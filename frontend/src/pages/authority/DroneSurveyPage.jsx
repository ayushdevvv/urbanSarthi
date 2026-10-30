import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, AlertTriangle, ArrowUpRight, CheckCircle2, Clock3, CloudSun, FileVideo, ImagePlus, MapPin, Plane, RadioTower, ScanLine, Send, ShieldCheck, UploadCloud, Wind } from 'lucide-react';
import PageIntro from '../../components/shared/PageIntro.jsx';
import { api } from '../../services/api/client.js';
import { useApp } from '../../context/AppContext.jsx';
import { saveLatestVisionEvidence } from '../../services/visionEvidence.js';
import './monitoring-pages.css';

const fmt = (value, digits = 1) => value == null || !Number.isFinite(Number(value)) ? '—' : Number(value).toLocaleString(undefined, { maximumFractionDigits: digits });
const VIDEO_TYPES = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v'];
const CLASS_LABELS = { car: 'Cars', motorbike: 'Motorcycles', bus: 'Buses', bicycle: 'Bicycles', truck: 'Trucks' };
export default function DroneSurveyPage() {
  const { notify } = useApp();
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState('');
  const [status, setStatus] = useState(null);
  const [report, setReport] = useState(null);
  const [emissions, setEmissions] = useState(null);
  const [air, setAir] = useState(null);
  const [nearby, setNearby] = useState([]);
  const [busy, setBusy] = useState(false);
  const [airBusy, setAirBusy] = useState(false);
  const [sensorBusy, setSensorBusy] = useState(false);
  const [error, setError] = useState('');
  const [mission, setMission] = useState({ id: 'DRN-LKO-01', name: 'Gomti Nagar corridor survey', latitude: '26.8467', longitude: '80.9462', altitude: '80', distance: '0.8', pm25: '42.5', pm10: '67.2', aqi: '' });
  const isVideo = Boolean(file && (file.type.startsWith('video/') || VIDEO_TYPES.some((ext) => file.name.toLowerCase().endsWith(ext))));
  useEffect(() => {
    let active = true;
    api.get('/traffic-detection/video-status').then((data) => { if (active) setStatus(data); }).catch((err) => { if (active) setStatus({ ready: false, video_analysis_ready: false, note: err.message || 'Video analysis service is unavailable.' }); });
    return () => { active = false; };
  }, []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const countRows = useMemo(() => Object.entries(CLASS_LABELS).map(([key, label]) => ({ key, label, count: Number(report?.counts?.[key] || 0) })), [report]);
  const total = report?.tracking_ids_available ? (report?.total_vehicles ?? 0) : (report?.peak_vehicles_in_frame ?? report?.total_vehicles ?? 0);
  function choose(nextFile) {
    if (!nextFile) return;
    const video = nextFile.type.startsWith('video/') || VIDEO_TYPES.some((ext) => nextFile.name.toLowerCase().endsWith(ext));
    const image = nextFile.type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(nextFile.name);
    if (!video && !image) { setError('Choose an MP4/MOV/WebM clip or JPG/PNG/WebP aerial image.'); return; }
    if (video && nextFile.size > 150 * 1024 * 1024) { setError('Video must be 150 MB or smaller.'); return; }
    if (image && nextFile.size > 8 * 1024 * 1024) { setError('Image must be 8 MB or smaller.'); return; }
    setFile(nextFile); setPreview(URL.createObjectURL(nextFile)); setReport(null); setEmissions(null); setError('');
  }
  async function analyze() {
    if (!file) { setError('Add an aerial image or video first.'); return; }
    setBusy(true); setError(''); setReport(null); setEmissions(null);
    try {
      const form = new FormData(); form.append('file', file);
      const endpoint = isVideo ? '/traffic-detection/analyze-video?confidence=0.3&sample_every_seconds=1' : '/traffic-detection/analyze?confidence=0.3';
      const data = await api.postForm(endpoint, form);
      const enriched = { ...data, source_filename: file.name };
      setReport(enriched);
      const counts = Object.fromEntries(Object.keys(CLASS_LABELS).map((key) => [key, Math.max(0, Number(enriched.counts?.[key] || 0))]));
      if (Object.values(counts).some((value) => value > 0)) {
        try { const impact = await api.post('/air-intelligence/emissions/estimate', { vehicle_counts: counts, segment_distance_km: Math.max(0.001, Number(mission.distance) || 0.8) }); setEmissions(impact); } catch { /* Vision report remains useful without an emissions estimate. */ }
      }
      saveLatestVisionEvidence({ source_filename: file.name, counts: enriched.counts || {}, total_vehicles: enriched.total_vehicles || 0, sampled_frames: enriched.video?.sampled_frames || 1, decoder: enriched.video?.decoder || 'image', captured_at: new Date().toISOString(), source: 'drone-survey' });
      notify('Aerial footage analyzed. Review the vehicle counts and environmental estimates.');
      await loadAreaAir();
    } catch (err) { setError(err.message || 'Aerial analysis failed. Check model readiness and upload a supported file.'); }
    finally { setBusy(false); }
  }
  async function loadAreaAir() {
    setAirBusy(true);
    try {
      const lat = Number(mission.latitude), lon = Number(mission.longitude);
      const [forecast, sensors] = await Promise.allSettled([api.get(`/aqi/location-forecast?latitude=${lat}&longitude=${lon}`), api.get(`/aqi/nearby?latitude=${lat}&longitude=${lon}&radius_km=10`)]);
      if (forecast.status === 'fulfilled') setAir(forecast.value);
      if (sensors.status === 'fulfilled') setNearby(sensors.value?.stations || []);
    } catch { /* Optional air context should not block video review. */ }
    finally { setAirBusy(false); }
  }
  async function submitOnboardReading(event) {
    event.preventDefault(); setSensorBusy(true);
    try {
      const payload = { external_station_id: `${mission.id}-AIR`, station_name: `${mission.name} · Drone air sensor`, latitude: Number(mission.latitude), longitude: Number(mission.longitude), source: 'drone-air-sensor', ...(mission.aqi !== '' ? { aqi: Number(mission.aqi) } : {}), pm25: Number(mission.pm25), pm10: Number(mission.pm10), raw_payload: { platform: 'drone', flight_id: mission.id, altitude_m: Number(mission.altitude), transport: 'operator-submitted onboard payload' } };
      await api.post('/aqi/observations', payload); notify('Drone air-sensor observation stored.'); await loadAreaAir();
    } catch (err) { notify(err.message || 'Could not store drone sensor reading.'); }
    finally { setSensorBusy(false); }
  }
  const index = air?.current?.us_aqi ?? air?.current?.openweather_index;
  const scale = air?.current?.openweather_index != null ? 'OpenWeather 1–5' : air?.current?.us_aqi != null ? 'US AQI 0–500' : 'Unavailable';
  return <main className="monitor-page drone-page">
    <PageIntro eyebrow="AERIAL FIELD OPERATIONS" title="Drone air surveys" description="Bring aerial road activity and onboard air-sensor readings together for a clearer picture of pollution pressure." action={<span className={`drone-readiness ${status?.video_analysis_ready ? 'ready' : 'not-ready'}`}><i/>{status?.video_analysis_ready ? 'Aerial video analysis ready' : 'Analysis service needs attention'}</span>} />
    <section className="drone-hero"><div className="drone-hero-copy"><span className="monitor-overline"><Plane size={14}/> AERIAL MONITORING</span><h2>See the city<br/><em>from above.</em></h2><p>Survey road corridors, review visible vehicle activity and add geotagged air readings from a drone-mounted sensor payload.</p><div className="drone-hero-meta"><span><ShieldCheck size={14}/> Review before action</span><span><MapPin size={14}/> Geotagged missions</span></div></div><div className="drone-illustration"><div className="drone-scan-ring scan-one"/><div className="drone-scan-ring scan-two"/><div className="drone-craft"><span/><span/><span/><span/><b/></div><div className="drone-scan-beam"/><div className="drone-ground-grid"/><span className="drone-coordinate">26.8467° N<br/>80.9462° E</span><span className="drone-altitude">ALT {mission.altitude} M</span></div></section>

    <section className="monitor-grid drone-main-grid"><article className="monitor-panel drone-upload-panel"><div className="monitor-panel-heading"><div><span className="monitor-kicker">MISSION MEDIA</span><h3>Upload aerial capture</h3><p>Analyze a drone video or a single aerial frame.</p></div><span className="monitor-live-badge">{file ? 'Media selected' : 'Awaiting media'}</span></div>
      <div className={`drone-dropzone ${file ? 'has-file' : ''}`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); choose(event.dataTransfer.files?.[0]); }} onClick={() => inputRef.current?.click()} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') inputRef.current?.click(); }}>
        <input ref={inputRef} type="file" accept="video/mp4,video/quicktime,video/x-msvideo,video/x-matroska,video/webm,image/jpeg,image/png,image/webp,.mp4,.mov,.avi,.mkv,.webm,.m4v,.jpg,.jpeg,.png,.webp" hidden onChange={(event) => choose(event.target.files?.[0])}/>
        {preview ? <div className="drone-preview">{isVideo ? <video src={preview} controls muted/> : <img src={preview} alt="Aerial survey preview"/>}<div><b>{file.name}</b><small>{(file.size / (1024 * 1024)).toFixed(1)} MB · {isVideo ? 'Video capture' : 'Aerial image'}</small></div></div> : <><span className="drone-upload-icon"><UploadCloud size={24}/></span><b>Drop aerial footage here</b><small>or browse files · MP4, MOV, WebM, JPG, PNG</small><span className="drone-upload-limits"><FileVideo size={13}/> Video up to 150 MB <i/> <ImagePlus size={13}/> Image up to 8 MB</span></>}
      </div>
      <div className="drone-media-actions"><button className="monitor-button" onClick={() => { setFile(null); setReport(null); setEmissions(null); setPreview((old) => { if (old) URL.revokeObjectURL(old); return ''; }); }} disabled={!file}>Clear media</button><button className="monitor-primary" onClick={analyze} disabled={!file || busy}>{busy ? 'Analyzing capture…' : <><ScanLine size={15}/> Analyze aerial capture</>}</button></div>
      {error && <div className="monitor-alert"><AlertTriangle size={14}/>{error}</div>}
      {status?.note && <div className="drone-status-note"><Activity size={14}/>{status.note}</div>}
    </article>
    <article className="monitor-panel drone-mission-panel"><div className="monitor-panel-heading"><div><span className="monitor-kicker">FLIGHT CONTEXT</span><h3>Survey details</h3><p>Attach location and flight conditions to the capture.</p></div><Plane size={18}/></div>
      <div className="drone-mission-fields"><label>Mission ID<input value={mission.id} onChange={(e) => setMission({ ...mission, id: e.target.value })}/></label><label>Survey area<input value={mission.name} onChange={(e) => setMission({ ...mission, name: e.target.value })}/></label><div className="drone-field-pair"><label>Latitude<input type="number" step="any" value={mission.latitude} onChange={(e) => setMission({ ...mission, latitude: e.target.value })}/></label><label>Longitude<input type="number" step="any" value={mission.longitude} onChange={(e) => setMission({ ...mission, longitude: e.target.value })}/></label></div><div className="drone-field-pair"><label>Flight altitude<input type="number" min="0" value={mission.altitude} onChange={(e) => setMission({ ...mission, altitude: e.target.value })}/></label><label>Road segment<input type="number" min="0.001" step="0.1" value={mission.distance} onChange={(e) => setMission({ ...mission, distance: e.target.value })}/></label></div><button className="monitor-button full-width" onClick={loadAreaAir} disabled={airBusy}><CloudSun size={14}/>{airBusy ? 'Checking area air…' : 'Check air around mission'}</button></div>
    </article></section>

    {report && <section className="monitor-panel drone-results-panel"><div className="monitor-panel-heading"><div><span className="monitor-kicker">AERIAL ACTIVITY REPORT</span><h3>{report.source_filename}</h3><p>{report.mode || (isVideo ? 'Video analysis' : 'Image analysis')} · {report.video?.sampled_frames ?? 1} sampled frame(s) · {report.video?.decoder || 'image decoder'}</p></div><span className="drone-result-pill"><CheckCircle2 size={14}/> Analysis complete</span></div><div className="drone-result-kpis"><div><small>Observed vehicles</small><b>{fmt(total, 0)}</b><span>{report.tracking_ids_available ? 'Unique tracked IDs' : 'Peak simultaneous detections'}</span></div><div><small>Congestion assessment</small><b>{report.congestion_estimate || 'Not estimated'}</b><span>Heuristic from the uploaded scene</span></div><div><small>Estimated CO₂</small><b>{emissions ? `${fmt(emissions.totals?.co2_g)} g` : '—'}</b><span>{emissions ? 'Tailpipe estimate from vehicle mix' : 'No usable class counts'}</span></div></div><div className="drone-class-grid">{countRows.map((row) => <div key={row.key}><span>{row.label}</span><b>{fmt(row.count, 0)}</b><i style={{ width: `${total ? Math.max(2, row.count / Math.max(1, ...countRows.map((r) => r.count)) * 100) : 0}%` }}/></div>)}</div><div className="drone-report-foot"><span><Clock3 size={13}/> {report.video?.duration_seconds != null ? `${fmt(report.video.duration_seconds, 1)} sec capture` : 'Single image capture'}</span><span><Activity size={13}/> {report.unique_count_method || 'Detection count'}</span><span><MapPin size={13}/> {mission.name}</span></div></section>}

    <section className="monitor-grid drone-air-grid"><article className="monitor-panel drone-air-context"><div className="monitor-panel-heading"><div><span className="monitor-kicker">AMBIENT AIR CONTEXT</span><h3>Air quality around the flight</h3><p>Location forecast and nearby sensor observations are shown separately.</p></div><Wind size={17}/></div>{air ? <div className="drone-air-reading"><div><small>AREA INDEX · {scale}</small><strong>{index == null ? '—' : Math.round(index)}</strong><span>{air.current?.category || 'AQI unavailable'}</span></div><div className="drone-air-pollutants"><span>PM2.5 <b>{fmt(air.current?.pm25)} µg/m³</b></span><span>PM10 <b>{fmt(air.current?.pm10)} µg/m³</b></span><span>NO₂ <b>{fmt(air.current?.nitrogen_dioxide)} µg/m³</b></span></div></div> : <div className="monitor-empty compact"><CloudSun size={20}/><b>No area air context loaded</b><span>Set the flight location and check the surrounding air-quality outlook.</span></div>}{nearby.length > 0 && <div className="drone-nearby-note"><RadioTower size={13}/>{nearby.length} nearby ground station observation(s) within 10 km.</div>}<small className="monitor-caveat">A location forecast is not a measurement from the drone. Ground stations appear only when recent sensor readings exist.</small></article>
      <article className="monitor-panel drone-onboard-panel"><div className="monitor-panel-heading"><div><span className="monitor-kicker">ONBOARD AIR SENSOR</span><h3>Submit flight readings</h3><p>Store particulate measurements captured by a drone-mounted sensor payload.</p></div><RadioTower size={17}/></div><form className="drone-sensor-form" onSubmit={submitOnboardReading}><label>PM2.5 · µg/m³<input required type="number" min="0" step="any" value={mission.pm25} onChange={(e) => setMission({ ...mission, pm25: e.target.value })}/></label><label>PM10 · µg/m³<input required type="number" min="0" step="any" value={mission.pm10} onChange={(e) => setMission({ ...mission, pm10: e.target.value })}/></label><label>AQI · optional, device-calculated<input type="number" min="0" max="1000" value={mission.aqi} onChange={(e) => setMission({ ...mission, aqi: e.target.value })}/></label><button className="monitor-primary full-width" type="submit" disabled={sensorBusy}>{sensorBusy ? 'Submitting…' : <><Send size={14}/> Submit onboard reading</>}</button></form><small className="monitor-caveat">Submitting this form stores the values you provide as a drone air-sensor observation. It does not establish a live drone connection.</small></article></section>

    <div className="drone-integrity-note"><AlertTriangle size={15}/><span><b>Measurement integrity:</b> the aerial image/video model detects visible road vehicles. It does not infer PM2.5 or AQI from pixels. Air-quality values must come from an onboard or ground sensor, or a separately labelled atmospheric forecast.</span></div>
  </main>;
}
