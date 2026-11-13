import { useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, CarFront, Clock3, Gauge, Pause, Play, RotateCcw, Route, Signal, Zap } from 'lucide-react';
import PageIntro from '../../components/shared/PageIntro.jsx';
import TrafficSimulationScene from './TrafficSimulationScene.jsx';
import { api } from '../../services/api/client.js';
import './traffic-simulation-page.css';

const DEFAULTS = {
  name: 'Signal timing experiment',
  north_south_green_seconds: 42,
  east_west_green_seconds: 42,
  yellow_seconds: 3,
  all_red_seconds: 1,
  demand_multiplier: 1,
};
const number = (value, suffix = '') => value === null || value === undefined ? '—' : `${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 1 })}${suffix}`;
const pct = (value) => value === null || value === undefined ? '—' : `${value > 0 ? '+' : ''}${value}%`;

function Metric({ icon: Icon, label, value, hint, delta, goodDirection = -1 }) {
  const isGood = delta !== undefined && delta !== null && delta !== 0 && Math.sign(delta) === goodDirection;
  return <article className="sumo-metric">
    <span className="sumo-metric-icon"><Icon size={17}/></span>
    <small>{label}</small>
    <strong>{value}</strong>
    <div className="sumo-metric-foot">{delta !== undefined && delta !== null ? <span className={delta === 0 ? '' : isGood ? 'positive' : 'negative'}>{delta < 0 ? <ArrowDownRight size={13}/> : delta > 0 ? <ArrowUpRight size={13}/> : null}{pct(delta)}</span> : null}<em>{hint}</em></div>
  </article>;
}

function QueueChart({ baseline = [], proposed = [] }) {
  const max = Math.max(1, ...baseline.map((x) => Number(x.queue_total || 0)), ...proposed.map((x) => Number(x.queue_total || 0)));
  const points = (items) => items.map((item, index) => {
    const minute = Number(item.minute);
    const x = Number.isFinite(minute) ? Math.max(0, Math.min(100, minute / 60 * 100)) : items.length < 2 ? 0 : index / (items.length - 1) * 100;
    const y = 88 - (Number(item.queue_total || 0) / max) * 78;
    return `${x},${y}`;
  }).join(' ');
  return <div className="sumo-chart">
    <div className="sumo-chart-legend"><span><i className="base-line"/> Baseline</span><span><i className="candidate-line"/> Signal plan</span></div>
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Five-minute road queue comparison chart">
      {[20, 40, 60, 80].map((y) => <line key={y} x1="0" x2="100" y1={y} y2={y} stroke="currentColor" strokeOpacity=".1" strokeDasharray="1 2"/>)}
      {baseline.length > 1 && <polyline points={points(baseline)} fill="none" stroke="#9ba99b" strokeWidth="1.6" vectorEffect="non-scaling-stroke"/>}
      {proposed.length > 1 && <polyline points={points(proposed)} fill="none" stroke="#4b8a56" strokeWidth="2.2" vectorEffect="non-scaling-stroke"/>}
    </svg>
    <div className="sumo-chart-axis"><span>0 min</span><span>30 min</span><span>60 min</span></div>
  </div>;
}

