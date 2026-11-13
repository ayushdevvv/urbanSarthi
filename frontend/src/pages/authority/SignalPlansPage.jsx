import { useEffect, useMemo, useState } from 'react';
import { Activity, ArrowDownRight, ArrowUpRight, CheckCircle2, Clock3, Gauge, Play, RefreshCw, Route, ShieldCheck, SlidersHorizontal, TrafficCone } from 'lucide-react';
import { api } from '../../services/api/client.js';
import TrafficSimulationScene from './TrafficSimulationScene.jsx';
import './premium-operations.css';

const defaults = { name: 'Delhi corridor · adaptive timing study', north_south_green_seconds: 42, east_west_green_seconds: 42, yellow_seconds: 3, all_red_seconds: 1, demand_multiplier: 1 };
const n = (v, s = '') => v === null || v === undefined ? '—' : `${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 1 })}${s}`;

function CompareLine({ baseline = [], proposed = [] }) {
  const max = Math.max(1, ...baseline.map((x) => Number(x.queue_total || 0)), ...proposed.map((x) => Number(x.queue_total || 0)));
  const line = (rows) => rows.map((row, i) => `${(i / Math.max(1, rows.length - 1)) * 100},${92 - Number(row.queue_total || 0) / max * 78}`).join(' ');
  return <div className="ops-compare-chart"><div className="ops-chart-legend"><span><i className="baseline"/> Reference</span><span><i className="candidate"/> Proposed timing</span></div><svg viewBox="0 0 100 100" preserveAspectRatio="none"><path d="M0 20H100 M0 45H100 M0 70H100"/><polyline points={line(baseline)} className="baseline-line"/><polyline points={line(proposed)} className="candidate-line"/></svg><div><span>Now</span><span>30 min</span><span>60 min</span></div></div>;
}

