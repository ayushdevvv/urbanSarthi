import { useCallback, useEffect, useRef, useState } from 'react';

const PREVIEW_DELAY_MS = 5_000;

/**
 * Live-first resource loader with a five-second seeded-preview handoff.
 * If the API is still pending or fails, the caller can show its local sample.
 * A later successful response always replaces that sample automatically.
 */
export default function useApiResource(loader, dependencies = []) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [fallbackReady, setFallbackReady] = useState(false);
  const requestId = useRef(0);
  const fallbackTimer = useRef(null);

  const clearFallbackTimer = () => {
    if (fallbackTimer.current) window.clearTimeout(fallbackTimer.current);
    fallbackTimer.current = null;
  };

  const armFallbackTimer = (id) => {
    clearFallbackTimer();
    setFallbackReady(false);
    fallbackTimer.current = window.setTimeout(() => {
      if (requestId.current === id) setFallbackReady(true);
    }, PREVIEW_DELAY_MS);
  };

  const reload = useCallback(async () => {
    const currentId = ++requestId.current;
    armFallbackTimer(currentId);
    setLoading(true);
    setError('');
    try {
      const value = await loader();
      if (requestId.current === currentId) {
        setData(value);
        setFallbackReady(false);
        clearFallbackTimer();
      }
      return value;
    } catch (err) {
      if (requestId.current === currentId) setError(err?.message || 'Unable to load data');
      // Keep the five-second timer armed. The local preview remains available
      // even if the request is still pending or has already failed.
      return null;
    } finally {
      if (requestId.current === currentId) setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);

  useEffect(() => {
    let active = true;
    const currentId = ++requestId.current;
    armFallbackTimer(currentId);
    setLoading(true);
    setError('');
    Promise.resolve()
      .then(loader)
      .then((value) => {
        if (active && requestId.current === currentId) {
          setData(value);
          setFallbackReady(false);
          clearFallbackTimer();
        }
      })
      .catch((err) => {
        if (active && requestId.current === currentId) setError(err?.message || 'Unable to load data');
      })
      .finally(() => {
        if (active && requestId.current === currentId) setLoading(false);
      });
    return () => {
      active = false;
      clearFallbackTimer();
      if (requestId.current === currentId) requestId.current += 1;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);

  return { data, loading, error, reload, fallbackReady };
}
