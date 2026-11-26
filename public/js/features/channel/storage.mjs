import {
  ANCHOR_MODES,
  CHANNEL_ASSETS,
  CHANNEL_SYMBOLS,
  SAMPLE_WINDOWS,
  normalizeCustomAnchor
} from '../../domain/log-channel.mjs';

export const STORAGE_KEY = 'seeker.logChannel.v3';
export const LEGACY_KEYS = ['seeker.logChannel.v2', 'seeker.logChannel.v1'];
export const SCHEMA_VERSION = 4;
export const VALID_TABS = new Set([...CHANNEL_SYMBOLS, 'COMPARE']);

function readFiniteNumber(val) {
  return typeof val === 'number' && Number.isFinite(val) ? val : null;
}

function getDefaultStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function createDefaultSymbolConfig(sym) {
  return {
    slopePct: CHANNEL_ASSETS[sym].defaultSlope,
    anchorMode: ANCHOR_MODES.recent7y,
    userPreferredAnchor: ANCHOR_MODES.recent7y,
    offsetPct: 0,
    customAnchor: null
  };
}

export function createDefaultChannelState() {
  const symbols = {};
  for (const sym of CHANNEL_SYMBOLS) {
    symbols[sym] = createDefaultSymbolConfig(sym);
  }
  return {
    activeTab: 'SPY',
    windowId: '15y',
    showOrigLine: false,
    showPivot: false,
    showProjection: true,
    showResidual: true,
    hoverT: null,
    symbols
  };
}

function cloneChannelState(state) {
  const symbols = {};
  for (const sym of CHANNEL_SYMBOLS) {
    const src = state.symbols?.[sym] || createDefaultSymbolConfig(sym);
    symbols[sym] = {
      ...src,
      customAnchor: src.customAnchor ? { ...src.customAnchor } : null
    };
  }
  return {
    ...state,
    symbols
  };
}

/**
 * Parse serialized channel preferences (schema v4 or legacy flat v1/v2/v3)
 * with strict type checks so corrupt values fall back safely.
 */
export function parseChannelState(rawJson, defaults = createDefaultChannelState()) {
  const next = cloneChannelState(defaults);
  if (typeof rawJson !== 'string' || !rawJson) return next;

  let parsed;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return next;
  }
  if (!parsed || typeof parsed !== 'object') return next;

  if (typeof parsed.activeTab === 'string' && VALID_TABS.has(parsed.activeTab)) {
    next.activeTab = parsed.activeTab;
  }
  if (Object.hasOwn(SAMPLE_WINDOWS, parsed.windowId)) {
    next.windowId = parsed.windowId;
  }
  if (typeof parsed.showOrigLine === 'boolean') next.showOrigLine = parsed.showOrigLine;
  if (typeof parsed.showPivot === 'boolean') next.showPivot = parsed.showPivot;
  if (typeof parsed.showProjection === 'boolean') next.showProjection = parsed.showProjection;
  if (typeof parsed.showResidual === 'boolean') next.showResidual = parsed.showResidual;

  if (parsed.symbols && typeof parsed.symbols === 'object') {
    for (const sym of CHANNEL_SYMBOLS) {
      const rawCfg = parsed.symbols[sym];
      if (!rawCfg || typeof rawCfg !== 'object') continue;
      const cfg = next.symbols[sym];

      const slopeVal = readFiniteNumber(rawCfg.slopePct);
      if (slopeVal !== null) {
        cfg.slopePct = Math.max(0, Math.min(100, Math.round(slopeVal * 10) / 10));
      }
      if (Object.hasOwn(ANCHOR_MODES, rawCfg.anchorMode)) {
        cfg.anchorMode = rawCfg.anchorMode;
      }
      if (Object.hasOwn(ANCHOR_MODES, rawCfg.userPreferredAnchor)) {
        cfg.userPreferredAnchor = rawCfg.userPreferredAnchor;
      } else {
        cfg.userPreferredAnchor = cfg.anchorMode;
      }
      const offsetVal = readFiniteNumber(rawCfg.offsetPct);
      if (offsetVal !== null) {
        cfg.offsetPct = Math.max(-40, Math.min(60, Math.round(offsetVal * 10) / 10));
      }
      cfg.customAnchor = normalizeCustomAnchor(rawCfg.customAnchor);
    }
    return next;
  }

  // Legacy flat schema (v1 / v2 / v3) migration
  const legacyAnchor = Object.hasOwn(ANCHOR_MODES, parsed.anchorMode)
    ? parsed.anchorMode
    : ANCHOR_MODES.recent7y;
  const legacyPreferred = Object.hasOwn(ANCHOR_MODES, parsed.userPreferredAnchor)
    ? parsed.userPreferredAnchor
    : legacyAnchor;

  for (const sym of CHANNEL_SYMBOLS) {
    const cfg = next.symbols[sym];
    cfg.anchorMode = legacyAnchor;
    cfg.userPreferredAnchor = legacyPreferred;

    if (parsed.slopes && typeof parsed.slopes === 'object') {
      const slopeVal = readFiniteNumber(parsed.slopes[sym]);
      if (slopeVal !== null) {
        cfg.slopePct = Math.max(0, Math.min(100, Math.round(slopeVal * 10) / 10));
      }
    }
    if (parsed.offsets && typeof parsed.offsets === 'object') {
      const offsetVal = readFiniteNumber(parsed.offsets[sym]);
      if (offsetVal !== null) {
        cfg.offsetPct = Math.max(-40, Math.min(60, Math.round(offsetVal * 10) / 10));
      }
    }
  }

  return next;
}

