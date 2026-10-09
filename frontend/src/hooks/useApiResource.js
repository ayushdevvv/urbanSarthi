import { useCallback, useEffect, useState } from 'react';

const isEmpty = (value) => value == null || (Array.isArray(value) && value.length === 0) || (typeof value === 'object' && !Array.isArray(value) && (Object.keys(value).length === 0 || (Array.isArray(value.sources) && value.sources.length === 0)));
const makeFallbackMessage = (reason) => `DEMO_FALLBACK: ${reason}. Synthetic sample data is displayed so the interface remains usable.`;

export default function useApiResource(loader, dependencies = [], options = {}) {
  const fallback = options?.fallback;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const performLoad = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const value = await loader();
      if (fallback !== undefined && isEmpty(value)) {
        setData(typeof fallback === 'function' ? fallback() : fallback);
        setError(makeFallbackMessage('The API returned no records'));
      } else {
        setData(value);
      }
    } catch (err) {
      if (fallback !== undefined) {
        setData(typeof fallback === 'function' ? fallback() : fallback);
        setError(makeFallbackMessage(`The API could not be reached (${err?.message || 'network request failed'})`));
      } else {
        setError(err?.message || 'Unable to load data');
        setData(null);
      }
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...dependencies, fallback]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    Promise.resolve().then(loader).then((value) => {
      if (!active) return;
      if (fallback !== undefined && isEmpty(value)) {
        setData(typeof fallback === 'function' ? fallback() : fallback);
        setError(makeFallbackMessage('The API returned no records'));
      } else {
        setData(value);
      }
    }).catch((err) => {
      if (!active) return;
      if (fallback !== undefined) {
        setData(typeof fallback === 'function' ? fallback() : fallback);
        setError(makeFallbackMessage(`The API could not be reached (${err?.message || 'network request failed'})`));
      } else {
        setError(err?.message || 'Unable to load data');
        setData(null);
      }
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);

  return { data, loading, error, reload: performLoad, isDemo: error.startsWith('DEMO_FALLBACK:') };
}
