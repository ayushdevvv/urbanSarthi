const DEFAULT_API_URL = 'http://127.0.0.1:8000/api/v1';

export const API_BASE_URL = (import.meta.env.VITE_API_URL || import.meta.env.VITE_API_BASE_URL || DEFAULT_API_URL).replace(/\/$/, '');

export class ApiError extends Error {
  constructor(message, status, payload) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

export async function request(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
  } catch (error) {
    throw new ApiError(`Unable to reach the UrbanSaarthi API at ${API_BASE_URL}. Check that the backend is running and CORS allows this frontend.`, 0, error);
  }

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json().catch(() => null) : await response.text().catch(() => '');
  if (!response.ok) {
    const detail = typeof payload?.detail === 'string' ? payload.detail : Array.isArray(payload?.detail) ? payload.detail.map((item) => item.msg).join(', ') : response.statusText;
    throw new ApiError(detail || `Request failed (${response.status})`, response.status, payload);
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
