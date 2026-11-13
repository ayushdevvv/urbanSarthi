import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, CarFront, Clock3, Gauge, Pause, Play, RefreshCw, Route, TrendingDown, TrendingUp } from 'lucide-react';
import PageIntro from '../../components/shared/PageIntro.jsx';
import TrafficSimulationScene from './TrafficSimulationScene.jsx';
import { api } from '../../services/api/client.js';
import './traffic-simulation-page.css';
import './traffic-studio.css';

const number = (value, suffix = '') => value == null || !Number.isFinite(Number(value)) ? '—' : `${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 1 })}${suffix}`;
const scenarioLabels = { baseline: 'Current pattern', demand_surge: 'Higher demand', signal_priority: 'Signal priority what-if' };

function Metric({ icon: Icon, label, value, detail, tone = '' }) {
  return <article className={`city-stat ${tone}`}><span className="city-stat-icon"><Icon size={18}/></span><small>{label}</small><strong>{value}</strong><span>{detail}</span></article>;
}

export default function TrafficSimulationPage() {
  const [scenario, setScenario] = useState('baseline');
  const [result, setResult] = useState(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loadedAt, setLoadedAt] = useState(null);
  const timeline = result?.timeline || [];
  const frame = timeline[Math.min(index, Math.max(0, timeline.length - 1))] || null;
  const roads = frame?.roads || [];
  const topRoads = useMemo(() => [...roads].sort((a, b) => Number(b.queue || 0) - Number(a.queue || 0)).slice(0, 8), [roads]);

  const load = useCallback(async (nextScenario = scenario) => {
    setBusy(true); setError(''); setPlaying(false);
    try {
      const data = await api.get(`/traffic/simulation/scenario?minutes=60&step_minutes=5&scenario=${encodeURIComponent(nextScenario)}`, { timeoutMs: 30000, fallbackGraceMs: 0 });
      if (!Array.isArray(data?.timeline) || data.timeline.length < 2) throw new Error('The 60-minute outlook did not return enough forecast points.');
      setResult(data); setIndex(0); setLoadedAt(new Date()); setPlaying(true);
    } catch (err) { setError(err?.payload?.detail || err?.message || 'The traffic outlook is temporarily unavailable.'); }
    finally { setBusy(false); }
  }, [scenario]);

  useEffect(() => { load('baseline'); }, []); // one read-only forecast on entry
  useEffect(() => {
    if (!playing || timeline.length < 2) return undefined;
    const timer = window.setInterval(() => setIndex((current) => {
      if (current >= timeline.length - 1) { setPlaying(false); return current; }
      return current + 1;
    }), 950);
    return () => window.clearInterval(timer);
  }, [playing, timeline.length]);

  const summary = result?.summary || {};
  return <div className="city-studio">
    <PageIntro eyebrow="NETWORK OUTLOOK" title="60-minute traffic simulation" description="Explore how road queues and congestion may change over the next hour." action={<button className="utility" onClick={() => load(scenario)} disabled={busy}><RefreshCw size={15}/> Refresh outlook</button>}/>
    <section className="city-studio-toolbar">
      <div><span className="studio-kicker">SCENARIO</span><h2>{scenarioLabels[scenario]}</h2><p>13 forecast frames · five-minute intervals</p></div>
      <div className="studio-toolbar-controls"><label>Traffic scenario<select value={scenario} onChange={(event) => { setScenario(event.target.value); load(event.target.value); }}><option value="baseline">Current pattern</option><option value="demand_surge">Higher demand</option><option value="signal_priority">Signal priority what-if</option></select></label><button className="studio-primary" onClick={() => load(scenario)} disabled={busy}>{busy ? 'Updating…' : 'Run 60-minute outlook'}</button></div>
    </section>
    {error && <div className="studio-error"><AlertTriangle size={16}/><span>{error}</span><button onClick={() => load(scenario)}>Retry</button></div>}
    {busy && !result && <div className="studio-loading"><div className="studio-loader"/><div><b>Preparing the road outlook</b><span>Loading network conditions and forecast frames…</span></div></div>}
    {result && <>
      <div className="city-stats-grid">
        <Metric icon={Activity} label="Network queue" value={number(frame?.queue_total)} detail="Vehicles expected to be halted" tone="primary"/>
        <Metric icon={AlertTriangle} label="Heavy corridors" value={number(frame?.heavy_roads)} detail={`${number(frame?.moderate_roads)} moderate at this step`}/>
        <Metric icon={Route} label="Clear corridors" value={number(frame?.free_roads)} detail={`${number(frame?.roads?.length)} mapped model segments`}/>
        <Metric icon={CarFront} label="Traffic volume" value={number(frame?.vehicles)} detail="Reference network estimate"/>
      </div>
      <section className="studio-main-grid">
        <div className="studio-scene-card">
          <div className="studio-card-head"><div><span className="studio-kicker">ROAD NETWORK</span><h2>Traffic flow playback</h2><p>{loadedAt ? `Updated ${loadedAt.toLocaleTimeString()}` : 'Forecast playback'}</p></div><span className="studio-mode-pill">{playing ? 'PLAYING' : 'PAUSED'} · {Number(frame?.minute || 0)} MIN</span></div>
          <TrafficSimulationScene roads={roads} frame={frame} playing={playing} areaName="80-segment reference network" modelForecast networkGeometry={result.network_geometry}/>
          <div className="studio-playback"><div className="studio-playback-row"><div><span>FORECAST TIME</span><b>{String(Math.floor(Number(frame?.minute || 0))).padStart(2, '0')}:00 <small>/ 60:00</small></b></div><button className="studio-play" onClick={() => setPlaying((value) => !value)}>{playing ? <Pause size={15}/> : <Play size={15}/>} {playing ? 'Pause' : 'Play'}</button></div><input aria-label="Forecast time" type="range" min="0" max={timeline.length - 1} value={index} onChange={(event) => { setIndex(Number(event.target.value)); setPlaying(false); }}/><div className="studio-time-labels"><span>Now</span><span>15 min</span><span>30 min</span><span>45 min</span><span>60 min</span></div></div>
        </div>
        <aside className="studio-side-stack">
          <section className="studio-card"><div className="studio-card-head"><div><span className="studio-kicker">ROAD CONDITIONS</span><h2>Most affected roads</h2></div><Route size={18}/></div><div className="studio-road-list">{topRoads.map((road) => <div className="studio-road-row" key={road.road}><div><b>{road.road}</b><small>{number(road.vehicles)} vehicles · {number(road.queue)} queue</small></div><span className={`studio-level ${String(road.level || '').toLowerCase()}`}>{road.level || '—'}</span></div>)}</div></section>
          <section className="studio-card studio-insight-card"><span className="studio-kicker">60-MINUTE OUTLOOK</span><h2>{number(summary.queue_end)} projected queue</h2><div className="studio-insight-value">{Number(summary.queue_change_percent) > 0 ? <TrendingUp size={18}/> : <TrendingDown size={18}/>} {number(summary.queue_change_percent, '%')} across the forecast horizon</div><p>This is a modelled reference-network outlook, not live city telemetry or a vehicle-by-vehicle run.</p></section>
        </aside>
      </section>
      <section className="studio-card studio-provenance"><div><span className="studio-kicker">DATA CONTEXT</span><h2>Forecast, not a live measurement</h2><p>Forecast frames are built from historical reference-network patterns. The moving markers illustrate traffic flow and are not individually tracked vehicles. Use Signal Plan Studio for timing sensitivity comparisons, or Digital Twin for detailed vehicle-level runs when available.</p></div><div className="studio-crosslinks"><a href="/authority/signal-plans">Signal Plan Studio</a><a href="/authority/digital-twin">Digital Twin</a></div></section>
    </>}
  </div>;
}
