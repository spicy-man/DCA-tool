export function initStrategyDialog() {
  const $ = id => document.getElementById(id);
  const strategyDialog = $('strategy-dialog');
  const diagramScroll = strategyDialog.querySelector('.strategy-dialog-body');

  function open() {
    strategyDialog.showModal();
    document.body.classList.add('strategy-dialog-open');
  }

  $('strategy-help').addEventListener('click', open);

  $('strategy-dialog-close').addEventListener('click', () => strategyDialog.close());

  strategyDialog.addEventListener('close', () => {
    document.body.classList.remove('strategy-dialog-open');
    diagramScroll.scrollTo(0, 0);
    strategyDialog.querySelectorAll('.strategy-diagram-scroll').forEach(panel => panel.scrollTo(0, 0));
  });

  strategyDialog.addEventListener('click', event => {
    if (event.target !== strategyDialog) return;
    const r = strategyDialog.getBoundingClientRect();
    if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) {
      strategyDialog.close();
    }
  });

  strategyDialog.querySelectorAll('.strategy-diagram-original').forEach(button => {
    button.addEventListener('click', () => {
      const viewer = new URL('../../diagram.html', import.meta.url);
      viewer.searchParams.set('image', button.dataset.image);
      window.open(viewer.href, '_blank', 'noopener,noreferrer');
    });
  });

  return open;
}