export default function TrafficSimulationPage() {
  const [form, setForm] = useState(DEFAULTS);
  const [result, setResult] = useState(null);
  const [minuteIndex, setMinuteIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [runAt, setRunAt] = useState('');
  const [capabilities, setCapabilities] = useState(null);

  const timeline = result?.timeline || [];
  const baseline = result?.baseline_timeline || [];
  const frame = timeline[Math.min(minuteIndex, Math.max(0, timeline.length - 1))] || null;
  const timing = result?.experiment?.signal_timings || form;
  const summary = result?.summary || {};
  const comparison = result?.traffic_comparison || {};
  const roads = useMemo(() => frame?.roads || [], [frame]);
  const roadRows = roads.slice(0, 8);
  const totalCycle = Number(form.north_south_green_seconds) + Number(form.east_west_green_seconds) + 2 * (Number(form.yellow_seconds) + Number(form.all_red_seconds));

  useEffect(() => {
    let active = true;
    api.get('/traffic/simulation/capabilities', { timeoutMs: 9000, fallbackGraceMs: 0 })
      .then((value) => { if (active) setCapabilities(value); })
      .catch(() => { if (active) setCapabilities({ native_simulation_available: false, forecast_available: true, recommended_mode: 'forecast' }); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!playing || timeline.length < 2) return undefined;
    const timer = window.setInterval(() => {
      setMinuteIndex((current) => {
        if (current >= timeline.length - 1) { setPlaying(false); return current; }
        return current + 1;
      });
    }, 800);
    return () => window.clearInterval(timer);
  }, [playing, timeline.length]);

  function update(key, value) { setForm((current) => ({ ...current, [key]: value })); }

  async function runSimulation(event) {
    event.preventDefault();
    setBusy(true); setError(''); setPlaying(false); setResult(null); setMinuteIndex(0);
    try {
      let response;
      let nativeError = null;
      let activeCapabilities = capabilities;
      if (!activeCapabilities) {
        try { activeCapabilities = await api.get('/traffic/simulation/capabilities', { timeoutMs: 9000, fallbackGraceMs: 0 }); }
        catch { activeCapabilities = { native_simulation_available: false, forecast_available: true }; }
      }
      // Do not call an unavailable optional engine. This avoids an expected 424
      // network error on every run and keeps the fallback path clean in DevTools.
      if (activeCapabilities?.native_simulation_available) {
        try {
          response = await api.post('/traffic/sumo/run', form, { timeoutMs: 600000, fallbackGraceMs: 0 });
        } catch (err) {
          nativeError = err;
          if (![424, 503].includes(Number(err?.status))) throw err;
        }
      }
      if (!response) {
        if (activeCapabilities?.forecast_available === false) {
          throw new Error('The 60-minute road forecast is temporarily unavailable. Please try again shortly.');
        }
        response = await api.post('/traffic/simulation/model-scenario', form, { timeoutMs: 45000, fallbackGraceMs: 0 });
        if (nativeError) response.engine_fallback_note = 'Detailed vehicle simulation could not start, so this run uses the available 60-minute network forecast.';
      }
      if (!['native_sumo_simulation', 'xgboost_model_scenario'].includes(response?.mode) || !Array.isArray(response.timeline)) {
        throw new Error('The API did not return a supported simulation or forecast result.');
      }
      setResult(response);
      setRunAt(new Date().toLocaleString());
      setPlaying(true);
    } catch (err) {
      const detail = err?.payload?.detail || err?.message || 'The simulation could not complete.';
      setError(typeof detail === 'string' ? detail : 'The simulation could not complete. Please retry shortly or contact the workspace administrator.');
    } finally { setBusy(false); }
  }

  function reset() { setForm(DEFAULTS); setResult(null); setError(''); setMinuteIndex(0); setPlaying(false); }

  return <div className="sumo-page">
    <PageIntro eyebrow="TRAFFIC OPERATIONS / DIGITAL TWIN" title="Traffic simulation" description="Explore a 60-minute road network, tune signal timings and watch traffic conditions change through the playback." action={<span className="sumo-engine-chip"><span/>{result ? (result.mode === 'native_sumo_simulation' ? 'Detailed simulation' : '60-minute forecast') : capabilities?.native_simulation_available ? 'Simulation ready' : capabilities?.forecast_available ? 'Forecast ready' : 'Checking availability'}</span>} />

    <section className="sumo-intro-strip">
      <div className="sumo-intro-icon"><Route size={20}/></div>
      <div><b>Baseline vs. proposed signal plan</b><p>Compare the current timing with your proposed cycle. Road conditions, vehicle flow indicators, queues and signal phases update as the 60-minute timeline plays.</p></div>
      <span className="sumo-network-tag">ROAD NETWORK PREVIEW</span>
    </section>

    <div className="sumo-workspace">
      <form className="sumo-panel sumo-controls" onSubmit={runSimulation}>
        <div className="sumo-panel-head"><div><span>EXPERIMENT SETUP</span><h2>Intersection control</h2></div><span className="sumo-soft-icon"><Signal size={18}/></span></div>
        <label className="sumo-name-field">Experiment name<input value={form.name} onChange={(event) => update('name', event.target.value)} maxLength={120}/></label>
        <div className="sumo-timing-grid">
          <label><span>North / South green</span><div><input type="number" min="8" max="100" value={form.north_south_green_seconds} onChange={(event) => update('north_south_green_seconds', Number(event.target.value))}/><small>sec</small></div></label>
          <label><span>East / West green</span><div><input type="number" min="8" max="100" value={form.east_west_green_seconds} onChange={(event) => update('east_west_green_seconds', Number(event.target.value))}/><small>sec</small></div></label>
          <label><span>Yellow clearance</span><div><input type="number" min="3" max="8" value={form.yellow_seconds} onChange={(event) => update('yellow_seconds', Number(event.target.value))}/><small>sec</small></div></label>
          <label><span>All-red clearance</span><div><input type="number" min="1" max="5" value={form.all_red_seconds} onChange={(event) => update('all_red_seconds', Number(event.target.value))}/><small>sec</small></div></label>
        </div>
        <label className="sumo-demand-field"><span>Traffic demand <b>{Number(form.demand_multiplier).toFixed(1)}×</b></span><input type="range" min="0.5" max="2" step="0.1" value={form.demand_multiplier} onChange={(event) => update('demand_multiplier', Number(event.target.value))}/><div><small>0.5× lighter</small><small>2× heavier</small></div></label>
        <div className="sumo-cycle-row"><div><small>Total cycle</small><b>{totalCycle}s</b></div><div><small>Simulation horizon</small><b>60 min</b></div><div><small>Forecast interval</small><b>5 min</b></div></div>
        {error && <div className="sumo-error"><AlertTriangle size={16}/><span>{error}</span></div>}
        <button className="sumo-run-button" type="submit" disabled={busy || totalCycle < 40 || totalCycle > 240 || form.north_south_green_seconds < 8 || form.east_west_green_seconds < 8}>
          {busy ? <><span className="sumo-spinner"/> Running simulation…</> : <><Play size={16} fill="currentColor"/> Run simulation</>}
        </button>
        <button type="button" className="sumo-reset-button" onClick={reset} disabled={busy}><RotateCcw size={14}/> Reset experiment</button>
        <p className="sumo-control-foot"><AlertTriangle size={13}/> Forecast frames update every five minutes. Detailed vehicle positions, when enabled, are sampled every 30 seconds. Signal changes affect this experiment only and never control physical traffic lights.</p>
      </form>

      <div className="sumo-visual-column">
        {result ? <>
          <TrafficSimulationScene roads={roads} frame={frame} playing={playing} areaName="Urban grid reference network" signalTimings={timing} nativeSumo={result.mode === 'native_sumo_simulation'} modelForecast={result.mode === 'xgboost_model_scenario'} networkGeometry={result.network_geometry} />
          <div className="sumo-playback sumo-panel">
            <div className="sumo-playback-top"><div><span>SIMULATION PLAYBACK</span><b>Minute {Number(frame?.minute ?? 0).toFixed(1)} <small>/ 60</small></b></div><button type="button" onClick={() => setPlaying((value) => !value)}>{playing ? <Pause size={15}/> : <Play size={15}/>} {playing ? 'Pause' : 'Play'}</button></div>
            <input aria-label="Simulation minute" type="range" min="0" max={Math.max(0, timeline.length - 1)} value={minuteIndex} onChange={(event) => { setMinuteIndex(Number(event.target.value)); setPlaying(false); }}/>
            <div className="sumo-playback-scale"><span>00:00</span><span>30:00</span><span>60:00</span></div>
            <div className="sumo-playback-stats"><span><b>{number(frame?.vehicle_count_actual ?? frame?.vehicles)}</b> vehicles on network</span><span><b>{number(frame?.queue_total)}</b> halted</span><span><b>{number(frame?.mean_speed_kmph, ' km/h')}</b> mean speed</span></div>
          </div>
        </> : <section className="sumo-empty sumo-panel">
          <div className="sumo-empty-visual"><div className="sumo-road-cross"><i/><i/><i/><i/><span><Signal size={26}/></span></div></div>
          <span className="sumo-empty-eyebrow">ROAD NETWORK / 60-MINUTE PLAYBACK</span><h2>Ready to run an experiment</h2><p>Choose the signal timings and traffic demand, then start the road simulation. Vehicles, junction signals and network metrics will move with the timeline.</p>
          <div className="sumo-empty-pills"><span><CarFront size={14}/> Vehicle flow</span><span><Gauge size={14}/> Road conditions</span><span><Clock3 size={14}/> 60-minute run</span></div>
        </section>}
      </div>
    </div>

    {result && <>
      <div className="sumo-results-head"><div><span>EXPERIMENT RESULTS</span><h2>{result.experiment?.name || 'Signal timing experiment'}</h2><small>Completed {runAt || (result.generated_at ? new Date(result.generated_at).toLocaleString() : '—')} · {result.mode === 'native_sumo_simulation' ? 'Detailed road simulation' : '60-minute network forecast'}</small></div><span className="sumo-complete-chip"><i/> {result.mode === 'native_sumo_simulation' ? 'DETAILED SIMULATION' : '60-MINUTE FORECAST'}</span></div>
      <div className="sumo-metrics-grid">
        {result.mode === 'native_sumo_simulation' ? <>
          <Metric icon={CarFront} label="Vehicles completed" value={number(summary.vehicles_completed)} hint="Candidate run" delta={comparison.vehicles_completed?.change_percent} goodDirection={1}/>
          <Metric icon={Clock3} label="Average trip wait" value={number(summary.avg_trip_waiting_seconds, 's')} hint="Across trip records" delta={comparison.average_wait_seconds?.change_percent}/>
          <Metric icon={Gauge} label="Final mean speed" value={number(summary.mean_speed_kmph_final, ' km/h')} hint="Candidate run"/>
          <Metric icon={Activity} label="Queue at 60 min" value={number(summary.queue_end)} hint="Halted vehicles" delta={comparison.queue_at_60m?.change_percent}/>
        </> : <>
          <Metric icon={Activity} label="Forecast queue at 60 min" value={number(summary.queue_end)} hint="Signal timing what-if" delta={comparison.queue_at_60m?.change_percent}/>
          <Metric icon={Route} label="Heavy roads" value={number(summary.heavy_roads_end)} hint="Forecast road classification"/>
          <Metric icon={Gauge} label="30 min forecast accuracy" value={number(result.models?.horizon_30?.level_accuracy_percent, '%')} hint="Held-out model metric"/>
          <Metric icon={Clock3} label="60 min forecast accuracy" value={number(result.models?.horizon_60?.level_accuracy_percent, '%')} hint="Held-out model metric"/>
        </>}
      </div>
      <div className="sumo-result-grid">
        <section className="sumo-panel sumo-chart-panel"><div className="sumo-panel-head"><div><span>NETWORK PERFORMANCE</span><h2>Queue comparison</h2></div><span className="sumo-chart-icon"><Activity size={17}/></span></div><QueueChart baseline={baseline} proposed={timeline}/><div className="sumo-chart-foot"><div><small>Baseline queue</small><b>{number(comparison.queue_at_60m?.baseline)}</b></div><div><small>Signal plan queue</small><b>{number(comparison.queue_at_60m?.proposed)}</b></div><div><small>Change</small><b className={Number(comparison.queue_at_60m?.change_percent) < 0 ? 'positive' : 'negative'}>{pct(comparison.queue_at_60m?.change_percent)}</b></div></div></section>
        <section className="sumo-panel sumo-road-panel"><div className="sumo-panel-head"><div><span>ROAD DATA · {number(frame?.road_telemetry_count)}</span><h2>Road conditions</h2></div><span className="sumo-chart-icon"><Route size={17}/></span></div>
          {roadRows.length ? <div className="sumo-road-list">{roadRows.map((road) => <div className="sumo-road-row" key={road.road}><div><b>{road.road}</b><small>{result.mode === 'native_sumo_simulation' ? `${number(road.density, ' veh/km/lane')} · ${number(road.occupancy, '%')} occupancy` : `Forecast queue · ${number(road.queue)} halted · ${number(road.vehicles)} observed at baseline`}</small></div><div><strong>{number(result.mode === 'native_sumo_simulation' ? road.entered_vehicles : road.queue)}</strong><small>{result.mode === 'native_sumo_simulation' ? 'entered / 5 min' : 'forecast queue'}</small></div><span className={`sumo-road-level ${String(road.level || '').toLowerCase()}`}>{road.level}</span></div>)}</div> : <p className="sumo-no-roads">No road-segment values were returned for this point in the timeline.</p>}
        </section>
      </div>
      <div className="sumo-provenance"><Zap size={14}/><span>{result.mode === 'native_sumo_simulation' ? `${number(result.training_data?.road_edges)} reference road segments · ${number(result.training_data?.routes)} generated routes · 60-minute run. Vehicle positions and road measurements come from the simulation output.` : `Forecast based on ${number(result.training_data?.records)} historical reference records across ${number(result.training_data?.simulation_runs)} model runs and ${number(result.training_data?.road_edges)} road segments. Road colours and queue values are estimates; moving markers are illustrative flow indicators, not tracked vehicles.`}</span></div>
      {result.engine_fallback_note && <div className="sumo-provenance"><AlertTriangle size={14}/><span>{result.engine_fallback_note} {result.native_engine_note}</span></div>}
      <div className="sumo-notes">{(result.notes || []).slice(0, 4).map((note, index) => <p key={index}>{note}</p>)}</div>
    </>}
  </div>;
}
