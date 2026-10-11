import { scoreFromAverage } from './analytics.mjs';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from './db.mjs';

const soraBytes=readFileSync(resolve(ROOT,'server/assets/fonts/Sora-Regular.ttf'));
const sora=JSON.parse(readFileSync(resolve(ROOT,'server/assets/fonts/Sora-Regular.metrics.json'),'utf8'));
const plainText=s=>s.replace(/[—–]/g,'-').replace(/[^\x20-\xff]/g,' ');
const textWidth=(text,size)=>[...plainText(text)].reduce((sum,c)=>sum+(sora.widths[c.charCodeAt(0)-sora.firstChar]??sora.widths[31])*size/1000,0);

export function reportRows(data,params) {
  const min=Number(params.get('minScore') || 0),max=Number(params.get('maxScore') || 100),volume=Number(params.get('minVolume') || 0),category=Number(params.get('category') || 0),status=params.get('alertStatus') || '';
  if(![min,max,volume,category].every(Number.isFinite)||min>max||min<0||max>100||volume<0||category<0||category>6)throw Object.assign(new Error('Filtros de relatório inválidos.'),{status:400});
  return data.units.filter(u=>{
    const s=category?u.categories.find(c=>c.id===category)?.score:u.score;
    return (s==null || (s>=min&&s<=max))&&u.count>=volume&&(!status||data.alerts.some(a=>a.unit_id===u.id&&a.status===status));
  });
}
const br=n=>n==null?'Sem dados':Number(n).toFixed(1).replace('.',',');
const csvCell=v=>`"${String(v??'').replace(/^[=+\-@\t\r]/,"'$&").replaceAll('"','""')}"`;
export function csv(data,params) {
  const rows=reportRows(data,params),names=data.categories.map(c=>c.name);
  const records=[['Vox — Relatório de unidades'],['Período',data.period.start,data.period.end],['Base',data.demonstration?'Contém dados de demonstração':'Avaliações reais'],['Unidade','Avaliações','Score geral',...names,'Prioridade','Alertas abertos','Amostra']];
  for(const u of rows) {
    const weakest=[...u.categories].filter(c=>c.score!=null).sort((a,b)=>a.score-b.score)[0];
    records.push([u.name,u.count,br(u.score),...u.categories.map(c=>br(c.score)),weakest?.name || 'Sem dados',data.alerts.filter(a=>a.unit_id===u.id).map(a=>a.type+': '+a.status).join(' | '),u.count<data.settings.sample_min?'Amostra reduzida':'Amostra suficiente']);
  }
  records.push(['Fórmula','(média da nota - 1) / 4 × 100. Seis categorias com pesos iguais.']);
  if(data.previous.total)records.push(['Período anterior equivalente: avaliações',data.previous.total,'Score',br(data.previous.score)]);
  return '\uFEFF'+records.map(row=>row.map(csvCell).join(';')).join('\r\n');
}
// Self-contained PDF writer with bundled Sora and measured WinAnsi glyph widths.
export function pdf(data,params) {
  const pages=[];let lines=[];
  const add=(text='',size=11)=>{if(lines.length>=43){pages.push(lines);lines=[];}lines.push({text,size});};
  const width=textWidth;
  const wrap=(text,size=11)=>{let line='';for(const word of text.split(' ')){if(width(line+' '+word,size)>507&&line){add(line,size);line='';}if(width(word,size)>507){for(const c of word){if(width(line+c,size)>507){add(line,size);line='';}line+=c;}}else line+=(line?' ':'')+word;}if(line)add(line,size);};
  add('Vox | Inteligência em saúde',22);add('Secretaria Municipal de Saúde de Louveira - SP',11);add();
  add(`Relatório: ${data.period.start.split('-').reverse().join('/')} a ${data.period.end.split('-').reverse().join('/')}`,13);
  add(data.demonstration?'AMBIENTE DE DEMONSTRAÇÃO - CONTÉM DADOS FICTÍCIOS':'Avaliações recebidas pelo Vox',10);add();
  if(params.get('category'))wrap('Filtro por categoria: '+data.categories.find(c=>c.id===Number(params.get('category')))?.name);
  add(`Score geral: ${br(data.summary.score)}/100 | Avaliações: ${data.summary.total}`,14);
  if(data.previous.total)add(`Período anterior equivalente: ${data.previous.total} avaliações; score ${br(data.previous.score)}/100.`);
  add();
  for(const u of reportRows(data,params)) {
    if(lines.length>30){pages.push(lines);lines=[];}
    wrap(`${u.name} | Score: ${br(u.score)}/100 | ${u.count} avaliações`,14);
    if(u.count<data.settings.sample_min)add(`Amostra reduzida: mínimo configurado de ${data.settings.sample_min} avaliações.`,10);
    for(const c of u.categories)add(`${c.name}: ${br(c.score)}/100`,11);
    const weakest=[...u.categories].filter(c=>c.score!=null).sort((a,b)=>a.score-b.score)[0];
    if(weakest)wrap(`Prioridade: ${weakest.name} apresenta a menor pontuação da unidade no período.`);
    for(const a of data.alerts.filter(a=>a.unit_id===u.id))wrap(`Alerta (${a.status}): ${a.type}. ${a.evidence}`);
    add();
  }
  wrap('Metodologia: score da categoria = (média das notas - 1) / 4 x 100. Score geral = média das seis categorias, com pesos iguais. Alertas sinalizam situações para análise e não comprovam irregularidades.');
  add('Fuso horário: America/Sao_Paulo. Fotos e credenciais não integram este relatório.',9);
  pages.push(lines);
  const objects=[],put=s=>{objects.push(Buffer.isBuffer(s)?s:Buffer.from(s,'latin1'));return objects.length;};
  put('<< /Type /Catalog /Pages 2 0 R >>');put('');
  const fontFile=put(Buffer.concat([Buffer.from(`<< /Length ${soraBytes.length} /Length1 ${soraBytes.length} >>\nstream\n`),soraBytes,Buffer.from('\nendstream')]));
  const descriptor=put(`<< /Type /FontDescriptor /FontName /Sora-Regular /Flags 32 /FontBBox [${sora.bbox.join(' ')}] /ItalicAngle 0 /Ascent ${sora.ascent} /Descent ${sora.descent} /CapHeight ${sora.capHeight} /StemV 80 /FontFile2 ${fontFile} 0 R >>`);
  const font=put(`<< /Type /Font /Subtype /TrueType /BaseFont /Sora-Regular /Encoding /WinAnsiEncoding /FirstChar ${sora.firstChar} /LastChar ${sora.lastChar} /Widths [${sora.widths.join(' ')}] /FontDescriptor ${descriptor} 0 R >>`),refs=[];
  const clean=s=>plainText(s).replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');
  pages.forEach((page,i)=>{
    const content=Buffer.from(page.map((l,j)=>`BT /F1 ${l.size} Tf 0.12 0.15 0.22 rg 44 ${790-j*16} Td (${clean(l.text)}) Tj ET`).join('\n')+`\nBT /F1 9 Tf 44 28 Td (Vox - Página ${i+1} de ${pages.length}) Tj ET`,'latin1');
    const stream=put(Buffer.concat([Buffer.from(`<< /Length ${content.length} >>\nstream\n`),content,Buffer.from('\nendstream')]));
    refs.push(put(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${stream} 0 R >>`));
  });
  objects[1]=Buffer.from(`<< /Type /Pages /Kids [${refs.map(r=>r+' 0 R').join(' ')}] /Count ${refs.length} >>`);
  const chunks=[Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n','latin1')],offsets=[0];let offset=chunks[0].length;
  objects.forEach((o,i)=>{offsets.push(offset);const b=Buffer.concat([Buffer.from(`${i+1} 0 obj\n`),o,Buffer.from('\nendobj\n')]);chunks.push(b);offset+=b.length;});
  chunks.push(Buffer.from(`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(o=>String(o).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF`));
  return Buffer.concat(chunks);
}
