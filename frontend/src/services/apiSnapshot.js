const PREFIX = 'urbansaarthi:api-snapshot:v3:';
const MAX_ITEM_BYTES = 420_000;
const MAX_ITEMS = 45;
const MAX_API_AGE_MS = 6 * 60 * 60 * 1000;
const MAX_LOCAL_RECORD_AGE_MS = 7 * 24 * 60 * 60 * 1000;
let statusRequestSequence = 0;

export function createDataStatusContext(routePath) {
  return { routePath: routePath || (typeof window === 'undefined' ? '/' : window.location.pathname), requestId: ++statusRequestSequence };
}

function safeStorage() {
  try { return globalThis.localStorage; } catch { return null; }
}

export function publishDataStatus(detail, contextOrRoutePath, legacyRequestId) {
  if (typeof window === 'undefined') return;
  const context = contextOrRoutePath && typeof contextOrRoutePath === 'object'
    ? contextOrRoutePath
    : { routePath: contextOrRoutePath || window.location.pathname, requestId: legacyRequestId || ++statusRequestSequence };
  window.dispatchEvent(new CustomEvent('urbansaarthi:data-status', {
    detail: { ...detail, routePath: context.routePath, requestId: context.requestId, updatedAt: Date.now() },
  }));
}

export function storeApiSnapshot(path, payload) {
  const storage = safeStorage();
  if (!storage || payload === undefined) return;
  try {
    const serialized = JSON.stringify(payload);
    if (serialized.length > MAX_ITEM_BYTES) return;
    const key = `${PREFIX}${path}`;
    storage.setItem(key, JSON.stringify({ savedAt: Date.now(), payload }));
    const keys = [];
    for (let index = 0; index < storage.length; index += 1) {
      const candidate = storage.key(index);
      if (candidate?.startsWith(PREFIX)) keys.push(candidate);
    }
    if (keys.length > MAX_ITEMS) {
      keys.sort((a, b) => {
        try { return JSON.parse(storage.getItem(a) || '{}').savedAt - JSON.parse(storage.getItem(b) || '{}').savedAt; }
        catch { return 0; }
      });
      keys.slice(0, keys.length - MAX_ITEMS).forEach((oldKey) => storage.removeItem(oldKey));
    }
  } catch {
    // Storage may be full or disabled. In-memory API responses still work.
  }
}

export function readApiSnapshot(path) {
  const storage = safeStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(`${PREFIX}${path}`);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (!entry || !entry.savedAt || Date.now() - entry.savedAt > MAX_API_AGE_MS) return null;
    return { payload: entry.payload, savedAt: entry.savedAt };
  } catch { return null; }
}

export function saveLocalRecord(key, value, savedAt = Date.now()) {
  const storage = safeStorage();
  if (!storage) return false;
  try { storage.setItem(`urbansarthi:record:${key}`, JSON.stringify({ savedAt, value })); return true; }
  catch { return false; }
}

export function readLocalRecord(key) {
  const storage = safeStorage();
  if (!storage) return null;
  try {
    const record = JSON.parse(storage.getItem(`urbansarthi:record:${key}`) || 'null');
    if (record?.value == null || !record.savedAt || Date.now() - record.savedAt > MAX_LOCAL_RECORD_AGE_MS) return null;
    return { value: record.value, savedAt: record.savedAt };
  } catch { return null; }
}
