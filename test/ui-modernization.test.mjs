import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bindDialogCommands,
  closeDialog,
  enableDialogLightDismiss
} from '../public/js/ui/dialog-utils.mjs';

function mockButton() {
  const attrs = {};
  const listeners = {};
  return {
    listeners,
    setAttribute(name, value) { attrs[name] = String(value); },
    getAttribute(name) { return attrs[name]; },
    addEventListener(name, fn) { listeners[name] = fn; }
  };
}

test('不支持 closedBy 时通过 pointerdown + pointerup 边界检测实现安全轻触关闭', async t => {
  const previousDialog = Object.getOwnPropertyDescriptor(globalThis, 'HTMLDialogElement');
  delete globalThis.HTMLDialogElement;
  t.after(() => {
    if (previousDialog) Object.defineProperty(globalThis, 'HTMLDialogElement', previousDialog);
  });

  const listeners = {};
  let closed = 0;
  const dialog = {
    addEventListener(name, fn) { listeners[name] = fn; },
    getBoundingClientRect: () => ({ left: 100, right: 300, top: 100, bottom: 300 }),
    close() { closed++; }
  };

  enableDialogLightDismiss(dialog);

  // Dragging text from inside dialog to backdrop must NOT close.
  listeners.pointerdown({ target: dialog, clientX: 150, clientY: 150 });
  await listeners.pointerup({ target: dialog, clientX: 20, clientY: 20 });
  assert.equal(closed, 0);

  // Clicking entirely on the backdrop closes.
  listeners.pointerdown({ target: dialog, clientX: 20, clientY: 20 });
  await listeners.pointerup({ target: dialog, clientX: 20, clientY: 20 });
  assert.equal(closed, 1);
});

test('无 commandForElement 支持时 bindDialogCommands 为声明式关闭按钮提供本地兜底', async t => {
  const previousButton = Object.getOwnPropertyDescriptor(globalThis, 'HTMLButtonElement');
  delete globalThis.HTMLButtonElement;
  t.after(() => {
    if (previousButton) Object.defineProperty(globalThis, 'HTMLButtonElement', previousButton);
  });

  let closed = 0;
  const dialog = { close() { closed++; } };
  const btn = mockButton();
  btn.setAttribute('commandfor', 'welcome-dialog');
  btn.setAttribute('command', 'close');

  const root = {
    querySelectorAll: () => [btn],
    getElementById: id => (id === 'welcome-dialog' ? dialog : null)
  };
  bindDialogCommands(root);
  await btn.listeners.click();
  assert.equal(closed, 1);

  await closeDialog(dialog);
  assert.equal(closed, 2);
});
