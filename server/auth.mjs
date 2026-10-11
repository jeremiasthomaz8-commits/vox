import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';

export const digest = v => createHash('sha256').update(v).digest('hex');
export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return `scrypt$32768$${salt}$${scryptSync(password,salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024}).toString('hex')}`;
}
export function verifyPassword(password, hash) {
  try {
    const [method,n,salt,value] = hash.split('$');
    if (method!=='scrypt' || n!=='32768' || !/^[a-f0-9]{128}$/.test(value)) return false;
    return timingSafeEqual(Buffer.from(value,'hex'),scryptSync(password,salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024}));
  } catch { return false; }
}
const dummyHash = hashPassword(randomBytes(24).toString('hex'));
export async function login(db, username, password, ip) {
  const now = Date.now(), keys = [`ip:${digest(ip)}`,`user:${digest(username.toLowerCase())}`];
  for (const key of keys) {
    const attempt = (await db.prepare('SELECT * FROM login_attempts WHERE key=?').get(key));
    if(attempt && now-attempt.window_start<900000 && attempt.count >= (key.startsWith('ip:')?25:5)) {
      const e=new Error('Muitas tentativas. Aguarde 15 minutos antes de tentar novamente.'); e.status=429; throw e;
    }
  }
  const user=(await db.prepare('SELECT u.*,h.active unit_active FROM users u LEFT JOIN units h ON h.id=u.unit_id WHERE LOWER(u.username)=LOWER(?)').get(username));
  const valid=verifyPassword(password,user?.password_hash || dummyHash);
  if(!valid || !user?.active || (user.role==='unit'&&!user.unit_active)) {
    for(const key of keys) (await db.prepare(`INSERT INTO login_attempts VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN ?-login_attempts.window_start>=900000 THEN 1 ELSE login_attempts.count+1 END,window_start=CASE WHEN ?-login_attempts.window_start>=900000 THEN ? ELSE login_attempts.window_start END`).run(key,now,now,now,now));
    const e=new Error('Usuário ou senha inválidos, ou acesso desativado.');e.status=401;throw e;
  }
  (await db.prepare('DELETE FROM login_attempts WHERE key=?').run(keys[1]));
  (await db.prepare('DELETE FROM sessions WHERE expires_at<?').run(now));
  const token=randomBytes(32).toString('hex'),csrf=randomBytes(24).toString('hex');
  (await db.prepare('INSERT INTO sessions VALUES(?,?,?,?,?,?)').run(digest(token),user.id,csrf,now,now,now+(user.role==='unit'?43200000:28800000)));
  return {token,user};
}
export async function session(db, req) {
  const token=(req.headers.cookie || '').match(/(?:^|;\s*)vox_session=([a-f0-9]{64})(?:;|$)/)?.[1];
  if(!token)return null;
  const row=(await db.prepare(`SELECT s.*,u.username,u.role,u.unit_id,u.active,u.must_change,h.name unit_name,h.active unit_active,h.device_id FROM sessions s JOIN users u ON u.id=s.user_id LEFT JOIN units h ON h.id=u.unit_id WHERE s.token_hash=?`).get(digest(token)));
  const now=Date.now();
  if(!row || !row.active || row.expires_at<now || now-row.touched_at>(row.role==='unit'?43200000:1800000) || (row.role==='unit'&&!row.unit_active))return null;
  (await db.prepare('UPDATE sessions SET touched_at=? WHERE token_hash=?').run(now,row.token_hash));
  return row;
}
export const cookie = (token,production,clear=false) => `vox_session=${clear?'':token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${clear?0:43200}${production?'; Secure':''}`;
export function publicUser(s) {
  return {id:s.user_id || s.id,username:s.username,role:s.role,unit_id:s.unit_id,unit_name:s.unit_name,device_id:s.device_id,must_change:!!s.must_change};
}