export function probeChannelStorage(storage = getDefaultStorage()) {
  if (!storage || typeof storage.setItem !== 'function' || typeof storage.removeItem !== 'function') {
    return false;
  }
  const probeKey = 'seeker.logChannel.__probe__';
  try {
    storage.setItem(probeKey, '1');
    storage.removeItem(probeKey);
    return true;
  } catch {
    return false;
  }
}

export function loadChannelState(storage = getDefaultStorage()) {
  const defaults = createDefaultChannelState();
  if (!storage || typeof storage.getItem !== 'function') {
    return { state: defaults, loadedFromKey: null, storageReadable: false };
  }
  const keys = [STORAGE_KEY, ...LEGACY_KEYS];
  try {
    for (const key of keys) {
      const raw = storage.getItem(key);
      if (typeof raw === 'string' && raw.trim()) {
        return {
          state: parseChannelState(raw, defaults),
          loadedFromKey: key,
          storageReadable: true
        };
      }
    }
    return { state: defaults, loadedFromKey: null, storageReadable: true };
  } catch {
    return { state: defaults, loadedFromKey: null, storageReadable: false };
  }
}

export function saveChannelState(state, storage = getDefaultStorage()) {
  if (!storage || typeof storage.setItem !== 'function' || typeof storage.getItem !== 'function') {
    return { ok: false, error: 'storage unavailable' };
  }
  try {
    const savedAt = Date.now();
    const symbols = {};
    for (const sym of CHANNEL_SYMBOLS) {
      const cfg = state.symbols?.[sym] || createDefaultSymbolConfig(sym);
      const slopeVal = readFiniteNumber(cfg.slopePct);
      const offsetVal = readFiniteNumber(cfg.offsetPct);
      const customAnchor = normalizeCustomAnchor(cfg.customAnchor);
      symbols[sym] = {
        slopePct: slopeVal !== null ? Math.max(0, Math.min(100, Math.round(slopeVal * 10) / 10)) : CHANNEL_ASSETS[sym].defaultSlope,
        anchorMode: Object.hasOwn(ANCHOR_MODES, cfg.anchorMode) ? cfg.anchorMode : ANCHOR_MODES.recent7y,
        userPreferredAnchor: Object.hasOwn(ANCHOR_MODES, cfg.userPreferredAnchor) ? cfg.userPreferredAnchor : ANCHOR_MODES.recent7y,
        offsetPct: offsetVal !== null ? Math.max(-40, Math.min(60, Math.round(offsetVal * 10) / 10)) : 0,
        customAnchor
      };
    }

    const payload = JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      updatedAt: savedAt,
      activeTab: typeof state.activeTab === 'string' && VALID_TABS.has(state.activeTab) ? state.activeTab : 'SPY',
      windowId: Object.hasOwn(SAMPLE_WINDOWS, state.windowId) ? state.windowId : '15y',
      showOrigLine: Boolean(state.showOrigLine),
      showPivot: Boolean(state.showPivot),
      showProjection: Boolean(state.showProjection),
      showResidual: Boolean(state.showResidual),
      symbols
    });

    storage.setItem(STORAGE_KEY, payload);
    const verified = storage.getItem(STORAGE_KEY) === payload;
    return verified
      ? { ok: true, savedAt }
      : { ok: false, error: 'write verification failed' };
  } catch (err) {
    return { ok: false, error: err?.message || 'storage write failed' };
  }
}
