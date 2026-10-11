import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { localDay } from './analytics.mjs';
import { asAsyncDatabase, openPostgres } from './database-adapter.mjs';
export { asAsyncDatabase } from './database-adapter.mjs';

// Netlify bundles modules into the function entry file. Runtime assets retain
// their repository paths relative to the deployed function's working directory.
export const ROOT = process.env.LAMBDA_TASK_ROOT || (process.env.NETLIFY==='true' ? process.cwd() : fileURLToPath(new URL('../', import.meta.url)));
export const CATEGORIES = [
  ['Atendimento da equipe', 'Como foi o atendimento da equipe?'],
  ['Atendimento médico', 'Como foi o atendimento médico?'],
  ['Higiene e limpeza', 'Como estavam a higiene e a limpeza?'],
  ['Organização da unidade', 'Como foi a organização da unidade?'],
  ['Comunicação visual', 'As placas e orientações estavam claras?'],
  ['Satisfação geral', 'De modo geral, como foi sua experiência?']
];
export function openDatabase(filename = process.env.VOX_DB || resolve(ROOT, 'data/vox.sqlite')) {
  if (filename !== ':memory:') mkdirSync(dirname(resolve(filename)), { recursive: true });
  const db = new DatabaseSync(filename);
  db.function('sao_day', { deterministic:true }, value=>localDay(value));
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
  if (!db.prepare('SELECT 1 FROM schema_migrations WHERE version=1').get()) {
    sqliteTransaction(db, () => {
      db.exec(readFileSync(resolve(ROOT, 'migrations/001_initial.sql'), 'utf8'));
      db.prepare('INSERT INTO schema_migrations VALUES(1,?)').run(new Date().toISOString());
      for (const [i, c] of CATEGORIES.entries()) db.prepare('INSERT INTO categories VALUES(?,?,?,?)').run(i+1,c[0],c[1],i+1);
      db.prepare('INSERT INTO settings(id,updated_at) VALUES(1,?)').run(new Date().toISOString());
    });
  }
  for(const filename of readdirSync(resolve(ROOT,'migrations')).filter(f=>/^\d+_.+\.sql$/.test(f)).sort()) {
    const version=Number(filename.split('_')[0]);
    if(!db.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(version))sqliteTransaction(db,()=>{
      db.exec(readFileSync(resolve(ROOT,'migrations',filename),'utf8'));
      db.prepare('INSERT INTO schema_migrations VALUES(?,?)').run(version,new Date().toISOString());
    });
  }
  return db;
}
function sqliteTransaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = fn(); db.exec('COMMIT'); return result; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}
export async function transaction(db,fn) {return asAsyncDatabase(db).transaction(fn);}
export async function connectDatabase(env=process.env) {
  const provider=env.VOX_DATABASE || (env.DATABASE_URL?'supabase':'sqlite');
  if(provider==='sqlite')return asAsyncDatabase(openDatabase(env.VOX_DB));
  if(provider!=='supabase')throw Error('VOX_DATABASE deve ser sqlite ou supabase.');
  if(!env.DATABASE_URL)throw Error('Configure DATABASE_URL para conectar ao Supabase.');
  const ca=env.DATABASE_CA_CERT||readFileSync(resolve(ROOT,'supabase/certs/prod-ca-2021.crt'),'utf8');
  const db=openPostgres(env.DATABASE_URL,ca,{serverless:env.NETLIFY==='true'});
  try {
    if(!(await db.prepare('SELECT version FROM schema_migrations WHERE version=1').get()))throw Error('Aplique a migração do Vox no Supabase antes de iniciar.');
    return db;
  }catch(error){await db.close();throw error;}
}
export async function audit(db, actor, action, target, metadata={}) {
  await db.prepare('INSERT INTO audit_logs VALUES(?,?,?,?,?,?)').run(randomUUID(),actor || null,action,String(target),new Date().toISOString(),JSON.stringify(metadata));
}
export function loadEnv() {
  const filename = resolve(ROOT, '.env');
  if (!existsSync(filename)) return;
  for (const line of readFileSync(filename,'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]]=m[2].replace(/^['"]|['"]$/g,'');
  }
}
