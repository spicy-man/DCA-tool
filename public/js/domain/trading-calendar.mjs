// NYSE rules: https://www.nyse.com/trade/hours-calendars
// Special closures must be maintained when announced.
const day=86400000;
const iso=d=>new Date(d).toISOString().slice(0,10);
const weekday=d=>new Date(d+'T12:00:00Z').getUTCDay();
const shift=(d,n)=>iso(Date.parse(d+'T12:00:00Z')+n*day);
const nth=(y,m,w,n)=>{const first=`${y}-${String(m).padStart(2,'0')}-01`;return shift(first,(w-weekday(first)+7)%7+7*(n-1));};
const observed=d=>weekday(d)===6?shift(d,-1):weekday(d)===0?shift(d,1):d;
function easter(y){
 const a=y%19,b=Math.floor(y/100),c=y%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451),v=h+l-7*m+114;
 return `${y}-${String(Math.floor(v/31)).padStart(2,'0')}-${String(v%31+1).padStart(2,'0')}`;
}
const special=new Set(['2001-09-11','2001-09-12','2001-09-13','2001-09-14','2004-06-11','2007-01-02','2012-10-29','2012-10-30','2018-12-05','2025-01-09']);
const holidayCache=new Map();
function holidays(y){
 if(holidayCache.has(y))return holidayCache.get(y);
 const jan=`${y}-01-01`;
 // Saturday New Year's Day is not observed on the prior Friday by NYSE.
 const dates=[weekday(jan)===0?shift(jan,1):jan,nth(y,2,1,3),shift(easter(y),-2),shift(nth(y,6,1,1),-7),observed(`${y}-07-04`),nth(y,9,1,1),nth(y,11,4,4),observed(`${y}-12-25`)];
 if(y>=1998)dates.push(nth(y,1,1,3));
 if(y>=2022)dates.push(observed(`${y}-06-19`));
 const result=new Set(dates);holidayCache.set(y,result);return result;
}
export function isTradingDay(date){return ![0,6].includes(weekday(date))&&!holidays(Number(date.slice(0,4))).has(date)&&!special.has(date);}
export function nyDate(now=Date.now()){return new Date(now).toLocaleDateString('en-CA',{timeZone:'America/New_York'});}
export function sessionClose(date){
 const y=Number(date.slice(0,4));
 const early=date===shift(nth(y,11,4,4),1)||date===`${y}-12-24`||date===`${y}-07-03`;
 const nyHour=Number(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'numeric',hourCycle:'h23'}).format(new Date(date+'T17:00:00Z')));
 return Date.parse(date+`T${String((early?13:16)+17-nyHour).padStart(2,'0')}:00:00Z`);
}
export function latestClosedSession(now=Date.now(),graceMinutes=60){
 let date=nyDate(now);
 for(let i=0;i<20;i++,date=shift(date,-1))if(isTradingDay(date)&&now>=sessionClose(date)+graceMinutes*60000)return date;
 throw Error('无法确定最近已收盘交易日');
}
