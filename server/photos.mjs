import { randomBytes, randomUUID, createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, transaction, audit } from './db.mjs';

export const PHOTO_NOTICE_VERSION='vox-photo-v1';
export const MAX_PHOTO_BYTES=256*1024;
const hash=value=>createHash('sha256').update(value).digest('hex');
function dpapi(value,protect) {
  const operation=protect?'Protect':'Unprotect';
  const code=`Add-Type -AssemblyName System.Security; $inputValue=[Console]::In.ReadToEnd(); $bytes=[Convert]::FromBase64String($inputValue); $result=[Security.Cryptography.ProtectedData]::${operation}($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Write([Convert]::ToBase64String($result))`;
  try{return execFileSync('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',['-NoProfile','-NonInteractive','-Command',code],{input:value,encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe']}).trim();}
  catch{throw Error('Não foi possível acessar a chave privada das fotografias nesta conta do Windows.');}
}
export function loadPhotoKey(production=false) {
  if(process.env.PHOTO_ENCRYPTION_KEY){const key=Buffer.from(process.env.PHOTO_ENCRYPTION_KEY,'base64');if(key.length!==32)throw Error('PHOTO_ENCRYPTION_KEY deve conter 32 bytes em base64.');return key;}
  if(production)throw Error('Configure PHOTO_ENCRYPTION_KEY no gerenciador de segredos antes de ativar fotografias em produção.');
  const filename=resolve(ROOT,'data/private/photo-key.json');
  if(existsSync(filename)){
    const saved=JSON.parse(readFileSync(filename,'utf8'));
    const key=Buffer.from(saved.kind==='dpapi-current-user'?dpapi(saved.data,false):saved.data,'base64');
    if(key.length!==32)throw Error('Chave privada das fotografias inválida.');return key;
  }
  const key=randomBytes(32),windows=process.platform==='win32';
  mkdirSync(resolve(ROOT,'data/private'),{recursive:true,mode:0o700});
  writeFileSync(filename,JSON.stringify({kind:windows?'dpapi-current-user':'local-development',data:windows?dpapi(key.toString('base64'),true):key.toString('base64')}),{mode:0o600,flag:'wx'});
  return key;
}
// Read JPEG dimensions without loading an unbounded image into a decoder.
function validJpeg(bytes) {
  if(bytes.length<32||bytes.length>MAX_PHOTO_BYTES||bytes.readUInt16BE(0)!==0xffd8||bytes.readUInt16BE(bytes.length-2)!==0xffd9)return false;
  let offset=2;
  while(offset+4<bytes.length){
    if(bytes[offset++]!==0xff)return false;
    while(offset<bytes.length&&bytes[offset]===0xff)offset++;
    if(offset+3>bytes.length)return false;
    const marker=bytes[offset++];if(marker===0xda||marker===0xd9)return false;
    const length=bytes.readUInt16BE(offset);if(length<2||offset+length>bytes.length)return false;
    if([0xc0,0xc1,0xc2].includes(marker)){
      if(length<8)return false;const height=bytes.readUInt16BE(offset+3),width=bytes.readUInt16BE(offset+5);
      return width>0&&height>0&&width<=1280&&height<=1280&&width*height<=1280*1280;
    }
    offset+=length;
  }return false;
}
export function preparePhoto(input,enabled,retention) {
  const raw=typeof input.photo?.data==='string'?input.photo.data:'';
  const requested=input.photo_status||'disabled';
  const fingerprint=hash(JSON.stringify({status:requested,data:hash(raw),consent:input.photo?.consent===true,version:input.photo?.notice_version,days:input.photo?.retention_days}));
  const result={status:enabled?'declined':'disabled',fingerprint,bytes:null,authorization:null,days:null};
  if(requested!=='captured'){
    if(['declined','camera_unavailable','permission_denied','capture_failed'].includes(requested))result.status=requested;
    return result;
  }
  if(!enabled){result.status='capture_failed';return result;}
  const days=input.photo?.retention_days;
  if(input.photo?.consent!==true||input.photo?.notice_version!==PHOTO_NOTICE_VERSION||!Number.isInteger(days)||days<1||days>365){result.status='capture_failed';return result;}
  if(!/^data:image\/jpeg;base64,[A-Za-z0-9+/]*={0,2}$/.test(raw)){result.status='capture_failed';return result;}
  const bytes=Buffer.from(raw.slice(raw.indexOf(',')+1),'base64');
  if(!validJpeg(bytes)){result.status='capture_failed';return result;}
  result.status='captured';result.bytes=bytes;result.days=Math.min(days,retention);
  result.authorization={consent:true,notice_version:PHOTO_NOTICE_VERSION,retention_days:result.days,received_at:new Date().toISOString()};
  return result;
}
export async function storePhoto(db,evaluationId,photo,key) {
  if(photo.status==='disabled')return;
  const id=randomUUID(),now=new Date().toISOString();let encrypted=null;
  if(photo.bytes){
    const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(evaluationId));
    const content=Buffer.concat([cipher.update(photo.bytes),cipher.final()]);encrypted=Buffer.concat([iv,cipher.getAuthTag(),content]);
  }
  (await db.prepare('INSERT INTO photographic_evidence(id,evaluation_id,authorization_record,captured_at,status,encrypted_data,expires_at,content_hash) VALUES(?,?,?,?,?,?,?,?)').run(id,evaluationId,photo.authorization?JSON.stringify(photo.authorization):null,photo.bytes?now:null,photo.status,encrypted,photo.bytes?new Date(Date.now()+photo.days*86400000).toISOString():null,photo.bytes?hash(photo.bytes):null));
}
export function decryptPhoto(row,key) {
  const bytes=Buffer.from(row.encrypted_data),decipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));
  decipher.setAuthTag(bytes.subarray(12,28));decipher.setAAD(Buffer.from(row.evaluation_id));
  return Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]);
}
export async function deletePhoto(db,row,actor=null,reason='manual') {
  const changed=(await db.prepare("UPDATE photographic_evidence SET encrypted_data=NULL,content_hash=NULL,private_reference=NULL,status='deleted',deleted_at=? WHERE id=? AND status='captured'").run(new Date().toISOString(),row.id));
  if(!changed.changes)return;
  (await db.prepare("UPDATE evaluations SET photo_status='deleted' WHERE id=?").run(row.evaluation_id));
  (await audit(db,actor,'Fotografia excluída',row.id,{evaluation_id:row.evaluation_id,reason}));
}
export async function expirePhotos(db,now=new Date().toISOString()) {
  const rows=(await db.prepare("SELECT id,evaluation_id FROM photographic_evidence WHERE status='captured' AND expires_at<=?").all(now));
  if(rows.length)(await transaction(db,async ()=>{for(const row of rows)(await deletePhoto(db,row,null,'retention'));}));
  return rows.length;
}
