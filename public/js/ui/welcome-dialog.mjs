import { bindDialogExitFallback, closeDialog, enableDialogLightDismiss } from './dialog-utils.mjs';

const storageKey = 'seeker.welcome.v1';

export function initWelcomeDialog({ openStrategyDialog }) {
  const $ = id => document.getElementById(id);
  const dialog = $('welcome-dialog');
  const preference = $('welcome-show-again');
  let saved;
  try { saved = localStorage.getItem(storageKey); } catch {}
  preference.checked = saved === 'always';

  function open() {
    dialog.showModal();
    dialog.querySelector('.welcome-body').scrollTop = 0;
  }

  function savePreference() {
    try { localStorage.setItem(storageKey, preference.checked ? 'always' : 'seen'); } catch {}
  }

  preference.addEventListener('change', savePreference);

  $('welcome-help').addEventListener('click', open);
  $('welcome-strategy').addEventListener('click', async () => {
    await closeDialog(dialog);
    openStrategyDialog();
  });

  dialog.addEventListener('close', savePreference);

  bindDialogExitFallback(dialog);
  enableDialogLightDismiss(dialog);

  if (saved !== 'seen') open();
}
