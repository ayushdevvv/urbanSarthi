import { useCallback, useEffect, useRef, useState } from 'react';

/** Loads an API resource and optionally reveals a local continuity view after a bounded wait. */
export default function useApiResource(loader, dependencies = [], options = {}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [fallbackReady, setFallbackReady] = useState(false);
  const requestId = useRef(0);
  const fallbackTimer = useRef(null);
  const fallbackAfterMs = Number.isFinite(options?.fallbackAfterMs) ? Math.max(0, options.fallbackAfterMs) : null;

  const clearFallbackTimer = () => {
    if (fallbackTimer.current) {
      window.clearTimeout(fallbackTimer.current);
      fallbackTimer.current = null;
    }
  };
  const scheduleFallback = (id) => {
    clearFallbackTimer();
    if (fallbackAfterMs == null) return;
    fallbackTimer.current = window.setTimeout(() => {
      if (requestId.current === id) setFallbackReady(true);
      fallbackTimer.current = null;
    }, fallbackAfterMs);
  };

  const reload = useCallback(async () => {
    const currentId = ++requestId.current;
    setLoading(true);
    setError('');
    setFallbackReady(false);
    scheduleFallback(currentId);
    try {
      const value = await loader();
      if (requestId.current === currentId) {
        setData(value);
        setFallbackReady(false);
        clearFallbackTimer();
      }
      return value;
    } catch (err) {
      if (requestId.current === currentId) {
        setError(err?.message || 'Unable to load data');
        if (fallbackAfterMs == null) setFallbackReady(true);
      }
      return null;
    } finally {
      if (requestId.current === currentId) setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...dependencies, fallbackAfterMs]);

  useEffect(() => {
    let active = true;
    const currentId = ++requestId.current;
    setLoading(true);
    setError('');
    setFallbackReady(false);
    scheduleFallback(currentId);
    Promise.resolve().then(loader).then((value) => {
      if (active && requestId.current === currentId) {
        setData(value);
        setFallbackReady(false);
        clearFallbackTimer();
      }
    }).catch((err) => {
      if (active && requestId.current === currentId) {
        setError(err?.message || 'Unable to load data');
        if (fallbackAfterMs == null) setFallbackReady(true);
      }
    }).finally(() => {
      if (active && requestId.current === currentId) setLoading(false);
    });
    return () => {
      active = false;
      clearFallbackTimer();
      if (requestId.current === currentId) requestId.current += 1;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...dependencies, fallbackAfterMs]);

  return { data, loading, error, reload, fallbackReady };
}
