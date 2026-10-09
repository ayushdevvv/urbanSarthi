import { useMemo, useState } from 'react';
import { Activity, Clock3, RefreshCw, Wind, Zap } from 'lucide-react';
import PageIntro, { MetricCard } from '../../components/shared/PageIntro.jsx';
import { ErrorNotice } from '../../components/shared/Toast.jsx';
import useApiResource from '../../hooks/useApiResource.js';
import { api, endpoints } from '../../services/api/client.js';
import { DEMO_JUNCTIONS } from '../../data/demoData.js';

const HORIZONS = [0, 15, 30, 45, 60];
const horizonLabel = (value) => value === 0 ? 'Now' : `+${value} min`;
function buildScenarioForecasts(junction) {
  const queue = Number(junction?.queue_length_m ?? 22);
  const congestion = Number(junction?.congestion_score ?? 54);
  const vehicles = Number(junction?.vehicle_count ?? 68);
  const wait = Number(junction?.average_wait_seconds ?? 42);
  return HORIZONS.map((horizon) => ({
    id: `scenario-${junction?.id ?? 1}-${horizon}`, junction_id: junction?.id ?? 1,
    generated_at: new Date().toISOString(), horizon_minutes: horizon,
    predicted_queue_length_m: Math.max(4, Math.round(queue * (1 + horizon / 260) * 10) / 10),
    predicted_vehicle_count: Math.max(12, Math.round(vehicles * (1 + horizon / 350))),
    predicted_average_wait_seconds: Math.max(8, Math.round(wait * (1 + horizon / 420))),
    predicted_congestion_score: Math.min(98, Math.max(8, Math.round(congestion + horizon / 12))),
    predicted_aqi: Math.max(52, Math.round(142 + congestion * 0.8 - horizon / 15)),
    confidence: Math.max(0.42, 0.82 - horizon / 180),
    model_version: 'scenario-trend-v1', feature_snapshot: { is_synthetic: true, note: 'Illustrative trend, not a trained/validated model prediction.' },
  }));
}

export default function ForecastsPage() {
  const { data: junctions, loading: junctionLoading, error: junctionError, reload: reloadJunctions } = useApiResource(() => api.get(endpoints.junctions), [], { fallback: DEMO_JUNCTIONS });
  const junctionList = Array.isArray(junctions) && junctions.length ? junctions : DEMO_JUNCTIONS;
  const [selectedId, setSelectedId] = useState(null);
  const selected = junctionList.find((item) => String(item.id) === String(selectedId)) || junctionList[0];
  const { data: rawForecasts, loading, error, reload } = useApiResource(
    () => api.get(`/predictions/junctions/${selected?.id ?? 1}`),
    [selected?.id],
    { fallback: () => buildScenarioForecasts(selected) },
  );
  const forecasts = useMemo(() => {
    const rows = Array.isArray(rawForecasts) ? rawForecasts : [];
    const complete = new Map(rows.map((row) => [Number(row.horizon_minutes), row]));
    const scenarioRows = buildScenarioForecasts(selected);
    return HORIZONS.map((horizon) => complete.get(horizon) || scenarioRows.find((row) => row.horizon_minutes === horizon));
  }, [rawForecasts, selected]);
  const latest = forecasts[0] || buildScenarioForecasts(selected)[0];
  const peak = forecasts.reduce((best, row) => row.predicted_congestion_score > best.predicted_congestion_score ? row : best, forecasts[0]);

  async function refreshAll() {
    try {
      await api.post('/predictions/refresh', { junction_id: selected.id });
      await reload();
    } catch {
      await reload();
    }
  }

  return <>
    <PageIntro eyebrow="TRAFFIC FORECASTING" title="Junction forecasts" description="Review the current state and the next 60 minutes. Values from a trend fallback are estimates, not validated AI predictions." action={<button className="utility" onClick={refreshAll}><RefreshCw size={14}/> Refresh forecast</button>} />
    <ErrorNotice message={error || junctionError} onRetry={() => { reloadJunctions(); reload(); }} />
    <div className="forecast-toolbar panel">
      <div><span className="eyebrow">JUNCTION</span><b>{selected?.name || 'City junction'}</b><small>{selected?.cluster_id ? `Network group ${selected.cluster_id}` : 'City network'}</small></div>
      <label>Choose junction<select value={selected?.id ?? ''} onChange={(event) => setSelectedId(event.target.value)}>{junctionList.map((junction) => <option value={junction.id} key={junction.id}>{junction.name}</option>)}</select></label>
      <span className="status-pill">{loading || junctionLoading ? 'Updating…' : '5 horizons'}</span>
    </div>
    <div className="analytics-kpis forecast-kpis">
      <MetricCard icon={Activity} label="Current queue" value={`${latest.predicted_queue_length_m} m`} detail="Latest observation / baseline" />
      <MetricCard icon={Zap} label="Peak congestion" value={`${peak?.predicted_congestion_score ?? latest.predicted_congestion_score}/100`} detail={`Highest forecast · ${horizonLabel(peak?.horizon_minutes ?? 0)}`} />
      <MetricCard icon={Clock3} label="Expected wait" value={`${Math.round(latest.predicted_average_wait_seconds)} sec`} detail="Current horizon estimate" />
      <MetricCard icon={Wind} label="Air quality context" value={latest.predicted_aqi == null ? 'Not available' : `AQI ${Math.round(latest.predicted_aqi)}`} detail="Context estimate; not a station reading" />
    </div>
    <section className="panel forecast-panel">
      <div className="panel-head"><div><div className="eyebrow">NOW / +15 / +30 / +45 / +60</div><h3>Queue and congestion outlook</h3></div><span className="status-pill">Scenario-aware forecast</span></div>
      <div className="forecast-timeline">{forecasts.map((row, index) => <article className="forecast-point" key={row.horizon_minutes}>
        <div className="forecast-point-top"><span>{horizonLabel(row.horizon_minutes)}</span><b>{Math.round(row.predicted_congestion_score)}<small>/100</small></b></div>
        <div className="forecast-bar-track"><i style={{ height: `${Math.max(8, Math.min(100, row.predicted_congestion_score))}%` }} /></div>
        <div className="forecast-point-stats"><span>Queue<b>{row.predicted_queue_length_m} m</b></span><span>Vehicles<b>{row.predicted_vehicle_count}</b></span><span>Wait<b>{Math.round(row.predicted_average_wait_seconds)} sec</b></span></div>
        <small className="forecast-confidence">{Math.round((row.confidence ?? 0.6) * 100)}% scenario confidence</small>
      </article>)}</div>
      <p className="api-note forecast-disclaimer">A trend heuristic is used when a trained model or fresh forecasts are unavailable. This view does not claim model accuracy and does not issue signal-control commands.</p>
    </section>
  </>;
}
