import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn,spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync,rmSync,readdirSync,realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve,dirname,basename } from 'node:path';
import { openDatabase,ROOT } from '../server/db.mjs';
import { runtimeConfig } from '../server/runtime.mjs';
import { provisionFromEnv } from '../server/bootstrap.mjs';
import { verifyPassword } from '../server/auth.mjs';

const approved={NODE_ENV:'production',TRUST_PROXY:'true',LEGAL_REVIEW_APPROVED:'true',PHOTO_CAPTURE_ENABLED:'false',PUBLIC_ORIGIN:'https://vox.example.test'};
const credentials=()=>({VOX_ADMIN_PASSWORD:'Admin-'+randomUUID(),VOX_UNIT_PASSWORD:'Unit-'+randomUUID()});

test('runtime resolves Render HTTPS origin and binding without changing local defaults',()=>{
  assert.deepEqual(runtimeConfig({}),{production:false,publicOrigin:'',trustProxy:false,photoEnabled:false,host:'127.0.0.1',port:3000});
  const config=runtimeConfig({...approved,PUBLIC_ORIGIN:'',RENDER:'true',RENDER_EXTERNAL_URL:'https://vox-example.onrender.com/'});
  assert.equal(config.publicOrigin,'https://vox-example.onrender.com');assert.equal(config.host,'0.0.0.0');assert.equal(config.port,10000);
  assert.equal(runtimeConfig({...approved,RENDER:'true',RENDER_EXTERNAL_URL:'https://ignored.onrender.com'}).publicOrigin,approved.PUBLIC_ORIGIN);
  assert.throws(()=>runtimeConfig({...approved,PUBLIC_ORIGIN:'',RENDER_EXTERNAL_URL:'https://ignored.onrender.com'}));
});

test('production rejects absent approvals, untrusted proxies, malformed origins and ports',()=>{
  for(const patch of [{LEGAL_REVIEW_APPROVED:'false'},{TRUST_PROXY:'false'},{PUBLIC_ORIGIN:'http://vox.example.test'},
    {PUBLIC_ORIGIN:'https://user:secret@vox.example.test'},{PUBLIC_ORIGIN:'https://vox.example.test/path'},
    {PUBLIC_ORIGIN:'https://vox.example.test?query=1'},{PUBLIC_ORIGIN:'https://vox.example.test#hash'},
    {PUBLIC_ORIGIN:'not-a-url'},{PORT:'0'},{PORT:'65536'},{PORT:'1.5'},{PHOTO_CAPTURE_ENABLED:'true'}])
    assert.throws(()=>runtimeConfig({...approved,...patch}));
  assert.equal(runtimeConfig({...approved,PHOTO_CAPTURE_ENABLED:'true',PHOTO_PRIVACY_APPROVED:'true'}).photoEnabled,true);
});

test('cloud provisioning validates secrets before writing and keeps a fresh database empty',()=>{
  const db=openDatabase(':memory:');
  try {
    assert.equal(provisionFromEnv(db,{}),false);
    for(const env of [{},{VOX_ADMIN_PASSWORD:'too-short'},{...credentials(),VOX_UNIT_USERNAME:'Bad user'},
      {...credentials(),VOX_ADMIN_USERNAME:'SameUser',VOX_UNIT_USERNAME:'sameuser'}]) {
      assert.throws(()=>provisionFromEnv(db,env,{required:true}));
      for(const table of ['users','units','evaluations','audit_logs'])assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n,0);
    }
    const env=credentials();assert.equal(provisionFromEnv(db,env,{required:true}),true);
    const users=db.prepare('SELECT * FROM users ORDER BY role').all();assert.equal(users.length,2);
    assert.equal(users[0].username,'admregulacaodiretor');assert.equal(users[0].unit_id,null);assert.equal(users[1].username,'UBSMonterrey');
    assert.ok(users.every(u=>u.must_change===1));assert.ok(verifyPassword(env.VOX_ADMIN_PASSWORD,users[0].password_hash));
    assert.ok(verifyPassword(env.VOX_UNIT_PASSWORD,users[1].password_hash));
    assert.equal(db.prepare('SELECT COUNT(*) n FROM evaluations').get().n,0);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM categories').get().n,6);
    const audit=JSON.stringify(db.prepare('SELECT * FROM audit_logs').all());
    assert.ok(!audit.includes(env.VOX_ADMIN_PASSWORD));assert.ok(!audit.includes(env.VOX_UNIT_PASSWORD));
    assert.equal(provisionFromEnv(db,{}, {required:true}),false);
    assert.equal(provisionFromEnv(db,credentials(),{required:true}),false);
    assert.deepEqual(db.prepare('SELECT * FROM users ORDER BY role').all(),users);
  }finally{db.close();}
});

