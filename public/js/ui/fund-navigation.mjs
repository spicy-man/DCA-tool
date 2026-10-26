import { FUND_GROUPS } from '../domain/fund-groups.mjs';

export function initFundNavigation() {
  const symbol = document.getElementById('symbol');
  const link = document.getElementById('fund-entry');
  if (!symbol || !link) return;
  const update = () => {
    const group = Object.values(FUND_GROUPS).find(item => item.homeSymbol === symbol.value);
    link.hidden = !group;
    if (!group) return;
    link.href = './' + group.page;
    const arrow = document.createElement('span');
    arrow.setAttribute('aria-hidden', 'true'); arrow.textContent = '↗';
    link.replaceChildren(document.createTextNode(group.button + ' '), arrow);
  };
  symbol.addEventListener('change', update);
  update();
}
