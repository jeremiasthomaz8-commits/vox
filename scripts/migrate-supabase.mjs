import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {loadEnv,connectDatabase,ROOT,audit} from '../server/db.mjs';
import {loadPhotoKey,decryptPhoto} from '../server/photos.mjs';

const tables=['units','users','evaluations','responses','photographic_evidence','alerts','alert_history','audit_logs'];
export async function importSqlite(source,target){
  if(target.dialect!=='postgres')throw Error('O destino deve ser o Supabase PostgreSQL.');
  const snapshot=Object.fromEntries(tables.map(t=>[t,source.prepare(`SELECT * FROM ${t}`).all()]));
  if(snapshot.evaluations.some(e=>e.demo===1))throw Error('Remova dados de demonstração antes da migração para produção.');
  const captured=snapshot.photographic_evidence.filter(p=>p.status==='captured');
  if(captured.length){const key=loadPhotoKey(true);for(const photo of captured)decryptPhoto(photo,key);}
  const settings=source.prepare('SELECT * FROM settings WHERE id=1').get();
  return target.transaction(async()=>{
    await target.lock('import-sqlite');
    for(const t of tables)if((await target.prepare(`SELECT COUNT(*) n FROM ${t}`).get()).n)throw Error('O destino já contém dados. A migração exige tabelas Vox vazias.');
    for(const t of tables){
      for(const row of snapshot[t]){
        const keys=Object.keys(row);await target.prepare(`INSERT INTO ${t}(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).run(...keys.map(k=>row[k] instanceof Uint8Array?Buffer.from(row[k]):row[k]));
      }
      if((await target.prepare(`SELECT COUNT(*) n FROM ${t}`).get()).n!==snapshot[t].length)throw Error('A contagem da migração divergiu. A operação foi cancelada.');
    }
    if(settings){const keys=Object.keys(settings).filter(k=>k!=='id');await target.prepare(`UPDATE settings SET ${keys.map(k=>k+'=?').join(',')} WHERE id=1`).run(...keys.map(k=>settings[k]));}
    await audit(target,null,'Banco migrado para Supabase','system',{counts:Object.fromEntries(tables.map(t=>[t,snapshot[t].length]))});
    return Object.fromEntries(tables.map(t=>[t,snapshot[t].length]));
  });
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(ROOT,'scripts/migrate-supabase.mjs')){
  loadEnv();const filename=resolve(process.env.VOX_DB||resolve(ROOT,'data/vox.sqlite'));
  const source=new DatabaseSync(filename,{readOnly:true}),directory=resolve(dirname(filename),'backups');mkdirSync(directory,{recursive:true});
  const backup=resolve(directory,`antes-supabase-${randomUUID()}.sqlite`);source.prepare('VACUUM INTO ?').run(backup);
  const snapshot=new DatabaseSync(backup,{readOnly:true});let target;
  try{target=await connectDatabase({...process.env,VOX_DATABASE:'supabase'});const counts=await importSqlite(snapshot,target);console.log(JSON.stringify({counts,backup,sessions_migrated:false}));}
  finally{source.close();snapshot.close();if(target)await target.close();}
}
