import { useEffect, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, FlaskConical, LocateFixed, MapPin, RotateCcw, Sparkles, Wind } from 'lucide-react';
import PageIntro from '../../components/shared/PageIntro.jsx';
import { api } from '../../services/api/client.js';
import './aqi-vision.css';

const DEFAULT_FORM = { city: '', latitude: '', longitude: '', pm25: '26.1', pm10: '41.0', temperature: '26.9', humidity: '43.5', season: 'Monsoon', day_or_night: 'Day' };
const CATEGORIES = ['Good', 'Satisfactory', 'Moderate', 'Poor', 'Very Poor', 'Severe'];

function exampleResult(form) {
  const pm = Number(form.pm25 || 26);
  const category = pm <= 12 ? 'Good' : pm <= 35 ? 'Satisfactory' : pm <= 55 ? 'Moderate' : pm <= 150 ? 'Poor' : pm <= 250 ? 'Very Poor' : 'Severe';
  const weights = CATEGORIES.map((name) => name === category ? 72 : 28 / 5);
  return { mode: 'sample', predicted_category: category, confidence: 72, probabilities: CATEGORIES.map((category, i) => ({ category, probability: weights[i] })), note: 'Preview estimate based on the entered PM2.5 value. The model service was unavailable, so this is not a trained model prediction.' };
}

