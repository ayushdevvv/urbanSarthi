import { useMemo, useState } from 'react';
import { Activity, ArrowDownRight, ArrowUpRight, CarFront, Download, Leaf, RefreshCw, Sparkles, Truck, Bus, Bike } from 'lucide-react';
import PageIntro from '../../components/shared/PageIntro.jsx';
import { api } from '../../services/api/client.js';
import { useApp } from '../../context/AppContext.jsx';
import { readLatestVisionEvidence } from '../../services/visionEvidence.js';
import './monitoring-pages.css';

const VEHICLES = [
  { key: 'car', label: 'Cars', icon: CarFront }, { key: 'motorbike', label: 'Motorcycles', icon: Bike },
  { key: 'bus', label: 'Buses', icon: Bus }, { key: 'truck', label: 'Trucks', icon: Truck },
  { key: 'bicycle', label: 'Bicycles', icon: Bike },
];
const fmt = (value, digits = 2) => value == null || !Number.isFinite(Number(value)) ? '—' : Number(value).toLocaleString(undefined, { maximumFractionDigits: digits });
function readEvidence() { return readLatestVisionEvidence(); }
function CarbonBar({ label, value, max, unit = 'g' }) { const pct = max > 0 ? Math.max(0, Math.min(100, Number(value || 0) / max * 100)) : 0; return <div className="carbon-bar-row"><div><span>{label}</span><b>{fmt(value)} {unit}</b></div><div className="carbon-bar-track"><i style={{ width: `${pct}%` }}/></div></div>; }
export default function CarbonImpactPage() {
  const { notify } = useApp();
  const [counts, setCounts] = useState(() => { const evidence = readEvidence(); return { car: String(evidence?.counts?.car || 0), motorbike: String(evidence?.counts?.motorbike || 0), bus: String(evidence?.counts?.bus || 0), truck: String(evidence?.counts?.truck || 0), bicycle: String(evidence?.counts?.bicycle || 0) }; });
  const [distance, setDistance] = useState('0.5');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [evidence] = useState(readEvidence);
  const total = useMemo(() => Object.values(counts).reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0), [counts]);
  const emissions = result?.totals || {};
  const barMax = Math.max(1, ...['co2_g', 'nox_g', 'pm_g', 'co_g'].map((key) => Number(emissions[key] || 0)));
  async function importLatest() {
    const latest = readEvidence();
    if (!latest?.counts) { notify('Run a road video analysis first.'); return; }
    setCounts({ car: String(latest.counts.car || 0), motorbike: String(latest.counts.motorbike || 0), bus: String(latest.counts.bus || 0), truck: String(latest.counts.truck || 0), bicycle: String(latest.counts.bicycle || 0) });
    notify('Latest vehicle counts imported.');
  }
  async function estimate() {
    setBusy(true);
    try {
      const data = await api.post('/air-intelligence/emissions/estimate', { vehicle_counts: Object.fromEntries(Object.entries(counts).map(([key, value]) => [key, Math.max(0, Number(value) || 0)])), segment_distance_km: Math.max(0.001, Number(distance) || 0.5) });
      setResult(data); notify('Emission estimate calculated.');
    } catch (error) { notify(error.message || 'Could not calculate emissions.'); }
    finally { setBusy(false); }
  }
  function download() {
    if (!result) return;
    const blob = new Blob([JSON.stringify({ project: 'UrbanSaarthi | Air Quality & Traffic Intelligence', generated_at: new Date().toISOString(), estimate: result, note: 'Indicative tailpipe estimates. Not direct ambient measurements or a complete emissions inventory.' }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'emissions-report.json'; a.click(); URL.revokeObjectURL(url);
  }
  return <main className="monitor-page carbon-page">
    <PageIntro eyebrow="ENVIRONMENTAL IMPACT" title="Carbon & emissions" description="Translate observed road activity into pollutant-specific tailpipe estimates and an understandable impact report." action={<button className="monitor-button" onClick={importLatest}><RefreshCw size={14}/>Import latest video counts</button>} />
    <section className="carbon-hero"><div className="carbon-hero-copy"><span className="monitor-overline"><Leaf size={14}/> CLEANER MOBILITY · MEASURABLE IMPACT</span><h2>Make the cost of congestion<br/><em>visible in the air.</em></h2><p>Estimate emissions from the vehicle mix observed on a road segment. Keep carbon and local air pollutants visible side by side.</p><div className="carbon-hero-tags"><span>CO₂ footprint</span><span>NOx & particulate matter</span><span>Vehicle-class breakdown</span></div></div><div className="carbon-hero-art"><div className="carbon-ring ring-one"/><div className="carbon-ring ring-two"/><div className="carbon-leaf"><Leaf size={34}/></div><span className="carbon-float float-one">CO₂</span><span className="carbon-float float-two">NOx</span><span className="carbon-float float-three">PM</span></div></section>

    <section className="monitor-grid carbon-workspace"><article className="monitor-panel emissions-input-panel"><div className="monitor-panel-heading"><div><span className="monitor-kicker">OBSERVED VEHICLE MIX</span><h3>Build an estimate</h3><p>Use counts from video analysis or enter an observed mix.</p></div><span className="monitor-live-badge">{evidence?.captured_at ? 'Latest video available' : 'Manual entry'}</span></div>
      <div className="vehicle-count-grid">{VEHICLES.map(({ key, label, icon: Icon }) => <label className="vehicle-count" key={key}><span><Icon size={16}/>{label}</span><input type="number" min="0" max="100000" value={counts[key]} onChange={(event) => setCounts((old) => ({ ...old, [key]: event.target.value }))}/></label>)}</div>
      <label className="distance-field"><span>Road segment distance</span><div><input type="number" min="0.001" max="100" step="0.1" value={distance} onChange={(event) => setDistance(event.target.value)}/><small>km</small></div></label>
      <div className="estimate-input-foot"><span><b>{total.toLocaleString()}</b> vehicles in the selected sample</span><button className="monitor-primary" onClick={estimate} disabled={busy || total === 0}>{busy ? 'Calculating…' : <><Activity size={15}/> Calculate impact</>}</button></div>
      {evidence?.source_filename && <div className="evidence-chip"><Activity size={13}/> Latest footage: <b>{evidence.source_filename}</b> · {evidence.captured_at ? new Date(evidence.captured_at).toLocaleString() : 'Saved locally'}</div>}
    </article>
    <article className="monitor-panel carbon-result-panel"><div className="monitor-panel-heading"><div><span className="monitor-kicker">ESTIMATED TAILPIPE OUTPUT</span><h3>Emission profile</h3><p>Each gas and particulate estimate is reported separately.</p></div>{result && <button className="monitor-icon-button" onClick={download} title="Download report"><Download size={16}/></button>}</div>
      {result ? <><div className="carbon-total-block"><div><small>ESTIMATED CO₂</small><strong>{fmt(emissions.co2_g)} <em>g</em></strong><span>{fmt(result.vehicle_km, 2)} vehicle-km · {result.segment_distance_km} km segment</span></div><div className="carbon-total-symbol"><Leaf size={23}/></div></div><div className="carbon-bars">{[['CO₂', emissions.co2_g], ['NOx', emissions.nox_g], ['PM', emissions.pm_g], ['CO', emissions.co_g]].map(([label, value]) => <CarbonBar key={label} label={label} value={value} max={barMax}/>)}</div><div className="carbon-class-breakdown">{Object.entries(result.by_class || {}).map(([key, item]) => <div key={key}><span>{key.replaceAll('_', ' ')}</span><b>{fmt(item?.co2_g)} g CO₂</b></div>)}</div></> : <div className="monitor-empty carbon-empty"><Leaf size={25}/><b>Your impact profile will appear here</b><span>Enter a vehicle mix and run the estimate to see CO₂, NOx, PM and CO.</span></div>}
    </article></section>
    <section className="carbon-caveats"><Sparkles size={16}/><div><b>How to read this estimate</b><p>These are indicative tailpipe estimates based on the project's documented emission factors and distance assumptions. They are not measured ambient concentrations, official AQI values, or a complete emissions inventory. Non-exhaust dust and atmospheric chemistry are not included.</p></div></section>
  </main>;
}
