import test from 'node:test';import assert from 'node:assert/strict';import {constrainWindow,zoomWindow,panWindow} from '../public/chart-navigation.mjs';
const day=864e5,bounds={start:0,end:1000*day},view={start:200*day,end:400*day};
test('缩放固定鼠标下的时间锚点',()=>{const zoom=zoomWindow(view,.75,.5,bounds);assert.equal(zoom.end-zoom.start,100*day);assert.equal(zoom.start+(zoom.end-zoom.start)*.75,350*day);});
test('拖动保持窗口跨度，在两端限制到有效历史',()=>{const left=panWindow(view,-20,bounds),right=panWindow(view,20,bounds);assert.deepEqual(left,{start:0,end:200*day});assert.deepEqual(right,{start:800*day,end:1000*day});});
test('缩放范围限制：至少 14 天，最多全历史，不能出现未来日期',()=>{const tiny=zoomWindow(view,.5,.0001,bounds);assert.equal(tiny.end-tiny.start,14*day);assert.deepEqual(zoomWindow(view,.5,100,bounds),bounds);assert.deepEqual(constrainWindow({start:900*day,end:1100*day},bounds),{start:800*day,end:1000*day});});