export default function SignalPlansPage() {
  const [form, setForm] = useState(defaults);
  const [result, setResult] = useState(null);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState([]);
  const [historyBusy, setHistoryBusy] = useState(false);
  const timeline = result?.timeline || [];
  const frame = timeline[Math.min(index, Math.max(0, timeline.length - 1))] || null;
  const signal = result?.experiment?.signal_timings || form;
  const heavy = useMemo(() => [...(frame?.roads || [])].sort((a, b) => Number(b.queue || 0) - Number(a.queue || 0)).slice(0, 5), [frame]);
  const cycle = Number(form.north_south_green_seconds) + Number(form.east_west_green_seconds) + 2 * (Number(form.yellow_seconds) + Number(form.all_red_seconds));

  async function refreshHistory() {
    setHistoryBusy(true);
    try {
      const rows = await api.get('/traffic-detection/reports?report_type=signal_plan_study&limit=8', { timeoutMs: 9000, fallbackGraceMs: 0 });
      setSaved(Array.isArray(rows) ? rows : []);
    } catch { setSaved([]); }
    finally { setHistoryBusy(false); }
  }
  useEffect(() => { refreshHistory(); }, []);

  async function run(event) {
    event?.preventDefault(); setBusy(true); setError('');
    try {
      const data = await api.post('/traffic/simulation/model-scenario', form, { timeoutMs: 65000, fallbackGraceMs: 0 });
      if (data?.mode !== 'xgboost_model_scenario' || !Array.isArray(data.timeline)) throw new Error('The signal study did not return a valid model result.');
      setResult(data); setIndex(0);
      try { await api.post('/traffic-detection/reports/signal-study', { name: form.name, result: data }, { timeoutMs: 12000, fallbackGraceMs: 0 }); await refreshHistory(); }
      catch { setError('The signal study ran, but its history could not be saved. Export the result or retry saving after the connection returns.'); }
    } catch (err) { setError(err?.message || 'Signal timing study could not run.'); }
    finally { setBusy(false); }
  }
  function set(key, value) { setForm((v) => ({ ...v, [key]: value })); }

  return <main className="ops-screen ops-signal-screen">
    <header className="ops-page-head"><div><span className="ops-eyebrow">CONTROL STRATEGY / WHAT-IF STUDIO</span><h2>Signal Plan Studio</h2><p>Compare timing strategies against the trained network forecast before an operator reviews a plan.</p></div><span className="ops-state"><i/>Analysis only · no field controller writes</span></header>
    <div className="ops-signal-layout">
      <form className="ops-data-card ops-timing-form" onSubmit={run}>
        <div className="ops-card-head"><div><span>PLAN PARAMETERS</span><h3>Intersection timing</h3></div><SlidersHorizontal size={18}/></div>
        <label className="ops-field"><span>Study name</span><input value={form.name} onChange={(e) => set('name', e.target.value)} maxLength={120}/></label>
        <div className="ops-form-grid">
          <label className="ops-field"><span>North / South green</span><div className="ops-input-unit"><input type="number" min="8" max="100" value={form.north_south_green_seconds} onChange={(e) => set('north_south_green_seconds', Number(e.target.value))}/><em>sec</em></div></label>
          <label className="ops-field"><span>East / West green</span><div className="ops-input-unit"><input type="number" min="8" max="100" value={form.east_west_green_seconds} onChange={(e) => set('east_west_green_seconds', Number(e.target.value))}/><em>sec</em></div></label>
          <label className="ops-field"><span>Yellow clearance</span><div className="ops-input-unit"><input type="number" min="3" max="8" value={form.yellow_seconds} onChange={(e) => set('yellow_seconds', Number(e.target.value))}/><em>sec</em></div></label>
          <label className="ops-field"><span>All-red clearance</span><div className="ops-input-unit"><input type="number" min="1" max="5" value={form.all_red_seconds} onChange={(e) => set('all_red_seconds', Number(e.target.value))}/><em>sec</em></div></label>
        </div>
        <label className="ops-field ops-demand-field"><span>Demand multiplier <b>{Number(form.demand_multiplier).toFixed(1)}×</b></span><input type="range" min="0.5" max="2" step="0.1" value={form.demand_multiplier} onChange={(e) => set('demand_multiplier', Number(e.target.value))}/><small>0.5× lighter demand <i/> 2× heavier demand</small></label>
        <div className="ops-cycle-box"><span>Total signal cycle</span><b>{cycle}s</b><small>Two phases · safety clearance retained</small></div>
        {error && <div className="ops-alert"><TrafficCone size={15}/>{error}</div>}
        <button className="ops-button primary full" disabled={busy || cycle < 40 || cycle > 240} type="submit">{busy ? <span className="ops-loader"/> : <Play size={15}/>} {busy ? 'Evaluating plan' : 'Evaluate signal plan'}</button>
        <p className="ops-small-note"><ShieldCheck size={14}/> Results are sensitivity estimates over the trained queue forecast, not proven signal-control outcomes.</p>
      </form>
      <div className="ops-signal-results">
        {result ? <>
          <section className="ops-map-card"><div className="ops-card-head"><div><span>INTERSECTION DIGITAL VIEW</span><h3>{form.name}</h3></div><span className="ops-live-label">60 MIN STUDY</span></div><TrafficSimulationScene roads={frame?.roads || []} frame={frame} areaName="Signal plan reference network" modelForecast networkGeometry={result.network_geometry} signalTimings={signal}/><div className="ops-playback"><div><b>Forecast horizon</b><span>+{frame?.minute ?? 0} minutes</span></div><input aria-label="Signal plan forecast minute" type="range" min="0" max={Math.max(0, timeline.length - 1)} value={index} onChange={(e) => setIndex(Number(e.target.value))}/><div className="ops-time-scale"><span>Now</span><span>30 min</span><span>60 min</span></div></div></section>
          <section className="ops-kpi-grid"><article><span><Activity size={16}/> Queue at +60 min</span><b>{n(result.summary?.queue_end)}</b><small>Proposed timing sensitivity</small></article><article><span><ArrowDownRight size={16}/> Queue difference</span><b>{n(result.traffic_comparison?.queue_at_60m?.change_percent, '%')}</b><small>Versus reference forecast</small></article><article><span><Route size={16}/> Heavy roads</span><b>{n(result.summary?.heavy_roads_end)}</b><small>At the 60-minute horizon</small></article><article><span><Clock3 size={16}/> Cycle length</span><b>{n(cycle, 's')}</b><small>Clearance intervals included</small></article></section>
          <section className="ops-data-card"><div className="ops-card-head"><div><span>MODEL COMPARISON</span><h3>Reference vs proposed</h3></div><Gauge size={18}/></div><CompareLine baseline={result.baseline_timeline || []} proposed={timeline}/><div className="ops-summary-row"><span>Reference queue</span><b>{n(result.traffic_comparison?.queue_at_60m?.baseline)}</b></div><div className="ops-summary-row"><span>Proposed queue</span><b>{n(result.traffic_comparison?.queue_at_60m?.proposed)}</b></div></section>
          <section className="ops-data-card"><div className="ops-card-head"><div><span>CONGESTED APPROACHES</span><h3>Roads to review</h3></div><Route size={18}/></div>{heavy.map((road) => <div className="ops-road-row" key={road.road}><div><b>{road.road}</b><small>Queue estimate · {n(road.queue)}</small></div><span className={`ops-road-pill ${String(road.level || '').toLowerCase()}`}>{road.level}</span></div>)}</section>
        </> : <section className="ops-empty-card"><div className="ops-empty-icon"><SlidersHorizontal size={24}/></div><span>READY FOR REVIEW</span><h3>Build a timing strategy</h3><p>Adjust the phase durations and demand assumption, then evaluate how the 60-minute network forecast responds.</p><div className="ops-empty-steps"><span>01 Set phase timing</span><span>02 Evaluate forecast</span><span>03 Review road impact</span></div></section>}
        <section className="ops-data-card"><div className="ops-card-head"><div><span>RECENT STUDIES</span><h3>Saved signal plans</h3></div><button className="ops-icon-button" type="button" onClick={refreshHistory} disabled={historyBusy} aria-label="Refresh saved studies"><RefreshCw size={15}/></button></div>{historyBusy && saved.length === 0 ? <p className="ops-empty-copy">Loading saved studies…</p> : saved.length ? saved.map((row) => <button className="ops-road-row ops-history-button" type="button" key={row.report_id} onClick={async () => { try { const detail = await api.get(`/traffic-detection/reports/${encodeURIComponent(row.report_id)}`, { timeoutMs: 10000, fallbackGraceMs: 0 }); setResult(detail.result); setIndex(0); setForm((current) => ({ ...current, name: detail.source_name || current.name })); } catch (err) { setError(err?.message || 'Could not open this study.'); } }}><span><b>{row.source_name}</b><small>{row.created_at ? new Date(row.created_at).toLocaleString() : 'Saved study'}</small></span><span className="ops-road-pill">{n(row.summary?.queue_end)} queue</span></button>) : <p className="ops-empty-copy">Your completed timing studies will be saved here.</p>}</section>
      </div>
    </div>
  </main>;
}
