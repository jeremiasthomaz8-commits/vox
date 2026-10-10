import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { openDatabase,loadEnv,audit,transaction,ROOT } from '../server/db.mjs';

loadEnv();const db=openDatabase();
try {
  const all=process.argv.includes('--all'),where=all?'1=1':'demo=1';
  const count=db.prepare(`SELECT COUNT(*) n FROM evaluations WHERE ${where}`).get().n;
  const expected=process.argv.find(v=>v.startsWith('--expected='));
  if(!expected||Number(expected.split('=')[1])!==count)throw Error('Informe --expected com a contagem exata das avaliações que devem ser removidas.');
  mkdirSync(resolve(ROOT,'data/backups'),{recursive:true});
  const backup=resolve(ROOT,'data/backups',`antes-limpeza-${new Date().toISOString().replace(/[:.]/g,'-')}.sqlite`);
  db.prepare('VACUUM INTO ?').run(backup);
  audit(db,null,'Backup antes da limpeza','system',{evaluations:count});
  let alerts=0;
  transaction(db,()=>{
    db.prepare(`DELETE FROM photographic_evidence WHERE evaluation_id IN(SELECT id FROM evaluations WHERE ${where})`).run();
    db.prepare(`DELETE FROM evaluations WHERE ${where}`).run();
    db.prepare('DELETE FROM alert_history WHERE alert_id IN(SELECT id FROM alerts WHERE demo=1)').run();
    alerts=db.prepare('DELETE FROM alerts WHERE demo=1').run().changes;
    audit(db,null,'Avaliações de teste removidas','system',{evaluations:count,demo_alerts:alerts,scope:all?'todas autorizadas pelo usuário':'demonstração'});
  });
  console.log(JSON.stringify({evaluations_removed:count,demo_alerts_removed:alerts,backup,remaining:db.prepare('SELECT COUNT(*) n FROM evaluations').get().n}));
}finally{db.close();}
