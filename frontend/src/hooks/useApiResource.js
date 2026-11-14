import { useCallback, useEffect, useRef, useState } from 'react';

const PREVIEW_DELAY_MS = 40_000;
const isAvailabilityFailure = (error) => !error?.status || error.status >= 500 || error.status === 408 || error.status === 429;

/**
 * Race-safe resource loader shared by dashboard pages.
 * Live responses always win. A page may opt into an illustrative local preview
 * only after an availability failure has persisted for the 40-second grace period.
 */
export default function useApiResource(loader, dependencies = []) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [fallbackReady, setFallbackReady] = useState(false);
  const requestId = useRef(0);
  const fallbackTimer = useRef(null);
  const requestStartedAt = useRef(0);
  const fallbackEligible = useRef(false);

  const clearFallbackTimer = () => {
    if (fallbackTimer.current) window.clearTimeout(fallbackTimer.current);
    fallbackTimer.current = null;
  };

  const armFallbackTimer = (id) => {
    clearFallbackTimer();
    requestStartedAt.current = Date.now();
    fallbackEligible.current = false;
    setFallbackReady(false);
    fallbackTimer.current = window.setTimeout(() => {
      if (requestId.current === id && fallbackEligible.current) setFallbackReady(true);
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
        fallbackEligible.current = false;
        clearFallbackTimer();
      }
      return value;
    } catch (err) {
      if (requestId.current === currentId) {
        setError(err?.message || 'Unable to load data');
        fallbackEligible.current = isAvailabilityFailure(err);
        if (fallbackEligible.current && Date.now() - requestStartedAt.current >= PREVIEW_DELAY_MS) setFallbackReady(true);
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
    armFallbackTimer(currentId);
    setLoading(true);
    setError('');
    Promise.resolve()
      .then(loader)
      .then((value) => {
        if (active && requestId.current === currentId) {
          setData(value);
          setFallbackReady(false);
          fallbackEligible.current = false;
          clearFallbackTimer();
        }
      })
      .catch((err) => {
        if (active && requestId.current === currentId) {
          setError(err?.message || 'Unable to load data');
          fallbackEligible.current = isAvailabilityFailure(err);
          if (fallbackEligible.current && Date.now() - requestStartedAt.current >= PREVIEW_DELAY_MS) setFallbackReady(true);
        }
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
