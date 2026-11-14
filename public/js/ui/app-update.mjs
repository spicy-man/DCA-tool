import { getDeploymentInfo } from '../services/data-client.mjs';

const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function parseSemver(value) {
  const match = typeof value === 'string' ? value.trim().match(SEMVER_RE) : null;
  return match ? match.slice(1).map(Number) : null;
}

export function isNewerVersion(remoteVersion, currentVersion) {
  const remote = parseSemver(remoteVersion);
  const current = parseSemver(currentVersion);
  if (!remote || !current) return false;
  for (let i = 0; i < 3; i++) {
    if (remote[i] !== current[i]) return remote[i] > current[i];
  }
  return false;
}

export function readCurrentAppVersion(doc = globalThis.document) {
  return doc?.querySelector?.('meta[name="app-version"]')?.content?.trim() || '';
}

function mountBanner(doc, banner) {
  const shell = doc.querySelector?.('.shell');
  if (shell) {
    const main = shell.querySelector?.('main');
    if (main && typeof shell.insertBefore === 'function') {
      shell.insertBefore(banner, main);
      return;
    }
    if (typeof shell.prepend === 'function') {
      shell.prepend(banner);
      return;
    }
  }
  doc.body?.prepend?.(banner);
}

export function createAppUpdateWatcher({
  doc = globalThis.document,
  win = globalThis,
  getDeployment = getDeploymentInfo,
  reload = () => win?.location?.reload?.()
} = {}) {
  let checking = false;
  let dismissedVersion = null;
  let banner = null;
  let textNode = null;

  function showBanner(nextVersion) {
    if (!doc?.createElement) return;
    if (!banner) {
      banner = doc.createElement('div');
      banner.id = 'app-update-banner';
      banner.className = 'app-update-banner';
      banner.setAttribute?.('role', 'status');
      banner.setAttribute?.('aria-live', 'polite');

      textNode = doc.createElement('span');
      textNode.className = 'app-update-text';

      const actions = doc.createElement('div');
      actions.className = 'app-update-actions';

      const reloadButton = doc.createElement('button');
      reloadButton.type = 'button';
      reloadButton.className = 'app-update-reload';
      reloadButton.textContent = '立即更新';
      reloadButton.addEventListener('click', () => reload());

      const dismissButton = doc.createElement('button');
      dismissButton.type = 'button';
      dismissButton.className = 'app-update-dismiss';
      dismissButton.textContent = '稍后';
      dismissButton.addEventListener('click', () => {
        dismissedVersion = banner.dataset?.version || nextVersion;
        banner.hidden = true;
      });

      actions.append(reloadButton, dismissButton);
      banner.append(textNode, actions);
      mountBanner(doc, banner);
    }
    if (banner.dataset) banner.dataset.version = nextVersion;
    textNode.textContent = `发现新版本 v${nextVersion}，刷新后生效。`;
    banner.hidden = false;
  }

  async function checkForUpdate(prefetchedInfo = null) {
    const currentVersion = readCurrentAppVersion(doc);
    if (!currentVersion) return false;

    let info = prefetchedInfo;
    if (!info) {
      if (win?.navigator?.onLine === false || checking) return false;
      checking = true;
      try {
        info = await getDeployment();
      } catch {
        return false;
      } finally {
        checking = false;
      }
    }

    const nextVersion = info?.version?.trim?.() || '';
    if (!isNewerVersion(nextVersion, currentVersion) || nextVersion === dismissedVersion) {
      return false;
    }
    showBanner(nextVersion);
    return true;
  }

  return {
    checkForUpdate
  };
}
