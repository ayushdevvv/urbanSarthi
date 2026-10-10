import { useCallback, useEffect, useState } from 'react';
import { Activity, AlertTriangle, Clock3, Gauge, MapPin, RefreshCw, Route, ShieldCheck, Wifi } from 'lucide-react';
import PageIntro from '../../components/shared/PageIntro.jsx';
import { api } from '../../services/api/client.js';

const DEFAULT_POINT = { latitude: '28.6139', longitude: '77.2090' };
const fmt = (value, suffix = '') => value === null || value === undefined || !Number.isFinite(Number(value)) ? 'Not available' : `${Math.round(Number(value) * 10) / 10}${suffix}`;

export default function TrafficInfoPage() {
  const [point, setPoint] = useState(DEFAULT_POINT);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const latitude = Number(point.latitude);
      const longitude = Number(point.longitude);
      if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
        throw new Error('Enter valid latitude and longitude values.');
      }
      const result = await api.get(`/traffic/current?latitude=${latitude}&longitude=${longitude}`);
      setData(result);
    } catch (e) {
      setError(e.message || 'Traffic data could not be loaded.');
    } finally {
      setBusy(false);
    }
  }, [point]);

  useEffect(() => { refresh(); }, []);

  const flow = data?.flow;
  const ratio = flow?.free_flow_speed_kmph > 0 ? flow.current_speed_kmph / flow.free_flow_speed_kmph : null;
  const condition = ratio === null ? 'Unknown' : ratio >= 0.8 ? 'Moving well' : ratio >= 0.5 ? 'Slower traffic' : 'Heavy traffic';
  const speedDrop = flow?.free_flow_speed_kmph > 0 && flow?.current_speed_kmph != null
    ? Math.max(0, Math.round((1 - flow.current_speed_kmph / flow.free_flow_speed_kmph) * 100)) : null;

  return <div className="traffic-info-page">
    <PageIntro eyebrow="ROAD CONDITIONS" title="Traffic near your route" description="Check a road segment speed against its usual free flow speed before you travel." action={<button className="utility" onClick={refresh} disabled={busy}><RefreshCw size={14}/>{busy ? 'Checking' : 'Refresh traffic'}</button>} />
    <section className="panel traffic-location-panel">
      <div className="traffic-info-heading"><span className="traffic-info-icon"><MapPin size={18}/></span><div><h3>Choose a road location</h3><p>Delhi is selected by default. Enter coordinates for another road segment.</p></div></div>
      <form className="traffic-coordinate-form" onSubmit={(event) => { event.preventDefault(); refresh(); }}>
        <label>Latitude<input type="number" step="any" min="-90" max="90" value={point.latitude} onChange={(e) => setPoint((old) => ({ ...old, latitude: e.target.value }))} required /></label>
        <label>Longitude<input type="number" step="any" min="-180" max="180" value={point.longitude} onChange={(e) => setPoint((old) => ({ ...old, longitude: e.target.value }))} required /></label>
        <button className="primary" type="submit" disabled={busy}><Activity size={15}/> Check conditions</button>
      </form>
    </section>
    {error && <div className="traffic-info-error"><AlertTriangle size={17}/><span>{error}</span></div>}
    {data && !data.configured && <section className="panel traffic-provider-setup"><div className="traffic-info-heading"><span className="traffic-info-icon"><Wifi size={18}/></span><div><h3>Connect live traffic data</h3><p>{data.message}</p></div></div><ol><li>Create a TomTom developer account and enable the Traffic Flow service.</li><li>Add <code>TOMTOM_API_KEY</code> to the Render backend environment variables.</li><li>Redeploy the backend, then return here and refresh.</li></ol><p className="api-note">The key stays on the backend and is never sent to the browser.</p></section>}
    {data?.configured && flow && <>
      <section className="traffic-condition-hero panel"><div><span className="traffic-live-label"><i/> PROVIDER ROAD FLOW</span><h2>{condition}</h2><p>Current speed compared with the provider's free flow estimate.</p><div className="traffic-speed-row"><div><small>Current speed</small><strong>{fmt(flow.current_speed_kmph, ' km/h')}</strong></div><div className="traffic-speed-divider"/><div><small>Free flow speed</small><strong>{fmt(flow.free_flow_speed_kmph, ' km/h')}</strong></div></div></div><div className="traffic-speed-gauge"><Gauge size={35}/><strong>{speedDrop === null ? 'Not available' : `${speedDrop}%`}</strong><span>speed reduction</span></div></section>
      <div className="traffic-info-kpis"><div className="panel"><Clock3 size={17}/><small>Current travel time</small><b>{flow.current_travel_time_seconds == null ? 'Not available' : `${Math.round(flow.current_travel_time_seconds / 60)} min`}</b></div><div className="panel"><Route size={17}/><small>Free flow travel time</small><b>{flow.free_flow_travel_time_seconds == null ? 'Not available' : `${Math.round(flow.free_flow_travel_time_seconds / 60)} min`}</b></div><div className="panel"><ShieldCheck size={17}/><small>Provider confidence</small><b>{flow.confidence == null ? 'Not supplied' : `${Math.round(flow.confidence * 100)}%`}</b></div></div>
      {flow.road_closed && <div className="traffic-info-error"><AlertTriangle size={17}/><span>The provider reports a road closure at this segment.</span></div>}
      <section className="panel traffic-data-note"><h3>About this reading</h3><p>Source: {data.provider}. Queried at {new Date(data.observed_at).toLocaleString()}. This is a provider road segment snapshot for the selected coordinates, not a citywide traffic measurement. Coverage varies by location.</p><small>Coordinates: {Number(data.latitude).toFixed(5)}, {Number(data.longitude).toFixed(5)}</small></section>
    </>}
    {busy && !data && <section className="panel traffic-loading">Checking road conditions…</section>}
  </div>;
}
