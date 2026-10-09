import { useCallback, useEffect, useState } from 'react';

export default function useApiResource(loader, dependencies = []) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try { setData(await loader()); }
    catch (err) { setError(err?.message || 'Unable to load data'); setData(null); }
    finally { setLoading(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);
  useEffect(() => { let active = true; setLoading(true); setError(''); Promise.resolve().then(loader).then((value) => { if (active) setData(value); }).catch((err) => { if (active) { setError(err?.message || 'Unable to load data'); setData(null); } }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);
  return { data, loading, error, reload };
}
