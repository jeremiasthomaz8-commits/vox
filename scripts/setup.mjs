import readline from 'node:readline/promises';
import { randomUUID } from 'node:crypto';
import { connectDatabase,loadEnv,transaction,audit } from '../server/db.mjs';
import { hashPassword,digest } from '../server/auth.mjs';
import { localDay,shiftDay,midnight } from '../server/analytics.mjs';
import { detectAlerts } from '../server/alerts.mjs';

loadEnv();
if(process.env.NODE_ENV==='production'&&process.argv.includes('--demo'))throw Error('Demonstration seed is not allowed in production.');
const db=await connectDatabase();
if((await db.prepare('SELECT 1 FROM users LIMIT 1').get())){console.log('Vox já foi configurado. Nenhuma conta ou avaliação foi recriada.');(await db.close());process.exit(0);}
let config;
if(process.argv.includes('--stdin')) {
  if(process.stdin.isTTY)process.stdin.setRawMode(true);
  process.stdin.resume();
  console.log('Aguardando configuração JSON pela entrada padrão (entrada oculta).');
  config=await new Promise((resolve,reject)=>{let value='';process.stdin.on('data',chunk=>{value+=chunk.toString();if(value.includes('\n')||value.includes('\r')){process.stdin.pause();if(process.stdin.isTTY)process.stdin.setRawMode(false);try{resolve(JSON.parse(value.trim()));}catch{reject(Error('Invalid setup JSON'));}}});});
}else {
  const rl=readline.createInterface({input:process.stdin,output:process.stdout});
  const admin=await rl.question('Usuário da direção: '),unit=await rl.question('Usuário da UBS Monterrey: ');
  rl.close();
  const secret=async prompt=>{process.stdout.write(prompt);if(!process.stdin.isTTY)throw Error('Use --stdin for non-interactive setup.');process.stdin.setRawMode(true);process.stdin.resume();return new Promise(resolve=>{let value='';const onData=chunk=>{for(const char of chunk.toString()){if(char==='\r'||char==='\n'){process.stdin.off('data',onData);process.stdin.setRawMode(false);process.stdin.pause();process.stdout.write('\n');resolve(value);return;}if(char==='\u0003')process.exit(1);if(char==='\u007f'||char==='\b')value=value.slice(0,-1);else value+=char;}};process.stdin.on('data',onData);});};
  config={admin,unit,adminPassword:await secret('Senha inicial da direção (oculta): '),unitPassword:await secret('Senha inicial da unidade (oculta): ')};
}
for(const k of ['admin','unit'])if(!/^[a-zA-Z][a-zA-Z0-9]{2,59}$/.test(config[k]||''))throw Error('Invalid username');
for(const k of ['adminPassword','unitPassword'])if(typeof config[k]!=='string'||config[k].length<10||config[k].length>128)throw Error('Passwords must have 10 to 128 characters');
const now=new Date().toISOString(),unitId=randomUUID(),adminId=randomUUID(),unitUserId=randomUUID(),demo=process.argv.includes('--demo');
const adminHash=hashPassword(config.adminPassword),unitHash=hashPassword(config.unitPassword);
(await transaction(db,async ()=>{
  (await db.prepare('INSERT INTO units(id,name,device_id,created_at,updated_at) VALUES(?,?,?,?,?)').run(unitId,'UBS Monterrey','VOX-'+randomUUID().slice(0,8).toUpperCase(),now,now));
  (await db.prepare('INSERT INTO users(id,username,password_hash,role,unit_id,created_at,updated_at) VALUES(?,?,?,\'admin\',NULL,?,?)').run(adminId,config.admin,adminHash,now,now));
  (await db.prepare('INSERT INTO users(id,username,password_hash,role,unit_id,created_at,updated_at) VALUES(?,?,?,\'unit\',?,?,?)').run(unitUserId,config.unit,unitHash,unitId,now,now));
  (await audit(db,null,'Configuração inicial','system',{demo}));
  if(demo) {
    const units=[
      [unitId,'UBS Monterrey',[4.6,4.7,4.4,4.5,4.1,4.7],8],
      [randomUUID(),'UBS Centro',[4.8,4.7,4.8,4.6,4.4,4.8],10],
      [randomUUID(),'UBS Santo Antônio',[4.4,4.5,4.5,4.4,4.1,4.6],6],
      [randomUUID(),'UBS Vista Alegre',[4.3,4.6,4.2,4.3,3.8,4.5],7],
      [randomUUID(),'UBS Jardim Niero',[4.4,4.6,4.0,4.1,3.4,4.4],5],
      [randomUUID(),'UBS Estiva',[4.1,4.3,3.8,3.6,3.1,4.1],4]
    ];
    let state=48271;const rand=()=>{state=state*16807%2147483647;return (state-1)/2147483646;};
    for(const [id,name,means,frequency]of units) {
      if(id!==unitId)(await db.prepare('INSERT INTO units(id,name,device_id,demo,created_at,updated_at) VALUES(?,?,?,1,?,?)').run(id,name,'DEMO-'+id.slice(0,8).toUpperCase(),now,now));
      for(let ago=89;ago>=0;ago--) {
        const day=shiftDay(localDay(),-ago),weekday=new Date(day+'T12:00:00Z').getUTCDay();
        const count=Math.max(0,Math.floor(frequency*(weekday===0?0.15:weekday===6?0.4:1)+(rand()-0.5)*4));
        for(let j=0;j<count;j++) {
          const created=new Date(Date.parse(midnight(day))+(8+rand()*9)*3600000);
          if(created.getTime()>Date.now())continue;
          const eid=randomUUID(),key=randomUUID();
          const ratings=means.map(mean=>{const val=mean-ago/180+(rand()-0.5)*1.8;return Math.max(1,Math.min(5,Math.floor(val)+(rand()<(val%1)?1:0)));});
          (await db.prepare('INSERT INTO evaluations(id,unit_id,created_at,device_id,idempotency_key,payload_hash,demo) VALUES(?,?,?,?,?,?,1)').run(eid,id,created.toISOString(),'DEMO-'+id.slice(0,8).toUpperCase(),key,digest(JSON.stringify(ratings))));
          for(const [i,rating]of ratings.entries())(await db.prepare('INSERT INTO responses VALUES(?,?,?)').run(eid,i+1,rating));
        }
      }
    }
    (await audit(db,adminId,'Demonstração carregada','system',{units:6}));
  }
}));
(await detectAlerts(db));config=null;
console.log(`Vox configurado. ${demo?'Dados fictícios de demonstração identificados foram adicionados.':'Banco pronto, sem avaliações fictícias.'} As senhas provisórias devem ser alteradas antes do uso em produção.`);
(await db.close());process.stdin.destroy();
