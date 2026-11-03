let reset = () => {};

export function resetPlanEstimateHelp() { reset(); }

export function initPlanEstimateHelp() {
  const help = document.getElementById('next-plan-help');
  const button = document.getElementById('next-plan-help-trigger');
  const note = document.getElementById('next-plan-estimate-note');
  let hovered = false;
  let focused = false;
  let pinned = false;
  let dismissed = false;

  function position() {
    const rect = button.getBoundingClientRect();
    const left = rect.right + 8;
    note.style.left = left + 'px';
    note.style.maxWidth = Math.max(0, document.documentElement.clientWidth - left - 12) + 'px';
    note.style.top = Math.max(8, Math.min(rect.top + rect.height / 2 - note.offsetHeight / 2, document.documentElement.clientHeight - note.offsetHeight - 8)) + 'px';
  }

  function update() {
    const visible = !help.hidden && !dismissed && (hovered || focused || pinned);
    note.hidden = !visible;
    button.setAttribute('aria-expanded', String(visible));
    if (visible) position();
  }

  reset = () => {
    hovered = focused = pinned = false;
    dismissed = true;
    update();
  };
  help.addEventListener('pointerenter', event => {
    if (event.pointerType !== 'mouse') return;
    hovered = true;
    dismissed = false;
    update();
  });
  help.addEventListener('pointerleave', () => {
    hovered = false;
    update();
  });
  button.addEventListener('focus', () => {
    focused = button.matches(':focus-visible');
    dismissed = false;
    update();
  });
  button.addEventListener('blur', () => {
    focused = pinned = false;
    update();
  });
  button.addEventListener('click', () => {
    pinned = !pinned;
    dismissed = !pinned;
    update();
  });
  document.addEventListener('pointerdown', event => {
    if (!help.contains(event.target)) reset();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') reset();
  });
  window.addEventListener('resize', () => { if (!note.hidden) position(); });
  window.addEventListener('scroll', () => { if (!note.hidden) position(); }, true);
}
