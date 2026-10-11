import { AsyncLocalStorage } from 'node:async_hooks';
import pg from 'pg';

const tables=new Set(['units','users','categories','evaluations','responses','photographic_evidence','alerts','alert_history','audit_logs','settings','sessions','login_attempts','schema_migrations']);
// Queries are authored by the server. Values always travel separately as parameters.
export function postgresSql(sql) {
  sql=sql.replace(/\bINSERT OR IGNORE INTO alerts\b/g,'INSERT INTO alerts').replace(/\bCOLLATE NOCASE\b/g,'')
    .replace(/group_concat\(r\.rating,','\)/g,"string_agg(r.rating::text,',' ORDER BY r.category_id)")
    .replace(/json_group_array\(json_object\('category_id',r\.category_id,'rating',r\.rating\)\)/g,"json_agg(json_build_object('category_id',r.category_id,'rating',r.rating))::text")
    .replace(/json_extract\(a\.metadata,'\$\.unit_id'\)/g,"(a.metadata::jsonb ->> 'unit_id')")
    .replace(/HAVING n>=/g,'HAVING COUNT(*)>=');
  let parameter=0;
  const tokens=sql.match(/--[^\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:""|[^"])*"|\$([A-Za-z_][A-Za-z_0-9]*)?\$[\s\S]*?\$\1\$|[A-Za-z_][A-Za-z_0-9]*|\?|[^\sA-Za-z_?'"$]+|\s+|\$/g)||[];
  return tokens.map((token,i)=>{
    if(token==='?')return '$'+(++parameter);
    if((tables.has(token)||token==='sao_day')&&!tokens[i-1]?.trim().endsWith('.')&&!tokens[i+1]?.trim().startsWith('.'))return 'vox.'+token;
    return token;
  }).join('');
}
const numeric=new Set([20,21,23,700,701,1700]);
function normalize(result) {
  const rows=result.rows.map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>{
    const type=result.fields?.find(f=>f.name===key)?.dataTypeID;
    if(value!==null&&numeric.has(type)){
      const number=Number(value);
      if(type===20&&!Number.isSafeInteger(number))throw Error('Database integer exceeds the safe range.');
      return [key,number];
    }return [key,value];
  })));
  return {rows,changes:result.rowCount??result.affectedRows??0};
}
export function postgresAdapter(pool,{close=()=>pool.end(),transaction:driverTransaction}={}) {
  const context=new AsyncLocalStorage();
  const query=async(sql,args=[])=>normalize(await (context.getStore()||pool).query(postgresSql(sql),args));
  const db={dialect:'postgres',prepare(sql){return {
    get:async(...args)=>(await query(sql,args)).rows[0],
    all:async(...args)=>(await query(sql,args)).rows,
    run:async(...args)=>({changes:(await query(sql,args)).changes})
  };},exec:async sql=>{const client=context.getStore()||pool;return client.exec?client.exec(sql):client.query(sql);},close,
    async lock(key){if(!context.getStore())throw Error('Database lock requires a transaction.');await query('SELECT pg_advisory_xact_lock(hashtextextended(?,0))',[key]);},
    async transaction(fn){
      if(context.getStore())throw Error('Nested database transactions are not supported.');
      if(driverTransaction)return driverTransaction(client=>context.run(client,fn));
      const client=await pool.connect();
      try{await client.query('BEGIN');const result=await context.run(client,fn);await client.query('COMMIT');return result;}
      catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
    }
  };
  return db;
}
export function postgresConnectionOptions(url,ca) {
  const parsed=new URL(url);
  if(!['postgres:','postgresql:'].includes(parsed.protocol))throw Error('DATABASE_URL deve ser uma conexão PostgreSQL.');
  // pg's sslmode parameters override ssl options; remove them before setting verified TLS.
  for(const key of ['sslmode','sslcert','sslkey','sslrootcert'])parsed.searchParams.delete(key);
  return {connectionString:parsed.toString(),ssl:{rejectUnauthorized:true,...ca?{ca:ca.replaceAll('\\n','\n')}:{}},max:5,connectionTimeoutMillis:15000,idleTimeoutMillis:30000,application_name:'vox'};
}
export function openPostgres(url,ca,{serverless=false}={}) {
  const pool=new pg.Pool({...postgresConnectionOptions(url,ca),...serverless?{max:1,idleTimeoutMillis:1000,allowExitOnIdle:true}:{}});
  pool.on('error',()=>console.error('database_pool_error'));
  return postgresAdapter(pool);
}
const wrappers=new WeakMap();
export function asAsyncDatabase(raw) {
  if(raw.dialect)return raw;
  if(wrappers.has(raw))return wrappers.get(raw);
  const context=new AsyncLocalStorage();let tail=Promise.resolve();
  async function exclusive(fn){const previous=tail;let release;tail=new Promise(resolve=>release=resolve);await previous;try{return await fn();}finally{release();}}
  const execute=fn=>context.getStore()?Promise.resolve().then(fn):exclusive(fn);
  const db={dialect:'sqlite',prepare(sql){return {get:(...a)=>execute(()=>raw.prepare(sql).get(...a)),all:(...a)=>execute(()=>raw.prepare(sql).all(...a)),run:(...a)=>execute(()=>raw.prepare(sql).run(...a))};},
    exec:sql=>execute(()=>raw.exec(sql)),close:()=>execute(()=>raw.close()),lock:async()=>{},
    transaction:fn=>exclusive(async()=>{raw.exec('BEGIN IMMEDIATE');try{const result=await context.run(true,fn);raw.exec('COMMIT');return result;}catch(error){raw.exec('ROLLBACK');throw error;}})
  };
  wrappers.set(raw,db);return db;
}
