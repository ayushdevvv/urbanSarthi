import { useEffect, useState } from 'react';
import { AlertTriangle, CarFront, Clock3, Play, RefreshCw, Route, Signal, Gauge } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../../services/api/client.js';
import TrafficSimulationScene from './TrafficSimulationScene.jsx';
import './premium-operations.css';

const fmt = (v, suffix = '') => v === null || v === undefined ? '—' : `${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 1 })}${suffix}`;
const initial = { name: 'Delhi reference intersection · microscopic run', north_south_green_seconds: 42, east_west_green_seconds: 42, yellow_seconds: 3, all_red_seconds: 1, demand_multiplier: 1 };

export default function DigitalTwinPage() {
  const [capabilities, setCapabilities] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState(initial);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const timeline = result?.timeline || result?.frames || [];
  const frame = timeline[index] || timeline[0] || null;
  const summary = result?.summary || result?.metrics || {};
  useEffect(() => { api.get('/traffic/simulation/capabilities', { timeoutMs: 10000, fallbackGraceMs: 0 }).then(setCapabilities).catch(() => setCapabilities({ native_simulation_available: false, message: 'Simulation availability could not be checked.' })); }, []);
  useEffect(() => { if (!playing || timeline.length < 2) return undefined; const timer = setInterval(() => setIndex((v) => { if (v >= timeline.length - 1) { setPlaying(false); return v; } return v + 1; }), 250); return () => clearInterval(timer); }, [playing, timeline.length]);
  async function run(event) { event?.preventDefault(); setBusy(true); setError(''); setResult(null); setPlaying(false); try { const data = await api.post('/traffic/sumo/run', form, { timeoutMs: 600000, fallbackGraceMs: 0 }); if (!data || !['native_sumo_simulation', 'sumo_simulation'].includes(data.mode)) throw new Error('The detailed vehicle run did not return a native simulation result.'); setResult(data); setIndex(0); } catch (err) { setError(err?.message || 'Detailed digital twin could not run.'); } finally { setBusy(false); } }
  const vehicles = frame?.vehicle_positions || frame?.vehicles || [];
  return <main className="ops-screen ops-digital-screen">
    <header className="ops-page-head"><div><span className="ops-eyebrow">MICROSCOPIC ROAD MODEL / VEHICLE-LEVEL VIEW</span><h2>Traffic digital twin</h2><p>Run a detailed vehicle-level intersection experiment, separate from the 60-minute network forecast.</p></div><div className="ops-head-actions"><span className={`ops-state ${capabilities?.native_simulation_available ? '' : 'warning'}`}><i/>{capabilities?.native_simulation_available ? 'Detailed engine available' : 'Engine unavailable'}</span><button className="ops-button secondary" onClick={() => api.get('/traffic/simulation/capabilities', { timeoutMs: 10000, fallbackGraceMs: 0 }).then(setCapabilities).catch(() => setCapabilities({ native_simulation_available: false }))}><RefreshCw size={14}/> Check</button></div></header>
    {!capabilities?.native_simulation_available && <div className="ops-alert"><AlertTriangle size={16}/><span>Vehicle-level simulation is not available on this deployment. The 60-minute forecast remains available separately.</span><Link to="/authority/traffic-simulation">Open 60-minute simulation</Link></div>}
    <div className="ops-twin-layout">
      <form className="ops-data-card ops-twin-controls" onSubmit={run}><div className="ops-card-head"><div><span>EXPERIMENT SETUP</span><h3>Intersection controls</h3></div><Signal size={18}/></div>
        <label className="ops-field"><span>Study name</span><input value={form.name} onChange={(e) => setForm((v) => ({ ...v, name: e.target.value }))}/></label>
        {['north_south_green_seconds','east_west_green_seconds','yellow_seconds','all_red_seconds'].map((key) => <label className="ops-field" key={key}><span>{key.replaceAll('_',' ')}</span><input type="number" min={key.includes('green') ? 8 : key.includes('yellow') ? 3 : 1} max={key.includes('green') ? 100 : key.includes('yellow') ? 8 : 5} value={form[key]} onChange={(e) => setForm((v) => ({ ...v, [key]: Number(e.target.value) }))}/></label>)}
        <label className="ops-field"><span>Demand level · {Number(form.demand_multiplier).toFixed(1)}×</span><input type="range" min="0.5" max="2" step="0.1" value={form.demand_multiplier} onChange={(e) => setForm((v) => ({ ...v, demand_multiplier: Number(e.target.value) }))}/></label>
        {error && <div className="ops-alert"><AlertTriangle size={15}/>{error}</div>}
        <button className="ops-button primary full" type="submit" disabled={busy || !capabilities?.native_simulation_available}>{busy ? <span className="ops-loader"/> : <Play size={15}/>} {busy ? 'Building vehicle run' : 'Run digital twin'}</button><small className="ops-small-note">No physical signals are connected or controlled by this experiment.</small>
      </form>
      <div className="ops-twin-stage">{result ? <><section className="ops-map-card"><div className="ops-card-head"><div><span>VEHICLE-LEVEL PLAYBACK</span><h3>{form.name}</h3></div><span className="ops-live-label">NATIVE RUN</span></div><TrafficSimulationScene nativeSumo roads={frame?.roads || []} frame={frame} playing networkGeometry={result.network_geometry}/><div className="ops-playback"><div><b>Simulation playback</b><span>Frame {index + 1} / {timeline.length}</span></div><button className="ops-icon-button" onClick={() => setPlaying((v) => !v)}>{playing ? 'Pause' : 'Play'}</button><input type="range" min="0" max={Math.max(0, timeline.length - 1)} value={index} onChange={(e) => { setIndex(Number(e.target.value)); setPlaying(false); }}/></div></section>
        <section className="ops-kpi-grid"><article><span><CarFront size={16}/> Vehicles completed</span><b>{fmt(summary.vehicles_completed)}</b><small>Microscopic run</small></article><article><span><Clock3 size={16}/> Average waiting</span><b>{fmt(summary.avg_trip_waiting_seconds, 's')}</b><small>Trip records</small></article><article><span><Gauge size={16}/> Mean speed</span><b>{fmt(summary.mean_speed_kmph_final, ' km/h')}</b><small>End of run</small></article><article><span><Route size={16}/> Queue at end</span><b>{fmt(summary.queue_end)}</b><small>Halted vehicles</small></article></section></> : <section className="ops-empty-card dark"><div className="ops-road-graphic"><i/><i/><i/><i/><span><CarFront size={23}/></span></div><span>MICROSCOPIC DIGITAL TWIN</span><h3>{busy ? 'Building the road scene' : 'A living intersection model'}</h3><p>Run a detailed experiment to inspect individual vehicle movements, signal phases and road performance through the simulation timeline.</p></section>}</div>
    </div>
  </main>;
}
