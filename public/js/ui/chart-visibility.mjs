import { appEvents, events } from '../services/events.mjs';

const storageKey = 'seeker.priceChartRevealed.v1';

function readRevealed() {
  try {
    return localStorage.getItem(storageKey) === '1';
  } catch {
    return false;
  }
}

function saveRevealed(revealed) {
  try {
    localStorage.setItem(storageKey, revealed ? '1' : '0');
  } catch {}
}

export function initChartVisibility() {
  const $ = id => document.getElementById(id);
  const button = $('price-visibility-toggle');
  const revealButton = $('price-visibility-reveal');
  const note = $('price-visibility-note');
  let revealed = readRevealed();

  function apply() {
    $('price-wrap').classList.toggle('is-concealed', !revealed);
    $('price-chart').inert = !revealed;
    $('signal-layer').inert = !revealed;
    const scaleToggle = $('price-scale-toggle');
    if (scaleToggle) scaleToggle.inert = !revealed;
    $('price-quote').classList.toggle('is-concealed', !revealed);
    $('price-quote').setAttribute('aria-hidden', String(!revealed));
    $('price-quote').inert = !revealed;
    if (note) {
      note.inert = revealed;
      note.setAttribute('aria-hidden', String(revealed));
    }
    $('price-tooltip').hidden = true;
    button.setAttribute('aria-pressed', String(revealed));
    const label = revealed ? '隐藏主图' : '显示主图';
    button.setAttribute('aria-label', label);
    button.title = label;
    appEvents.dispatchEvent(new Event(events.chartVisibility));
  }

  button.addEventListener('click', () => {
    revealed = !revealed;
    saveRevealed(revealed);
    apply();
  });
  revealButton?.addEventListener('click', () => {
    if (revealed) return;
    revealed = true;
    saveRevealed(true);
    apply();
  });
  apply();
}
