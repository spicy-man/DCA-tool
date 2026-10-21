import { getDeploymentMode } from '../services/data-client.mjs';
import { appEvents, events } from '../services/events.mjs';
import { SYMBOLS } from '../domain/market.mjs';

export async function initSymbolDialog() {
  const $ = id => document.getElementById(id);
  const select = $('symbol');
  const dialog = $('symbol-dialog');
  const input = $('custom-symbol');
  const message = $('symbol-message');
  const submit = $('symbol-submit');
  let busy = false;
  function setBusy(value) {
    busy = value;
    submit.disabled = input.disabled = value;
    for (const button of $('custom-symbol-list').querySelectorAll('button')) button.disabled = value;
  }
  function sync(symbols) {
    const selected = select.value;
    for (const control of [select, $('floating-charts-symbol')]) {
      for (const option of Array.from(control.options)) {
        if (!SYMBOLS.includes(option.value) && !symbols.includes(option.value)) option.remove();
      }
    }
    for (const symbol of symbols) {
      if (Array.from(select.options).some(option => option.value === symbol)) continue;
      select.add(new Option(symbol, symbol));
      $('floating-charts-symbol').add(new Option(symbol, symbol));
    }
    $('custom-symbol-list').replaceChildren(...symbols.map(symbol => {
      const row = document.createElement('li');
      const label = document.createElement('strong');
      label.textContent = symbol;
      row.append(label);
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = '删除';
      button.setAttribute('aria-label', '删除 ' + symbol);
      button.disabled = busy;
      button.addEventListener('click', () => remove(symbol));
      row.append(button);
      return row;
    }));
    if (selected && !SYMBOLS.includes(selected) && !symbols.includes(selected)) {
      select.value = SYMBOLS[0];
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    $('floating-charts-symbol').value = select.value;
  }
  async function remove(symbol) {
    if (busy) return;
    setBusy(true);
    message.textContent = '正在删除 ' + symbol + '…';
    try {
      const response = await fetch('./api/symbols', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol })
      });
      const result = await response.json();
      if (response.status === 405) throw Error('本地服务尚未更新，请停止旧服务并重新运行 start.cmd，再刷新页面后重试');
      if (!response.ok) throw Error(result.error || '删除失败，请稍后重试');
      sync(result.symbols);
      appEvents.dispatchEvent(new Event(events.sourceHealth));
      message.textContent = symbol + ' 已删除';
    } catch (error) {
      message.textContent = error.message;
    } finally {
      setBusy(false);
    }
  }
  const mode = await getDeploymentMode();
  if (mode !== 'local') return;
  $('add-symbol').disabled = false;
  $('add-symbol-hint').removeAttribute('title');
  $('add-symbol-hint').removeAttribute('tabindex');
  try {
    const response = await fetch('./data/custom-symbols.json', { cache: 'no-store' });
    if (response.ok) sync(await response.json());
    else if (response.status === 404) sync([]);
    else if (response.status !== 404) throw Error('无法读取标的列表');
  } catch {
    message.textContent = '自定义标的列表读取失败，请刷新页面后重试。';
  }
  $('add-symbol').addEventListener('click', () => dialog.showModal());
  $('symbol-cancel').addEventListener('click', () => dialog.close());
  $('symbol-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (busy) return;
    const symbol = input.value.trim().toUpperCase();
    input.value = symbol;
    if (Array.from(select.options).some(option => option.value === symbol)) {
      message.textContent = symbol + ' 已在标的列表中';
      return;
    }
    setBusy(true);
    message.textContent = '正在获取 ' + symbol + ' 完整历史行情，请稍候…';
    try {
      const response = await fetch('./api/symbols', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol })
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || '添加失败，请稍后重试');
      sync(result.symbols);
      appEvents.dispatchEvent(new Event(events.sourceHealth));
      select.value = result.symbol;
      select.dispatchEvent(new CustomEvent('change', { bubbles: true, detail: { forceRefresh: true } }));
      input.value = '';
      $('floating-charts-symbol').value = result.symbol;
      message.textContent = result.symbol + ' 已添加';
    } catch (error) {
      message.textContent = error.message;
    } finally {
      setBusy(false);
    }
  });
}
