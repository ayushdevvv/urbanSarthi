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
  const { cacheResponse: _cacheResponse, ...fetchOptions } = options;
  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const returnSaved = (reason) => {
    const saved = cacheEligible ? readApiSnapshot(cacheKey) : null;
    if (!saved) return null;
    publishDataStatus({ type: 'snapshot', path: cacheKey, cachedAt: saved.savedAt, reason: reason || 'The service could not be reached.' });
    return saved.payload;
  };

  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, { ...fetchOptions, headers });
  } catch (error) {
    const saved = returnSaved('The service could not be reached.');
    if (saved !== null) return saved;
    publishDataStatus({ type: 'offline', path: cacheKey, reason: 'The service could not be reached.' });
    throw new ApiError('We could not refresh this information. You can retry when the connection is restored.', 0, error);
  }

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json().catch(() => null) : await response.text().catch(() => '');
  if (!response.ok) {
    const detail = typeof payload?.detail === 'string' ? payload.detail : Array.isArray(payload?.detail) ? payload.detail.map((item) => item.msg).join(', ') : response.statusText;
    const saved = returnSaved(`The service returned ${response.status}.`);
    if (saved !== null) return saved;
    publishDataStatus({ type: 'offline', path: cacheKey, reason: `The service returned ${response.status}.` });
    throw new ApiError(detail || 'This information could not be refreshed just now. Please retry.', response.status, { detail, payload });
  }
  if (cacheEligible && payload !== null && typeof payload === 'object') {
    storeApiSnapshot(cacheKey, payload);
    publishDataStatus({ type: 'fresh', path: cacheKey });
  }
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
