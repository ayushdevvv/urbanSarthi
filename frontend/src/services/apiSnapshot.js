const PREFIX = 'urbansaarthi:api-snapshot:v2:';
const MAX_ITEM_BYTES = 420_000;
const MAX_ITEMS = 45;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const STATUS_KEY = 'urbansaarthi:data-status:v1';
const STATUS_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function safeStorage() {
  try { return globalThis.localStorage; } catch { return null; }
}

export function publishDataStatus(detail) {
  if (typeof window === 'undefined') return;
  const storage = safeStorage();
  const event = { ...detail, updatedAt: Date.now() };
  if (storage && detail?.path) {
    try {
      const current = JSON.parse(storage.getItem(STATUS_KEY) || '{}');
      if (detail.type === 'fresh') delete current[detail.path];
      else current[detail.path] = event;
      for (const [key, value] of Object.entries(current)) {
        if (!value?.updatedAt || Date.now() - value.updatedAt > STATUS_MAX_AGE_MS) delete current[key];
      }
      storage.setItem(STATUS_KEY, JSON.stringify(current));
    } catch { /* Status storage is optional; the in-memory event still works. */ }
  }
  window.dispatchEvent(new CustomEvent('urbansaarthi:data-status', { detail: event }));
}

export function readDataStatusEvents() {
  const storage = safeStorage();
  if (!storage) return {};
  try {
    const current = JSON.parse(storage.getItem(STATUS_KEY) || '{}');
    const now = Date.now();
    return Object.fromEntries(Object.entries(current).filter(([, value]) => value?.updatedAt && now - value.updatedAt <= STATUS_MAX_AGE_MS));
  } catch { return {}; }
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
    if (!entry || !entry.savedAt || Date.now() - entry.savedAt > MAX_AGE_MS) return null;
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
    if (record?.value == null || !record.savedAt || Date.now() - record.savedAt > MAX_AGE_MS) return null;
    return { value: record.value, savedAt: record.savedAt };
  } catch { return null; }
}
