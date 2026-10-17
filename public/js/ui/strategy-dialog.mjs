export function initStrategyDialog(){
 const $=id=>document.getElementById(id);
const strategyDialog=$('strategy-dialog'),diagramScroll=strategyDialog.querySelector('.strategy-dialog-body');
$('strategy-help').addEventListener('click',()=>{const threshold=Number($('fear-threshold').value),amount=Number($('base-amount').value);$('strategy-fear-settings').textContent=Number.isFinite(threshold)&&threshold>0&&threshold<=95&&Number.isFinite(amount)&&amount>=.01?'当前阈值 '+threshold+' · 重置 '+(threshold+5)+' · 每次加投 '+amount.toLocaleString('en-US')+' USD（1 × N）':'阈值与基准 N 以主图有效设置为准';strategyDialog.showModal();document.body.classList.add('strategy-dialog-open');});
$('strategy-dialog-close').addEventListener('click',()=>strategyDialog.close());
strategyDialog.addEventListener('close',()=>{document.body.classList.remove('strategy-dialog-open');diagramScroll.classList.remove('is-zoomed');$('strategy-diagram-zoom').textContent='放大查看';$('strategy-diagram-zoom').setAttribute('aria-pressed','false');diagramScroll.scrollTo(0,0);strategyDialog.querySelectorAll('.strategy-diagram-scroll').forEach(panel=>panel.scrollTo(0,0));});
strategyDialog.addEventListener('click',event=>{if(event.target!==strategyDialog)return;const r=strategyDialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)strategyDialog.close();});
$('strategy-diagram-zoom').addEventListener('click',event=>{const zoomed=diagramScroll.classList.toggle('is-zoomed');event.currentTarget.textContent=zoomed?'适应窗口':'放大查看';event.currentTarget.setAttribute('aria-pressed',String(zoomed));});

}
