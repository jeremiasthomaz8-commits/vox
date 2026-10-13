import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {createVercelHandler,createVercelRetentionHandler} from '../server/vercel.mjs';
import {fixtureDatabase} from './database-fixture.mjs';

const env={VOX_DATABASE:'supabase',VERCEL_ENV:'production',PUBLIC_ORIGIN:'https://vox.example.test',TRUST_PROXY:'true',LEGAL_REVIEW_APPROVED:'true',PHOTO_CAPTURE_ENABLED:'false',CRON_SECRET:randomBytes(32).toString('hex')};
test('Vercel previews fail before connecting to the production database',async context=>{
  context.mock.method(console,'error',()=>{});let connections=0;
  const handler=createVercelHandler({env:{...env,VERCEL_ENV:'preview'},connect:async()=>{connections++;throw Error('must not connect');}});
  assert.equal((await handler(new Request(env.PUBLIC_ORIGIN+'/api/health'))).status,503);assert.equal(connections,0);
});
test('Vercel maintenance requires a configured secret and rejects anonymous calls without querying data',async()=>{
  let connections=0;const connect=async()=>{connections++;throw Error('must not connect');};
  const req=(method='GET',authorization)=>new Request(env.PUBLIC_ORIGIN+'/api/photo-retention',{method,headers:authorization?{authorization}:{}});
  const handler=createVercelRetentionHandler({env,connect});
  assert.equal((await handler(req())).status,401);
  assert.equal((await handler(req('GET','Bearer wrong'))).status,401);
  assert.equal((await handler(req('POST','Bearer '+env.CRON_SECRET))).status,405);
  assert.equal((await createVercelRetentionHandler({env:{...env,CRON_SECRET:''},connect})(req())).status,503);
  assert.equal(connections,0);
});
test('authenticated Vercel maintenance purges expired photos, keeps ratings and closes its connection',async()=>{
  const db=await fixtureDatabase(),now=new Date().toISOString(),unit=randomUUID(),evaluation=randomUUID(),photo=randomUUID();let closed=0;
  await db.prepare('INSERT INTO units(id,name,device_id,created_at,updated_at) VALUES(?,?,?,?,?)').run(unit,'UBS Teste','RETENTION',now,now);
  await db.prepare('INSERT INTO evaluations(id,unit_id,created_at,device_id,idempotency_key,payload_hash,photo_status) VALUES(?,?,?,?,?,?,?)').run(evaluation,unit,now,'RETENTION',randomUUID(),'test','captured');
  for(let i=1;i<=6;i++)await db.prepare('INSERT INTO responses VALUES(?,?,?)').run(evaluation,i,4);
  await db.prepare('INSERT INTO photographic_evidence(id,evaluation_id,status,encrypted_data,expires_at) VALUES(?,?,?,?,?)').run(photo,evaluation,'captured',Buffer.from('expired'),new Date(Date.now()-86400000).toISOString());
  const handler=createVercelRetentionHandler({env,connect:async()=>({...db,close:async()=>{closed++;}})});
  try {
    const r=await handler(new Request(env.PUBLIC_ORIGIN+'/api/photo-retention',{headers:{authorization:'Bearer '+env.CRON_SECRET}}));
    assert.equal(r.status,200);assert.deepEqual(await r.json(),{removed:1});assert.equal(closed,1);
    const stored=await db.prepare('SELECT status,encrypted_data FROM photographic_evidence WHERE id=?').get(photo);assert.equal(stored.status,'deleted');assert.equal(stored.encrypted_data,null);
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM responses WHERE evaluation_id=?').get(evaluation)).n,6);
  }finally{await db.close();}
});
