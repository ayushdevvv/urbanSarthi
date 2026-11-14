import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Loads a live API resource and exposes fallbackReady only after a real request
 * failure. A slow request is allowed to finish; it is never replaced by mock
 * content merely because a timer elapsed.
 */
export default function useApiResource(loader, dependencies = []) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [fallbackReady, setFallbackReady] = useState(false);
  const requestId = useRef(0);

  const reload = useCallback(async () => {
    const currentId = ++requestId.current;
    setLoading(true);
    setError('');
    setFallbackReady(false);
    try {
      const value = await loader();
      if (requestId.current === currentId) {
        setData(value);
        setFallbackReady(false);
      }
      return value;
    } catch (err) {
      if (requestId.current === currentId) {
        setError(err?.message || 'Unable to load data');
        setFallbackReady(true);
      }
      return null;
    } finally {
      if (requestId.current === currentId) setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);

  useEffect(() => {
    let active = true;
    const currentId = ++requestId.current;
    setLoading(true);
    setError('');
    setFallbackReady(false);
    Promise.resolve()
      .then(loader)
      .then((value) => {
        if (active && requestId.current === currentId) {
          setData(value);
          setFallbackReady(false);
        }
      })
      .catch((err) => {
        if (active && requestId.current === currentId) {
          setError(err?.message || 'Unable to load data');
          setFallbackReady(true);
        }
      })
      .finally(() => {
        if (active && requestId.current === currentId) setLoading(false);
      });
    return () => {
      active = false;
      if (requestId.current === currentId) requestId.current += 1;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);

  return { data, loading, error, reload, fallbackReady };
}
