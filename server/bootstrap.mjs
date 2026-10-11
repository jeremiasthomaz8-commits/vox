import { randomUUID } from 'node:crypto';
import { transaction,audit } from './db.mjs';
import { hashPassword } from './auth.mjs';

// Only an empty database is provisioned. Restarts never reset existing accounts.
export async function provisionFromEnv(db,env=process.env,{required=false}={}) {
  if((await db.prepare('SELECT 1 FROM users LIMIT 1').get()))return false;
  const adminPassword=env.VOX_ADMIN_PASSWORD,unitPassword=env.VOX_UNIT_PASSWORD;
  if(!required&&adminPassword===undefined&&unitPassword===undefined)return false;
  for(const [name,value] of [['VOX_ADMIN_PASSWORD',adminPassword],['VOX_UNIT_PASSWORD',unitPassword]]) {
    if(typeof value!=='string'||value.length<10||value.length>128)
      throw Error(`Configure ${name} com 10 a 128 caracteres no gerenciador de segredos para o primeiro início.`);
  }
  const admin=env.VOX_ADMIN_USERNAME || 'admregulacaodiretor',unit=env.VOX_UNIT_USERNAME || 'UBSMonterrey';
  if(![admin,unit].every(value=>/^[a-zA-Z][a-zA-Z0-9]{2,59}$/.test(value))||admin.toLowerCase()===unit.toLowerCase())
    throw Error('Os usuários iniciais devem ser distintos, com 3 a 60 letras e números.');
  const now=new Date().toISOString(),unitId=randomUUID(),adminId=randomUUID(),unitUserId=randomUUID();
  const adminHash=hashPassword(adminPassword),unitHash=hashPassword(unitPassword);
  return (await transaction(db,async ()=>{
    await (db.lock?.('bootstrap'));
    // Another provisioner may have finished while passwords were being hashed.
    if((await db.prepare('SELECT 1 FROM users LIMIT 1').get()))return false;
    (await db.prepare('INSERT INTO units(id,name,device_id,created_at,updated_at) VALUES(?,?,?,?,?)')
      .run(unitId,'UBS Monterrey','VOX-'+randomUUID().slice(0,8).toUpperCase(),now,now));
    (await db.prepare("INSERT INTO users(id,username,password_hash,role,unit_id,created_at,updated_at) VALUES(?,?,?,'admin',NULL,?,?)")
      .run(adminId,admin,adminHash,now,now));
    (await db.prepare("INSERT INTO users(id,username,password_hash,role,unit_id,created_at,updated_at) VALUES(?,?,?,'unit',?,?,?)")
      .run(unitUserId,unit,unitHash,unitId,now,now));
    (await audit(db,null,'Configuração inicial','system',{demo:false,source:'environment'}));
    return true;
  }));
}
