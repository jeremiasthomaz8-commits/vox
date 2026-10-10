import { test,before,after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID,randomBytes } from 'node:crypto';
import { openDatabase } from '../server/db.mjs';
import { createApp } from '../server/index.mjs';
import { digest,hashPassword } from '../server/auth.mjs';
import { preparePhoto,PHOTO_NOTICE_VERSION,expirePhotos,decryptPhoto } from '../server/photos.mjs';

// A bounded JPEG fixture; browser tests separately validate a canvas-generated image.
const jpeg=Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=','base64');
const photo={data:'data:image/jpeg;base64,'+jpeg.toString('base64'),consent:true,notice_version:PHOTO_NOTICE_VERSION,retention_days:30};
let db,server,origin,admin,unit;const key=randomBytes(32),unitId=randomUUID();
async function req(path,{as=admin,method='GET',data,csrf=true}={}){
  const response=await fetch(origin+path,{method,headers:{...as?{cookie:as.cookie}:{},...csrf&&as?{'X-CSRF-Token':as.csrf}:{},...data?{'Content-Type':'application/json'}:{}},...data?{body:JSON.stringify(data)}:{}});
  return {status:response.status,headers:response.headers,body:response.headers.get('content-type')?.includes('json')?await response.json():Buffer.from(await response.arrayBuffer())};
}
before(async()=>{
  db=openDatabase(':memory:');const now=new Date().toISOString(),hash=hashPassword(randomBytes(24).toString('hex'));
  db.prepare('INSERT INTO units(id,name,device_id,created_at,updated_at) VALUES(?,?,?,?,?)').run(unitId,'UBS Teste','TEST-CAMERA',now,now);
  const accounts={};for(const role of ['admin','unit']){
    const id=randomUUID(),token=randomBytes(32).toString('hex'),csrf=randomBytes(24).toString('hex'),time=Date.now();
    db.prepare('INSERT INTO users(id,username,password_hash,role,unit_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(id,'Photo'+role,hash,role,role==='unit'?unitId:null,now,now);
    db.prepare('INSERT INTO sessions VALUES(?,?,?,?,?,?)').run(digest(token),id,csrf,time,time,time+3600000);accounts[role]={cookie:'vox_session='+token,csrf};
  }admin=accounts.admin;unit=accounts.unit;
  ({server}=createApp({db,photoEnabled:true,photoKey:key}));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
});
after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();});
test('camera capability is announced with consent version and retention',async()=>{const r=await req('/api/me',{as:unit});assert.equal(r.body.photo_enabled,true);assert.equal(r.body.photo_notice_version,PHOTO_NOTICE_VERSION);assert.equal(r.body.photo_retention_days,30);assert.ok(r.headers.get('permissions-policy').includes('camera=(self)'));});
test('valid consent encrypts photo; metadata never leaks bytes or authorization',async()=>{
  const data={ratings:[4,4,4,4,4,4],key:randomUUID(),photo_status:'captured',photo};
  const r=await req('/api/evaluations',{as:unit,method:'POST',data});assert.equal(r.status,201);assert.equal(r.body.photo_status,'captured');
  const row=db.prepare('SELECT * FROM photographic_evidence WHERE evaluation_id=?').get(r.body.id);assert.ok(row.encrypted_data);assert.ok(!Buffer.from(row.encrypted_data).equals(jpeg));assert.deepEqual(decryptPhoto(row,key),jpeg);assert.throws(()=>decryptPhoto({...row,evaluation_id:randomUUID()},key));assert.throws(()=>decryptPhoto(row,randomBytes(32)));
  const list=await req('/api/admin/photos');assert.equal(list.body.total,1);assert.equal(list.body.records[0].id,row.id);assert.ok(!JSON.stringify(list.body).includes('encrypted_data'));assert.ok(!JSON.stringify(list.body).includes('authorization_record'));assert.ok(!JSON.stringify(list.body).includes(photo.data));
  assert.equal((await req('/api/evaluations',{as:unit,method:'POST',data})).status,200);
  assert.equal((await req('/api/evaluations',{as:unit,method:'POST',data:{...data,photo:{...photo,consent:false}}})).status,409);
  const detail=await req('/api/admin/evaluations');assert.equal(detail.body.records[0].evidence_id,row.id);
});
test('only director can read images, with no cache and audited access',async()=>{
  const row=db.prepare("SELECT * FROM photographic_evidence WHERE status='captured'").get(),path='/api/admin/photos/'+row.id+'/image';
  assert.equal((await req(path,{as:null})).status,401);assert.equal((await req(path,{as:unit})).status,403);assert.equal((await req('/api/admin/photos',{as:unit})).status,403);
  const r=await req(path);assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'image/jpeg');assert.ok(r.headers.get('cache-control').includes('no-store'));assert.deepEqual(r.body,jpeg);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='Fotografia visualizada' AND target=?").get(row.id).n,1);
  assert.equal((await req('/data/private/photo-key.json',{as:null})).status,404);
});
test('denial, unavailable camera, invalid image and missing consent still save six ratings without photo',async()=>{
  const cases=[{photo_status:'declined'},{photo_status:'permission_denied'},{photo_status:'camera_unavailable'},{photo_status:'capture_failed'},{photo_status:'captured',photo:{...photo,consent:false}},{photo_status:'captured',photo:{...photo,data:'data:image/jpeg;base64,bm90LWEtcGhvdG8='}},{photo_status:'captured',photo:{...photo,notice_version:'obsolete'}}];
  for(const data of cases){const r=await req('/api/evaluations',{as:unit,method:'POST',data:{ratings:[5,4,3,2,1,4],key:randomUUID(),...data}});assert.equal(r.status,201);assert.notEqual(r.body.photo_status,'captured');assert.equal(db.prepare('SELECT COUNT(*) n FROM responses WHERE evaluation_id=?').get(r.body.id).n,6);assert.equal(db.prepare('SELECT encrypted_data FROM photographic_evidence WHERE evaluation_id=?').get(r.body.id).encrypted_data,null);}
});
test('manual deletion requires CSRF, preserves ratings and removes photo bytes',async()=>{
  const row=db.prepare("SELECT * FROM photographic_evidence WHERE status='captured'").get(),path='/api/admin/photos/'+row.id;
  assert.equal((await req(path,{method:'DELETE',csrf:false})).status,403);assert.equal((await req(path,{as:unit,method:'DELETE'})).status,403);
  assert.equal((await req(path,{method:'DELETE'})).status,200);assert.equal((await req(path+'/image')).status,410);
  assert.equal(db.prepare('SELECT encrypted_data FROM photographic_evidence WHERE id=?').get(row.id).encrypted_data,null);assert.equal(db.prepare('SELECT COUNT(*) n FROM responses WHERE evaluation_id=?').get(row.evaluation_id).n,6);
});
test('retention cannot exceed authorization and expiry purges only photographs',async()=>{
  assert.equal(preparePhoto({photo_status:'captured',photo},true,10).days,10);
  const r=await req('/api/evaluations',{as:unit,method:'POST',data:{ratings:[4,4,4,4,4,4],key:randomUUID(),photo_status:'captured',photo:{...photo,retention_days:1}}});
  const row=db.prepare('SELECT * FROM photographic_evidence WHERE evaluation_id=?').get(r.body.id);assert.ok(Date.parse(row.expires_at)-Date.parse(row.captured_at)<=86400001);
  assert.equal(expirePhotos(db,new Date(Date.now()+2*86400000).toISOString()),1);assert.equal(db.prepare('SELECT photo_status FROM evaluations WHERE id=?').get(r.body.id).photo_status,'deleted');assert.equal(db.prepare('SELECT COUNT(*) n FROM responses WHERE evaluation_id=?').get(r.body.id).n,6);
  assert.equal((await req('/api/admin/photos?status=captured')).body.total,0);assert.ok((await req('/api/admin/photos?status=deleted')).body.total>=2);
});
test('malformed JPEG marker runs are discarded without interrupting evaluations',async()=>{
  const malformed=Buffer.alloc(40,255);malformed.writeUInt16BE(0xffd8,0);malformed.writeUInt16BE(0xffd9,38);
  const r=await req('/api/evaluations',{as:unit,method:'POST',data:{ratings:[4,4,4,4,4,4],key:randomUUID(),photo_status:'captured',photo:{...photo,data:'data:image/jpeg;base64,'+malformed.toString('base64')}}});
  assert.equal(r.status,201);assert.equal(r.body.photo_status,'capture_failed');assert.equal(db.prepare('SELECT COUNT(*) n FROM responses WHERE evaluation_id=?').get(r.body.id).n,6);
});
