import { readApiSnapshot, storeApiSnapshot, publishDataStatus } from '../apiSnapshot.js';

const DEFAULT_API_URL = import.meta.env.DEV ? 'http://127.0.0.1:8000/api/v1' : 'https://urbansarthi.onrender.com/api/v1';

export const API_BASE_URL = (import.meta.env.VITE_API_URL || import.meta.env.VITE_API_BASE_URL || DEFAULT_API_URL).replace(/\/$/, '');

export class ApiError extends Error {
  constructor(message, status, payload) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

function requestCacheKey(path, body) {
  if (typeof body !== 'string' || !body) return path;
  // A compact deterministic key lets read-only POST responses (route plans,
  // estimates) be restored for the same inputs without storing request bodies.
  let hash = 2166136261;
  for (let index = 0; index < body.length; index += 1) {
    hash ^= body.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${path}::${(hash >>> 0).toString(16)}`;
}

export async function request(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const method = String(options.method || 'GET').toUpperCase();
  const privatePath = /^\/(?:auth(?:\/|\?|$)|trips(?:\/|\?|$)|users(?:\/|\?|$)|profile(?:\/|\?|$)|analytics\/my-mobility(?:\/|\?|$)|agent(?:\/|\?|$)|routing\/(?:geocode|reverse-geocode)(?:\/|\?|$))/i.test(path);
  const cacheEligible = (method === 'GET' && !privatePath) || (options.cacheResponse === true && typeof options.body === 'string');
  const cacheKey = method === 'GET' ? path : requestCacheKey(path, options.body);
  const { cacheResponse: _cacheResponse, timeoutMs = 60000, signal: externalSignal, ...fetchOptions } = options;
  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const returnSaved = (reason) => {
    const saved = cacheEligible ? readApiSnapshot(cacheKey) : null;
    if (!saved) return null;
    publishDataStatus({ type: 'snapshot', path: cacheKey, cachedAt: saved.savedAt, reason: reason || 'The service could not be reached.' });
    return saved.payload;
  };

  // Always give the live API first opportunity to respond. The 60-second budget
  // accommodates a sleeping free-tier host starting up before any saved response
  // is considered. External cancellation is preserved for uploads/navigation.
  const controller = new AbortController();
  const onExternalAbort = () => controller.abort(externalSignal?.reason);
  if (externalSignal) {
    if (externalSignal.aborted) onExternalAbort();
    else externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }
  const timeoutId = globalThis.setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), Math.max(1000, timeoutMs));
  let response;
  const retryDelay = (milliseconds) => new Promise((resolve, reject) => {
    const finish = () => { controller.signal.removeEventListener('abort', abort); resolve(); };
    const timer = globalThis.setTimeout(finish, milliseconds);
    const abort = () => { globalThis.clearTimeout(timer); reject(controller.signal.reason || new Error('Request cancelled')); };
    if (controller.signal.aborted) abort();
    else controller.signal.addEventListener('abort', abort, { once: true });
  });
  try {
    const retryable = ['GET', 'HEAD', 'OPTIONS'].includes(method);
    for (let attempt = 0; ; attempt += 1) {
      try {
        response = await fetch(`${API_BASE_URL}${path}`, { ...fetchOptions, headers, signal: controller.signal });
      } catch (error) {
        if (!retryable || attempt >= 2 || controller.signal.aborted) throw error;
        await retryDelay(attempt === 0 ? 900 : 1800);
        continue;
      }
      // Render and other hosted backends can briefly return gateway errors while
      // waking up. Retry safe reads before considering any browser snapshot.
      if (retryable && response.status >= 500 && attempt < 2) {
        await retryDelay(attempt === 0 ? 900 : 1800);
        continue;
      }
      break;
    }
  } catch (error) {
    const isExternalAbort = Boolean(externalSignal?.aborted);
    const reason = controller.signal.aborted && !isExternalAbort
      ? `The service did not respond within ${Math.round(Math.max(1000, timeoutMs) / 1000)} seconds.`
      : 'The service could not be reached.';
    const saved = isExternalAbort ? null : returnSaved(reason);
    if (saved !== null) return saved;
    if (!isExternalAbort) publishDataStatus({ type: 'offline', path: cacheKey, reason });
    throw new ApiError(isExternalAbort ? 'The request was cancelled.' : 'We could not refresh this information. You can retry when the connection is restored.', 0, error);
  } finally {
    globalThis.clearTimeout(timeoutId);
    externalSignal?.removeEventListener?.('abort', onExternalAbort);
  }

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json().catch(() => null) : await response.text().catch(() => '');
  if (!response.ok) {
    const detail = typeof payload?.detail === 'string' ? payload.detail : Array.isArray(payload?.detail) ? payload.detail.map((item) => item.msg).join(', ') : response.statusText;
    // Only availability/server failures may use a saved response. A 400/401/403/
    // 404/422 is a real request or permission error, not an outage to mask.
    const outageStatus = response.status >= 500 || response.status === 408 || response.status === 429;
    if (outageStatus) {
      const saved = returnSaved(`The service returned ${response.status}.`);
      if (saved !== null) return saved;
      publishDataStatus({ type: 'offline', path: cacheKey, reason: `The service returned ${response.status}.` });
    } else {
      publishDataStatus({ type: 'fresh', path: cacheKey });
    }
    throw new ApiError(detail || 'This information could not be refreshed just now. Please retry.', response.status, { detail, payload });
  }
  if (cacheEligible && payload !== null && typeof payload === 'object') storeApiSnapshot(cacheKey, payload);
  // A successful live response clears any previous outage notice even when its
  // body is empty or non-JSON.
  publishDataStatus({ type: 'fresh', path: cacheKey });
  return payload;
}

export const api = {
  get: (path, options = {}) => request(path, options),
  post: (path, body, options = {}) => request(path, { ...options, method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: (path, body, options = {}) => request(path, { ...options, method: 'PATCH', body: body === undefined ? undefined : JSON.stringify(body) }),
  postForm: (path, formData, options = {}) => request(path, { ...options, method: 'POST', body: formData }),
};

export const endpoints = {
  commandOverview: '/command-center/overview', clusters: '/command-center/clusters', sourceHealth: '/command-center/health/data-sources',
  citySummary: (days = 7) => `/analytics/city-summary?days=${encodeURIComponent(days)}`,
  myMobility: '/analytics/my-mobility', trips: '/trips', junctions: '/traffic/junctions',
  aqi: (lat = 28.61, lon = 77.20) => `/aqi/observations?latitude=${lat}&longitude=${lon}&radius_km=20&max_age_hours=24`,
  transitRoutes: '/transit/routes', transitStops: (search = '') => `/transit/stops${search ? `?search=${encodeURIComponent(search)}` : ''}`,
  transitAlerts: '/transit/alerts?status=active', signalPlans: '/signals/plans',
};
