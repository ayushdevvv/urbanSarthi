import { useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, CarFront, Clock3, Gauge, Pause, Play, RefreshCw, Route, Sparkles } from 'lucide-react';
import { api } from '../../services/api/client.js';
import TrafficSimulationScene from './TrafficSimulationScene.jsx';
import './traffic-simulation-page.css';
import './premium-operations.css';

const fmt = (n, suffix = '') => n === null || n === undefined ? '—' : `${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 1 })}${suffix}`;

export default function TrafficSimulationPage() {
  const [scenario, setScenario] = useState('baseline');
  const [result, setResult] = useState(null);
  const [minuteIndex, setMinuteIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loadedAt, setLoadedAt] = useState('');
  const timeline = result?.timeline || [];
  const frame = timeline[Math.min(minuteIndex, Math.max(0, timeline.length - 1))] || null;
  const summary = result?.summary || {};
  const roads = frame?.roads || [];
  const topRoads = useMemo(() => [...roads].sort((a, b) => Number(b.queue || 0) - Number(a.queue || 0)).slice(0, 6), [roads]);

  async function loadScenario(nextScenario = scenario) {
    setBusy(true); setError(''); setPlaying(false);
    try {
      const data = await api.get(`/traffic/simulation/scenario?minutes=60&step_minutes=5&scenario=${encodeURIComponent(nextScenario)}`, { timeoutMs: 65000, fallbackGraceMs: 0 });
      if (!Array.isArray(data?.timeline) || !data.timeline.length) throw new Error('The 60-minute model did not return a usable timeline.');
      setResult(data); setMinuteIndex(0); setLoadedAt(new Date().toLocaleTimeString());
    } catch (err) { setError(err?.message || 'The 60-minute forecast could not be loaded.'); }
    finally { setBusy(false); }
  }

  useEffect(() => { loadScenario('baseline'); }, []);
  useEffect(() => {
    if (!playing || timeline.length < 2) return undefined;
    const timer = window.setInterval(() => setMinuteIndex((v) => {
      if (v >= timeline.length - 1) { setPlaying(false); return v; }
      return v + 1;
    }), 950);
    return () => window.clearInterval(timer);
  }, [playing, timeline.length]);

  return <main className="ops-screen ops-forecast-screen">
    <header className="ops-page-head">
      <div><span className="ops-eyebrow">CITY FLOW / 60 MINUTE OUTLOOK</span><h2>Traffic simulation</h2><p>Explore how congestion may evolve across the reference road network over the next hour.</p></div>
      <div className="ops-head-actions"><span className="ops-state"><i/>{result ? 'Forecast ready' : busy ? 'Preparing forecast' : 'Model status'}</span><button className="ops-button secondary" onClick={() => loadScenario()} disabled={busy}><RefreshCw size={15}/> Refresh</button></div>
    </header>
    <section className="ops-controls-bar">
      <div><span>WHAT-IF SCENARIO</span><select value={scenario} onChange={(e) => { setScenario(e.target.value); loadScenario(e.target.value); }} disabled={busy}><option value="baseline">Typical demand</option><option value="demand_surge">Demand surge</option><option value="signal_priority">Signal-priority sensitivity</option></select></div>
      <div className="ops-context"><Sparkles size={16}/><span>60-minute forecast · 5-minute intervals · reference network</span></div>
      <button className="ops-button primary" onClick={() => loadScenario()} disabled={busy}>{busy ? <span className="ops-loader"/> : <Play size={15}/>} {busy ? 'Updating' : 'Run forecast'}</button>
    </section>
    {error && <div className="ops-alert"><AlertTriangle size={16}/>{error}</div>}
    {busy && !result && <div className="ops-loading-grid"><div className="ops-skeleton scene"/><div className="ops-skeleton"/><div className="ops-skeleton"/><div className="ops-skeleton"/></div>}
    {result && <>
      <section className="ops-kpi-grid">
        <article><span><Activity size={16}/> Queue at +60 min</span><b>{fmt(summary.queue_end)}</b><small>Modelled halted vehicles</small></article>
        <article><span><Route size={16}/> Heavy roads</span><b>{fmt(summary.heavy_roads_end)}</b><small>Forecast road classification</small></article>
        <article><span><CarFront size={16}/> Network vehicles</span><b>{fmt(frame?.vehicles)}</b><small>Reference model input volume</small></article>
        <article><span><Gauge size={16}/> Model confidence</span><b>{fmt(result.models?.horizon_60?.level_accuracy_percent, '%')}</b><small>Held-out 60-minute level accuracy</small></article>
      </section>
      <div className="ops-simulation-layout">
        <section className="ops-map-card">
          <div className="ops-card-head"><div><span>NETWORK DIGITAL VIEW</span><h3>Road conditions</h3></div><span className="ops-live-label"><i/>{playing ? 'PLAYING' : 'PAUSED'} · {frame?.minute ?? 0} MIN</span></div>
          <TrafficSimulationScene roads={roads} frame={frame} playing={playing} areaName="Delhi reference road network" modelForecast networkGeometry={result.network_geometry}/>
          <div className="ops-playback"><div><b>Playback</b><span>Minute {frame?.minute ?? 0} / 60</span></div><button className="ops-icon-button" onClick={() => setPlaying((v) => !v)} disabled={timeline.length < 2}>{playing ? <Pause size={16}/> : <Play size={16}/>}</button><input aria-label="Forecast minute" type="range" min="0" max={Math.max(0, timeline.length - 1)} value={minuteIndex} onChange={(e) => { setMinuteIndex(Number(e.target.value)); setPlaying(false); }}/><div className="ops-time-scale"><span>Now</span><span>+30 min</span><span>+60 min</span></div></div>
        </section>
        <aside className="ops-side-stack">
          <section className="ops-data-card"><div className="ops-card-head"><div><span>ROAD HOTSPOTS</span><h3>Highest predicted queues</h3></div><Route size={17}/></div>{topRoads.length ? topRoads.map((road) => <div className="ops-road-row" key={road.road}><div><b>{road.road}</b><small>{road.vehicles ?? '—'} vehicles · queue {fmt(road.queue)}</small></div><span className={`ops-road-pill ${String(road.level || '').toLowerCase()}`}>{road.level || 'Unknown'}</span></div>) : <p className="ops-empty-copy">No road values for this frame.</p>}</section>
          <section className="ops-data-card ops-signal-card"><div className="ops-card-head"><div><span>SCENARIO SUMMARY</span><h3>Network outlook</h3></div><Gauge size={17}/></div><div className="ops-summary-row"><span>Queue change</span><b>{fmt(summary.queue_change_percent, '%')}</b></div><div className="ops-summary-row"><span>Road segments</span><b>{fmt(summary.road_count)}</b></div><div className="ops-summary-row"><span>Last updated</span><b>{loadedAt || '—'}</b></div><small className="ops-disclaimer">Forecast values are modelled. Flow markers illustrate road movement and are not live vehicle tracking.</small></section>
        </aside>
      </div>
    </>}
  </main>;
}
