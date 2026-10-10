import { openDatabase,loadEnv,audit } from '../server/db.mjs';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
loadEnv();const db=openDatabase();mkdirSync('data/backups',{recursive:true});
const target=resolve('data/backups',`vox-${new Date().toISOString().replace(/[:.]/g,'-')}.sqlite`);
db.prepare('VACUUM INTO ?').run(target);
audit(db,null,'Backup local criado','system');db.close();
console.log(`Backup consistente criado: ${target}`);
