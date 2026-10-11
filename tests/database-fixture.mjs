import {readFileSync,readdirSync} from 'node:fs';
import {openDatabase,asAsyncDatabase} from '../server/db.mjs';
import {postgresAdapter} from '../server/database-adapter.mjs';
export async function fixtureDatabase(){
  if(process.env.TEST_DATABASE!=='postgres')return asAsyncDatabase(openDatabase(':memory:'));
  const {PGlite}=await import('@electric-sql/pglite');
  const raw=new PGlite(),directory=new URL('../supabase/migrations/',import.meta.url);
  for(const file of readdirSync(directory).filter(f=>f.endsWith('.sql')).sort())await raw.exec(readFileSync(new URL(file,directory),'utf8'));
  await raw.exec(readFileSync(new URL('../supabase/vox-app-role.sql',import.meta.url),'utf8').replace('GRANT CONNECT ON DATABASE postgres TO vox_app;',''));
  await raw.exec('SET ROLE vox_app');
  // PostgreSQL WASM does not need cluster-wide advisory locks: one connection serializes transactions.
  const db=postgresAdapter(raw,{close:()=>raw.close(),transaction:fn=>raw.transaction(fn)});db.lock=async()=>{};
  return db;
}
