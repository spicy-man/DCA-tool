let supportsDisplayTransition;

export function canTransitionDisplay() {
  if (supportsDisplayTransition !== undefined) return supportsDisplayTransition;
  if (!globalThis.CSS?.supports?.('transition-behavior', 'allow-discrete') || !globalThis.document?.body) {
    return false;
  }
  const probe = document.createElement('div');
  probe.style.cssText = 'transition: display 1s allow-discrete !important; display: block;';
  document.body.appendChild(probe);
  globalThis.getComputedStyle?.(probe).display;
  probe.style.display = 'none';
  supportsDisplayTransition = globalThis.getComputedStyle?.(probe).display === 'block';
  probe.remove();
  return Boolean(supportsDisplayTransition);
}

function supportsTopLayerExit() {
  return Boolean(globalThis.CSS?.supports?.('overlay', 'auto') && canTransitionDisplay());
}

export async function closeDialog(dialog) {
  if (!dialog) return;
  if (supportsTopLayerExit() || !dialog.getAnimations || !dialog.setAttribute) {
    dialog.close?.();
    return;
  }
  if (dialog.hasAttribute?.('data-closing')) return;
  dialog.setAttribute('data-closing', '');
  const animations = dialog.getAnimations({ subtree: true });
  if (animations.length > 0) {
    await Promise.race([
      Promise.allSettled(animations.map(animation => animation.finished)),
      new Promise(resolve => setTimeout(resolve, 600))
    ]);
  }
  if (!dialog.hasAttribute?.('data-closing')) return;
  dialog.removeAttribute?.('data-closing');
  dialog.close?.();
}

export function bindDialogExitFallback(dialog) {
  if (!dialog?.addEventListener) return;
  dialog.addEventListener('cancel', event => {
    if (supportsTopLayerExit()) return;
    event.preventDefault();
    closeDialog(dialog);
  });
  dialog.addEventListener('command', event => {
    if (event.command !== 'close' || supportsTopLayerExit()) return;
    event.preventDefault();
    closeDialog(dialog);
  });
}

export function enableDialogLightDismiss(dialog) {
  if (!dialog?.addEventListener) return;
  const hasNativeClosedBy = Boolean(globalThis.HTMLDialogElement?.prototype && 'closedBy' in HTMLDialogElement.prototype);
  if (hasNativeClosedBy) return;

  const outside = event => {
    if (!dialog.getBoundingClientRect) return false;
    const rect = dialog.getBoundingClientRect();
    return event.clientX < rect.left || event.clientX > rect.right ||
      event.clientY < rect.top || event.clientY > rect.bottom;
  };

  let pressedOutside = false;
  dialog.addEventListener('pointerdown', event => {
    pressedOutside = event.target === dialog && outside(event);
  });
  dialog.addEventListener('pointerup', event => {
    if (pressedOutside && event.target === dialog && outside(event)) closeDialog(dialog);
    pressedOutside = false;
  });
}

export function bindDialogCommands(root = globalThis.document) {
  if (!root?.querySelectorAll) return;
  const supportsInvoker = Boolean(globalThis.HTMLButtonElement?.prototype && 'commandForElement' in HTMLButtonElement.prototype);
  if (supportsInvoker) return;

  for (const button of root.querySelectorAll('button[commandfor][command]')) {
    button.addEventListener('click', () => {
      const target = root.getElementById?.(button.getAttribute('commandfor'));
      if (!target) return;
      const command = button.getAttribute('command');
      if (command === 'close') closeDialog(target);
      else if (command === 'show-modal') target.showModal?.();
    });
  }
}
