const dayFormatter = new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'});
export function localDay(value=new Date()) {
  const p=Object.fromEntries(dayFormatter.formatToParts(new Date(value)).map(p=>[p.type,p.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
export const shiftDay = (day,amount) => new Date(Date.parse(day+'T12:00:00Z')+amount*86400000).toISOString().slice(0,10);
// Resolve São Paulo midnight with Intl, including historical daylight saving.
export function midnight(day) {
  const desired=Date.parse(day+'T00:00:00Z');let candidate=desired;
  const fmt=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
  for(let i=0;i<3;i++) {const parts=Object.fromEntries(fmt.formatToParts(new Date(candidate)).map(p=>[p.type,p.value]));const asUTC=Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`);candidate+=desired-asUTC;}
  return new Date(candidate).toISOString();
}
export function period(params=new URLSearchParams()) {
  const end=params.get('end') || localDay(),start=params.get('start') || shiftDay(end,-29);
  for(const d of [start,end])if(!/^\d{4}-\d{2}-\d{2}$/.test(d) || !Number.isFinite(Date.parse(d)) || new Date(d+'T12:00:00Z').toISOString().slice(0,10)!==d) throw Object.assign(new Error('Informe datas válidas.'),{status:400});
  const days=Math.round((Date.parse(end)-Date.parse(start))/86400000)+1;
  if(days<1 || days>731)throw Object.assign(new Error('Escolha um período de 1 a 731 dias.'),{status:400});
  return {start,end,from:midnight(start),to:midnight(shiftDay(end,1)),days,unit:params.get('unit') || ''};
}
export const scoreFromAverage = avg => avg==null?null:(avg-1)*25;
export async function aggregate(db,p) {
  const cond='e.created_at>=? AND e.created_at<?'+(p.unit?' AND e.unit_id=?':'');
  const args=[p.from,p.to,...(p.unit?[p.unit]:[])];
  const summary=(await db.prepare(`SELECT COUNT(DISTINCT e.id) total,COUNT(DISTINCT e.unit_id) evaluated_units,AVG(r.rating) avg,AVG(CASE WHEN r.category_id=6 THEN r.rating END) satisfaction FROM evaluations e JOIN responses r ON r.evaluation_id=e.id WHERE ${cond}`).get(...args));
  const categories=(await db.prepare(`SELECT c.id,c.name,AVG(r.rating) average,COUNT(r.rating) count FROM categories c LEFT JOIN (responses r JOIN evaluations e ON e.id=r.evaluation_id AND ${cond}) ON r.category_id=c.id GROUP BY c.id ORDER BY c.display_order`).all(...args)).map(c=>({...c,score:scoreFromAverage(c.average)}));
  const units=(await db.prepare(`SELECT u.id,u.name,u.address,u.code,u.active,u.device_id,u.demo,u.created_at,COUNT(DISTINCT e.id) count,AVG(r.rating) average,a.id account_id,a.username,a.active account_active FROM units u LEFT JOIN evaluations e ON e.unit_id=u.id AND e.created_at>=? AND e.created_at<? LEFT JOIN responses r ON r.evaluation_id=e.id LEFT JOIN users a ON a.unit_id=u.id ${p.unit?'WHERE u.id=?':''} GROUP BY u.id,a.id ORDER BY average DESC,u.name`).all(...args)).map(u=>({...u,score:scoreFromAverage(u.average)}));
  const unitCategories=(await db.prepare(`SELECT e.unit_id,r.category_id,AVG(r.rating) average,COUNT(*) count FROM responses r JOIN evaluations e ON e.id=r.evaluation_id WHERE ${cond} GROUP BY e.unit_id,r.category_id`).all(...args));
  for(const u of units)u.categories=categories.map(c=>{const found=unitCategories.find(x=>x.unit_id===u.id&&x.category_id===c.id);return {id:c.id,name:c.name,score:scoreFromAverage(found?.average),count:found?.count||0};});
  const rows=(await db.prepare(`SELECT sao_day(e.created_at) AS day,COUNT(DISTINCT e.id) count,AVG(r.rating) average FROM evaluations e JOIN responses r ON r.evaluation_id=e.id WHERE ${cond} GROUP BY day ORDER BY day`).all(...args));
  const trend=[];
  for(let i=0;i<p.days;i++){const day=shiftDay(p.start,i),r=rows.find(x=>x.day===day);trend.push({day,count:r?.count||0,score:scoreFromAverage(r?.average)});}
  return {summary:{...summary,score:scoreFromAverage(summary.avg)},categories,units,trend};
}
export async function dashboard(db,p) {
  const current=(await aggregate(db,p)),previous=(await aggregate(db,{...p,start:shiftDay(p.start,-p.days),end:shiftDay(p.start,-1),from:midnight(shiftDay(p.start,-p.days)),to:p.from}));
  const settings=(await db.prepare('SELECT * FROM settings WHERE id=1').get());
  const allUnits=(await db.prepare('SELECT id,name,active FROM units ORDER BY name').all());
  const alerts=(await db.prepare(`SELECT a.*,u.name unit_name FROM alerts a JOIN units u ON u.id=a.unit_id WHERE a.status!='Encerrado' AND a.detected_at>=? AND a.detected_at<? ${p.unit?'AND a.unit_id=?':''} ORDER BY CASE a.severity WHEN 'critical' THEN 0 ELSE 1 END,a.detected_at DESC LIMIT 200`).all(p.from,p.to,...(p.unit?[p.unit]:[])));
  const priorities=current.units.flatMap(u=>u.categories.filter(c=>c.score!==null&&c.count>=settings.sample_min&&c.score<settings.score_threshold).map(c=>({unit_id:u.id,unit_name:u.name,category:c.name,score:c.score,count:c.count}))).sort((a,b)=>a.score-b.score).slice(0,6);
  const category_trends=p.unit?(await db.prepare('SELECT sao_day(e.created_at) AS day,r.category_id,AVG(r.rating) average,COUNT(*) count FROM evaluations e JOIN responses r ON r.evaluation_id=e.id WHERE e.created_at>=? AND e.created_at<? AND e.unit_id=? GROUP BY day,r.category_id ORDER BY day').all(p.from,p.to,p.unit)).map(r=>({...r,score:scoreFromAverage(r.average)})):[];
  return {...current,previous:previous.summary,previous_categories:previous.categories,category_trends,period:{start:p.start,end:p.end,days:p.days},settings,allUnits,alerts,priorities,demonstration:!!(await db.prepare('SELECT 1 FROM evaluations WHERE demo=1 LIMIT 1').get()),has_real:!!(await db.prepare('SELECT 1 FROM evaluations WHERE demo=0 LIMIT 1').get())};
}
