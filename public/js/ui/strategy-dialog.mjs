export function initStrategyDialog(){
 const $=id=>document.getElementById(id);
const strategyDialog=$('strategy-dialog'),diagramScroll=strategyDialog.querySelector('.strategy-diagram-scroll');
$('strategy-help').addEventListener('click',()=>{strategyDialog.showModal();document.body.classList.add('strategy-dialog-open');});
$('strategy-dialog-close').addEventListener('click',()=>strategyDialog.close());
strategyDialog.addEventListener('close',()=>{document.body.classList.remove('strategy-dialog-open');diagramScroll.classList.remove('is-zoomed');$('strategy-diagram-zoom').textContent='放大查看';$('strategy-diagram-zoom').setAttribute('aria-pressed','false');diagramScroll.scrollTo(0,0);});
strategyDialog.addEventListener('click',event=>{if(event.target!==strategyDialog)return;const r=strategyDialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)strategyDialog.close();});
$('strategy-diagram-zoom').addEventListener('click',event=>{const zoomed=diagramScroll.classList.toggle('is-zoomed');event.currentTarget.textContent=zoomed?'适应宽度':'放大查看';event.currentTarget.setAttribute('aria-pressed',String(zoomed));});

}
