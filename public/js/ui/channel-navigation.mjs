export function initChannelNavigation() {
  const symbol = document.getElementById('symbol');
  const link = document.getElementById('channel-entry');
  if (!symbol || !link) return;
  const update = () => {
    link.href = symbol.value
      ? `./channel.html?symbol=${encodeURIComponent(symbol.value)}`
      : './channel.html';
  };
  symbol.addEventListener('change', update);
  update();
}
