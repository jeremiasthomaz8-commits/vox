import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const files=[...readdirSync('public').filter(f=>f.endsWith('.js')).map(f=>`public/${f}`),...['server','scripts','tests','netlify/functions','api'].flatMap(dir=>readdirSync(dir).filter(f=>f.endsWith('.mjs')).map(f=>`${dir}/${f}`))];
for(const file of files){const r=spawnSync(process.execPath,['--check',file],{stdio:'inherit'});if(r.status)process.exit(r.status);}
console.log(`${files.length} arquivos JavaScript verificados.`);