test('failed provisioning rolls back both accounts and the initial audit',()=>{
  const db=openDatabase(':memory:');
  try {
    db.exec("CREATE TRIGGER reject_unit BEFORE INSERT ON users WHEN NEW.role='unit' BEGIN SELECT RAISE(ABORT,'test rollback'); END;");
    assert.throws(()=>provisionFromEnv(db,credentials(),{required:true}));
    for(const table of ['users','units','audit_logs'])assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n,0);
  }finally{db.close();}
});

function request(port,path,{method='GET',headers={},data}={}) {
  return new Promise((resolve,reject)=>{
    const req=http.request({hostname:'127.0.0.1',port,path,method,agent:false,headers:{...headers,...data?{'Content-Type':'application/json'}:{}}},res=>{
      const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>{
        const value=Buffer.concat(chunks).toString();resolve({status:res.statusCode,headers:res.headers,body:res.headers['content-type']?.startsWith('application/json')&&value?JSON.parse(value):value});
      });
    });req.on('error',reject);if(data)req.write(JSON.stringify(data));req.end();
  });
}
async function unusedPort() {
  const probe=http.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));
  const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));return port;
}
async function start(env) {
  const child=spawn(process.execPath,['server/index.mjs'],{cwd:ROOT,env:{...process.env,...env},windowsHide:true,stdio:['ignore','pipe','pipe']});
  let logs='';child.stdout.on('data',chunk=>logs+=chunk);child.stderr.on('data',chunk=>logs+=chunk);
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{child.kill();reject(Error('Timed out starting isolated production server'));},10000);
    const failed=()=>{clearTimeout(timer);reject(Error('Isolated production server exited before becoming ready'));};
    child.once('error',failed);child.once('exit',failed);
    child.stdout.on('data',()=>{if(logs.includes('Vox disponível em ')){clearTimeout(timer);child.off('error',failed);child.off('exit',failed);resolve();}});
  });
  return {child,logs:()=>logs};
}
async function stop(child) {
  if(child.exitCode!==null||child.signalCode!==null)return;
  await new Promise(resolve=>{child.once('exit',resolve);child.kill();});
}
function removeTestDirectory(directory) {
  const target=realpathSync(directory),parent=realpathSync(tmpdir());
  assert.equal(dirname(target).toLowerCase(),parent.toLowerCase());
  assert.ok(basename(target).startsWith('vox-deployment-'));
  rmSync(target,{recursive:true,force:true});
}

