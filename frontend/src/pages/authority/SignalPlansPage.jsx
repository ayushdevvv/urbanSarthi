import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, Download, Gauge, Play, RefreshCw, Route, ShieldCheck, Signal } from 'lucide-react';
import PageIntro from '../../components/shared/PageIntro.jsx';
import TrafficSimulationScene from './TrafficSimulationScene.jsx';
import { api } from '../../services/api/client.js';
import './traffic-simulation-page.css';
import './traffic-studio.css';

const DEFAULTS = { name: 'Central corridor timing study', north_south_green_seconds: 42, east_west_green_seconds: 42, yellow_seconds: 3, all_red_seconds: 1, demand_multiplier: 1 };
const num = (v, suffix = '') => v == null || !Number.isFinite(Number(v)) ? '—' : `${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 1 })}${suffix}`;

function saveJson(name, content) { const url = URL.createObjectURL(new Blob([JSON.stringify(content, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url); }

export default function SignalPlansPage() {
  const [form, setForm] = useState(DEFAULTS);
  const [result, setResult] = useState(null);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState([]);
  const [historyError, setHistoryError] = useState('');
  const timeline = result?.timeline || [];
  const frame = timeline[Math.min(index, Math.max(0, timeline.length - 1))] || null;
  const baseline = result?.baseline_timeline?.at?.(-1)?.queue_total;
  const finalQueue = timeline.at?.(-1)?.queue_total;
  const delta = baseline == null || finalQueue == null ? null : ((finalQueue - baseline) / Math.max(1, baseline)) * 100;
  const roads = useMemo(() => [...(frame?.roads || [])].sort((a, b) => Number(b.queue || 0) - Number(a.queue || 0)).slice(0, 8), [frame]);

  const loadHistory = useCallback(async () => {
    try { const data = await api.get('/traffic-detection/reports?limit=8', { timeoutMs: 10000, fallbackGraceMs: 0 }); setHistory((data?.items || []).filter((item) => item.report_type === 'signal_plan_scenario')); setHistoryError(''); }
    catch (err) { setHistoryError(err.message || 'Saved studies could not be loaded.'); }
  }, []);
  useEffect(() => { loadHistory(); }, [loadHistory]);

  async function run(event) {
    event.preventDefault(); setBusy(true); setError(''); setIndex(0);
    try {
      const data = await api.post('/traffic/simulation/model-scenario', form, { timeoutMs: 45000, fallbackGraceMs: 0 });
      if (!Array.isArray(data?.timeline) || !data.timeline.length) throw new Error('No timing comparison was returned.');
      setResult(data); await loadHistory();
    } catch (err) { setError(err?.payload?.detail || err.message || 'The signal timing study could not finish.'); }
    finally { setBusy(false); }
  }

  const timing = result?.experiment?.signal_timings || form;
  return <div className="city-studio">
    <PageIntro eyebrow="SIGNAL CONTROL" title="Signal plan studio" description="Compare candidate green splits and clearance times against the network baseline." action={<button className="utility" onClick={loadHistory}><RefreshCw size={15}/> Refresh studies</button>}/>
    <section className="city-studio-toolbar"><div><span className="studio-kicker">TIMING WORKSPACE</span><h2>Build a signal scenario</h2><p>Run a 60-minute comparison without requiring a registered junction.</p></div><span className="studio-mode-pill">HUMAN REVIEW REQUIRED</span></section>
    <div className="studio-planner-grid">
      <form className="studio-card studio-form" onSubmit={run}>
        <div className="studio-card-head"><div><span className="studio-kicker">CANDIDATE PLAN</span><h2>Signal timings</h2></div><Signal size={19}/></div>
        <label>Study name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={160}/></label>
        <div className="studio-form-grid">
          <label>North / South green <div className="studio-input-unit"><input type="number" min="8" max="100" value={form.north_south_green_seconds} onChange={(e) => setForm({ ...form, north_south_green_seconds: Number(e.target.value) })}/><span>sec</span></div></label>
          <label>East / West green <div className="studio-input-unit"><input type="number" min="8" max="100" value={form.east_west_green_seconds} onChange={(e) => setForm({ ...form, east_west_green_seconds: Number(e.target.value) })}/><span>sec</span></div></label>
          <label>Yellow clearance <div className="studio-input-unit"><input type="number" min="3" max="8" value={form.yellow_seconds} onChange={(e) => setForm({ ...form, yellow_seconds: Number(e.target.value) })}/><span>sec</span></div></label>
          <label>All-red clearance <div className="studio-input-unit"><input type="number" min="1" max="5" value={form.all_red_seconds} onChange={(e) => setForm({ ...form, all_red_seconds: Number(e.target.value) })}/><span>sec</span></div></label>
        </div>
        <label className="studio-range-label">Traffic demand <b>{Number(form.demand_multiplier).toFixed(1)}×</b><input type="range" min="0.5" max="2" step="0.1" value={form.demand_multiplier} onChange={(e) => setForm({ ...form, demand_multiplier: Number(e.target.value) })}/><small>0.5× lighter · 2× heavier</small></label>
        <div className="studio-cycle-summary"><span>Cycle length <b>{form.north_south_green_seconds + form.east_west_green_seconds + 2 * (form.yellow_seconds + form.all_red_seconds)} sec</b></span><span>Horizon <b>60 minutes</b></span></div>
        {error && <div className="studio-error"><AlertTriangle size={15}/>{error}</div>}
        <button className="studio-primary full" type="submit" disabled={busy}>{busy ? <><span className="studio-mini-spinner"/> Comparing plans…</> : <><Play size={15}/> Compare signal plan</>}</button>
        <p className="studio-footnote"><ShieldCheck size={14}/> This comparison is a bounded model sensitivity study. It is not a measured signal-control effect and does not send commands to field controllers.</p>
      </form>
      <div className="studio-result-column">
        {result ? <>
          <div className="city-stats-grid compact"><article className="city-stat"><small>Baseline queue at 60 min</small><strong>{num(baseline)}</strong><span>Reference outlook</span></article><article className="city-stat primary"><small>Candidate queue at 60 min</small><strong>{num(finalQueue)}</strong><span>Selected timings</span></article><article className="city-stat"><small>Queue sensitivity</small><strong>{num(delta, '%')}</strong><span>{delta == null ? 'Not available' : delta < 0 ? 'Lower than baseline' : delta > 0 ? 'Higher than baseline' : 'No change'}</span></article></div>
          <div className="studio-scene-card"><div className="studio-card-head"><div><span className="studio-kicker">PLAN PREVIEW</span><h2>Network response</h2></div><button className="studio-icon-button" onClick={() => saveJson('urbansaarthi-signal-study.json', result)} title="Download study"><Download size={16}/></button></div><TrafficSimulationScene roads={frame?.roads || []} frame={frame} playing={false} areaName="Reference network" modelForecast networkGeometry={result.network_geometry} signalTimings={timing}/><div className="studio-slider-row"><label>Forecast step <b>{num(frame?.minute, ' min')}</b><input type="range" min="0" max={timeline.length - 1} value={index} onChange={(e) => setIndex(Number(e.target.value))}/></label></div></div>
          <section className="studio-card"><div className="studio-card-head"><div><span className="studio-kicker">ROAD IMPACT</span><h2>Most affected segments</h2></div><Gauge size={18}/></div><div className="studio-road-list">{roads.map((road) => <div className="studio-road-row" key={road.road}><div><b>{road.road}</b><small>{num(road.vehicles)} vehicles</small></div><strong>{num(road.queue)} queue</strong><span className={`studio-level ${String(road.level || '').toLowerCase()}`}>{road.level}</span></div>)}</div></section>
          <div className="studio-footnote"><Activity size={14}/> Saved as report {result.report_id ? `#${result.report_id.slice(0, 8)}` : 'in this session'}. No field signal device is connected.</div>
        </> : <div className="studio-empty"><div className="studio-empty-icon"><Signal size={27}/></div><h2>Ready to compare timings</h2><p>Adjust green splits and traffic demand, then run a comparison to see the 60-minute network response and save a study report.</p></div>}
      </div>
    </div>
    <section className="studio-card studio-history"><div className="studio-card-head"><div><span className="studio-kicker">SAVED WORK</span><h2>Recent signal studies</h2></div><span className="studio-count">{history.length} studies</span></div>{historyError && <div className="studio-inline-muted">{historyError}</div>}{history.length ? history.map((item) => <div className="studio-history-row" key={item.public_id}><div><b>{item.title}</b><small>{new Date(item.created_at).toLocaleString()}</small></div><span className="studio-level free">Saved</span></div>) : <p className="studio-inline-muted">Your completed timing studies will appear here.</p>}</section>
  </div>;
}
