import { useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, Camera, CheckCircle2, Cloud, ImagePlus, LoaderCircle, ScanSearch, ShieldAlert, Wind } from 'lucide-react';
import PageIntro from '../../components/shared/PageIntro.jsx';
import { api } from '../../services/api/client.js';
import './aqi-vision.css';

const initialReadings = { pm25: '', pm10: '', temperature: '', humidity: '', season: 'Winter', day_or_night: 'Day' };

function ImageInput({ label, hint, value, onChange, preview, id }) {
  return <label className="vision-image-drop" htmlFor={id}>
    {preview ? <img src={preview} alt={`${label} preview`} /> : <span className="vision-image-placeholder"><ImagePlus size={25}/></span>}
    <span className="vision-image-copy"><b>{value?.name || label}</b><small>{value ? `${(value.size / 1024 / 1024).toFixed(2)} MB · ready` : hint}</small></span>
    <span className="vision-image-action"><Camera size={15}/>{value ? 'Change image' : 'Add image'}</span>
    <input id={id} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(event) => onChange(event.target.files?.[0] || null)} />
  </label>;
}

export default function AqiVisionPage() {
  const [readings, setReadings] = useState(initialReadings);
  const [front, setFront] = useState(null);
  const [rear, setRear] = useState(null);
  const [frontPreview, setFrontPreview] = useState('');
  const [rearPreview, setRearPreview] = useState('');
  const [modelStatus, setModelStatus] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    api.get('/aqi-vision/status', { fallbackGraceMs: 0 }).then((status) => { if (active) setModelStatus(status); }).catch(() => { if (active) setModelStatus({ ready: false, note: 'Model status could not be reached.' }); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!front) { setFrontPreview(''); return undefined; }
    const url = URL.createObjectURL(front); setFrontPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [front]);
  useEffect(() => {
    if (!rear) { setRearPreview(''); return undefined; }
    const url = URL.createObjectURL(rear); setRearPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [rear]);

  const canSubmit = useMemo(() => Boolean(front && rear && ['pm25', 'pm10', 'temperature', 'humidity'].every((key) => readings[key] !== '' && Number.isFinite(Number(readings[key])))), [front, rear, readings]);

  async function analyze(event) {
    event.preventDefault(); setError(''); setResult(null);
    if (!front || !rear) { setError('Add both a front and rear roadside image.'); return; }
    setLoading(true);
    const form = new FormData();
    form.append('front_image', front); form.append('rear_image', rear);
    Object.entries(readings).forEach(([key, value]) => form.append(key, value));
    try {
      const payload = await api.postForm('/aqi-vision/analyze', form, { timeoutMs: 120000 });
      setResult(payload);
    } catch (err) { setError(err?.message || 'AQI Vision could not complete inference.'); }
    finally { setLoading(false); }
  }

  return <div className="aqi-vision-page">
    <PageIntro eyebrow="MULTIMODAL AIR INTELLIGENCE" title="AQI Vision" description="Combine two roadside views with current sensor readings to estimate an air-quality category." action={<span className={`vision-model-status ${modelStatus?.ready ? 'ready' : 'offline'}`}><i/>{modelStatus?.ready ? 'Model ready' : 'Model unavailable'}</span>} />
    <div className="vision-model-note"><Activity size={16}/><span><b>Model output, not a station reading.</b> The model predicts a category from supplied images and measurements. It does not produce an official CPCB AQI value.</span></div>
    <form className="vision-workspace" onSubmit={analyze}>
      <section className="panel vision-panel">
        <div className="vision-panel-head"><span className="vision-step">01</span><div><h3>Roadside imagery</h3><p>Capture or upload clear views from the same area, close in time.</p></div></div>
        <div className="vision-image-grid">
          <ImageInput id="vision-front" label="Front road view" hint="JPG, PNG or WebP · max 8 MB" value={front} onChange={setFront} preview={frontPreview}/>
          <ImageInput id="vision-rear" label="Rear road view" hint="JPG, PNG or WebP · max 8 MB" value={rear} onChange={setRear} preview={rearPreview}/>
        </div>
      </section>
      <section className="panel vision-panel">
        <div className="vision-panel-head"><span className="vision-step">02</span><div><h3>Current environment</h3><p>Enter readings from a connected sensor or a calibrated handheld monitor.</p></div></div>
        <div className="vision-reading-grid">
          <label>PM2.5 <span>µg/m³</span><input type="number" min="0" max="2000" step="0.1" required value={readings.pm25} onChange={(e) => setReadings({ ...readings, pm25: e.target.value })} placeholder="Required"/></label>
          <label>PM10 <span>µg/m³</span><input type="number" min="0" max="2000" step="0.1" required value={readings.pm10} onChange={(e) => setReadings({ ...readings, pm10: e.target.value })} placeholder="Required"/></label>
          <label>Temperature <span>°C</span><input type="number" min="-50" max="70" step="0.1" required value={readings.temperature} onChange={(e) => setReadings({ ...readings, temperature: e.target.value })} placeholder="Required"/></label>
          <label>Humidity <span>%</span><input type="number" min="0" max="100" step="0.1" required value={readings.humidity} onChange={(e) => setReadings({ ...readings, humidity: e.target.value })} placeholder="Required"/></label>
          <label>Season<select value={readings.season} onChange={(e) => setReadings({ ...readings, season: e.target.value })}><option>Winter</option><option>Summer</option><option>Monsoon</option></select></label>
          <label>Time of day<select value={readings.day_or_night} onChange={(e) => setReadings({ ...readings, day_or_night: e.target.value })}><option>Day</option><option>Night</option></select></label>
        </div>
      </section>
      {error && <div className="vision-error"><AlertTriangle size={16}/>{error}</div>}
      <div className="vision-submit-row"><span><ShieldAlert size={15}/> Inputs are processed for inference and are not published as a public station observation.</span><button className="primary" type="submit" disabled={!canSubmit || loading || modelStatus?.ready === false}>{loading ? <><LoaderCircle className="spin" size={16}/> Analysing images</> : <><ScanSearch size={16}/> Analyse air quality</>}</button></div>
    </form>
    {result && <section className="panel vision-result" aria-live="polite">
      <div className="vision-result-icon"><Wind size={22}/></div><div className="vision-result-main"><span className="eyebrow">MODEL CLASSIFICATION</span><h3>{result.predicted_category}</h3><p>{result.note}</p></div>
      <div className="vision-confidence"><strong>{Number(result.confidence).toFixed(1)}%</strong><span>Model confidence</span></div>
      {Array.isArray(result.probabilities) && <div className="vision-probabilities">{result.probabilities.map((item) => <div key={item.category}><span>{item.category}</span><div><i style={{ width: `${Math.max(0, Math.min(100, Number(item.probability) || 0))}%` }}/></div><b>{Number(item.probability).toFixed(1)}%</b></div>)}</div>}
      <div className="vision-result-foot"><CheckCircle2 size={15}/> Inference completed {result.generated_at ? new Date(result.generated_at).toLocaleString() : 'just now'} · model prediction only</div>
    </section>}
    {!modelStatus?.ready && <section className="vision-setup"><Cloud size={17}/><div><b>AQI Vision model needs setup</b><span>{modelStatus?.note || 'The server model and dependencies are not ready. The feature will activate when its model bundle is available.'}</span></div></section>}
  </div>;
}
