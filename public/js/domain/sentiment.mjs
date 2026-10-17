export const OFFICIAL_START='2021-02-01';
export function rating(score){return score<25?'Extreme Fear':score<45?'Fear':score<55?'Neutral':score<75?'Greed':'Extreme Greed';}
export function parseCSV(text){
 const lines=text.trim().replace(/^\uFEFF/,'').split(/\r?\n/);
 if(lines.shift()!=='Date,Fear Greed,Rating')throw Error('CSV 列名不匹配');
 const seen=new Set();
 const rows=lines.map(line=>{
 const [date,value,label]=line.split(','),score=Number(value);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date||!value?.trim()||!Number.isFinite(score)||score<0||score>100||seen.has(date))throw Error('CSV 数据无效或日期重复');
 seen.add(date);return {date,score,label:label||rating(score),source:date>=OFFICIAL_START?'CNN official':'Historical archive'};
 });
 if(!rows.length)throw Error('没有可用数据');return rows.sort((a,b)=>a.date.localeCompare(b.date));
}
export function aggregate(rows,frequency){
 if(frequency==='daily')return rows;
 const groups=new Map();
 for(const row of rows){const d=new Date(row.date+'T00:00:00Z');if(frequency==='weekly')d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));const key=frequency==='monthly'?row.date.slice(0,7):d.toISOString().slice(0,10);groups.set(key,row);}
 return [...groups.values()];
}
export function selectRange(rows,range,end=rows.at(-1).date){
 if(range==='all')return rows.filter(r=>r.date<=end);
 const date=new Date(end+'T00:00:00Z');date.setUTCMonth(date.getUTCMonth()-Number(range));const start=date.toISOString().slice(0,10);
 return rows.filter(r=>r.date>=start&&r.date<=end);
}
