import http from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { openDatabase,transaction,audit,loadEnv,ROOT } from './db.mjs';
import { login,session,cookie,publicUser,hashPassword,verifyPassword,digest } from './auth.mjs';
import { dashboard,period } from './analytics.mjs';
import { detectAlerts } from './alerts.mjs';
import { csv,pdf } from './reports.mjs';
import { PHOTO_NOTICE_VERSION, loadPhotoKey, preparePhoto, storePhoto, decryptPhoto, deletePhoto, expirePhotos } from './photos.mjs';
import { runtimeConfig } from './runtime.mjs';
import { provisionFromEnv } from './bootstrap.mjs';

const fail=(status,message,code)=>{throw Object.assign(new Error(message),{status,code});};
const text=(v,label,max=150)=>{if(typeof v!=='string'||!v.trim()||v.trim().length>max)fail(400,`${label}: preencha um valor válido de até ${max} caracteres.`);return v.trim();};
const password=v=>{if(typeof v!=='string'||v.length<10||v.length>128)fail(400,'A senha deve ter de 10 a 128 caracteres.');return v;};
const username=v=>{v=text(v,'Usuário',60);if(!/^[a-zA-Z][a-zA-Z0-9]{2,59}$/.test(v))fail(400,'O usuário deve ter de 3 a 60 letras e números, sem espaços.');return v;};
async function body(req,limit=16384) {
  if(!String(req.headers['content-type']||'').startsWith('application/json'))fail(415,'Envie os dados no formato JSON.');
  let size=0;const chunks=[];
  for await(const chunk of req){size+=chunk.length;if(size>limit)fail(413,'O envio excede o tamanho permitido.');chunks.push(chunk);}
  try {const value=JSON.parse(Buffer.concat(chunks).toString());if(!value||Array.isArray(value)||typeof value!=='object')throw Error();return value;}catch{fail(400,'Não foi possível ler os dados enviados.');}
}
export function createApp({db=openDatabase(),production=false,publicOrigin='',trustProxy=false,photoEnabled=false,photoKey=null}={}) {
  const hasPhotos=!!db.prepare("SELECT 1 FROM photographic_evidence WHERE status='captured' LIMIT 1").get();
  if((photoEnabled||hasPhotos)&&!photoKey)photoKey=loadPhotoKey(production);
  expirePhotos(db);
  const retentionTimer=setInterval(()=>{try{expirePhotos(db);}catch{console.error('photo_retention_failed');}},600000);retentionTimer.unref();
  const server=http.createServer(async(req,res)=>{
    const started=Date.now();
    const headers={
      'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'same-origin',
      'Permissions-Policy':`camera=${photoEnabled?'(self)':'()'}, microphone=(), geolocation=()`,
      'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      'Cache-Control':'no-store'
    };
    if(production)headers['Strict-Transport-Security']='max-age=31536000';
    const send=(status,value,type='application/json; charset=utf-8',extra={})=>{res.writeHead(status,{...headers,'Content-Type':type,...extra});res.end(type.startsWith('application/json')?JSON.stringify(value):value);};
    try {
      // The platform's internal health probe uses HTTP and an internal Host.
      // This public route exposes no account, configuration or database contents.
      if(req.url?.split('?')[0]==='/api/health'&&['GET','HEAD'].includes(req.method))
        return send(200,{status:'ok',name:'Vox'});
      if(production&&(!trustProxy||req.headers['x-forwarded-proto']!=='https'))fail(400,'A conexão segura HTTPS é obrigatória.');
      const host=req.headers.host;
      if(!host||!/^([a-zA-Z0-9.-]+|\[[a-fA-F0-9:]+\])(?::\d+)?$/.test(host))fail(400,'Endereço inválido.');
      const origin=publicOrigin || `http://${host}`;
      if(publicOrigin && new URL(publicOrigin).host!==host)fail(400,'Endereço não autorizado.');
      const url=new URL(req.url,origin),path=url.pathname,method=req.method;
      const mutating=!['GET','HEAD'].includes(method);
      if(mutating&&req.headers.origin&&req.headers.origin!==origin)fail(403,'A origem da solicitação não foi autorizada.');
      if(path==='/api/auth/login'&&method==='POST') {
        const b=await body(req);if(typeof b.username!=='string'||typeof b.password!=='string'||b.username.length>60||b.password.length>128)fail(400,'Informe usuário e senha válidos.');
        const {token,user}=login(db,b.username.trim(),b.password,req.socket.remoteAddress||'local');
        audit(db,user.id,'Login realizado',user.id);
        return send(200,{user:publicUser(user)},undefined,{'Set-Cookie':cookie(token,production)});
      }
      if(path.startsWith('/api/')) {
        const s=session(db,req);if(!s)fail(401,'Sua sessão expirou. Entre novamente.');
        if(mutating&&req.headers['x-csrf-token']!==s.csrf)fail(403,'Atualize a página antes de tentar novamente.');
        if(path==='/api/me'&&method==='GET')return send(200,{user:publicUser(s),csrf:s.csrf,categories:db.prepare('SELECT * FROM categories ORDER BY display_order').all(),production,photo_enabled:photoEnabled,photo_retention_days:db.prepare('SELECT photo_retention_days FROM settings WHERE id=1').get().photo_retention_days,photo_notice_version:PHOTO_NOTICE_VERSION});
        if(path==='/api/auth/logout'&&method==='POST') {db.prepare('DELETE FROM sessions WHERE token_hash=?').run(s.token_hash);audit(db,s.user_id,'Logout realizado',s.user_id);return send(200,{ok:true},undefined,{'Set-Cookie':cookie('',production,true)});}
        if(path==='/api/auth/verify'&&method==='POST') {
          const b=await body(req),u=db.prepare('SELECT password_hash FROM users WHERE id=?').get(s.user_id);
          if(typeof b.password!=='string'||b.password.length>128||!verifyPassword(b.password,u.password_hash))fail(400,'A senha informada está incorreta.');
          return send(200,{ok:true});
        }
        if(path==='/api/auth/password'&&method==='POST') {
          const b=await body(req),u=db.prepare('SELECT * FROM users WHERE id=?').get(s.user_id);
          if(typeof b.current!=='string'||!verifyPassword(b.current,u.password_hash))fail(400,'A senha atual está incorreta.');
          const next=password(b.password);if(next===b.current)fail(400,'Escolha uma senha diferente da atual.');
          const hash=hashPassword(next);
          transaction(db,()=>{db.prepare('UPDATE users SET password_hash=?,must_change=0,updated_at=? WHERE id=?').run(hash,new Date().toISOString(),s.user_id);db.prepare('DELETE FROM sessions WHERE user_id=? AND token_hash!=?').run(s.user_id,s.token_hash);audit(db,s.user_id,'Senha alterada',s.user_id);});
          return send(200,{ok:true});
        }
        if(production&&s.must_change)fail(403,'Altere a senha provisória antes de continuar.','PASSWORD_CHANGE_REQUIRED');
        if(path==='/api/evaluations'&&method==='POST') {
          if(s.role!=='unit')fail(403,'Somente o acesso da unidade pode enviar uma avaliação.');
          const b=await body(req,400000);
          if(!Array.isArray(b.ratings)||b.ratings.length!==6||!b.ratings.every(n=>Number.isInteger(n)&&n>=1&&n<=5))fail(400,'Responda às seis perguntas com notas de 1 a 5.');
          if(typeof b.key!=='string'||!/^[-a-f0-9]{36}$/.test(b.key))fail(400,'Identificador de envio inválido. Reinicie a avaliação.');
          const photo=preparePhoto(b,photoEnabled,db.prepare('SELECT photo_retention_days FROM settings WHERE id=1').get().photo_retention_days);
          const payload=digest(JSON.stringify({ratings:b.ratings,photo:photo.fingerprint}));
          const existing=db.prepare('SELECT id,unit_id,payload_hash FROM evaluations WHERE idempotency_key=?').get(b.key);
          if(existing) {
            if(existing.unit_id!==s.unit_id||existing.payload_hash!==payload)fail(409,'Esse identificador já foi usado em outro envio.');
            audit(db,s.user_id,'Reenvio idempotente',existing.id,{device:s.device_id,unit_id:s.unit_id});
            try {detectAlerts(db);}catch{}
            return send(200,{id:existing.id,saved:true,photo_status:db.prepare('SELECT photo_status FROM evaluations WHERE id=?').get(existing.id).photo_status});
          }
          const rate=db.prepare('SELECT COUNT(*) n FROM evaluations WHERE unit_id=? AND created_at>=? AND demo=0').get(s.unit_id,new Date(Date.now()-60000).toISOString()).n;
          if(rate>=60)fail(429,'Muitos envios em sequência. Aguarde um minuto e tente novamente.');
          const id=randomUUID();
          transaction(db,()=>{
            db.prepare('INSERT INTO evaluations(id,unit_id,created_at,device_id,submitted_by,idempotency_key,payload_hash,photo_status) VALUES(?,?,?,?,?,?,?,?)').run(id,s.unit_id,new Date().toISOString(),s.device_id,s.user_id,b.key,payload,photo.status);
            for(const [i,r] of b.ratings.entries())db.prepare('INSERT INTO responses VALUES(?,?,?)').run(id,i+1,r);
            storePhoto(db,id,photo,photoKey);
            audit(db,s.user_id,'Avaliação recebida',id,{unit_id:s.unit_id,device:s.device_id});
            if(['capture_failed','permission_denied','camera_unavailable'].includes(photo.status))audit(db,s.user_id,'Fotografia indisponível',id,{unit_id:s.unit_id,status:photo.status});
          });
          try {detectAlerts(db);}catch{audit(db,null,'Falha técnica',s.unit_id,{code:'ALERT_DETECTION'});}
          return send(201,{id,saved:true,photo_status:photo.status});
        }
        if(path==='/api/technical'&&method==='POST') {
          const b=await body(req);const codes=['SUBMISSION_FAILURE','RETRY_FAILURE'];if(!codes.includes(b.code))fail(400,'Código de falha inválido.');
          audit(db,s.user_id,'Falha técnica',s.unit_id||s.user_id,{code:b.code,device:s.device_id||null});try{detectAlerts(db);}catch{}return send(200,{ok:true});
        }
        // One backend boundary for every administrative route, including protected evidence.
        if(!path.startsWith('/api/admin/'))fail(404,'Recurso não encontrado.');
        if(s.role!=='admin')fail(403,'Este acesso é exclusivo da direção.');
        if(path==='/api/admin/photos'&&method==='GET') {
          expirePhotos(db);
          const p=period(url.searchParams),page=Math.max(1,Math.min(100000,Math.floor(Number(url.searchParams.get('page'))||1))),status=url.searchParams.get('status');
          if(status&&!['captured','declined','camera_unavailable','permission_denied','capture_failed','deleted'].includes(status))fail(400,'Status da fotografia inválido.');
          const where=`e.created_at>=? AND e.created_at<? ${p.unit?'AND e.unit_id=?':''} ${status?'AND f.status=?':''}`,args=[p.from,p.to,...p.unit?[p.unit]:[],...status?[status]:[]];
          const total=db.prepare(`SELECT COUNT(*) n FROM photographic_evidence f JOIN evaluations e ON e.id=f.evaluation_id WHERE ${where}`).get(...args).n;
          const records=db.prepare(`SELECT f.id,f.evaluation_id,f.status,f.captured_at,f.expires_at,f.deleted_at,e.created_at,e.device_id,e.unit_id,u.name unit_name FROM photographic_evidence f JOIN evaluations e ON e.id=f.evaluation_id JOIN units u ON u.id=e.unit_id WHERE ${where} ORDER BY e.created_at DESC LIMIT 20 OFFSET ?`).all(...args,(page-1)*20);
          return send(200,{records,total,page,pages:Math.ceil(total/20),retention_days:db.prepare('SELECT photo_retention_days FROM settings WHERE id=1').get().photo_retention_days});
        }
        const photoMatch=path.match(/^\/api\/admin\/photos\/([-a-f0-9]{36})(\/image)?$/);
        if(photoMatch) {
          expirePhotos(db);const row=db.prepare('SELECT * FROM photographic_evidence WHERE id=?').get(photoMatch[1]);
          if(!row)fail(404,'Registro fotográfico não encontrado.');
          if(method==='GET'&&photoMatch[2]) {
            if(row.status!=='captured'||!row.encrypted_data)fail(410,'Esta fotografia foi excluída ou não foi capturada.');
            const image=decryptPhoto(row,photoKey);audit(db,s.user_id,'Fotografia visualizada',row.id,{evaluation_id:row.evaluation_id});
            return send(200,image,'image/jpeg',{'Content-Disposition':'inline; filename="fotografia.jpg"','Cache-Control':'private, no-store, max-age=0'});
          }
          if(method==='DELETE'&&!photoMatch[2]) {
            if(row.status==='captured')transaction(db,()=>deletePhoto(db,row,s.user_id));
            return send(200,{ok:true});
          }
          fail(405,'Método não permitido.');
        }
        if(path==='/api/admin/dashboard'&&method==='GET')return send(200,dashboard(db,period(url.searchParams)));
        if(path==='/api/admin/units'&&method==='POST') {
          const b=await body(req),name=text(b.name,'Nome da unidade'),user=username(b.username),hash=hashPassword(password(b.password));
          const address=String(b.address||'').trim(),code=String(b.code||'').trim();if(address.length>250||code.length>30)fail(400,'Os dados da unidade excedem o tamanho permitido.');
          const id=randomUUID(),uid=randomUUID(),now=new Date().toISOString();
          transaction(db,()=>{db.prepare('INSERT INTO units(id,name,address,code,device_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(id,name,address,code,'VOX-'+randomUUID().slice(0,8).toUpperCase(),now,now);db.prepare('INSERT INTO users(id,username,password_hash,role,unit_id,created_at,updated_at) VALUES(?,?,?,\'unit\',?,?,?)').run(uid,user,hash,id,now,now);audit(db,s.user_id,'Unidade cadastrada',id,{name,username:user});});
          return send(201,{id});
        }
        const unitMatch=path.match(/^\/api\/admin\/units\/([-a-f0-9]{36})(\/device)?$/);
        if(unitMatch&&method==='PATCH') {
          const id=unitMatch[1],unit=db.prepare('SELECT * FROM units WHERE id=?').get(id);if(!unit)fail(404,'Unidade não encontrada.');
          const b=await body(req),now=new Date().toISOString();
          if(unitMatch[2]){const device='VOX-'+randomUUID().slice(0,8).toUpperCase();db.prepare('UPDATE units SET device_id=?,updated_at=? WHERE id=?').run(device,now,id);audit(db,s.user_id,'Dispositivo renovado',id);return send(200,{device_id:device});}
          const name=b.name===undefined?unit.name:text(b.name,'Nome'),address=b.address===undefined?unit.address:String(b.address).trim(),code=b.code===undefined?unit.code:String(b.code).trim(),active=b.active===undefined?unit.active:b.active===true?1:b.active===false?0:null;
          if(address.length>250||code.length>30||active===null)fail(400,'Dados da unidade inválidos.');
          db.prepare('UPDATE units SET name=?,address=?,code=?,active=?,updated_at=? WHERE id=?').run(name,address,code,active,now,id);audit(db,s.user_id,'Unidade atualizada',id,{name,active});return send(200,{ok:true});
        }
        if(path==='/api/admin/users'&&method==='GET')return send(200,{users:db.prepare('SELECT u.id,u.username,u.role,u.unit_id,u.active,u.must_change,u.created_at,h.name unit_name FROM users u LEFT JOIN units h ON h.id=u.unit_id ORDER BY u.role,u.username').all()});
        if(path==='/api/admin/users'&&method==='POST') {
          const b=await body(req);if(typeof b.unit_id!=='string'||!db.prepare('SELECT 1 FROM units WHERE id=?').get(b.unit_id))fail(400,'Selecione uma unidade cadastrada.');
          const name=username(b.username),hash=hashPassword(password(b.password)),id=randomUUID(),now=new Date().toISOString();
          db.prepare('INSERT INTO users(id,username,password_hash,role,unit_id,created_at,updated_at) VALUES(?,?,?,\'unit\',?,?,?)').run(id,name,hash,b.unit_id,now,now);audit(db,s.user_id,'Acesso provisionado',id,{username:name,unit_id:b.unit_id});return send(201,{id});
        }
        const userMatch=path.match(/^\/api\/admin\/users\/([-a-f0-9]{36})$/);
        if(userMatch&&method==='PATCH') {
          const id=userMatch[1],u=db.prepare('SELECT * FROM users WHERE id=?').get(id);if(!u)fail(404,'Usuário não encontrado.');
          const b=await body(req);if(id===s.user_id)fail(400,'Para sua conta, utilize Alterar senha no menu do perfil.');
          transaction(db,()=>{
            if(b.password!==undefined){db.prepare('UPDATE users SET password_hash=?,must_change=1,updated_at=? WHERE id=?').run(hashPassword(password(b.password)),new Date().toISOString(),id);audit(db,s.user_id,'Senha provisória redefinida',id);}
            else if(typeof b.active==='boolean'){db.prepare('UPDATE users SET active=?,updated_at=? WHERE id=?').run(b.active?1:0,new Date().toISOString(),id);audit(db,s.user_id,b.active?'Acesso ativado':'Acesso desativado',id);}
            else fail(400,'Informe a alteração desejada.');
            db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
          });return send(200,{ok:true});
        }
        if(path==='/api/admin/evaluations'&&method==='GET') {
          const p=period(url.searchParams),page=Math.max(1,Math.min(100000,Number(url.searchParams.get('page'))||1)),q=(url.searchParams.get('q')||'').slice(0,100),params=[p.from,p.to,...(p.unit?[p.unit]:[]),...q?[`%${q}%`]:[]];
          const where=`e.created_at>=? AND e.created_at<? ${p.unit?'AND e.unit_id=?':''} ${q?'AND (u.name LIKE ? OR e.id LIKE ?)':''}`;
          if(q)params.push(`%${q}%`);
          const total=db.prepare(`SELECT COUNT(*) n FROM evaluations e JOIN units u ON u.id=e.unit_id WHERE ${where}`).get(...params).n;
          const records=db.prepare(`SELECT e.id,e.unit_id,e.created_at,e.device_id,e.photo_status,e.demo,(SELECT id FROM photographic_evidence WHERE evaluation_id=e.id) evidence_id,u.name unit_name,AVG(r.rating) average,json_group_array(json_object('category_id',r.category_id,'rating',r.rating)) ratings FROM evaluations e JOIN units u ON u.id=e.unit_id JOIN responses r ON r.evaluation_id=e.id WHERE ${where} GROUP BY e.id ORDER BY e.created_at DESC LIMIT 20 OFFSET ?`).all(...params,(page-1)*20).map(r=>({...r,score:(r.average-1)*25,ratings:JSON.parse(r.ratings).sort((a,b)=>a.category_id-b.category_id)}));
          return send(200,{records,total,page,pages:Math.ceil(total/20)});
        }
        if(path==='/api/admin/alerts'&&method==='GET') {
          const p=period(url.searchParams),status=url.searchParams.get('status');
          const alerts=db.prepare(`SELECT a.*,u.name unit_name FROM alerts a JOIN units u ON u.id=a.unit_id WHERE a.detected_at>=? AND a.detected_at<? ${p.unit?'AND a.unit_id=?':''} ${status?'AND a.status=?':''} ORDER BY a.detected_at DESC LIMIT 200`).all(p.from,p.to,...p.unit?[p.unit]:[],...status?[status]:[]);
          for(const a of alerts)a.history=db.prepare('SELECT h.*,u.username FROM alert_history h LEFT JOIN users u ON u.id=h.actor_id WHERE alert_id=? ORDER BY h.created_at').all(a.id);
          return send(200,{alerts});
        }
        if(path==='/api/admin/alerts/detect'&&method==='POST'){detectAlerts(db);audit(db,s.user_id,'Verificação de alertas executada','all');return send(200,{ok:true});}
        const alertMatch=path.match(/^\/api\/admin\/alerts\/([-a-f0-9]{36})$/);
        if(alertMatch&&method==='PATCH') {
          const b=await body(req),id=alertMatch[1];if(!db.prepare('SELECT 1 FROM alerts WHERE id=?').get(id))fail(404,'Alerta não encontrado.');
          if(!['Novo','Em análise','Revisado','Encerrado'].includes(b.status)||typeof b.notes!=='string'||b.notes.length>2000)fail(400,'Informe um status válido e uma observação de até 2.000 caracteres.');
          transaction(db,()=>{db.prepare('UPDATE alerts SET status=?,notes=? WHERE id=?').run(b.status,b.notes.trim(),id);db.prepare('INSERT INTO alert_history VALUES(?,?,?,?,?,?)').run(randomUUID(),id,s.user_id,new Date().toISOString(),b.status,b.notes.trim());audit(db,s.user_id,'Alerta revisado',id,{status:b.status});});return send(200,{ok:true});
        }
        if(path==='/api/admin/audit'&&method==='GET') {
          const p=period(url.searchParams),page=Math.max(1,Math.min(100000,Number(url.searchParams.get('page'))||1));
          const args=[p.from,p.to,...p.unit?[p.unit,p.unit,p.unit,p.unit]:[]],where='a.created_at>=? AND a.created_at<?'+(p.unit?" AND (a.target=? OR u.unit_id=? OR json_extract(a.metadata,'$.unit_id')=? OR a.target IN(SELECT id FROM alerts WHERE unit_id=?))":'');
          return send(200,{total:db.prepare(`SELECT COUNT(*) n FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id WHERE ${where}`).get(...args).n,page,records:db.prepare(`SELECT a.*,u.username FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id WHERE ${where} ORDER BY a.created_at DESC LIMIT 30 OFFSET ?`).all(...args,(page-1)*30)});
        }
        if(path==='/api/admin/settings'&&method==='GET')return send(200,{...db.prepare('SELECT * FROM settings WHERE id=1').get(),photo_enabled:photoEnabled});
        if(path==='/api/admin/settings'&&method==='PATCH') {
          const b=await body(req),cfg=db.prepare('SELECT * FROM settings WHERE id=1').get(),rules={score_threshold:[0,100],sample_min:[5,1000],repeat_threshold:[3,50],concentration_threshold:[5,100],decline_threshold:[5,100],volume_change_threshold:[25,1000],high_threshold:[50,100],photo_retention_days:[1,365]};
          const labels={score_threshold:'Limite de atenção',sample_min:'Amostra mínima',repeat_threshold:'Respostas idênticas',concentration_threshold:'Concentração de envios',decline_threshold:'Queda de score',volume_change_threshold:'Variação de volume',high_threshold:'Notas máximas',photo_retention_days:'Retenção proposta de fotos'};
          for(const [key,[min,max]]of Object.entries(rules)){if(b[key]!==undefined){if(!Number.isInteger(b[key])||b[key]<min||b[key]>max)fail(400,`${labels[key]}: informe um número inteiro entre ${min} e ${max}.`);cfg[key]=b[key];}}
          transaction(db,()=>{db.prepare('UPDATE settings SET '+Object.keys(rules).map(k=>k+'=?').join(',')+',updated_at=? WHERE id=1').run(...Object.keys(rules).map(k=>cfg[k]),new Date().toISOString());audit(db,s.user_id,'Parâmetros atualizados','settings',{...Object.fromEntries(Object.keys(rules).map(k=>[k,cfg[k]]))});});return send(200,{ok:true});
        }
        if(path==='/api/admin/reports'&&method==='GET') {
          const p=period(url.searchParams),data=dashboard(db,p),format=url.searchParams.get('format');
          data.alerts=db.prepare(`SELECT * FROM alerts WHERE detected_at>=? AND detected_at<? ${p.unit?'AND unit_id=?':''}`).all(p.from,p.to,...p.unit?[p.unit]:[]);
          if(!['csv','pdf'].includes(format))fail(400,'Escolha CSV ou PDF.');
          const output=format==='csv'?csv(data,url.searchParams):pdf(data,url.searchParams);
          audit(db,s.user_id,'Relatório exportado',format,{start:p.start,end:p.end,unit_id:p.unit||null});
          return send(200,output,format==='csv'?'text/csv; charset=utf-8':'application/pdf',{'Content-Disposition':`attachment; filename="vox-relatorio-${p.start}-${p.end}.${format}"`});
        }
        fail(404,'Recurso não encontrado.');
      }
      if(method!=='GET'&&method!=='HEAD')fail(405,'Método não permitido.');
      const assets={'/':'index.html','/app.js':'app.js','/styles.css':'styles.css','/favicon.svg':'favicon.svg','/fonts/Sora-Variable.woff2':'fonts/Sora-Variable.woff2','/fonts/OFL-Sora.txt':'fonts/OFL-Sora.txt'};
      const filename=assets[path];if(!filename)fail(404,'Página não encontrada.');
      const type=filename.endsWith('.woff2')?'font/woff2':filename.endsWith('.txt')?'text/plain; charset=utf-8':filename.endsWith('.js')?'text/javascript; charset=utf-8':filename.endsWith('.css')?'text/css; charset=utf-8':filename.endsWith('.svg')?'image/svg+xml':'text/html; charset=utf-8';
      return send(200,readFileSync(resolve(ROOT,'public',filename)),type);
    }catch(e) {
      let status=e.status||500,message=e.message;
      if(e.code?.startsWith('ERR_SQLITE')||/UNIQUE constraint failed/.test(message)){status=409;message='Já existe uma unidade ou um usuário com esse nome, ou um acesso vinculado à unidade.';}
      if(status===500){message='Não foi possível concluir a operação. Tente novamente.';console.error(JSON.stringify({event:'request_error',method:req.method,path:req.url?.split('?')[0],elapsed:Date.now()-started,error:e.code||e.name}));}
      if(!res.headersSent)send(status,{error:message,...e.code==='PASSWORD_CHANGE_REQUIRED'?{code:e.code}:{}});
      else res.end();
    }
  });
  server.on('close',()=>clearInterval(retentionTimer));
  return {server,db};
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  loadEnv();const config=runtimeConfig(),db=openDatabase();
  if(config.production&&db.prepare('SELECT 1 FROM evaluations WHERE demo=1 LIMIT 1').get())throw new Error('Use a clean production database. Demonstration records must not enter production.');
  if(provisionFromEnv(db,process.env,{required:config.production}))console.log('Vox: acessos iniciais criados, sem avaliações fictícias. Altere as senhas provisórias no primeiro acesso.');
  delete process.env.VOX_ADMIN_PASSWORD;delete process.env.VOX_UNIT_PASSWORD;
  const {server}=createApp({db,...config});
  if(!db.prepare('SELECT 1 FROM users LIMIT 1').get())console.log('Vox: execute npm run setup para provisionar os acessos.');
  server.listen(config.port,config.host,()=>console.log(`Vox disponível em ${config.publicOrigin || `http://${config.host}:${config.port}`}`));
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>{db.close();process.exit(0);}));
}
