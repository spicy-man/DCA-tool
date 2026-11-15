import { appEvents, events } from '../services/events.mjs';

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
  const moved = wraps.map(() => false);
  let dismissed = false;
  let scheduled = false;
  let drag = null;
  let position = null;
  const clamp = (value, min, max) => Math.max(min, Math.min(value, Math.max(min, max)));
  const isWrapHidden = wrap => {
    const collapse = wrap.closest?.('#sentiment-chart-collapse');
    return wrap.hidden || Boolean(collapse?.hidden || collapse?.hasAttribute?.('data-closing')) ||
      Boolean(wrap.classList?.contains?.('is-concealed'));
  };

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
      if (moved[i]) {
        anchors[i].after(wrap);
        anchors[i].hidden = true;
        moved[i] = false;
      }
    }
    panel.hidden = true;
    drag = null;
  }

  function show(visible) {
    if (floating && wraps.every((_, i) => moved[i] === visible[i])) return;
    for (const id of ['price-tooltip', 'tooltip']) document.getElementById(id).hidden = true;
    const entering = wraps.map((_, i) => visible[i] && !moved[i]);
    for (const [i, wrap] of wraps.entries()) {
      if (entering[i]) {
        const style = getComputedStyle(wrap);
        anchors[i].style.height = wrap.getBoundingClientRect().height + 'px';
        anchors[i].style.marginTop = style.marginTop;
        anchors[i].style.marginBottom = style.marginBottom;
        anchors[i].hidden = false;
        moved[i] = true;
      } else if (!visible[i] && moved[i]) {
        anchors[i].after(wrap);
        anchors[i].hidden = true;
        moved[i] = false;
      }
    }
    if (entering[0]) {
      for (const [i, wrap] of wraps.entries()) {
        if (moved[i]) body.append(wrap);
      }
    } else if (entering[1]) {
      body.append(wraps[1]);
    }
    floating = true;
    panel.hidden = false;
    if (position) place(position.left, position.top);
  }

  function sync() {
    const source = moved[0] ? anchors[0] : wraps[0];
    const passed = source.getBoundingClientRect().bottom <= 0;
    if (!passed) dismissed = false;
    const visible = wraps.map(wrap => !isWrapHidden(wrap));
    if (!media.matches || !passed || dismissed || visible.every(v => !v)) restore();
    else show(visible);
    if (floating && position) place(position.left, position.top);
    ticker.value = document.getElementById('symbol').value;
    title.textContent = document.getElementById('frequency').selectedOptions[0].textContent;
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      sync();
    });
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
  appEvents.addEventListener(events.chartVisibility, schedule);
  addEventListener('scroll', schedule, { passive: true });
  addEventListener('resize', schedule, { passive: true });
  media.addEventListener('change', schedule);
  sync();
}
