import test from 'node:test';import assert from 'node:assert/strict';import {constrainWindow,zoomWindow,panWindow} from '../public/chart-navigation.mjs';
const day=864e5,bounds={start:0,end:1000*day},view={start:200*day,end:400*day};
test('缩放固定鼠标下的时间锚点',()=>{const zoom=zoomWindow(view,.75,.5,bounds);assert.equal(zoom.end-zoom.start,100*day);assert.equal(zoom.start+(zoom.end-zoom.start)*.75,350*day);});
test('拖动保持窗口跨度，在两端限制到有效历史',()=>{const left=panWindow(view,-20,bounds),right=panWindow(view,20,bounds);assert.deepEqual(left,{start:0,end:200*day});assert.deepEqual(right,{start:800*day,end:1000*day});});
test('缩放范围限制：至少 14 天，最多全历史，不能出现未来日期',()=>{const tiny=zoomWindow(view,.5,.0001,bounds);assert.equal(tiny.end-tiny.start,14*day);assert.deepEqual(zoomWindow(view,.5,100,bounds),bounds);assert.deepEqual(constrainWindow({start:900*day,end:1100*day},bounds),{start:800*day,end:1000*day});});


import {attachChartNavigation} from '../public/chart-navigation.mjs';
function navigation(t){
 const handlers=new Map(),captures=new Set(),classes=new Set(),frames=new Map();let id=0,window={...view};
 const oldRAF=globalThis.requestAnimationFrame,oldCancel=globalThis.cancelAnimationFrame;
 globalThis.requestAnimationFrame=fn=>{frames.set(++id,fn);return id;};globalThis.cancelAnimationFrame=id=>frames.delete(id);
 t.after(()=>{globalThis.requestAnimationFrame=oldRAF;globalThis.cancelAnimationFrame=oldCancel;});
 const canvas={clientWidth:400,clientHeight:300,setAttribute(){},focus(){},getBoundingClientRect:()=>({left:0,top:0,width:400,height:300}),
 classList:{add:c=>classes.add(c),remove:c=>classes.delete(c),toggle(c,on){on?classes.add(c):classes.delete(c);}},
 setPointerCapture:id=>captures.add(id),hasPointerCapture:id=>captures.has(id),releasePointerCapture:id=>captures.delete(id),
 addEventListener(type,fn){handlers.set(type,fn);}};
 attachChartNavigation(canvas,{getWindow:()=>window,getBounds:()=>bounds,onChange:next=>window=next,onReset:()=>window={...view}});
 return {get window(){return window;},classes,captures,
 flush(){const queued=[...frames.values()];frames.clear();queued.forEach(fn=>fn());},
 send(type,id,x,y=100,extra={}){handlers.get(type)({pointerId:id,clientX:x,clientY:y,pointerType:'touch',isPrimary:id===1,button:0,preventDefault(){},stopImmediatePropagation(){},...extra});}};
}
test('第二根非主触点参与缩放，中点时间保持不变',t=>{
 const n=navigation(t);n.send('pointerdown',1,100);n.send('pointerdown',2,200);
 n.send('pointermove',1,50);n.send('pointermove',2,250);n.flush();
 assert.equal(n.window.end-n.window.start,100*day);
 const ratio=150/346;assert.ok(Math.abs(n.window.start+100*day*ratio-(view.start+200*day*ratio))<.01);
});
test('双指捏合缩小、移动中点平移；松开一指使用未提交窗口继续拖动',t=>{
 const n=navigation(t);n.send('pointerdown',1,50);n.send('pointerdown',2,250);
 n.send('pointermove',1,100);n.send('pointermove',2,200);n.flush();
 assert.equal(n.window.end-n.window.start,400*day);
 const before={...n.window};n.send('pointermove',1,120);n.send('pointermove',2,220);n.flush();
 assert.ok(n.window.start<before.start);assert.equal(n.window.end-n.window.start,400*day);
 n.send('pointermove',2,240);n.send('pointerup',2,240);n.send('pointermove',1,130);n.flush();
 assert.ok(n.window.end-n.window.start<400*day);n.send('pointerup',1,130);assert.equal(n.classes.has('is-dragging'),false);assert.equal(n.captures.size,0);
});
test('触点取消、捕获丢失和额外手指不会卡住下次手势',t=>{
 const n=navigation(t);n.send('pointerdown',1,50);n.send('pointerdown',2,150);n.send('pointerdown',3,250);
 assert.equal(n.captures.size,2);n.send('pointercancel',2,150);n.send('lostpointercapture',1,50);
 assert.equal(n.classes.has('is-dragging'),false);n.send('pointerdown',4,50);n.send('pointermove',4,80);n.flush();assert.ok(n.window.start<view.start);
});
test('纵向双指张开也缩放，且最小窗口受限',t=>{
 const n=navigation(t);n.send('pointerdown',1,100,100);n.send('pointerdown',2,100,110);
 n.send('pointermove',2,100,1000);n.flush();assert.equal(n.window.end-n.window.start,14*day);
});
test('鼠标拖动与左侧绘图区仍可使用',t=>{
 const n=navigation(t);n.send('pointerdown',1,10,100,{pointerType:'mouse'});n.send('pointermove',1,50,100,{pointerType:'mouse'});n.flush();assert.ok(n.window.start<view.start);
 n.send('pointerup',1,50,100,{pointerType:'mouse'});assert.equal(n.classes.has('is-dragging'),false);
});
