import { useMemo, useState } from 'react';
import { Activity, ArrowDownRight, ArrowUpRight, BadgeCheck, BarChart3, Clock3, Gauge, Play, RotateCcw, Save, ShieldCheck, SlidersHorizontal, Sparkles, TrafficCone, Zap } from 'lucide-react';
import PageIntro from '../../components/shared/PageIntro.jsx';
import { api } from '../../services/api/client.js';
import './traffic-lab.css';

const DEFAULTS = { north_south_green_seconds: 34, east_west_green_seconds: 22, yellow_seconds: 3, all_red_seconds: 1, demand_factor: 1, duration_minutes: 60 };
const DEMAND_OPTIONS = [
  { label: 'Light', factor: 0.7, detail: 'Off-peak movement' },
  { label: 'Typical', factor: 1, detail: 'Normal city flow' },
  { label: 'Peak', factor: 1.45, detail: 'Rush-hour demand' },
  { label: 'Surge', factor: 1.8, detail: 'Event or incident load' },
];
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

function localEstimate(settings) {
  const baseStart = 684;
  const baseEnd = 1018;
  const green = settings.north_south_green_seconds + settings.east_west_green_seconds;
  const ratio = settings.north_south_green_seconds / Math.max(green, 1);
  const clearance = settings.yellow_seconds * 2 + settings.all_red_seconds * 2;
  const signalFactor = clamp(Math.pow(64 / Math.max(green + clearance, 1), 0.45) * (1 + 0.65 * Math.abs(ratio - 34 / 56)), 0.62, 1.48);
  const factor = signalFactor * settings.demand_factor;
  const end = Math.max(0, Math.round(baseStart + (baseEnd - baseStart) * factor));
  const roads = Array.from({ length: 8 }, (_, i) => ({ road: ['Ring Road · west', 'Central junction', 'ITO approach', 'NH-48 connector', 'Outer Ring Road', 'Janpath corridor', 'Airport Road', 'Old Delhi approach'][i], queue: Math.round((32 + i * 5) * factor), level: (32 + i * 5) * factor >= 55 ? 'Heavy' : (32 + i * 5) * factor >= 28 ? 'Moderate' : 'Free', vehicles: 70 + i * 8 }));
  const timeline = Array.from({ length: 13 }, (_, i) => ({ minute: i * 5, queue_total: Math.round(baseStart + (end - baseStart) * i / 12), heavy_roads: roads.filter(r => r.level === 'Heavy').length, roads: roads.map(r => ({ ...r, queue: Math.round(r.queue * i / 12) })) }));
  return { mode: 'demo_estimate', engine: 'Local illustrative sensitivity estimate', fresh_sumo_run: false, physical_signal_control: false, assumptions: { ...settings, signal_sensitivity_factor: Number(signalFactor.toFixed(3)), combined_impact_factor: Number(factor.toFixed(3)) }, baseline: { queue_start: baseStart, queue_end: baseEnd, average_wait_seconds_estimate: 26.0, throughput_index: 840, heavy_roads_end: 5 }, proposed: { queue_start: baseStart, queue_end: end, queue_change_percent: Number(((end - baseEnd) / baseEnd * 100).toFixed(1)), average_wait_seconds_estimate: Number((12 + end / 8 * 1.1).toFixed(1)), throughput_index: Math.round(840 / Math.max(factor, .25)), heavy_roads_end: roads.filter(r => r.level === 'Heavy').length }, timeline, baseline_timeline: timeline.map((f, i) => ({ ...f, queue_total: Math.round(baseStart + (baseEnd - baseStart) * i / 12) })), notes: ['Demo estimate only: the traffic API could not be reached.', 'The queue response is an illustrative sensitivity estimate and is not validated SUMO output or field measurement.'] };
}

const metric = (n) => Number(n ?? 0).toLocaleString('en-IN');
const seconds = (n) => `${n}s`;

