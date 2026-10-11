import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixtureDatabase} from './database-fixture.mjs';
import {postgresSql,postgresConnectionOptions} from '../server/database-adapter.mjs';
import {connectDatabase,openDatabase,asAsyncDatabase} from '../server/db.mjs';
import {importSqlite} from '../scripts/migrate-supabase.mjs';

test('PostgreSQL placeholders preserve quoted values and comments; TLS always verifies the server',()=>{
  assert.equal(postgresSql("SELECT '?' literal FROM users WHERE username=? -- ? users\n"),"SELECT '?' literal FROM vox.users WHERE username=$1 -- ? users\n");
  const config=postgresConnectionOptions('postgresql://example:private@example.test/postgres?sslmode=disable','ca\\ncontents');
  assert.equal(config.ssl.rejectUnauthorized,true);assert.equal(config.ssl.ca,'ca\ncontents');assert.ok(!config.connectionString.includes('sslmode'));
});
test('Supabase configuration never silently falls back to a local database',async()=>{
  await assert.rejects(()=>connectDatabase({VOX_DATABASE:'supabase'}),/DATABASE_URL/);
  await assert.rejects(()=>connectDatabase({VOX_DATABASE:'unknown'}),/VOX_DATABASE/);
});
test('asynchronous SQLite transactions isolate other operations and roll back after awaited failures',async()=>{
  const db=asAsyncDatabase(openDatabase(':memory:'));
  try {
    let release,entered;const gate=new Promise(r=>release=r),inside=new Promise(r=>entered=r);
    const operation=db.transaction(async()=>{await db.prepare('UPDATE settings SET sample_min=7 WHERE id=1').run();entered();await gate;throw Error('rollback');});
    await inside;const read=db.prepare('SELECT sample_min FROM settings WHERE id=1').get();release();
    await assert.rejects(()=>operation,/rollback/);assert.equal((await read).sample_min,30);
  }finally{await db.close();}
});
test('SQLite migration preserves account hashes, settings and audit; populated targets are refused',async()=>{
  const saved=process.env.TEST_DATABASE;process.env.TEST_DATABASE='postgres';const target=await fixtureDatabase();
  if(saved===undefined)delete process.env.TEST_DATABASE;else process.env.TEST_DATABASE=saved;
  const source=openDatabase(':memory:'),id=randomUUID(),now=new Date().toISOString();
  try {
    source.prepare('INSERT INTO units(id,name,device_id,created_at,updated_at) VALUES(?,?,?,?,?)').run(id,'Migração','TEST',now,now);
    source.prepare("INSERT INTO users(id,username,password_hash,role,created_at,updated_at) VALUES(?,?,?,'admin',?,?)").run(randomUUID(),'MigratedAdmin','original-hash',now,now);
    source.exec('UPDATE settings SET photo_retention_days=12');
    const result=await importSqlite(source,target);assert.equal(result.users,1);
    assert.equal((await target.prepare('SELECT password_hash FROM users').get()).password_hash,'original-hash');
    assert.equal((await target.prepare('SELECT photo_retention_days FROM settings').get()).photo_retention_days,12);
    await assert.rejects(()=>importSqlite(source,target),/já contém dados/);
    await assert.rejects(()=>target.prepare('DELETE FROM audit_logs').run());
    await assert.rejects(()=>target.prepare('UPDATE categories SET name=? WHERE id=1').run('tampered'));
    await assert.rejects(()=>target.exec('CREATE TABLE vox.forbidden(id int)'));
  }finally{source.close();await target.close();}
});
