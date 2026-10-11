import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID,randomBytes } from 'node:crypto';
import { fixtureDatabase } from './database-fixture.mjs';
import { hashPassword,digest } from '../server/auth.mjs';
import { createNetlifyHandler } from '../server/netlify.mjs';
import { PHOTO_NOTICE_VERSION } from '../server/photos.mjs';

const env={VOX_DATABASE:'supabase',NETLIFY:'true',URL:'https://vox.example.test',TRUST_PROXY:'true',LEGAL_REVIEW_APPROVED:'true',PHOTO_CAPTURE_ENABLED:'true',PHOTO_PRIVACY_APPROVED:'true'};
const jpeg=Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=','base64');

test('modern Netlify adapter preserves logins, CSRF, idempotency, protected photo bytes, reports and logout',async()=>{
  const db=await fixtureDatabase(),unitId=randomUUID(),password='Netlify-'+randomUUID(),now=new Date().toISOString();
  await db.prepare('INSERT INTO units(id,name,device_id,created_at,updated_at) VALUES(?,?,?,?,?)').run(unitId,'UBS Teste','NETLIFY-TEST',now,now);
  for(const role of ['admin','unit'])await db.prepare('INSERT INTO users(id,username,password_hash,role,unit_id,created_at,updated_at,must_change) VALUES(?,?,?,?,?,?,?,0)').run(randomUUID(),'Netlify'+role,hashPassword(password),role,role==='unit'?unitId:null,now,now);
  let connections=0;
  const handler=createNetlifyHandler({env,photoKey:randomBytes(32),connect:async config=>{assert.equal(config.NODE_ENV,'production');connections++;return db;}});
  async function req(path,{as,method='GET',data,headers={},origin=env.URL}={}){
    return handler(new Request(origin+path,{method,headers:{...as?{cookie:as.cookie,'x-csrf-token':as.csrf}:{},...data?{'content-type':'application/json'}:{},...headers},...data?{body:JSON.stringify(data)}:{}}),{ip:'192.0.2.10',site:{url:env.URL}});
  }
  async function auth(role){
    const login=await req('/api/auth/login',{method:'POST',data:{username:'Netlify'+role,password}});
    assert.equal(login.status,200);assert.match(login.headers.get('set-cookie'),/HttpOnly.*SameSite=Strict.*Secure/);
    const cookie=login.headers.get('set-cookie').split(';')[0],me=await req('/api/me',{as:{cookie}});
    assert.equal(me.status,200);return {cookie,csrf:(await me.json()).csrf};
  }
  try {
    const first=await Promise.all([req('/api/health'),req('/api/me')]);assert.equal(first[0].status,200);assert.equal(first[1].status,401);assert.equal(connections,1);
    const admin=await auth('admin'),unit=await auth('unit');
    assert.equal((await req('/api/admin/dashboard',{as:unit})).status,403);
    assert.equal((await req('/api/admin/settings',{as:admin,method:'PATCH',data:{sample_min:5},headers:{origin:'https://attacker.test'}})).status,403);
    assert.equal((await req('/api/admin/settings',{as:admin,method:'PATCH',data:{sample_min:5},headers:{'x-csrf-token':'wrong'}})).status,403);
    assert.equal((await req('/api/me',{as:admin,origin:'https://attacker.test',headers:{host:'vox.example.test'}})).status,400);
    assert.equal((await req('/api/me',{as:admin,origin:'http://vox.example.test',headers:{'x-forwarded-proto':'https'}})).status,400);
    const data={key:randomUUID(),ratings:[5,4,3,2,4,5],photo_status:'captured',photo:{data:'data:image/jpeg;base64,'+jpeg.toString('base64'),consent:true,notice_version:PHOTO_NOTICE_VERSION,retention_days:30}};
    const saved=await req('/api/evaluations',{as:unit,method:'POST',data});assert.equal(saved.status,201);
    assert.equal((await req('/api/evaluations',{as:unit,method:'POST',data})).status,200);
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM evaluations').get()).n,1);
    const photo=await db.prepare('SELECT * FROM photographic_evidence WHERE evaluation_id=?').get((await saved.json()).id);
    assert.ok(!Buffer.from(photo.encrypted_data).equals(jpeg));
    const photoPath='/api/admin/photos/'+photo.id+'/image';
    assert.equal((await req(photoPath,{as:unit})).status,403);
    const image=await req(photoPath,{as:admin});assert.equal(image.status,200);assert.deepEqual(Buffer.from(await image.arrayBuffer()),jpeg);assert.match(image.headers.get('cache-control'),/no-store/);
    const report=await req('/api/admin/reports?format=pdf',{as:admin});assert.equal(report.status,200);
    const bytes=Buffer.from(await report.arrayBuffer());assert.equal(bytes.subarray(0,8).toString(),'%PDF-1.4');assert.ok(bytes.includes(Buffer.from('FontFile2')));
    const csv=await req('/api/admin/reports?format=csv',{as:admin});assert.equal(csv.status,200);assert.ok((await csv.text()).includes('Atendimento médico'));
    assert.equal((await req('/api/auth/login',{method:'POST',data:{username:'Netlifyunit',password:'incorrect'},headers:{'x-forwarded-for':'192.0.2.99'}})).status,401);
    assert.ok(await db.prepare('SELECT 1 FROM login_attempts WHERE key=?').get('ip:'+digest('192.0.2.10')));
    assert.equal(await db.prepare('SELECT 1 FROM login_attempts WHERE key=?').get('ip:'+digest('192.0.2.99')),undefined);
    assert.equal((await req('/api/evaluations',{as:unit,method:'POST',data:{oversized:'x'.repeat(400001)}})).status,413);
    const logout=await req('/api/auth/logout',{as:unit,method:'POST'});assert.equal(logout.status,200);assert.match(logout.headers.get('set-cookie'),/Max-Age=0/);
    assert.equal((await req('/api/me',{as:unit})).status,401);
  }finally{await handler.close();}
});

test('failed cold starts retry, redact infrastructure errors and reject SQLite fallback',async context=>{
  const log=context.mock.method(console,'error',()=>{}),db=await fixtureDatabase(),now=new Date().toISOString();
  await db.prepare('INSERT INTO users(id,username,password_hash,role,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(randomUUID(),'NetlifyRetry',hashPassword(randomUUID()),'admin',now,now);
  const privateValue='test-infrastructure-password';let attempts=0;
  const handler=createNetlifyHandler({env:{...env,PHOTO_CAPTURE_ENABLED:'false'},connect:async()=>{if(++attempts===1)throw Error(privateValue);return db;}});
  const request=()=>new Request(env.URL+'/api/health');
  try {
    const failed=await handler(request());assert.equal(failed.status,503);assert.ok(!(await failed.text()).includes(privateValue));
    assert.equal((await handler(request())).status,200);assert.equal(attempts,2);
    const invalid=createNetlifyHandler({env:{...env,VOX_DATABASE:'sqlite'},connect:()=>{throw Error('must not connect');}});
    assert.equal((await invalid(request())).status,503);
    assert.ok(!JSON.stringify(log.mock.calls).includes(privateValue));
  }finally{await handler.close();}
});
