import { test,before,after } from 'node:test';
import { fixtureDatabase } from './database-fixture.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/index.mjs';
import { openDatabase,transaction } from '../server/db.mjs';
import { hashPassword,verifyPassword } from '../server/auth.mjs';
import { scoreFromAverage,period,aggregate,localDay,midnight,shiftDay } from '../server/analytics.mjs';
import { detectAlerts } from '../server/alerts.mjs';
import { csv,pdf } from '../server/reports.mjs';

let db,server,origin,admin,unit,unit2;const password='Test-'+randomUUID(),ids={admin:randomUUID(),user:randomUUID(),user2:randomUUID(),unit:randomUUID(),unit2:randomUUID()};
async function request(path,{as,method='GET',data,csrf=true,headers={}}={}) {
  const r=await fetch(origin+path,{method,headers:{...as?{cookie:as.cookie}:{},...data?{'Content-Type':'application/json',...(csrf&&as?{'X-CSRF-Token':as.csrf}:{})}:{},...headers},...data?{body:JSON.stringify(data)}:{}});
  const type=r.headers.get('content-type');return {status:r.status,headers:r.headers,body:type?.includes('application/json')?await r.json():Buffer.from(await r.arrayBuffer())};
}
async function auth(username){const r=await request('/api/auth/login',{method:'POST',data:{username,password}});assert.equal(r.status,200);const cookie=r.headers.get('set-cookie').split(';')[0],me=await request('/api/me',{as:{cookie}});return{cookie,csrf:me.body.csrf};}
before(async()=>{
  db=await fixtureDatabase();const now=new Date().toISOString(),hash=hashPassword(password);
  for(const [id,name]of [[ids.unit,'UBS Teste A'],[ids.unit2,'UBS Teste B']])(await db.prepare('INSERT INTO units(id,name,device_id,created_at,updated_at) VALUES(?,?,?,?,?)').run(id,name,'DEVICE-'+id,now,now));
  for(const [id,name,role,unitId]of [[ids.admin,'TestAdmin','admin',null],[ids.user,'TestUnitA','unit',ids.unit],[ids.user2,'TestUnitB','unit',ids.unit2]])(await db.prepare('INSERT INTO users(id,username,password_hash,role,unit_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(id,name,hash,role,unitId,now,now));
  ({server}=(await createApp({db})));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
  admin=await auth('TestAdmin');unit=await auth('TestUnitA');unit2=await auth('TestUnitB');
});
after(async()=>{await new Promise(resolve=>server.close(resolve));(await db.close());});

test('password hashes use salted scrypt and verify safely',()=>{const a=hashPassword(password),b=hashPassword(password);assert.notEqual(a,b);assert.ok(verifyPassword(password,a));assert.ok(!verifyPassword('incorrect',a));assert.ok(!verifyPassword(password,'broken'));});
test('scoring endpoints and equal category weights',()=>{assert.equal(scoreFromAverage(1),0);assert.equal(scoreFromAverage(3),50);assert.equal(scoreFromAverage(5),100);assert.equal(scoreFromAverage(null),null);});
test('São Paulo dates and invalid ranges are handled',()=>{assert.equal(localDay('2026-10-10T02:00:00Z'),'2026-10-09');assert.equal(midnight('2026-10-10'),'2026-10-10T03:00:00.000Z');assert.throws(()=>period(new URLSearchParams({start:'2026-02-30',end:'2026-10-10'})));assert.throws(()=>period(new URLSearchParams({start:'2026-10-11',end:'2026-10-10'})));});
test('anonymous and unit roles cannot access any administrative resource',async()=>{for(const path of ['/api/admin/dashboard','/api/admin/users','/api/admin/evaluations','/api/admin/alerts','/api/admin/audit','/api/admin/settings','/api/admin/reports?format=csv','/api/admin/evidence/1']){assert.equal((await request(path)).status,401);assert.equal((await request(path,{as:unit})).status,403);}});
test('CSRF and cross-origin mutations are rejected',async()=>{assert.equal((await request('/api/admin/settings',{as:admin,method:'PATCH',data:{sample_min:5},csrf:false})).status,403);assert.equal((await request('/api/admin/settings',{as:admin,method:'PATCH',data:{sample_min:5},headers:{origin:'https://attacker.example'}})).status,403);});
test('incomplete or invalid evaluations cannot be partially stored',async()=>{for(const ratings of [[1,2,3],[1,2,3,4,5,6],[1,2,3,4,5,1.5]])assert.equal((await request('/api/evaluations',{as:unit,method:'POST',data:{ratings,key:randomUUID()}})).status,400);assert.equal((await db.prepare('SELECT COUNT(*) n FROM evaluations').get()).n,0);});
test('unit association is server controlled; retries are idempotent',async()=>{
  const data={ratings:[1,2,3,4,5,5],key:randomUUID(),unit_id:ids.unit2,photo_status:'declined'};
  const first=await request('/api/evaluations',{as:unit,method:'POST',data});assert.equal(first.status,201);assert.equal(first.body.saved,true);
  assert.equal((await request('/api/evaluations',{as:unit,method:'POST',data})).status,200);
  assert.equal((await request('/api/evaluations',{as:unit2,method:'POST',data})).status,409);
  assert.equal((await request('/api/evaluations',{as:unit,method:'POST',data:{...data,ratings:[5,5,5,5,5,5]}})).status,409);
  const row=(await db.prepare('SELECT * FROM evaluations WHERE id=?').get(first.body.id));assert.equal(row.unit_id,ids.unit);assert.equal(row.device_id,'DEVICE-'+ids.unit);assert.equal(row.photo_status,'declined');assert.equal((await db.prepare('SELECT COUNT(*) n FROM responses WHERE evaluation_id=?').get(row.id)).n,6);
  const a=(await aggregate(db,period()));assert.equal(a.summary.total,1);assert.equal(a.categories[0].score,0);assert.equal(a.categories[4].score,100);assert.equal(a.summary.score,(20/6-1)*25);
});
test('dashboard filters, no-data states and equivalent comparison are real',async()=>{const r=await request('/api/admin/dashboard?unit='+ids.unit2,{as:admin});assert.equal(r.status,200);assert.equal(r.body.summary.total,0);assert.equal(r.body.summary.score,null);assert.ok(r.body.categories.every(c=>c.score===null));assert.equal(r.body.previous.total,0);assert.ok(r.body.trend.every(c=>c.count===0));});
test('administrative unit and account management preserve boundaries',async()=>{
  const r=await request('/api/admin/units',{as:admin,method:'POST',data:{name:'UBS Nova',username:'UBSNova',password}});assert.equal(r.status,201);const account=(await db.prepare('SELECT * FROM users WHERE unit_id=?').get(r.body.id));assert.ok(account.password_hash.startsWith('scrypt$'));assert.equal(account.must_change,1);
  assert.equal((await request('/api/admin/units',{as:unit,method:'POST',data:{name:'Bad',username:'BadUser',password}})).status,403);
  assert.equal((await request('/api/admin/units/'+ids.unit,{as:admin,method:'PATCH',data:{active:false}})).status,200);
  assert.equal((await request('/api/evaluations',{as:unit,method:'POST',data:{ratings:[5,5,5,5,5,5],key:randomUUID()}})).status,401);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM evaluations WHERE unit_id=?').get(ids.unit)).n,1);
  await request('/api/admin/units/'+ids.unit,{as:admin,method:'PATCH',data:{active:true}});
});
test('transactions roll back all evaluation records on failure',async ()=>{const before=(await db.prepare('SELECT COUNT(*) n FROM evaluations').get()).n;(await assert.rejects(async ()=>(await transaction(db,async ()=>{const id=randomUUID();(await db.prepare('INSERT INTO evaluations(id,unit_id,created_at,device_id,idempotency_key,payload_hash) VALUES(?,?,?,?,?,?)').run(id,ids.unit,new Date().toISOString(),'test',randomUUID(),'hash'));(await db.prepare('INSERT INTO responses VALUES(?,?,?)').run(id,1,9));}))));assert.equal((await db.prepare('SELECT COUNT(*) n FROM evaluations').get()).n,before);});
test('alerts explain configured thresholds and maintain review history',async()=>{
  await request('/api/admin/settings',{as:admin,method:'PATCH',data:{sample_min:5,repeat_threshold:3}});
  unit=await auth('TestUnitA');for(let i=0;i<5;i++)assert.equal((await request('/api/evaluations',{as:unit,method:'POST',data:{ratings:[2,2,2,2,2,2],key:randomUUID()}})).status,201);
  (await detectAlerts(db));const alerts=await request('/api/admin/alerts',{as:admin});assert.ok(alerts.body.alerts.some(a=>a.type==='Respostas idênticas em sequência'));const a=alerts.body.alerts[0];assert.ok(a.evidence.length>20);
  assert.equal((await request('/api/admin/alerts/'+a.id,{as:admin,method:'PATCH',data:{status:'Em análise',notes:'Verificação do contexto operacional.'}})).status,200);assert.equal((await db.prepare('SELECT COUNT(*) n FROM alert_history WHERE alert_id=?').get(a.id)).n,1);
});
test('CSV and PDF reports are restricted and exclude secrets and photographs',async()=>{
  for(const format of ['csv','pdf']){const r=await request('/api/admin/reports?format='+format,{as:admin});assert.equal(r.status,200);assert.ok(r.headers.get('content-disposition').includes('.'+format));const value=r.body.toString('latin1');assert.ok(!value.includes('scrypt$'));assert.ok(!value.includes(admin.cookie));assert.ok(!value.includes(password));if(format==='pdf')assert.ok(value.startsWith('%PDF-1.4'));else assert.ok(r.body.toString('utf8').includes('Atendimento médico'));}
});
test('stored CSV cells cannot execute spreadsheet formulas',async()=>{const u=(await db.prepare('SELECT id FROM units WHERE name=\'UBS Nova\'').get());await request('/api/admin/units/'+u.id,{as:admin,method:'PATCH',data:{name:'=HYPERLINK("malicious")'}});const r=await request('/api/admin/reports?format=csv',{as:admin});assert.ok(r.body.toString('utf8').includes('"\'=HYPERLINK'));});
test('audit records are immutable and static files do not expose database',async()=>{(await assert.rejects(async ()=>(await db.prepare('DELETE FROM audit_logs').run())));(await assert.rejects(async ()=>(await db.prepare('UPDATE audit_logs SET action=\'tampered\'').run())));for(const path of ['/data/vox.sqlite','/.env','/server/auth.mjs'])assert.equal((await request(path)).status,404);});
test('password resets revoke sessions and production sessions require rotation',async()=>{
  const newPassword='New-'+randomUUID();assert.equal((await request('/api/admin/users/'+ids.user2,{as:admin,method:'PATCH',data:{password:newPassword}})).status,200);assert.equal((await request('/api/me',{as:unit2})).status,401);
  const prod=(await createApp({db,production:true,trustProxy:true}));await new Promise(resolve=>prod.server.listen(0,'127.0.0.1',resolve));
  try {const r=await fetch('http://127.0.0.1:'+prod.server.address().port+'/api/admin/dashboard',{headers:{cookie:admin.cookie,'x-forwarded-proto':'https'}});assert.equal(r.status,403);assert.equal((await r.json()).code,'PASSWORD_CHANGE_REQUIRED');}finally{await new Promise(resolve=>prod.server.close(resolve));}
});
test('login throttles repeated failures without leaking passwords',async()=>{for(let i=0;i<5;i++)assert.equal((await request('/api/auth/login',{method:'POST',data:{username:'UnknownUser',password:'incorrect-password'}})).status,401);assert.equal((await request('/api/auth/login',{method:'POST',data:{username:'UnknownUser',password:'incorrect-password'}})).status,429);});

test('parallel retries share one committed evaluation across server instances',async()=>{
  unit=await auth('TestUnitA');
  const {server:second}=await createApp({db});await new Promise(r=>second.listen(0,'127.0.0.1',r));
  const data={ratings:[3,4,3,4,3,4],key:randomUUID()};
  const send=base=>fetch(base+'/api/evaluations',{method:'POST',headers:{cookie:unit.cookie,'Content-Type':'application/json','X-CSRF-Token':unit.csrf},body:JSON.stringify(data)});
  try{
    const responses=await Promise.all([send(origin),send('http://127.0.0.1:'+second.address().port)]);
    assert.deepEqual(responses.map(r=>r.status).sort(),[200,201]);
    const bodies=await Promise.all(responses.map(r=>r.json()));assert.equal(bodies[0].id,bodies[1].id);
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM evaluations WHERE idempotency_key=?').get(data.key)).n,1);
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM responses WHERE evaluation_id=?').get(bodies[0].id)).n,6);
  }finally{await new Promise(r=>second.close(r));}
});
