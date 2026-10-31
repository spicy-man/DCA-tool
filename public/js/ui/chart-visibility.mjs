export function initChartVisibility() {
  const $ = id => document.getElementById(id);
  const button = $('price-visibility-toggle');
  let revealed = false;

  function apply() {
    $('price-wrap').classList.toggle('is-concealed', !revealed);
    $('price-chart').inert = !revealed;
    $('signal-layer').inert = !revealed;
    $('price-quote').classList.toggle('is-concealed', !revealed);
    $('price-quote').setAttribute('aria-hidden', String(!revealed));
    $('price-quote').inert = !revealed;
    $('price-tooltip').hidden = true;
    button.setAttribute('aria-pressed', String(revealed));
    const label = revealed ? '隐藏主图' : '显示主图';
    button.setAttribute('aria-label', label);
    button.title = label;
  }

  button.addEventListener('click', () => {
    revealed = !revealed;
    apply();
  });
  apply();
}
