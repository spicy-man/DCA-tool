// Both panels use the same plot edges and a right-hand value axis.
export function chartInsets(width){return {left:0,right:width<500?54:64};}
// Trading sessions occupy equal horizontal slots; non-trading days occupy no space.
export function periodKey(date,frequency){if(frequency==='monthly')return date.slice(0,7);if(frequency==='weekly'){const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));return d.toISOString().slice(0,10);}return date;}
export function createTradingScale(calendar,frequency,left,width,rightOffset=3){
 const periods=new Map();for(const date of calendar)periods.set(periodKey(date,frequency),date);
 const keys=[...periods.keys()].sort(),dates=keys.map(key=>periods.get(key)),positions=new Map(keys.map((key,i)=>[key,i]));
 const spacing=width/Math.max(1,keys.length+rightOffset);
 function index(date){const key=periodKey(date,frequency);if(positions.has(key))return positions.get(key);let lo=0,hi=keys.length;while(lo<hi){const mid=(lo+hi)>>1;if(keys[mid]<key)lo=mid+1;else hi=mid;}return lo-.5;}
 return {spacing,dates,x:date=>left+(index(date)+.5)*spacing,dateAt:px=>dates[Math.max(0,Math.min(dates.length-1,Math.round((px-left)/spacing-.5)))],ticks(count){const indexes=new Set();for(let i=0;i<count;i++)indexes.add(Math.round((dates.length-1)*i/Math.max(1,count-1)));return [...indexes].filter(i=>dates[i]).map(i=>({date:dates[i],x:left+(i+.5)*spacing}));}};
}
// Device-pixel geometry prevents antialiased outlines and keeps the wick centered.
export function candleMetrics(spacing,dpr){
 const wick=Math.max(1,Math.floor(dpr));
 const ratio=spacing<=4?1:.8+.2/(1+.7*(spacing-4));
 let body=Math.max(wick,Math.floor(spacing*dpr*ratio));
 if(body>=2&&body%2!==wick%2)body--;
 return {body:Math.max(wick,body),wick,border:wick};
}
export function paintCandle(c,bar,metrics,dpr){
 const center=Math.round(bar.x*dpr),left=center-Math.floor(metrics.body/2),wickLeft=center-Math.floor(metrics.wick/2);
 const top=Math.round(Math.min(bar.openY,bar.closeY)*dpr),bottom=Math.round(Math.max(bar.openY,bar.closeY)*dpr),high=Math.round(bar.highY*dpr),low=Math.round(bar.lowY*dpr);
 c.fillStyle='#000000';
 if(top>high)c.fillRect(wickLeft,high,metrics.wick,top-high);
 if(low>bottom)c.fillRect(wickLeft,bottom+1,metrics.wick,low-bottom);
 const height=Math.max(metrics.wick,bottom-top+1);c.fillRect(left,top,metrics.body,height);
 if(bar.up&&metrics.body>metrics.border*2&&height>metrics.border*2){c.fillStyle='#ffffff';c.fillRect(left+metrics.border,top+metrics.border,metrics.body-2*metrics.border,height-2*metrics.border);}
}
