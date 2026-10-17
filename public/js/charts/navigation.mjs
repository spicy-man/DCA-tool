import {chartInsets} from './geometry.mjs';
const DAY=86400000;
export function constrainWindow(view,bounds,minSpan=14*DAY){
 const full=bounds.end-bounds.start;
 if(!Number.isFinite(full)||full<=0)return {...bounds};
 const span=Math.min(full,Math.max(Math.min(minSpan,full),view.end-view.start));
 const start=Math.max(bounds.start,Math.min(bounds.end-span,view.start));
 return {start,end:start+span};
}
export function zoomWindow(view,ratio,factor,bounds){
 ratio=Math.max(0,Math.min(1,ratio));
 const anchor=view.start+(view.end-view.start)*ratio;
 const span=Math.min(bounds.end-bounds.start,Math.max(14*DAY,(view.end-view.start)*factor));
 return constrainWindow({start:anchor-span*ratio,end:anchor+span*(1-ratio)},bounds);
}
export function panWindow(view,fraction,bounds){const delta=(view.end-view.start)*fraction;return constrainWindow({start:view.start+delta,end:view.end+delta},bounds);}
export function attachChartNavigation(canvas,{getWindow,getBounds,onChange,onReset}){
 let drag=null,pinch=null,pending=null,raf=0;
 const touches=new Map();
 const frame=()=>{const w=canvas.clientWidth,{left,right}=chartInsets(w);return {left,right,top:12,bottom:32,width:w-left-right};};
 const inside=event=>{const r=canvas.getBoundingClientRect(),f=frame(),x=event.clientX-r.left,y=event.clientY-r.top;return x>=f.left&&x<=r.width-f.right&&y>=f.top&&y<=r.height-f.bottom;};
 const commit=view=>{pending=view;if(!raf)raf=requestAnimationFrame(()=>{raf=0;const next=pending;pending=null;onChange(next);});};
 const current=()=>pending||getWindow();
 canvas.tabIndex=0;canvas.setAttribute('aria-keyshortcuts','ArrowLeft ArrowRight + - Home');
 canvas.addEventListener('wheel',event=>{
 if(!getWindow()||!inside(event))return;event.preventDefault();if(drag||pinch)return;
 const f=frame(),rect=canvas.getBoundingClientRect(),scale=event.deltaMode===1?16:event.deltaMode===2?canvas.clientHeight:1;
 const dx=event.deltaX*scale,dy=event.deltaY*scale;
 if(event.shiftKey||Math.abs(dx)>Math.abs(dy)){commit(panWindow(current(),(event.shiftKey?dy||dx:dx)/f.width,getBounds()));}
 else if(dy){commit(zoomWindow(current(),(event.clientX-rect.left-f.left)/f.width,Math.exp(Math.max(-500,Math.min(500,dy))*.002),getBounds()));}
 },{passive:false});
 const beginTouch=()=>{
 // Rebase on the pending window so adding/removing a finger cannot jump back a frame.
 const points=[...touches.values()],view={...current()};pinch=null;drag=null;
 if(points.length===2){const [a,b]=points,f=frame(),rect=canvas.getBoundingClientRect();pinch={view,distance:Math.max(1,Math.hypot(b.x-a.x,b.y-a.y)),ratio:Math.max(0,Math.min(1,((a.x+b.x)/2-rect.left-f.left)/f.width))};}
 else if(points.length===1)drag={id:points[0].id,x:points[0].x,view};
 canvas.classList.toggle('is-dragging',points.length>0);
 };
 canvas.addEventListener('pointerdown',event=>{
 if(event.button!==0||!getWindow()||!inside(event))return;
 if(event.pointerType==='touch'){
 if(touches.size>=2)return;
 touches.set(event.pointerId,{id:event.pointerId,x:event.clientX,y:event.clientY});canvas.setPointerCapture(event.pointerId);beginTouch();event.preventDefault();return;
 }
 if(!event.isPrimary||touches.size)return;
 canvas.classList.add('mouse-focused');canvas.focus({preventScroll:true});drag={id:event.pointerId,x:event.clientX,view:{...current()}};canvas.setPointerCapture(event.pointerId);canvas.classList.add('is-dragging');event.preventDefault();
 });
 canvas.addEventListener('pointermove',event=>{
 if(touches.has(event.pointerId)){
 touches.set(event.pointerId,{id:event.pointerId,x:event.clientX,y:event.clientY});
 if(pinch){
 event.preventDefault();event.stopImmediatePropagation();
 const [a,b]=[...touches.values()],f=frame(),rect=canvas.getBoundingClientRect();
 const ratio=Math.max(0,Math.min(1,((a.x+b.x)/2-rect.left-f.left)/f.width));
 const zoom=zoomWindow(pinch.view,pinch.ratio,pinch.distance/Math.max(1,Math.hypot(b.x-a.x,b.y-a.y)),getBounds());
 commit(panWindow(zoom,pinch.ratio-ratio,getBounds()));return;
 }
 }
 if(!drag||event.pointerId!==drag.id)return;event.preventDefault();event.stopImmediatePropagation();commit(panWindow(drag.view,-(event.clientX-drag.x)/frame().width,getBounds()));
 },{capture:true});
 const release=event=>{
 if(touches.delete(event.pointerId))beginTouch();
 else if(drag&&event.pointerId===drag.id){drag=null;canvas.classList.remove('is-dragging');}
 if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);
 };
 for(const type of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(type,release);
 canvas.addEventListener('dblclick',event=>{if(!inside(event))return;event.preventDefault();if(raf)cancelAnimationFrame(raf);raf=0;pending=null;onReset();});
 canvas.addEventListener('keydown',event=>{
 canvas.classList.remove('mouse-focused');
 if(!getWindow())return;let next;
 if(event.key==='ArrowLeft')next=panWindow(current(),-.2,getBounds());
 else if(event.key==='ArrowRight')next=panWindow(current(),.2,getBounds());
 else if(['+','=','ArrowUp'].includes(event.key))next=zoomWindow(current(),.5,.8,getBounds());
 else if(['-','ArrowDown'].includes(event.key))next=zoomWindow(current(),.5,1.25,getBounds());
 else if(event.key==='Home'){event.preventDefault();onReset();return;}else return;
 event.preventDefault();commit(next);
 });
}
