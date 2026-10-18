// Move the original interactive plots; placeholders keep document geometry stable.
export function initFloatingCharts() {
  const media = matchMedia('(min-width: 1024px) and (hover: hover) and (pointer: fine)');
  const panel = document.getElementById('floating-charts');
  const body = document.getElementById('floating-charts-body');
  const header = document.getElementById('floating-charts-header');
  const title = document.getElementById('floating-charts-title');
  const ticker = document.getElementById('floating-charts-symbol');
  const wraps = ['price-wrap', 'chart-wrap'].map(id => document.getElementById(id));
  const anchors = wraps.map(wrap => {
    const anchor = document.createElement('div');
    anchor.className = 'floating-chart-anchor';
    anchor.textContent = '图表已移至右下角小窗，返回主图后恢复显示。';
    anchor.hidden = true;
    wrap.before(anchor);
    return anchor;
  });
  let floating = false;
  let dismissed = false;
  let frame = 0;
  let drag = null;
  let position = null;
  const clamp = (value, min, max) => Math.max(min, Math.min(value, Math.max(min, max)));

  function place(left, top) {
    const rect = panel.getBoundingClientRect();
    position = {
      left: clamp(left, 12, innerWidth - rect.width - 12),
      top: clamp(top, 12, innerHeight - rect.height - 12)
    };
    panel.style.left = position.left + 'px';
    panel.style.top = position.top + 'px';
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
  }

  function restore() {
    if (!floating) return;
    floating = false;
    for (const id of ['price-tooltip', 'tooltip']) document.getElementById(id).hidden = true;
    for (const [i, wrap] of wraps.entries()) {
      anchors[i].after(wrap);
      anchors[i].hidden = true;
    }
    panel.hidden = true;
    drag = null;
  }

  function show() {
    if (floating) return;
    for (const id of ['price-tooltip', 'tooltip']) document.getElementById(id).hidden = true;
    for (const [i, wrap] of wraps.entries()) {
      const style = getComputedStyle(wrap);
      anchors[i].style.height = wrap.getBoundingClientRect().height + 'px';
      anchors[i].style.marginTop = style.marginTop;
      anchors[i].style.marginBottom = style.marginBottom;
      anchors[i].hidden = false;
      body.append(wrap);
    }
    floating = true;
    panel.hidden = false;
    if (position) place(position.left, position.top);
  }

  function sync() {
    frame = 0;
    const source = floating ? anchors[0] : wraps[0];
    const passed = source.getBoundingClientRect().bottom <= 0;
    if (!passed) dismissed = false;
    if (!media.matches || !passed || dismissed) restore();
    else show();
    if (floating && position) place(position.left, position.top);
    ticker.value = document.getElementById('symbol').value;
    title.textContent = document.getElementById('frequency').selectedOptions[0].textContent;
  }

  function schedule() {
    if (!frame) frame = requestAnimationFrame(sync);
  }

  function dismiss() {
    dismissed = true;
    restore();
  }

  document.getElementById('floating-charts-close').addEventListener('click', dismiss);
  document.getElementById('floating-charts-return').addEventListener('click', () => {
    dismiss();
    document.querySelector('.price-card').scrollIntoView({
      block: 'start',
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'
    });
  });
  ticker.addEventListener('change', () => {
    const source = document.getElementById('symbol');
    source.value = ticker.value;
    source.dispatchEvent(new Event('change', { bubbles: true }));
    schedule();
  });
  header.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.target.closest('button, select, option')) return;
    const rect = panel.getBoundingClientRect();
    drag = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, id: event.pointerId };
    header.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  header.addEventListener('pointermove', event => {
    if (drag && drag.id === event.pointerId) place(drag.left + event.clientX - drag.x, drag.top + event.clientY - drag.y);
  });
  const endDrag = () => { drag = null; };
  header.addEventListener('pointerup', endDrag);
  header.addEventListener('pointercancel', endDrag);
  header.addEventListener('lostpointercapture', endDrag);
  panel.addEventListener('keydown', event => {
    if (event.key === 'Escape' && event.target !== ticker) dismiss();
    if (event.target !== title || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    const rect = panel.getBoundingClientRect();
    const step = event.shiftKey ? 40 : 10;
    place(rect.left + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0),
      rect.top + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0));
    event.preventDefault();
  });
  for (const id of ['symbol', 'frequency']) document.getElementById(id).addEventListener('change', schedule);
  addEventListener('scroll', schedule, { passive: true });
  addEventListener('resize', schedule, { passive: true });
  media.addEventListener('change', schedule);
  sync();
}