test('production start, independent device sessions, HTTPS checks, restart persistence and consistent backup',{timeout:30000},async()=>{
  const directory=mkdtempSync(join(tmpdir(),'vox-deployment-')),filename=join(directory,'vox.sqlite'),port=await unusedPort();
  const secrets=credentials(),origin=approved.PUBLIC_ORIGIN;
  const env={...approved,...secrets,PUBLIC_ORIGIN:'',RENDER:'true',RENDER_EXTERNAL_URL:origin,HOST:'127.0.0.1',PORT:String(port),VOX_DB:filename};
  const forwarded={host:new URL(origin).host,'x-forwarded-proto':'https'};
  let running;
  try {
    running=await start(env);
    const health=await request(port,'/api/health',{headers:{host:'internal.render.test'}});
    assert.equal(health.status,200);assert.deepEqual(health.body,{status:'ok',name:'Vox'});
    const head=await request(port,'/api/health',{method:'HEAD'});assert.equal(head.status,200);assert.equal(head.body,'');
    assert.equal((await request(port,'/api/health',{method:'POST'})).status,400);
    assert.equal((await request(port,'/',{headers:{host:forwarded.host}})).status,400);
    assert.equal((await request(port,'/api/auth/login',{method:'POST',data:{username:'admregulacaodiretor',password:secrets.VOX_ADMIN_PASSWORD}})).status,400);
    assert.equal((await request(port,'/',{headers:{...forwarded,host:'other.example.test'}})).status,400);
    assert.equal((await request(port,'/',{headers:forwarded})).status,200);
    const auth=async(username,password)=>{
      const login=await request(port,'/api/auth/login',{method:'POST',headers:{...forwarded,origin},data:{username,password}});
      assert.equal(login.status,200);assert.match(login.headers['set-cookie'][0],/; Secure/);
      const cookie=login.headers['set-cookie'][0].split(';')[0];
      const me=await request(port,'/api/me',{headers:{...forwarded,cookie}});assert.equal(me.status,200);
      return {...forwarded,cookie,origin,'x-csrf-token':me.body.csrf};
    };
    const admin=await auth('admregulacaodiretor',secrets.VOX_ADMIN_PASSWORD),unit=await auth('UBSMonterrey',secrets.VOX_UNIT_PASSWORD);
    assert.notEqual(admin.cookie,unit.cookie);
    assert.equal((await request(port,'/api/admin/dashboard',{headers:admin})).body.code,'PASSWORD_CHANGE_REQUIRED');
    const newAdmin='Changed-admin-'+randomUUID(),newUnit='Changed-unit-'+randomUUID();
    assert.equal((await request(port,'/api/auth/password',{method:'POST',headers:admin,data:{current:secrets.VOX_ADMIN_PASSWORD,password:newAdmin}})).status,200);
    assert.equal((await request(port,'/api/auth/password',{method:'POST',headers:unit,data:{current:secrets.VOX_UNIT_PASSWORD,password:newUnit}})).status,200);
    assert.equal((await request(port,'/api/admin/photos',{headers:unit})).status,403);
    assert.equal((await request(port,'/api/evaluations',{method:'POST',headers:unit,data:{ratings:[5,4,3,4,5,4],key:randomUUID(),photo_status:'disabled'}})).status,201);
    assert.equal((await request(port,'/api/admin/dashboard',{headers:admin})).body.summary.total,1);
    assert.ok(!running.logs().includes(secrets.VOX_ADMIN_PASSWORD));assert.ok(!running.logs().includes(secrets.VOX_UNIT_PASSWORD));
    await stop(running.child);
    running=await start({...env,VOX_ADMIN_PASSWORD:'obsolete',VOX_UNIT_PASSWORD:'obsolete'});
    assert.ok(!running.logs().includes('acessos iniciais criados'));
    const afterRestart=await auth('admregulacaodiretor',newAdmin);
    assert.equal((await request(port,'/api/admin/dashboard',{headers:afterRestart})).body.summary.total,1);
    assert.equal((await request(port,'/api/me',{headers:await auth('UBSMonterrey',newUnit)})).body.user.role,'unit');
    await stop(running.child);
    const backup=spawnSync(process.execPath,['scripts/backup.mjs'],{cwd:ROOT,env:{...process.env,...env,VOX_BACKUP_DIR:''},encoding:'utf8',windowsHide:true});
    assert.equal(backup.status,0,backup.stderr);
    const backups=readdirSync(join(directory,'backups')).filter(f=>f.endsWith('.sqlite'));assert.equal(backups.length,1);
    const restored=openDatabase(resolve(directory,'backups',backups[0]));
    try {
      assert.equal(restored.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
      assert.equal(restored.prepare('SELECT COUNT(*) n FROM evaluations').get().n,1);
      assert.equal(restored.prepare('SELECT COUNT(*) n FROM responses').get().n,6);
      assert.equal(restored.prepare('SELECT COUNT(*) n FROM users').get().n,2);
      assert.equal(restored.prepare('SELECT COUNT(*) n FROM evaluations WHERE demo=1').get().n,0);
    }finally{restored.close();}
  }finally{
    if(running)await stop(running.child);
    removeTestDirectory(directory);
  }
});