export default function TrafficLabPage() {
  const [settings, setSettings] = useState(DEFAULTS);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [activePhase, setActivePhase] = useState('north_south');

  const timeline = result?.timeline || [];
  const current = timeline[Math.min(frame, Math.max(timeline.length - 1, 0))];
  const maximum = Math.max(1, ...(timeline.map(item => Number(item.queue_total) || 0)));
  const chartPoints = useMemo(() => timeline.map((item, i) => `${timeline.length <= 1 ? 0 : i / (timeline.length - 1) * 100},${100 - (Number(item.queue_total || 0) / maximum) * 86}`).join(' '), [timeline, maximum]);

  function update(key, value) {
    setSettings(old => ({ ...old, [key]: value }));
    setSaved(false);
  }

  async function runSimulation() {
    setBusy(true); setError(''); setSaved(false); setPlaying(false); setFrame(0);
    try {
      const data = await api.post('/traffic/simulation/what-if', settings);
      setResult(data);
    } catch (err) {
      setResult(localEstimate(settings));
      setError(`${err?.message || 'Traffic simulation service is unavailable.'} A clearly labelled local estimate is shown instead.`);
    } finally { setBusy(false); }
  }

  function applySuggested() {
    const suggestions = settings.demand_factor >= 1.4
      ? { north_south_green_seconds: 40, east_west_green_seconds: 30, yellow_seconds: 3, all_red_seconds: 1 }
      : settings.demand_factor <= .8
        ? { north_south_green_seconds: 28, east_west_green_seconds: 18, yellow_seconds: 3, all_red_seconds: 1 }
        : { north_south_green_seconds: 36, east_west_green_seconds: 24, yellow_seconds: 3, all_red_seconds: 1 };
    setSettings(old => ({ ...old, ...suggestions })); setSaved(false); setError('');
  }

  function saveScenario() {
    try {
      const item = { id: `scenario-${Date.now()}`, name: `Signal study ${new Date().toLocaleString()}`, settings, saved_at: new Date().toISOString() };
      const old = JSON.parse(localStorage.getItem('urbansaarthi.trafficLab.scenarios') || '[]');
      localStorage.setItem('urbansaarthi.trafficLab.scenarios', JSON.stringify([item, ...old].slice(0, 20)));
      setSaved(true);
    } catch { setError('Scenario could not be saved in this browser session.'); }
  }

  function reset() { setSettings(DEFAULTS); setResult(null); setError(''); setFrame(0); setPlaying(false); setSaved(false); }

  return <div className="traffic-lab-page">
    <PageIntro eyebrow="NETWORK OPERATIONS / CONTROL LAB" title="Traffic Lab" description="Change intersection timings, define traffic demand, and compare a proposed signal strategy with the baseline forecast." action={<span className="lab-status-pill"><i /> Scenario workspace</span>} />

    <div className="lab-command-strip">
      <div className="lab-command-icon"><TrafficCone size={21}/></div>
      <div><b>Signal strategy workbench</b><span>One connected workflow for signal settings and what-if analysis.</span></div>
      <div className="lab-strip-meta"><span><ShieldCheck size={14}/> Read-only control</span><span><Activity size={14}/> {result ? 'Results ready' : 'Awaiting run'}</span></div>
    </div>

    <div className="lab-main-grid">
      <section className="panel lab-settings-panel">
        <div className="lab-panel-heading"><div><span className="lab-eyebrow">01 / CONFIGURE</span><h2>Intersection settings</h2><p>Set phase durations and model the traffic load.</p></div><span className="lab-heading-icon"><SlidersHorizontal size={19}/></span></div>
        <div className="lab-intersection-preview">
          <div className="lab-road horizontal"/><div className="lab-road vertical"/><div className="lab-lane h1"/><div className="lab-lane h2"/><div className="lab-lane v1"/><div className="lab-lane v2"/>
          <div className="lab-crosswalk cw-top"/><div className="lab-crosswalk cw-bottom"/><div className="lab-light north-light"><i className={activePhase === 'north_south' ? 'green' : 'red'}/><i className="yellow"/><i className={activePhase === 'north_south' ? 'red' : 'green'}/></div><div className="lab-light east-light"><i className={activePhase === 'north_south' ? 'red' : 'green'}/><i className="yellow"/><i className={activePhase === 'north_south' ? 'green' : 'red'}/></div>
          <span className="lab-compass n">N</span><span className="lab-compass s">S</span><span className="lab-compass e">E</span><span className="lab-compass w">W</span>
          <span className="lab-timing-label north-timing">N/S {seconds(settings.north_south_green_seconds)}</span><span className="lab-timing-label east-timing">E/W {seconds(settings.east_west_green_seconds)}</span>
          <span className="lab-car car-a"/><span className="lab-car car-b"/><span className="lab-car car-c"/><span className="lab-car car-d"/>
        </div>
        <div className="lab-phase-tabs"><button className={activePhase === 'north_south' ? 'active' : ''} onClick={() => setActivePhase('north_south')}><i className="phase-dot green-dot"/>North ↕ South<span>{seconds(settings.north_south_green_seconds)}</span></button><button className={activePhase === 'east_west' ? 'active' : ''} onClick={() => setActivePhase('east_west')}><i className="phase-dot green-dot"/>East ↔ West<span>{seconds(settings.east_west_green_seconds)}</span></button></div>
        <div className="lab-slider-field"><div className="lab-slider-label"><label htmlFor="lab-ns">North / South green</label><strong>{seconds(settings.north_south_green_seconds)}</strong></div><input id="lab-ns" type="range" min="10" max="90" step="1" value={settings.north_south_green_seconds} onChange={e => update('north_south_green_seconds', Number(e.target.value))}/><div className="lab-range-labels"><span>10 sec</span><span>90 sec</span></div></div>
        <div className="lab-slider-field"><div className="lab-slider-label"><label htmlFor="lab-ew">East / West green</label><strong>{seconds(settings.east_west_green_seconds)}</strong></div><input id="lab-ew" type="range" min="10" max="90" step="1" value={settings.east_west_green_seconds} onChange={e => update('east_west_green_seconds', Number(e.target.value))}/><div className="lab-range-labels"><span>10 sec</span><span>90 sec</span></div></div>
        <div className="lab-compact-fields"><label>Yellow phase<select value={settings.yellow_seconds} onChange={e => update('yellow_seconds', Number(e.target.value))}>{[2,3,4,5,6,7,8].map(v => <option key={v} value={v}>{v} seconds</option>)}</select></label><label>All-red clearance<select value={settings.all_red_seconds} onChange={e => update('all_red_seconds', Number(e.target.value))}>{[0,1,2,3,4,5].map(v => <option key={v} value={v}>{v} seconds</option>)}</select></label></div>
        <div className="lab-demand-heading"><div><label>Traffic demand</label><small>Choose a scenario to test expected load.</small></div><span>{settings.demand_factor.toFixed(2)}×</span></div>
        <div className="lab-demand-options">{DEMAND_OPTIONS.map(o => <button key={o.label} className={settings.demand_factor === o.factor ? 'selected' : ''} onClick={() => update('demand_factor', o.factor)}><b>{o.label}</b><small>{o.detail}</small><span>{o.factor.toFixed(2)}×</span></button>)}</div>
        <div className="lab-duration-row"><label htmlFor="lab-duration">Forecast duration</label><div><select id="lab-duration" value={settings.duration_minutes} onChange={e => update('duration_minutes', Number(e.target.value))}><option value={15}>15 minutes</option><option value={30}>30 minutes</option><option value={45}>45 minutes</option><option value={60}>60 minutes</option></select></div></div>
        <div className="lab-actions"><button className="lab-primary-btn" onClick={runSimulation} disabled={busy}><Play size={16} fill="currentColor"/>{busy ? 'Running scenario…' : 'Run what-if simulation'}</button><button className="lab-ghost-btn" onClick={applySuggested}><Sparkles size={15}/> Suggested timings</button><button className="lab-icon-btn" onClick={reset} title="Reset to baseline" aria-label="Reset to baseline"><RotateCcw size={16}/></button></div>
        <div className="lab-safety-note"><ShieldCheck size={16}/><span>Analysis only. No command is sent to physical traffic signals.</span></div>
      </section>

      <div className="lab-results-column">
        {error && <div className={`lab-alert ${result?.mode === 'demo_estimate' ? 'warning' : ''}`}><Activity size={16}/><span>{error}</span></div>}
        <section className="panel lab-scene-panel">
          <div className="lab-panel-heading"><div><span className="lab-eyebrow">02 / WHAT IF</span><h2>Scenario preview</h2><p>{current ? `Forecast snapshot at minute ${current.minute}` : 'Run a simulation to render the proposed scenario.'}</p></div><span className={`lab-engine-badge ${result?.mode === 'demo_estimate' ? 'demo' : result ? 'ready' : ''}`}><i/>{result?.mode === 'demo_estimate' ? 'Demo estimate' : result ? 'Model results' : 'Ready to run'}</span></div>
          <div className="lab-live-scene"><div className="lab-scene-top"><span><i className="lab-scene-dot"/> Intersection model</span><span>{result ? `${settings.duration_minutes} min horizon` : 'Baseline configuration'}</span></div><div className="lab-scene-grid"><div className="lab-scene-map"><div className="lab-scene-road scene-h"/><div className="lab-scene-road scene-v"/><div className="lab-scene-center"/><div className="lab-stopline top-stop"/><div className="lab-stopline bottom-stop"/><div className="lab-signal scene-ns"><i className={activePhase === 'north_south' ? 'green' : 'red'}/><i/><i/></div><div className="lab-signal scene-ew"><i className={activePhase === 'east_west' ? 'green' : 'red'}/><i/><i/></div>{Array.from({length:8},(_,i)=><span key={i} className={`lab-scene-vehicle vehicle-${i+1}`} style={{animationDuration:`${1.6 + (i%4)*.5}s`}}/>)}<span className="scene-label n">N</span><span className="scene-label s">S</span><span className="scene-label e">E</span><span className="scene-label w">W</span></div><div className="lab-scene-info"><div><small>Active phase</small><b>{activePhase === 'north_south' ? 'North ↕ South' : 'East ↔ West'}</b><span>{seconds(activePhase === 'north_south' ? settings.north_south_green_seconds : settings.east_west_green_seconds)} green window</span></div><div><small>Cycle window</small><b>{settings.north_south_green_seconds + settings.east_west_green_seconds + (settings.yellow_seconds * 2) + (settings.all_red_seconds * 2)} sec</b><span>Including clearances</span></div><button onClick={() => setActivePhase(p => p === 'north_south' ? 'east_west' : 'north_south')}><Zap size={14}/> Toggle phase view</button></div></div></div>
          {current && <div className="lab-playback"><div className="lab-playback-head"><span><Clock3 size={14}/> Forecast playback</span><b>Minute {current.minute}</b></div><input aria-label="Simulation time" type="range" min="0" max={timeline.length - 1} value={frame} onChange={e => { setFrame(Number(e.target.value)); setPlaying(false); }} /><div className="lab-playback-labels"><span>0 min</span><span>{Math.round(settings.duration_minutes / 2)} min</span><span>{settings.duration_minutes} min</span></div><div className="lab-chart"><svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Projected queue trend"><polyline points={chartPoints || '0,70 100,70'} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke"/><line x1="0" x2="100" y1="100" y2="100" stroke="currentColor" opacity=".13"/></svg><div className="lab-chart-markers">{timeline.map((item,i)=><button key={item.minute} className={frame === i ? 'active' : ''} style={{left:`${timeline.length <= 1 ? 0 : i/(timeline.length-1)*100}%`}} onClick={() => setFrame(i)} title={`${item.minute} min • ${metric(item.queue_total)} queued`}/>)}</div></div></div>}
        </section>

        {result ? <>
          <section className="lab-kpi-grid"><div className="panel lab-kpi-card"><span>Projected queue</span><b>{metric(result.proposed?.queue_end)}</b><small>Baseline {metric(result.baseline?.queue_end)} at horizon end</small><em className={(result.proposed?.queue_change_percent ?? 0) <= 0 ? 'good' : 'bad'}>{(result.proposed?.queue_change_percent ?? 0) <= 0 ? <ArrowDownRight size={14}/> : <ArrowUpRight size={14}/>} {Math.abs(result.proposed?.queue_change_percent ?? 0)}% vs baseline</em></div><div className="panel lab-kpi-card"><span>Estimated average wait</span><b>{result.proposed?.average_wait_seconds_estimate ?? '—'}<small>s</small></b><small>Baseline {result.baseline?.average_wait_seconds_estimate ?? '—'}s</small><em>{(result.proposed?.average_wait_seconds_estimate ?? 0) <= (result.baseline?.average_wait_seconds_estimate ?? 0) ? 'Lower wait estimate' : 'Higher wait estimate'}</em></div><div className="panel lab-kpi-card"><span>Throughput index</span><b>{metric(result.proposed?.throughput_index)}</b><small>Baseline index {metric(result.baseline?.throughput_index)}</small><em>Comparative estimate</em></div><div className="panel lab-kpi-card"><span>Heavy road segments</span><b>{result.proposed?.heavy_roads_end ?? '—'}<small>roads</small></b><small>Baseline {result.baseline?.heavy_roads_end ?? '—'} heavy</small><em>At forecast horizon</em></div></section>
          <section className="panel lab-compare-panel"><div className="lab-panel-heading"><div><span className="lab-eyebrow">03 / COMPARE</span><h2>Baseline vs proposed</h2><p>See how this configuration shifts the forecast.</p></div><button className="lab-ghost-btn" onClick={saveScenario}><Save size={15}/>{saved ? 'Saved' : 'Save scenario'}</button></div><div className="lab-compare-row"><div><span>Baseline</span><b>{metric(result.baseline?.queue_end)}</b><small>Queued vehicles index</small></div><div className="lab-compare-track"><i style={{width:`${Math.min(100,(Number(result.baseline?.queue_end||0)/Math.max(result.baseline?.queue_end||0,result.proposed?.queue_end||0,1))*100)}%`}}/><i className="proposed" style={{width:`${Math.min(100,(Number(result.proposed?.queue_end||0)/Math.max(result.baseline?.queue_end||0,result.proposed?.queue_end||0,1))*100)}%`}}/></div><div><span>Proposed</span><b>{metric(result.proposed?.queue_end)}</b><small>{result.assumptions?.combined_impact_factor ?? '—'}× sensitivity factor</small></div></div><div className="lab-assumptions"><BadgeCheck size={16}/><span><b>Scenario assumptions</b><small>{result.engine || 'Illustrative estimate'} · N/S {settings.north_south_green_seconds}s green · E/W {settings.east_west_green_seconds}s green · demand {settings.demand_factor.toFixed(2)}×</small></span><button onClick={() => window.print()}>Print report</button></div><p className="lab-caveat">{result.fresh_sumo_run ? 'A fresh simulation engine run produced this result.' : result.mode === 'demo_estimate' ? 'Demo estimate only. Connect the API to use the saved forecast model.' : 'Uses the trained SUMO-generated traffic forecast plus a timing sensitivity layer. It is not a fresh microscopic SUMO run, calibrated delay measurement, or physical signal-control command.'}</p></section>
        </> : <section className="panel lab-empty-results"><div className="lab-empty-icon"><BarChart3 size={24}/></div><div><b>Your experiment results will appear here</b><p>Adjust the signal phases, choose a traffic-demand profile, then run the scenario to compare queue, waiting-time and throughput indicators.</p></div></section>}
      </div>
    </div>
    <div className="lab-footer-note"><Gauge size={15}/><span>Estimates support planning and prioritisation. Validate timings in SUMO/field trials before operational use.</span></div>
  </div>;
}
