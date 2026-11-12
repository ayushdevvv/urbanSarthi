import { useEffect, useRef, useState } from 'react';
import {
  Activity, AlertTriangle, ArrowDownToLine, ArrowUpRight, Bot, CheckCircle2, ChevronDown,
  CircleHelp, Clock3, Cpu, FileVideo, Gauge, LoaderCircle, ScanLine, ShieldCheck, SlidersHorizontal, Video, XCircle,
} from 'lucide-react';
import { api } from '../../services/api/client.js';
import { useApp } from '../../context/AppContext.jsx';
import { Link } from 'react-router-dom';
import { saveLatestVisionEvidence } from '../../services/visionEvidence.js';
import { saveLocalRecord, readLocalRecord } from '../../services/apiSnapshot.js';
import './traffic-lab-premium.css';

const ACCEPTED_VIDEO = '.mp4,.mov,.avi,.mkv,.webm,.m4v';
const ACCEPTED_IMAGE = 'image/jpeg,image/png,image/webp';
const CLASS_LABELS = { car: 'Cars', bus: 'Buses', motorbike: 'Motorcycles', bicycle: 'Bicycles', truck: 'Trucks' };

function compactReport(report) {
  return {
    mode: report.mode,
    model: report.model,
    source_filename: report.source_filename || report.filename || 'uploaded road scene',
    video: report.video || { sampled_frames: 1, duration_seconds: 0, sampling_interval_seconds: 1 },
    counts: report.counts || {},
    total_vehicles: report.total_vehicles ?? 0,
    peak_vehicles_in_frame: report.peak_vehicles_in_frame ?? report.total_vehicles ?? 0,
    mean_vehicles_per_sampled_frame: report.mean_vehicles_per_sampled_frame ?? report.total_vehicles ?? 0,
    congestion_estimate: report.congestion_estimate || 'Not estimated',
    congestion_score_heuristic: report.congestion_score_heuristic ?? null,
    tracking_ids_available: Boolean(report.tracking_ids_available),
    unique_count_method: report.unique_count_method || 'single-frame detector count',
    congestion_note: report.congestion_note || 'Single-frame count only; camera calibration is not available.',
    confidence_threshold: report.confidence_threshold,
    report_version: report.report_version || 'traffic-image-report-v1',
    approach_calibration: report.approach_calibration || { enabled: false },
    approach_demand: report.approach_demand || {},
    segment_distance_km: report.segment_distance_km ?? 0.5,
  };
}

