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
    document.body.classList.add('welcome-dialog-open');
    dialog.querySelector('.welcome-body').scrollTop = 0;
  }

  function savePreference() {
    try { localStorage.setItem(storageKey, preference.checked ? 'always' : 'seen'); } catch {}
  }

  preference.addEventListener('change', savePreference);

  $('welcome-help').addEventListener('click', open);
  $('welcome-close').addEventListener('click', () => dialog.close());
  $('welcome-start').addEventListener('click', () => dialog.close());
  $('welcome-strategy').addEventListener('click', () => {
    dialog.close();
    openStrategyDialog();
  });

  dialog.addEventListener('close', () => {
    document.body.classList.remove('welcome-dialog-open');
    savePreference();
  });

  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right ||
        event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });

  if (saved !== 'seen') open();
}
