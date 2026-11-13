import { useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, CarFront, Clock3, Gauge, Play, RefreshCw, ShieldCheck } from 'lucide-react';
import PageIntro from '../../components/shared/PageIntro.jsx';
import TrafficSimulationScene from './TrafficSimulationScene.jsx';
import { api } from '../../services/api/client.js';
import './traffic-simulation-page.css';
import './traffic-studio.css';

const DEFAULTS = { name: 'Delhi reference corridor run', north_south_green_seconds: 42, east_west_green_seconds: 42, yellow_seconds: 3, all_red_seconds: 1, demand_multiplier: 1 };
const fmt = (value, suffix = '') => value == null || !Number.isFinite(Number(value)) ? '—' : `${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 1 })}${suffix}`;

export default function DigitalTwinPage() {
  const [capabilities, setCapabilities] = useState(null);
  const [result, setResult] = useState(null);
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState(DEFAULTS);
  const timeline = result?.timeline || [];
  const frame = timeline[Math.min(frameIndex, Math.max(0, timeline.length - 1))] || null;
  const summary = result?.summary || {};

  async function refreshCapabilities() {
    try { setCapabilities(await api.get('/traffic/simulation/capabilities', { timeoutMs: 10000, fallbackGraceMs: 0 })); }
    catch { setCapabilities({ native_simulation_available: false, forecast_available: false }); }
  }
  useEffect(() => { refreshCapabilities(); }, []);
  useEffect(() => {
    if (!playing || timeline.length < 2) return undefined;
    const timer = window.setInterval(() => setFrameIndex((n) => { if (n >= timeline.length - 1) { setPlaying(false); return n; } return n + 1; }), 650);
    return () => window.clearInterval(timer);
  }, [playing, timeline.length]);

  async function run(event) {
    event.preventDefault(); setBusy(true); setError(''); setPlaying(false); setResult(null);
    try {
      const data = await api.post('/traffic/sumo/run', form, { timeoutMs: 600000, fallbackGraceMs: 0 });
      if (data?.mode !== 'native_sumo_simulation' || !Array.isArray(data.timeline)) throw new Error('The detailed vehicle run did not return a complete result.');
      setResult(data); setFrameIndex(0); setPlaying(true); await refreshCapabilities();
    } catch (err) { setError(err?.payload?.detail || err.message || 'The detailed vehicle run could not complete.'); }
    finally { setBusy(false); }
  }

  const vehicleRows = useMemo(() => frame?.vehicle_positions || [], [frame]);
  return <div className="city-studio">
    <PageIntro eyebrow="DETAILED ROAD MODEL" title="Digital twin" description="Run a detailed vehicle-level experiment on the bundled reference road network." action={<button className="utility" onClick={refreshCapabilities}><RefreshCw size={15}/> Check availability</button>}/>
    <section className="city-studio-toolbar"><div><span className="studio-kicker">DETAILED RUN</span><h2>Reference corridor digital twin</h2><p>Individual vehicle movement and signal timing, independent of the 60-minute forecast.</p></div><span className={`studio-mode-pill ${capabilities?.native_simulation_available ? 'ready' : 'muted'}`}>{capabilities?.native_simulation_available ? 'READY' : 'NOT AVAILABLE'}</span></section>
    {!capabilities?.native_simulation_available && <div className="studio-info-banner"><AlertTriangle size={17}/><div><b>Detailed vehicle simulation is not enabled on this service.</b><p>The 60-minute network outlook and signal plan studio remain available. This page will only start a detailed run after the simulator is installed and detected; it will not send a failing request or substitute forecast data as vehicle trajectories.</p></div><a href="/authority/traffic-simulation">Open 60-minute outlook</a></div>}
    <div className="studio-planner-grid twin-grid">
      <form className="studio-card studio-form" onSubmit={run}>
        <div className="studio-card-head"><div><span className="studio-kicker">RUN SETUP</span><h2>Simulation parameters</h2></div><CarFront size={18}/></div>
        <label>Experiment name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}/></label>
        <div className="studio-form-grid"><label>North / South green<div className="studio-input-unit"><input type="number" min="8" max="100" value={form.north_south_green_seconds} onChange={(e) => setForm({ ...form, north_south_green_seconds: Number(e.target.value) })}/><span>sec</span></div></label><label>East / West green<div className="studio-input-unit"><input type="number" min="8" max="100" value={form.east_west_green_seconds} onChange={(e) => setForm({ ...form, east_west_green_seconds: Number(e.target.value) })}/><span>sec</span></div></label><label>Yellow clearance<div className="studio-input-unit"><input type="number" min="3" max="8" value={form.yellow_seconds} onChange={(e) => setForm({ ...form, yellow_seconds: Number(e.target.value) })}/><span>sec</span></div></label><label>All-red clearance<div className="studio-input-unit"><input type="number" min="1" max="5" value={form.all_red_seconds} onChange={(e) => setForm({ ...form, all_red_seconds: Number(e.target.value) })}/><span>sec</span></div></label></div>
        <label className="studio-range-label">Traffic demand <b>{form.demand_multiplier.toFixed(1)}×</b><input type="range" min="0.5" max="2" step="0.1" value={form.demand_multiplier} onChange={(e) => setForm({ ...form, demand_multiplier: Number(e.target.value) })}/><small>0.5× lighter · 2× heavier</small></label>
        {error && <div className="studio-error"><AlertTriangle size={15}/>{error}</div>}
        <button className="studio-primary full" type="submit" disabled={busy || !capabilities?.native_simulation_available}>{busy ? <><span className="studio-mini-spinner"/> Running detailed simulation…</> : <><Play size={15}/> Run digital twin</>}</button>
        <p className="studio-footnote"><ShieldCheck size={14}/> Runs on a reference network. It does not actuate physical traffic lights or represent a calibrated Delhi junction.</p>
      </form>
      <div className="studio-result-column">
        {result ? <>
          <div className="city-stats-grid compact"><article className="city-stat"><small>Vehicles completed</small><strong>{fmt(summary.vehicles_completed)}</strong><span>In this run</span></article><article className="city-stat"><small>Average trip wait</small><strong>{fmt(summary.avg_trip_waiting_seconds, 's')}</strong><span>Across completed trips</span></article><article className="city-stat"><small>Queue at end</small><strong>{fmt(summary.queue_end)}</strong><span>Halted vehicles</span></article></div>
          <div className="studio-scene-card"><div className="studio-card-head"><div><span className="studio-kicker">VEHICLE MOVEMENT</span><h2>Live run playback</h2></div><span className="studio-mode-pill">{playing ? 'PLAYING' : 'PAUSED'} · {fmt(frame?.minute, ' MIN')}</span></div><TrafficSimulationScene roads={frame?.roads || []} frame={frame} playing={playing} areaName="Reference road network" nativeSumo networkGeometry={result.network_geometry} signalTimings={result.experiment?.signal_timings}/><div className="studio-slider-row"><label>Run timeline <b>{fmt(frame?.minute, ' min')}</b><input type="range" min="0" max={Math.max(0, timeline.length - 1)} value={frameIndex} onChange={(e) => { setFrameIndex(Number(e.target.value)); setPlaying(false); }}/></label></div></div>
          <section className="studio-card"><div className="studio-card-head"><div><span className="studio-kicker">CURRENT FRAME</span><h2>Vehicle sample</h2></div><Gauge size={18}/></div><div className="studio-twin-statline"><span><b>{fmt(frame?.vehicle_count_actual ?? vehicleRows.length)}</b> vehicles active</span><span><b>{fmt(frame?.mean_speed_kmph, ' km/h')}</b> mean speed</span><span><b>{fmt(frame?.queue_total)}</b> halted</span><span><b>{fmt(vehicleRows.length)}</b> visible positions</span></div></section>
        </> : <div className="studio-empty"><div className="studio-empty-icon"><Activity size={26}/></div><h2>Detailed vehicle view</h2><p>When the detailed simulation is available, each frame will contain actual sampled vehicle positions, speeds and signal phases.</p></div>}
      </div>
    </div>
  </div>;
}