export default function AqiVisionPage() {
  const [form, setForm] = useState(DEFAULT_FORM);
  const [locationState, setLocationState] = useState('not-set');
  const [locating, setLocating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [notice, setNotice] = useState('');
  const [modelAvailable, setModelAvailable] = useState(null);
  const [predictionMode, setPredictionMode] = useState('location');
  const [frontImage, setFrontImage] = useState(null);
  const [rearImage, setRearImage] = useState(null);

  useEffect(() => { api.get('/aqi-vision/status').then((s) => setModelAvailable(Boolean(s?.ready))).catch(() => setModelAvailable(false)); }, []);

  const setField = (key, value) => { setForm((old) => ({ ...old, [key]: value })); setResult(null); setNotice(''); };

  const useLocation = () => {
    if (!navigator.geolocation) { setLocationState('unavailable'); setNotice('Location is not supported in this browser. Enter your city manually.'); return; }
    setLocating(true); setNotice('');
    navigator.geolocation.getCurrentPosition(async (position) => {
      const latitude = position.coords.latitude;
      const longitude = position.coords.longitude;
      setForm((old) => ({ ...old, latitude: latitude.toFixed(5), longitude: longitude.toFixed(5) }));
      setLocationState('found');
      try {
        const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}`);
        if (response.ok) {
          const data = await response.json();
          const address = data.address || {};
          const city = address.city || address.town || address.city_district || address.village || address.county || address.state || '';
          if (city) setForm((old) => ({ ...old, city }));
          else setNotice('Coordinates captured. Enter your city name if you want it shown on the report.');
        } else setNotice('Coordinates captured. City lookup is unavailable, so enter your city manually.');
      } catch { setNotice('Coordinates captured. City lookup is unavailable, so enter your city manually.'); }
      finally { setLocating(false); }
    }, () => { setLocating(false); setLocationState('denied'); setNotice('Location permission was not granted. Enter your city manually or try location again.'); }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
  };

  const submit = async (event) => {
    event.preventDefault(); if (busy) return;
    if (predictionMode === 'camera' && (!frontImage || !rearImage)) { setNotice('Select both a front and rear road image to use camera prediction.'); return; }
    setBusy(true); setNotice(''); setResult(null);
    const payload = new FormData();
    for (const key of ['pm25', 'pm10', 'temperature', 'humidity', 'season', 'day_or_night']) payload.append(key, form[key]);
    payload.append('city', form.city || 'City not specified');
    if (form.latitude) payload.append('latitude', form.latitude);
    if (form.longitude) payload.append('longitude', form.longitude);
    try {
      let data;
      if (predictionMode === 'camera') {
        if (!frontImage || !rearImage) throw new Error('Add both a front and rear road image, or switch to location and form prediction.');
        payload.append('front_image', frontImage);
        payload.append('rear_image', rearImage);
        data = await api.postForm('/aqi-vision/analyze', payload);
        data.location = { city: form.city || 'City not specified', latitude: form.latitude || null, longitude: form.longitude || null };
      } else {
        data = await api.postForm('/aqi-vision/predict-form', payload);
      }
      setResult(data);
    } catch (error) {
      setResult(exampleResult(form));
      setNotice(error?.message || 'Showing a clearly marked preview because the model service could not be reached. Your entered values remain in the form.');
    } finally { setBusy(false); }
  };

  const isSample = result?.mode === 'sample';
  return <div className="aqi-vision-page">
    <PageIntro eyebrow="AIR QUALITY · MODEL PREDICTION" title="Predict AQI" description="Enter air and weather readings, detect your city, and generate an air quality category from the supplied model." action={<span className={`traffic-model-pill ${modelAvailable ? 'ready' : 'pending'}`}><span />{modelAvailable ? 'Model available' : 'Prediction ready'}</span>} />
    <div className="aqiv-hero-grid" style={{ gridTemplateColumns: 'minmax(0, 1.1fr) minmax(320px, .9fr)' }}>
      <section className="panel aqiv-input-panel">
        <div className="traffic-panel-heading"><div><span className="traffic-kicker">STEP 01 · YOUR LOCATION</span><h3>Where are you?</h3><p>Use your device location to show the city on your report, or enter it manually.</p></div><MapPin size={22} className="aqiv-heading-icon" /></div>
        <div className="aqiv-form-grid" style={{ marginBottom: 12 }}>
          <label style={{ gridColumn: '1 / -1' }}><span>City or town</span><input value={form.city} onChange={(e) => setField('city', e.target.value)} placeholder="e.g. Lucknow" /></label>
        </div>
        <div className="aqiv-mode-switch" role="group" aria-label="Prediction method">
          <button type="button" className={predictionMode === 'camera' ? 'active' : ''} onClick={() => { setPredictionMode('camera'); setResult(null); }}><Activity size={15}/> Camera and images</button>
          <button type="button" className={predictionMode === 'location' ? 'active' : ''} onClick={() => { setPredictionMode('location'); setResult(null); }}><MapPin size={15}/> Location and form</button>
        </div>
        {predictionMode === 'camera' && <div className="aqiv-camera-fields">
          <p>The trained model uses both front and rear road images along with your air and weather readings.</p>
          <label><span>Front road image</span><input type="file" accept="image/*" capture="environment" onChange={(e) => setFrontImage(e.target.files?.[0] || null)} /></label>
          <label><span>Rear road image</span><input type="file" accept="image/*" capture="environment" onChange={(e) => setRearImage(e.target.files?.[0] || null)} /></label>
          <small>{frontImage ? `Front: ${frontImage.name}` : 'Front image not selected'} · {rearImage ? `Rear: ${rearImage.name}` : 'Rear image not selected'}</small>
        </div>}
        <button type="button" className="traffic-secondary" onClick={useLocation} disabled={locating}><LocateFixed size={16} />{locating ? 'Finding location…' : locationState === 'found' ? 'Refresh my location' : 'Use my current location'}</button>
        {form.latitude && form.longitude && <p className="aqiv-private-note"><CheckCircle2 size={14}/> Location captured: {form.latitude}, {form.longitude}</p>}
        <div className="traffic-panel-heading" style={{ marginTop: 28 }}><div><span className="traffic-kicker">STEP 02 · AIR AND WEATHER</span><h3>Enter conditions</h3><p>Use sensor readings where available. Location is recorded with the result but does not replace pollutant readings.</p></div><Wind size={22} className="aqiv-heading-icon" /></div>
        <form onSubmit={submit}>
          <div className="aqiv-form-grid">
            <label><span>PM2.5 <small>µg/m³</small></span><input type="number" required min="0" max="2000" step="any" value={form.pm25} onChange={(e) => setField('pm25', e.target.value)} /></label>
            <label><span>PM10 <small>µg/m³</small></span><input type="number" required min="0" max="2000" step="any" value={form.pm10} onChange={(e) => setField('pm10', e.target.value)} /></label>
            <label><span>Temperature <small>°C</small></span><input type="number" required min="-50" max="70" step="any" value={form.temperature} onChange={(e) => setField('temperature', e.target.value)} /></label>
            <label><span>Humidity <small>%</small></span><input type="number" required min="0" max="100" step="any" value={form.humidity} onChange={(e) => setField('humidity', e.target.value)} /></label>
            <label><span>Season</span><select value={form.season} onChange={(e) => setField('season', e.target.value)}><option>Monsoon</option><option>Summer</option><option>Winter</option></select></label>
            <label><span>Time of day</span><select value={form.day_or_night} onChange={(e) => setField('day_or_night', e.target.value)}><option>Day</option><option>Night</option></select></label>
          </div>
          <button type="button" className="aqiv-example-link" onClick={() => { setForm((old) => ({ ...old, ...DEFAULT_FORM })); setResult(null); setNotice(''); }}><FlaskConical size={14}/> Fill example readings <span>sample inputs</span></button>
          <button type="submit" className="primary full aqiv-analyze-button" disabled={busy}>{busy ? 'Predicting category…' : <><Sparkles size={16}/> Predict AQI category <span>→</span></>}</button>
        </form>
        {notice && <div className="aqiv-inline-note"><AlertTriangle size={16}/><span>{notice}</span></div>}
      </section>
      <section className={`panel aqiv-result-panel ${result ? 'has-result' : ''}`}>
        <div className="traffic-panel-heading"><div><span className="traffic-kicker">STEP 03 · PREDICTION</span><h3>Your AQI report</h3><p>{form.city || 'Your city'} · based on the values entered above</p></div>{result && <span className={`traffic-status-label ${isSample ? 'sample' : ''}`}>{isSample ? 'PREVIEW' : 'MODEL RESULT'}</span>}</div>
        {!result ? <div className="aqiv-result-empty"><span><Wind size={24}/></span><b>Your report will appear here</b><p>Fill in your readings and select Predict AQI category.</p><div className="aqiv-result-steps"><i>1</i> Location <span>→</span> <i>2</i> Readings <span>→</span> <i>3</i> Prediction</div></div> : <>
          <div className="aqiv-result-summary"><div className={`aqiv-category-orb category-${result.predicted_category.toLowerCase().replaceAll(' ', '-')}`}><span><Wind size={26}/></span></div><div className="aqiv-result-main"><span>{isSample ? 'PREVIEW CATEGORY' : 'PREDICTED CATEGORY'}</span><h2>{result.predicted_category}</h2><p>{result.location?.city || form.city || 'City not specified'}</p></div><div className="aqiv-confidence"><b>{Number(result.confidence).toFixed(1)}<small>%</small></b><span>{isSample ? 'PREVIEW SCORE' : 'MODEL CONFIDENCE'}</span></div></div>
          <div className="aqiv-probabilities"><div className="aqiv-prob-heading"><b>Category probabilities</b><small>{isSample ? 'Illustrative values' : 'Model output'}</small></div>{(result.probabilities || []).map((item) => <div className="aqiv-prob-row" key={item.category}><span>{item.category}</span><div><i style={{ width: `${Math.min(100, Math.max(0, Number(item.probability) || 0))}%` }} /></div><b>{Number(item.probability).toFixed(1)}%</b></div>)}</div>
          <div className={`aqiv-result-disclaimer ${isSample ? 'sample' : ''}`}><AlertTriangle size={15}/><span>{result.note || 'This is a model category estimate, not an official AQI reading.'}</span></div>
          <button className="traffic-secondary aqiv-reset-result" onClick={() => { setResult(null); setNotice(''); }}><RotateCcw size={14}/> Clear report and try again</button>
        </>}
      </section>
    </div>
    <div className="aqiv-bottom-grid"><section className="panel aqiv-info-panel"><span className="traffic-kicker">HOW IT WORKS</span><h3>Location plus air readings</h3><div className="aqiv-info-row"><i>01</i><span><b>City tracking</b><small>Your browser can share approximate coordinates and a city name with permission.</small></span></div><div className="aqiv-info-row"><i>02</i><span><b>Form preprocessing</b><small>PM2.5, PM10, temperature, humidity, season and time are passed through the supplied preprocessor.</small></span></div><div className="aqiv-info-row"><i>03</i><span><b>Category prediction</b><small>The supplied model returns one of six categories. It does not return a numeric official AQI.</small></span></div></section><section className="panel aqiv-info-panel aqiv-limits-panel"><span className="traffic-kicker">IMPORTANT NOTE</span><h3>Understand the result</h3><div className="aqiv-limit-line"><CheckCircle2 size={15}/><span><b>Choose your method</b><small>Use front and rear road images for the full trained input, or use location and the form for a camera free estimate.</small></span></div><div className="aqiv-limit-line"><AlertTriangle size={15}/><span><b>Form only adaptation</b><small>Camera mode uses the original two image inputs. Location and form mode uses neutral image placeholders, so that result is an approximation.</small></span></div><div className="aqiv-limit-line"><Activity size={15}/><span><b>Not an official reading</b><small>For current measured AQI, use a trusted monitoring station. Location identifies the city but is not a trained model feature.</small></span></div></section></div>
  </div>;
}