function formatDuration(seconds) {
  if (!Number.isFinite(Number(seconds)) || Number(seconds) <= 0) return 'Single frame';
  const total = Math.round(Number(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export default function TrafficVisionPage() {
  const { notify } = useApp();
  const [initialReportSnapshot] = useState(() => readLocalRecord('traffic-lab-last-report'));
  const [mode, setMode] = useState(() => initialReportSnapshot?.value?.mode || 'video');
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [report, setReport] = useState(() => initialReportSnapshot?.value?.preview_only ? null : initialReportSnapshot?.value || null);
  const [reportRestored, setReportRestored] = useState(Boolean(initialReportSnapshot?.value && !initialReportSnapshot.value.preview_only));
  const [reportSavedAt, setReportSavedAt] = useState(initialReportSnapshot?.value?.preview_only ? null : initialReportSnapshot?.savedAt || null);
  const [systemStatus, setSystemStatus] = useState(null);
  const [confidence, setConfidence] = useState(0.3);
  const [sampleEvery, setSampleEvery] = useState('1');
  const [segmentDistanceKm, setSegmentDistanceKm] = useState('0.5');
  const [approachRoisJson, setApproachRoisJson] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileInput = useRef(null);
  const [cameraForm, setCameraForm] = useState({ name: '', externalId: '', latitude: '', longitude: '', rtspUrl: '', apiUrl: '' });
  const [cameraBusy, setCameraBusy] = useState(false);
  const [cameraCommand, setCameraCommand] = useState('');
  const [cameraError, setCameraError] = useState('');

  useEffect(() => {
    let alive = true;
    api.get('/traffic-detection/video-status', { timeoutMs: 9000, fallbackGraceMs: 6500 }).then((result) => {
      if (alive) setSystemStatus(result);
    }).catch((reason) => {
      if (alive) setSystemStatus({ ready: false, opencv_available: false, video_analysis_ready: false, note: 'Live video-analysis capability is temporarily unavailable. Try again after the service reconnects.' });
    });
    return () => { alive = false; };
  }, []);

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  // Only genuine inference results or clearly labelled historical results appear here.
  const visibleReport = report;
  const vehicleTotal = visibleReport?.tracking_ids_available ? (visibleReport?.total_vehicles ?? 0) : (visibleReport?.peak_vehicles_in_frame ?? visibleReport?.total_vehicles ?? 0);
  const countEntries = Object.entries(CLASS_LABELS).filter(([key]) => visibleReport?.counts && key in visibleReport.counts);
  const modelReadiness = Boolean(systemStatus?.ready);
  const videoReadiness = Boolean(systemStatus?.video_analysis_ready);

  function pickFile(nextFile) {
    if (!nextFile) return;
    const isVideo = nextFile.type.startsWith('video/') || /\.(mp4|mov|avi|mkv|webm|m4v)$/i.test(nextFile.name);
    if (mode === 'video' && !isVideo) { setError('Choose a video clip such as MP4, MOV, AVI or WebM.'); return; }
    if (mode === 'image' && !(['image/jpeg', 'image/png', 'image/webp'].includes(nextFile.type) || /\.(jpe?g|png|webp)$/i.test(nextFile.name))) { setError('Choose a JPG, PNG or WebP image.'); return; }
    const maxSize = mode === 'video' ? 150 * 1024 * 1024 : 8 * 1024 * 1024;
    if (nextFile.size > maxSize) { setError(`This file exceeds the ${mode === 'video' ? '150 MB' : '8 MB'} upload limit.`); return; }
    setFile(nextFile);
    setPreviewUrl(URL.createObjectURL(nextFile));
    if (report) setReportRestored(true);
    setError('');
  }

  function switchMode(nextMode) {
    setMode(nextMode);
    setFile(null);
    if (report) setReportRestored(true);
    setError('');
    setPreviewUrl((old) => { if (old) URL.revokeObjectURL(old); return ''; });
  }

  async function analyzeScene() {
    if (!file) { setError(`Upload a ${mode === 'video' ? 'traffic video' : 'road image'} first.`); return; }
    setBusy(true); setError('');
    try {
      const body = new FormData();
      body.append('file', file);
      let roiQuery = '';
      if (mode === 'video' && approachRoisJson.trim()) {
        let parsed;
        try { parsed = JSON.parse(approachRoisJson); }
        catch { throw new Error('Camera ROI configuration must be valid JSON.'); }
        if (!Array.isArray(parsed)) throw new Error('Camera ROI configuration must be a JSON array.');
        roiQuery = `&approach_rois=${encodeURIComponent(JSON.stringify(parsed))}`;
      }
      const endpoint = mode === 'video'
        ? `/traffic-detection/analyze-video?confidence=${confidence}&sample_every_seconds=${sampleEvery}${roiQuery}`
        : `/traffic-detection/analyze?confidence=${confidence}`;
      const data = await api.postForm(endpoint, body, { timeoutMs: mode === 'video' ? 180000 : 60000, fallbackGraceMs: 0 });
      const analyzedReport = { ...data, mode, source_filename: file.name, segment_distance_km: Number(segmentDistanceKm) || 0.5, saved_at: new Date().toISOString() };
      setReport(analyzedReport);
      setReportRestored(false);
      setReportSavedAt(Date.now());
      // Keep compact evidence in browser storage; annotated base64 frames can be several MB.
      saveLocalRecord('traffic-lab-last-report', { ...compactReport(analyzedReport), saved_at: analyzedReport.saved_at });
      if (mode === 'video') {
        saveLatestVisionEvidence({
          source_filename: file.name,
          counts: analyzedReport.counts || {},
          total_vehicles: analyzedReport.total_vehicles || 0,
          sampled_frames: analyzedReport.video?.sampled_frames || 1,
          decoder: analyzedReport.video?.decoder || 'opencv',
          captured_at: new Date().toISOString(),
        });
      }
      notify(mode === 'video' ? `Video analyzed with YOLO. Decoder: ${data.video?.decoder || 'OpenCV'}.` : 'Road image analyzed with YOLO.');
    } catch (e) {
      if (report) setReportRestored(true);
      const availabilityFailure = e?.status === 0 || e?.status >= 500 || /timed out|could not be reached|refresh/i.test(e?.message || '');
      setError(e.message || (availabilityFailure ? 'The vision service is temporarily unavailable. No result was generated.' : 'The vision pipeline failed. Check the API and model status.'));
    } finally { setBusy(false); }
  }

  function downloadReport() {
    if (!report) return;
    const payload = { project: 'UrbanSaarthi Traffic Lab', generated_at: new Date().toISOString(), evidence: compactReport(report), note: 'YOLO/OpenCV detections from the uploaded source. Object counts are not calibrated queue length or speed measurements.' };
    const href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = href; link.download = `urbansarthi-traffic-report-${Date.now()}.json`; link.click(); URL.revokeObjectURL(href);
  }

  async function registerCamera(event) {
    event.preventDefault(); setCameraBusy(true); setCameraError(''); setCameraCommand('');
    const cleanId = cameraForm.externalId.trim();
    const sourceId = `${cleanId.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-camera`.slice(0, 96);
    const rtspUrl = cameraForm.rtspUrl.trim();
    if (!/^rtsps?:\/\//i.test(rtspUrl)) { setCameraError('Use an authorized rtsp:// or rtsps:// camera stream URL.'); setCameraBusy(false); return; }
    if (!cameraForm.name.trim() || cleanId.length < 2 || !cameraForm.latitude || !cameraForm.longitude || !cameraForm.apiUrl.trim()) {
      setCameraError('Complete camera name, junction ID, coordinates and public API URL.'); setCameraBusy(false); return;
    }
    try {
      await api.post('/traffic/junctions', {
        external_id: cleanId, name: cameraForm.name.trim(), latitude: Number(cameraForm.latitude), longitude: Number(cameraForm.longitude),
        lane_count: 4, baseline_cycle_seconds: 90, status: 'unknown', configuration: { registered_from: 'traffic_lab_camera_setup' },
      });
    } catch (err) {
      if (err?.status !== 409) { setCameraError(err.message || 'Could not register the junction.'); setCameraBusy(false); return; }
    }
    try {
      await api.post('/admin/data-sources', {
        external_id: sourceId, name: `${cameraForm.name.trim()} camera`, source_type: 'camera',
        provider: 'OpenCV + YOLO edge worker', status: 'not_configured', freshness_seconds: 120,
        safe_config: { junction_external_id: cleanId, ingestion: 'edge_worker' },
      });
      const q = (value) => `'${String(value).replaceAll("'", "'\''")}'`;
      const apiUrl = cameraForm.apiUrl.trim().replace(/\/$/, '');
      const command = `export CAMERA_RTSP_URL=${q(rtspUrl)}\nexport INGESTION_API_KEY='REPLACE_WITH_BACKEND_INGESTION_API_KEY'\npython scripts/edge_camera_worker.py --junction-id ${q(cleanId)} --source-id ${q(sourceId)} --camera-id ${q(cameraForm.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-'))} --api-url ${q(apiUrl)}`;
      setCameraCommand(command);
      notify('Junction and camera source registered. Start the edge worker on the authorized camera network to receive live samples.');
    } catch (err) { setCameraError(`Junction registered, but camera source setup failed: ${err.message || 'Unknown error'}`); }
    finally { setCameraBusy(false); }
  }

  return <main className="ul-lab">
    <header className="ul-page-head">
      <div>
        <div className="ul-overline"><span className="ul-orbit"/> URBANSARTHI / OPERATIONS LAB</div>
        <h1>Traffic intelligence <em>lab.</em></h1>
        <p>Turn road footage into verified vehicle evidence, a reviewable signal strategy, and a 60-minute traffic forecast.</p>
      </div>
      <div className="ul-head-status"><span className={`ul-status-dot ${videoReadiness ? 'ready' : ''}`}/><div><b>{videoReadiness ? 'Vision pipeline ready' : 'Vision setup incomplete'}</b><small>{systemStatus?.readiness_note || (systemStatus?.ready ? 'YOLO weights detected' : 'Check weights and dependencies')}</small></div></div>
    </header>

    <div className="ul-status-strip">
      <div className="ul-status-item"><span className={modelReadiness ? 'ready' : ''}><Cpu size={15}/></span><div><b>YOLO detector</b><small>{modelReadiness ? 'Weights + inference ready' : 'Not ready'}</small></div></div>
      <div className="ul-status-item"><span className={systemStatus?.decoder_ready && systemStatus?.opencv_available ? 'ready' : ''}><ScanLine size={15}/></span><div><b>OpenCV video</b><small>{systemStatus?.opencv_available ? `OpenCV ${systemStatus.opencv_version || ''} · ${systemStatus?.ffmpeg_fallback_available ? 'FFmpeg fallback ready' : 'native decoder'}` : 'OpenCV package unavailable'}</small></div></div>
      <div className="ul-status-item"><span className={systemStatus?.forecast_ready ? 'ready' : ''}><Activity size={15}/></span><div><b>60 min scenario</b><small>{systemStatus?.native_sumo_available ? 'Native SUMO detected' : systemStatus?.forecast_ready ? 'XGBoost fallback ready' : 'Install forecast requirements'}</small></div></div>
      <div className="ul-status-item"><span className={systemStatus?.agent_tools_ready ? 'ready' : ''}><Bot size={15}/></span><div><b>Operations agent</b><small>{systemStatus?.llm_tool_calling_ready ? 'Groq LLM + tools ready' : 'Local tools ready · Groq optional'}</small></div></div>
    </div>

    <section className="ul-camera-connect-panel">
      <div className="ul-camera-connect-heading"><div><span className="ul-panel-kicker">CONTINUOUS SOURCE</span><h2>Connect a live CCTV stream</h2><p>Register a junction and its camera source, then run the OpenCV + YOLO edge worker on a machine that can reach the authorized RTSP stream.</p></div><span className="ul-camera-connect-badge"><Video size={15}/> RTSP EDGE WORKER</span></div>
      <form className="ul-camera-connect-form" onSubmit={registerCamera}>
        <label>Camera / junction name<input value={cameraForm.name} onChange={(e) => setCameraForm((v) => ({ ...v, name: e.target.value }))} placeholder="Hazratganj junction camera" required/></label>
        <label>Junction external ID<input value={cameraForm.externalId} onChange={(e) => setCameraForm((v) => ({ ...v, externalId: e.target.value }))} placeholder="JUNC-LKO-001" required/></label>
        <label>Latitude<input type="number" min="-90" max="90" step="any" value={cameraForm.latitude} onChange={(e) => setCameraForm((v) => ({ ...v, latitude: e.target.value }))} placeholder="26.8467" required/></label>
        <label>Longitude<input type="number" min="-180" max="180" step="any" value={cameraForm.longitude} onChange={(e) => setCameraForm((v) => ({ ...v, longitude: e.target.value }))} placeholder="80.9462" required/></label>
        <label className="wide">Authorized RTSP stream URL<input type="password" autoComplete="off" value={cameraForm.rtspUrl} onChange={(e) => setCameraForm((v) => ({ ...v, rtspUrl: e.target.value }))} placeholder="rtsp://camera-host:554/stream" required/><small>Used only to generate the local worker command. Never sent to or stored by the UrbanSaarthi API.</small></label>
        <label className="wide">UrbanSaarthi API base URL<input value={cameraForm.apiUrl} onChange={(e) => setCameraForm((v) => ({ ...v, apiUrl: e.target.value }))} placeholder="https://your-api.example.com/api/v1" required/></label>
        <button className="ul-primary-button" type="submit" disabled={cameraBusy}>{cameraBusy ? <><LoaderCircle size={15} className="ul-spin"/> Registering…</> : <><Video size={15}/> Register camera source</>}</button>
      </form>
      {cameraError && <div className="ul-inline-error"><AlertTriangle size={14}/>{cameraError}</div>}
      {cameraCommand && <div className="ul-camera-command"><div><b>Run on the camera-network machine</b><small>Install the edge worker requirements and set the same INGESTION_API_KEY configured on the backend.</small></div><pre>{cameraCommand}</pre><button className="ul-secondary-button" type="button" onClick={() => navigator.clipboard?.writeText(cameraCommand).then(() => notify('Worker command copied.')).catch(() => notify('Clipboard access is unavailable.'))}>Copy worker command</button></div>}
      <div className="ul-camera-connect-foot"><ShieldCheck size={14}/> Only connect cameras you are authorized to access. Registration does not start the stream; live status begins after the edge worker sends its first authenticated heartbeat.</div>
    </section>

    <div className="ul-section-heading"><div><span>01 / OBSERVATION</span><h2>Capture the road.</h2></div><p>Upload footage from a junction. The video is processed by your backend and is not saved as a media asset.</p></div>
    <div className="ul-observation-grid">
      <section className="ul-panel ul-input-panel">
        <div className="ul-panel-head"><div><span className="ul-panel-kicker">SOURCE INGESTION</span><h3>Traffic evidence</h3></div><span className="ul-live-tag"><i/> LOCAL UPLOAD</span></div>
        <div className="ul-tabs"><button className={mode === 'video' ? 'active' : ''} onClick={() => switchMode('video')}><FileVideo size={15}/> Video clip</button><button className={mode === 'image' ? 'active' : ''} onClick={() => switchMode('image')}><ScanLine size={15}/> Single frame</button></div>
        <div className={`ul-dropzone ${file ? 'has-file' : ''}`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); pickFile(event.dataTransfer.files?.[0]); }}>
          {file && previewUrl ? <div className="ul-preview-media">
            {mode === 'video' ? <video src={previewUrl} controls muted playsInline /> : <img src={previewUrl} alt="Selected road scene" />}
            <button className="ul-remove-file" onClick={() => { setFile(null); if (report) setReportRestored(true); setPreviewUrl((old) => { if (old) URL.revokeObjectURL(old); return ''; }); }} aria-label="Remove uploaded file"><XCircle size={17}/></button>
            <div className="ul-file-meta"><b>{file.name}</b><span>{(file.size / (1024 * 1024)).toFixed(1)} MB</span></div>
          </div> : <><div className="ul-upload-icon"><Video size={25}/></div><b>Drop your {mode === 'video' ? 'traffic clip' : 'road image'} here</b><p>{mode === 'video' ? 'MP4, MOV, AVI, MKV or WebM · up to 150 MB · 10 minutes max' : 'JPG, PNG or WebP · up to 8 MB'}</p><button className="ul-secondary-button" onClick={() => fileInput.current?.click()}>Browse files <ArrowUpRight size={14}/></button></>}
          <input ref={fileInput} type="file" accept={mode === 'video' ? ACCEPTED_VIDEO : ACCEPTED_IMAGE} onChange={(event) => { pickFile(event.target.files?.[0]); event.target.value = ''; }} hidden />
        </div>
        <div className="ul-controls-grid">
          <label className="ul-control"><span>Detection confidence <b>{Math.round(confidence * 100)}%</b></span><input type="range" min="0.1" max="0.8" step="0.05" value={confidence} onChange={(event) => setConfidence(Number(event.target.value))}/><small>Raise to reduce low-confidence boxes.</small></label>
          {mode === 'video' ? <label className="ul-control"><span>Sample interval</span><select value={sampleEvery} onChange={(event) => setSampleEvery(event.target.value)}><option value="1">Every 1 second</option><option value="2">Every 2 seconds</option><option value="3">Every 3 seconds</option><option value="5">Every 5 seconds</option></select><small>Automatically capped at 180 frames.</small></label> : <div className="ul-control ul-image-note"><span><ShieldCheck size={15}/> Private processing</span><small>Only the selected image is sent to the API for inference.</small></div>}
        </div>
        {mode === 'video' && <details className="ul-calibration-details">
          <summary><SlidersHorizontal size={14}/> Camera approach calibration <span>OPTIONAL · REQUIRED FOR DIRECTIONAL OPTIMIZATION</span></summary>
          <p>Define normalized polygons (x/y from 0 to 1) on the camera frame. Use exactly four IDs to unlock approach-level timing: <code>north_south_through</code>, <code>east_west_through</code>, <code>north_south_turn</code>, <code>east_west_turn</code>. Detection centres inside each polygon are counted by approach. Adjust every polygon to your footage; the example is not pre-calibrated.</p>
          <textarea rows={7} value={approachRoisJson} onChange={(event) => setApproachRoisJson(event.target.value)} placeholder={'[\n  {"id":"north_south_through","name":"North / south through","polygon":[[0.35,0.02],[0.65,0.02],[0.65,0.42],[0.35,0.42]]},\n  {"id":"east_west_through","name":"East / west through","polygon":[[0.02,0.42],[0.42,0.42],[0.42,0.68],[0.02,0.68]]},\n  {"id":"north_south_turn","name":"North / south turn","polygon":[[0.35,0.68],[0.65,0.68],[0.65,0.98],[0.35,0.98]]},\n  {"id":"east_west_turn","name":"East / west turn","polygon":[[0.58,0.42],[0.98,0.42],[0.98,0.68],[0.58,0.68]]}\n]'} />
          <label className="ul-distance-assumption"><span>Monitored corridor distance per counted vehicle</span><input type="number" min="0.001" max="100" step="0.1" value={segmentDistanceKm} onChange={(event) => setSegmentDistanceKm(event.target.value)}/><small>Operator assumption in km. Used only for the preliminary emissions estimate.</small></label>
        </details>}
        {error && <div className="ul-inline-error"><AlertTriangle size={15}/><span>{error}</span></div>}
        <button className="ul-primary-button ul-analyze-button" onClick={analyzeScene} disabled={!file || busy}>
          {busy ? <><LoaderCircle size={16} className="ul-spin"/> Processing real frames…</> : <><ScanLine size={16}/> Run YOLO analysis <ArrowUpRight size={16}/></>}
        </button>
        {systemStatus && !videoReadiness && <div className="ul-setup-hint"><CircleHelp size={15}/><span>{systemStatus.readiness_note || systemStatus.note || 'Video analysis is not ready.'} Install <code>backend/requirements.txt</code>, verify <code>backend/models/best.pt</code>, then restart the API.</span></div>}
        {systemStatus?.ffmpeg_fallback_available && <div className="ul-setup-hint"><ShieldCheck size={15}/><span>Codec compatibility mode is available. If OpenCV cannot decode a phone-recorded clip, the bundled FFmpeg decoder will decode frames for the same YOLO pipeline.</span></div>}
      </section>

      <section className="ul-panel ul-evidence-panel">
        <div className="ul-panel-head"><div><span className="ul-panel-kicker">SCENE OUTPUT</span><h3>Scene report</h3></div>{report && <button className="ul-text-button" onClick={downloadReport}><ArrowDownToLine size={14}/> Export JSON</button>}</div>
        {!visibleReport ? <div className="ul-empty-evidence"><div className="ul-scan-illustration"><span/><span/><span/><i/></div><b>Waiting for source evidence</b><p>Run the detector to populate class counts, track metrics and a report tied to your uploaded footage.</p><div className="ul-empty-track"><span>01 Capture</span><i/><span>02 Detect</span><i/><span>03 Verify</span></div></div> : <>
          <div className="ul-report-status"><span><CheckCircle2 size={16}/></span><div><b>{reportRestored ? 'Last successful analysis' : 'Inference completed'}</b><small>{visibleReport.model || 'YOLO detector'} · {visibleReport.source_filename || file?.name}</small></div><em>{reportRestored ? 'SAVED RESULT' : 'MODEL OUTPUT'}</em></div>
          {reportRestored && <div className="ul-saved-report-note">Restored from this browser · {reportSavedAt ? new Date(reportSavedAt).toLocaleString() : 'Saved earlier'}. This is a previous analysis, not a new inference.</div>}
          <div className="ul-metric-grid">
            <div className="ul-metric-card"><span>{visibleReport.tracking_ids_available ? 'Tracked vehicles' : visibleReport.mode === 'video' ? 'Peak vehicles' : 'Vehicles detected'}</span><strong>{vehicleTotal}</strong><small>{visibleReport.tracking_ids_available ? 'Unique IDs across sampled frames' : visibleReport.mode === 'video' ? 'IDs not returned by tracker' : 'From this frame only'}</small></div>
            <div className="ul-metric-card"><span>Peak in frame</span><strong>{visibleReport.peak_vehicles_in_frame ?? visibleReport.total_vehicles ?? 0}</strong><small>Highest concurrent count</small></div>
            <div className="ul-metric-card"><span>Mean per frame</span><strong>{visibleReport.mean_vehicles_per_sampled_frame ?? visibleReport.total_vehicles ?? 0}</strong><small>{visibleReport.video?.sampled_frames ?? 1} sampled frames</small></div>
            <div className="ul-metric-card"><span>Scene density</span><strong className={`ul-density-${String(visibleReport.congestion_estimate || 'unknown').toLowerCase()}`}>{visibleReport.congestion_estimate || '—'}</strong><small>Count-based heuristic only</small></div>
          </div>
          <div className="ul-class-counts">{countEntries.map(([key, label]) => {
            const max = Math.max(1, ...countEntries.map(([className]) => Number(visibleReport.counts?.[className] || 0)));
            const value = Number(visibleReport.counts?.[key] || 0);
            return <div className="ul-class-row" key={key}><span>{label}</span><div className="ul-class-track"><i style={{ width: `${(value / max) * 100}%` }}/></div><b>{value}</b></div>;
          })}</div>
          <div className="ul-report-foot"><div><Clock3 size={14}/><span>{formatDuration(visibleReport.video?.duration_seconds)}</span></div><div><ScanLine size={14}/><span>{visibleReport.video?.sampled_frames ?? 1} frames</span></div><div><Gauge size={14}/><span>{Math.round((visibleReport.confidence_threshold ?? confidence) * 100)}% threshold</span></div></div>
          <div className="ul-disclaimer"><AlertTriangle size={14}/><span>{visibleReport.congestion_note || 'The report describes detected objects, not calibrated queue length or speed.'}</span></div>
          {(visibleReport.annotated_frame || visibleReport.annotated_image) && <details className="ul-annotated-details" open><summary>Inspect annotated frame <ChevronDown size={14}/></summary><img src={`data:image/jpeg;base64,${visibleReport.annotated_frame || visibleReport.annotated_image}`} alt="YOLO annotated road frame"/></details>}
        </>}
      </section>
    </div>

    <section className="ul-agent-handoff">
      <div className="ul-agent-handoff-copy">
        <span className="ul-panel-kicker">02 / AUTONOMOUS DECISION SUPPORT</span>
        <h2>Evidence captured. Let TrafficSaarthi work.</h2>
        <p>Your saved YOLO report is ready for the operations agent. It can inspect the evidence, estimate corridor emissions, draft signal phases and run a 60-minute forecast before asking an operator to review.</p>
        <div className="ul-handoff-points"><span>Evidence inspection</span><span>Signal-plan drafting</span><span>60-minute forecast</span><span>Human approval</span></div>
      </div>
      <Link className="ul-agent-handoff-button" to="/authority/traffic-agent">Open Traffic Agent <ArrowUpRight size={17}/></Link>
    </section>
    <footer className="ul-lab-footer"><div><ShieldCheck size={14}/><span>YOLO evidence</span><i/> <span>Operator-reviewed decisions</span></div><span>URBANSARTHI · TRAFFIC INTELLIGENCE</span></footer>
  </main>;
}
