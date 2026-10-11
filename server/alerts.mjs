import { randomUUID } from 'node:crypto';
import { aggregate,period,localDay,shiftDay,midnight } from './analytics.mjs';
import { audit } from './db.mjs';
const fmt=(value,digits=1)=>Number(value).toLocaleString('pt-BR',{minimumFractionDigits:digits,maximumFractionDigits:digits});

export async function detectAlerts(db) {
  const cfg=(await db.prepare('SELECT * FROM settings WHERE id=1').get()),now=new Date(),day=localDay(now);
  const add=async (unit,type,fingerprint,evidence,severity='attention')=>{
    const r=(await db.prepare('INSERT INTO alerts(id,unit_id,type,fingerprint,detected_at,severity,evidence,demo) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(fingerprint) DO NOTHING').run(randomUUID(),unit.id,type,fingerprint,now.toISOString(),severity,evidence,unit.demo||0));
    if(r.changes)(await audit(db,null,'Alerta detectado',unit.id,{type,evidence}));
  };
  const current=(await aggregate(db,period()));
  const recent=(await aggregate(db,{...period(),from:midnight(shiftDay(day,-6)),to:midnight(shiftDay(day,1)),days:7,start:shiftDay(day,-6)}));
  const prev=(await aggregate(db,{...period(),from:midnight(shiftDay(day,-13)),to:midnight(shiftDay(day,-6)),days:7,start:shiftDay(day,-13),end:shiftDay(day,-7)}));
  for(const u of current.units) {
    for(const c of u.categories)if(c.count>=cfg.sample_min&&c.score<cfg.score_threshold) (await add(u,'Categoria abaixo do limite',`low:${u.id}:${c.id}:${day}`,`${c.name}: ${fmt(c.score)}/100 em ${c.count} avaliações nos últimos 30 dias. Limite configurado: ${cfg.score_threshold}/100.`,c.score<cfg.score_threshold-15?'critical':'attention'));
    const a=recent.units.find(x=>x.id===u.id),b=prev.units.find(x=>x.id===u.id);
    if(a?.count>=cfg.sample_min&&b?.count>=cfg.sample_min) {
      for(const c of a.categories) {
        const old=b.categories.find(x=>x.id===c.id),drop=old.score-c.score;
        if(drop>=cfg.decline_threshold)(await add(u,'Queda de desempenho',`drop:${u.id}:${c.id}:${day}`,`${c.name} caiu ${fmt(drop)} pontos: ${fmt(old.score)} para ${fmt(c.score)} em dois períodos de 7 dias (${b.count} e ${a.count} avaliações).`,'critical'));
      }
      const variation=(a.count-b.count)/b.count*100;
      if(Math.abs(variation)>=cfg.volume_change_threshold)(await add(u,'Variação de volume',`volume:${u.id}:${day}`,`Volume variou ${fmt(variation,0)}%: ${b.count} para ${a.count} avaliações em dois períodos de 7 dias. Limite: ${cfg.volume_change_threshold}%.`));
      const highs=(await db.prepare(`SELECT SUM(CASE WHEN pattern='5,5,5,5,5,5' THEN 1 ELSE 0 END) high,COUNT(*) n FROM (SELECT group_concat(r.rating,',') pattern FROM evaluations e JOIN responses r ON e.id=r.evaluation_id WHERE e.unit_id=? AND e.created_at>=? GROUP BY e.id)`).get(u.id,midnight(shiftDay(day,-6))));
      if(highs.n>=cfg.sample_min&&highs.high/highs.n*100>=cfg.high_threshold)(await add(u,'Concentração de notas máximas',`high:${u.id}:${day}`,`${highs.high} de ${highs.n} avaliações recentes tiveram todas as notas 5 (${fmt(highs.high/highs.n*100,0)}%). Limite: ${cfg.high_threshold}%. O padrão requer contexto e não comprova irregularidade.`));
    }
    const since=new Date(now.getTime()-600000).toISOString();
    const patterns=(await db.prepare(`SELECT pattern,COUNT(*) n FROM (SELECT group_concat(r.rating,',') pattern FROM evaluations e JOIN responses r ON e.id=r.evaluation_id WHERE e.unit_id=? AND e.created_at>=? GROUP BY e.id) GROUP BY pattern HAVING n>=?`).all(u.id,since,cfg.repeat_threshold));
    for(const pat of patterns)(await add(u,'Respostas idênticas em sequência',`repeat:${u.id}:${pat.pattern}:${Math.floor(now.getTime()/600000)}`,`${pat.n} avaliações com o padrão ${pat.pattern.replaceAll(',',' / ')} em 10 minutos. Limite: ${cfg.repeat_threshold}. Respostas repetidas não comprovam manipulação.`));
    const volume=(await db.prepare('SELECT device_id,COUNT(*) n FROM evaluations WHERE unit_id=? AND created_at>=? GROUP BY device_id HAVING n>=?').all(u.id,since,cfg.concentration_threshold));
    for(const v of volume)(await add(u,'Concentração de envios',`burst:${u.id}:${v.device_id}:${Math.floor(now.getTime()/600000)}`,`${v.n} envios no dispositivo ${v.device_id} em 10 minutos. Limite: ${cfg.concentration_threshold}. Verifique o movimento da unidade.`));
    const failures=(await db.prepare("SELECT a.action,COUNT(*) n FROM audit_logs a JOIN users actor ON actor.id=a.actor_id WHERE actor.unit_id=? AND a.created_at>=? AND a.action IN('Falha técnica','Reenvio idempotente') GROUP BY a.action HAVING n>=?").all(u.id,since,cfg.repeat_threshold));
    for(const f of failures)(await add(u,f.action==='Falha técnica'?'Falhas técnicas recorrentes':'Tentativas de reenvio recorrentes',`technical:${u.id}:${f.action}:${Math.floor(now.getTime()/600000)}`,`${f.n} ocorrências de ${f.action.toLowerCase()} em 10 minutos. Limite: ${cfg.repeat_threshold}. O mecanismo de idempotência preserva uma única avaliação por envio.`));
  }
}
