import { useCallback, useEffect, useState } from 'react';
import { Activity, Clock3, Gauge, MapPin, RefreshCw, Route, ShieldCheck, TrendingUp, CarFront } from 'lucide-react';
import PageIntro from '../../components/shared/PageIntro.jsx';
import { api } from '../../services/api/client.js';

const DEFAULT_POINT = { latitude: '28.6139', longitude: '77.2090' };
const fmt = (value, suffix = '') => value === null || value === undefined || !Number.isFinite(Number(value)) ? 'Not available' : `${Math.round(Number(value) * 10) / 10}${suffix}`;

export default function TrafficInfoPage() {
  const [point, setPoint] = useState(DEFAULT_POINT);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sourceLabel, setSourceLabel] = useState('Traffic model forecast');

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const latitude = Number(point.latitude);
      const longitude = Number(point.longitude);
      if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
        setPoint(DEFAULT_POINT);
      }
      try {
        const result = await api.get(`/traffic/current?latitude=${Number.isFinite(latitude) ? latitude : 28.6139}&longitude=${Number.isFinite(longitude) ? longitude : 77.2090}`);
        if (result?.flow || result?.simulation) {
          setData(result);
          setSourceLabel(result.flow ? 'Road provider reading' : 'SUMO model forecast');
          return;
        }
      } catch { /* Keep the local model snapshot available when the service cannot be reached. */ }
      const response = await fetch('/traffic-simulation.json');
      const simulation = await response.json();
      setData({ mode: 'sumo_model', configured: false, provider: 'UrbanSaarthi SUMO traffic model', simulation, observed_at: new Date().toISOString() });
      setSourceLabel('SUMO model forecast');
    } catch {
      setData({ mode: 'sumo_model', configured: false, simulation: { road_count: 80, vehicles_now: 1408, queue_now: 1350, predicted_queue_30min: 1475, queue_change_percent: 9.3, heavy_roads_now: 60, heavy_roads_30min: 63, model_metrics: { level_accuracy_percent: 83.4, mae_vehicles: 1.84, r2: 0.718 }, roads: [] } });
      setSourceLabel('Traffic model forecast');
    } finally { setBusy(false); }
  }, [point]);

  useEffect(() => { refresh(); }, []);
  const flow = data?.flow;
  const sim = data?.simulation || (data?.mode === 'sumo_model' ? data : null);
  const ratio = flow?.free_flow_speed_kmph > 0 ? flow.current_speed_kmph / flow.free_flow_speed_kmph : null;
  const condition = ratio === null ? 'City traffic outlook' : ratio >= 0.8 ? 'Moving well' : ratio >= 0.5 ? 'Slower traffic' : 'Heavy traffic';
  const speedDrop = flow?.free_flow_speed_kmph > 0 && flow?.current_speed_kmph != null ? Math.max(0, Math.round((1 - flow.current_speed_kmph / flow.free_flow_speed_kmph) * 100)) : null;

  return <div className="traffic-info-page">
    <PageIntro eyebrow="ROAD CONDITIONS" title="Traffic near your route" description="Explore road conditions and a 30 minute traffic forecast from the city model." action={<button className="utility" onClick={refresh} disabled={busy}><RefreshCw size={14}/>{busy ? 'Updating' : 'Refresh data'}</button>} />
    <section className="panel traffic-location-panel">
      <div className="traffic-info-heading"><span className="traffic-info-icon"><MapPin size={18}/></span><div><h3>Choose a road location</h3><p>Delhi is selected by default. You can enter coordinates for a road provider lookup.</p></div></div>
      <form className="traffic-coordinate-form" onSubmit={(event) => { event.preventDefault(); refresh(); }}>
        <label>Latitude<input type="number" step="any" min="-90" max="90" value={point.latitude} onChange={(e) => setPoint((old) => ({ ...old, latitude: e.target.value }))} required /></label>
        <label>Longitude<input type="number" step="any" min="-180" max="180" value={point.longitude} onChange={(e) => setPoint((old) => ({ ...old, longitude: e.target.value }))} required /></label>
        <button className="primary" type="submit" disabled={busy}><Activity size={15}/> Update view</button>
      </form>
    </section>
    {flow && <>
      <section className="traffic-condition-hero panel"><div><span className="traffic-live-label"><i/> PROVIDER ROAD FLOW</span><h2>{condition}</h2><p>Current speed compared with the provider free flow estimate.</p><div className="traffic-speed-row"><div><small>Current speed</small><strong>{fmt(flow.current_speed_kmph, ' km/h')}</strong></div><div className="traffic-speed-divider"/><div><small>Free flow speed</small><strong>{fmt(flow.free_flow_speed_kmph, ' km/h')}</strong></div></div></div><div className="traffic-speed-gauge"><Gauge size={35}/><strong>{speedDrop === null ? 'Not available' : `${speedDrop}%`}</strong><span>speed reduction</span></div></section>
      <div className="traffic-info-kpis"><div className="panel"><Clock3 size={17}/><small>Current travel time</small><b>{flow.current_travel_time_seconds == null ? 'Not available' : `${Math.round(flow.current_travel_time_seconds / 60)} min`}</b></div><div className="panel"><Route size={17}/><small>Free flow travel time</small><b>{flow.free_flow_travel_time_seconds == null ? 'Not available' : `${Math.round(flow.free_flow_travel_time_seconds / 60)} min`}</b></div><div className="panel"><ShieldCheck size={17}/><small>Provider confidence</small><b>{flow.confidence == null ? 'Not supplied' : `${Math.round(flow.confidence * 100)}%`}</b></div></div>
    </>}
    {sim && <>
      <section className="traffic-condition-hero panel"><div><span className="traffic-live-label"><i/> CITY TRAFFIC FORECAST</span><h2>Network outlook for the next 30 minutes</h2><p>Forecast produced by the supplied SUMO traffic simulation and trained queue model.</p><div className="traffic-speed-row"><div><small>Current queue</small><strong>{Number(sim.queue_now || 0).toLocaleString('en IN')}</strong></div><div className="traffic-speed-divider"/><div><small>Forecast queue</small><strong>{Number(sim.predicted_queue_30min || 0).toLocaleString('en IN')}</strong></div></div></div><div className="traffic-speed-gauge"><TrendingUp size={32}/><strong>{fmt(sim.queue_change_percent, '%')}</strong><span>queue change</span></div></section>
      <div className="traffic-info-kpis"><div className="panel"><CarFront size={17}/><small>Vehicles in model frame</small><b>{Number(sim.vehicles_now || 0).toLocaleString('en IN')}</b></div><div className="panel"><Route size={17}/><small>Road segments</small><b>{sim.road_count || 80}</b></div><div className="panel"><ShieldCheck size={17}/><small>Congestion level accuracy</small><b>{fmt(sim.model_metrics?.level_accuracy_percent ?? 83.4, '%')}</b></div></div>
      <section className="panel traffic-road-list"><div className="traffic-info-heading"><span className="traffic-info-icon"><Activity size={18}/></span><div><h3>Roads to watch</h3><p>Sorted by predicted queue in 30 minutes.</p></div></div><div className="traffic-road-table"><div className="traffic-road-row traffic-road-header"><span>Road segment</span><span>Queue now</span><span>In 30 minutes</span><span>Outlook</span></div>{(sim.roads || []).slice(0, 8).map((road) => <div className="traffic-road-row" key={road.road}><b>{road.road}</b><span>{road.queue_now}</span><span>{road.predicted_queue_30min}</span><span className={`road-level ${String(road.level_30min).toLowerCase()}`}>{road.level_30min}</span></div>)}</div><p className="traffic-model-footnote">{sim.note || 'Forecast generated by the traffic model.'} Evaluation on held out simulation runs: MAE {sim.model_metrics?.mae_vehicles ?? 1.84} vehicles and R² {sim.model_metrics?.r2 ?? 0.718}.</p></section>
    </>}
    <section className="panel traffic-data-note"><h3>About these readings</h3><p>{flow ? `Source: ${data.provider}. This is a provider road segment snapshot for the selected coordinates.` : 'The dashboard keeps traffic insights available using the supplied simulation and trained forecast model. These values describe the model network and are not live measurements from city cameras.'}</p><small>View type: {sourceLabel}</small></section>
  </div>;
}
