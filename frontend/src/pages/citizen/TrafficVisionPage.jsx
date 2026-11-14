import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, ArrowDownToLine, ArrowUpRight, CheckCircle2, ChevronDown,
  CircleHelp, Clock3, Cpu, FileVideo, Gauge, LoaderCircle, ScanLine, ShieldCheck, SlidersHorizontal, Video, XCircle,
} from 'lucide-react';
import { api } from '../../services/api/client.js';
import { useApp } from '../../context/AppContext.jsx';
import { Link } from 'react-router-dom';
import { saveLatestVisionEvidence } from '../../services/visionEvidence.js';
import { saveLocalRecord, readLocalRecord } from '../../services/apiSnapshot.js';
import WorkspaceDataState from '../../components/shared/WorkspaceDataState.jsx';
import './traffic-lab-premium.css';

const ACCEPTED_VIDEO = '.mp4,.mov,.avi,.mkv,.webm,.m4v';
const ACCEPTED_IMAGE = 'image/jpeg,image/png,image/webp';
const CLASS_LABELS = { car: 'Cars', bus: 'Buses', motorbike: 'Motorcycles', bicycle: 'Bicycles', truck: 'Trucks' };

function makeIllustrativeTrafficReport(mode = 'video', confidence = 0.3) {
  return {
    mode,
    model: 'Illustrative traffic scenario',
    preview_only: true,
    source_filename: 'Example junction scenario',
    video: mode === 'video' ? { sampled_frames: 12, duration_seconds: 45, sampling_interval_seconds: 4 } : { sampled_frames: 1, duration_seconds: 0, sampling_interval_seconds: 1 },
    counts: { car: 26, bus: 3, motorbike: 18, bicycle: 2, truck: 4 },
    total_vehicles: 53,
    peak_vehicles_in_frame: mode === 'video' ? 14 : 53,
    mean_vehicles_per_sampled_frame: mode === 'video' ? 4.4 : 53,
    congestion_estimate: 'Moderate',
    congestion_score_heuristic: 58,
    tracking_ids_available: false,
    confidence_threshold: confidence,
    congestion_note: 'Illustrative scenario only. These sample values are not live detections and are not sent to the Traffic Agent.',
  };
}

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
  const [report, setReport] = useState(() => initialReportSnapshot?.value || null);
  const [reportRestored, setReportRestored] = useState(Boolean(initialReportSnapshot?.value));
  const [reportSavedAt, setReportSavedAt] = useState(initialReportSnapshot?.savedAt || null);
  const [systemStatus, setSystemStatus] = useState(null);
  const [systemStatusLoading, setSystemStatusLoading] = useState(true);
  const [sampleReady, setSampleReady] = useState(false);
  const [confidence, setConfidence] = useState(0.3);
  const [previewReport, setPreviewReport] = useState(() => initialReportSnapshot?.value ? null : makeIllustrativeTrafficReport(mode, 0.3));
  const [sampleEvery, setSampleEvery] = useState('1');
  const [segmentDistanceKm, setSegmentDistanceKm] = useState('0.5');
  const [approachRoisJson, setApproachRoisJson] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileInput = useRef(null);

  useEffect(() => {
    let alive = true;
    const fallbackTimer = window.setTimeout(() => { if (alive) setSampleReady(true); }, 5000);
    api.get('/traffic-detection/video-status', { timeoutMs: 40000 }).then((result) => {
      if (alive) {
        setSystemStatus(result);
        setSystemStatusLoading(false);
        if (!result?.ready) setSampleReady(true);
      }
    }).catch(() => {
      if (alive) {
        setSystemStatus({ ready: false, opencv_available: false, video_analysis_ready: false, note: 'Traffic analysis is temporarily unavailable.' });
        setSystemStatusLoading(false);
        setSampleReady(true);
      }
    });
    return () => { alive = false; window.clearTimeout(fallbackTimer); };
  }, []);

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const visibleReport = report || previewReport;
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
    setPreviewReport(makeIllustrativeTrafficReport(mode, confidence));
    if (report) setReportRestored(true);
    setError('');
  }

  function switchMode(nextMode) {
    setMode(nextMode);
    setFile(null);
    setPreviewReport(makeIllustrativeTrafficReport(nextMode, confidence));
    if (report) setReportRestored(true);
    setError('');
    setPreviewUrl((old) => { if (old) URL.revokeObjectURL(old); return ''; });
  }

  async function analyzeScene() {
    if (!file) { setError(`Upload a ${mode === 'video' ? 'traffic video' : 'road image'} first.`); return; }
    setBusy(true); setError('');
    if (!report) setPreviewReport(makeIllustrativeTrafficReport(mode, confidence));
    try {
      const body = new FormData();
      body.append('file', file);
      let roiQuery = '';
      if (mode === 'video' && approachRoisJson.trim()) {
        let parsed;
        try { parsed = JSON.parse(approachRoisJson); }
        catch { throw new Error('Check the road-zone settings and try again.'); }
        if (!Array.isArray(parsed)) throw new Error('Road-zone settings must contain a list of areas.');
        roiQuery = `&approach_rois=${encodeURIComponent(JSON.stringify(parsed))}`;
      }
      const endpoint = mode === 'video'
        ? `/traffic-detection/analyze-video?confidence=${confidence}&sample_every_seconds=${sampleEvery}${roiQuery}`
        : `/traffic-detection/analyze?confidence=${confidence}`;
      const data = await api.postForm(endpoint, body, { timeoutMs: 40000 });
      const analyzedReport = { ...data, mode, source_filename: file.name, segment_distance_km: Number(segmentDistanceKm) || 0.5, saved_at: new Date().toISOString() };
      setReport(analyzedReport);
      setPreviewReport(null);
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
      notify(mode === 'video' ? 'Traffic video analyzed.' : 'Road image analyzed.');
    } catch (e) {
      if (report) setReportRestored(true);
      const availabilityFailure = e?.status === 0 || e?.status >= 500 || /timed out|could not be reached|refresh/i.test(e?.message || '');
      // Keep the clearly labelled local example visible when no real detection
      // report exists. It is never persisted or passed to the Traffic Agent.
      if (!report) setPreviewReport((current) => current || makeIllustrativeTrafficReport(mode, confidence));
      setError(e.message || (availabilityFailure ? 'The vision service is taking longer than expected.' : 'The traffic analysis could not be completed. Please try again.'));
    } finally { setBusy(false); }
  }

  function downloadReport() {
    if (!report) return;
    const payload = { project: 'UrbanSaarthi Traffic Lab', generated_at: new Date().toISOString(), evidence: compactReport(report), note: 'Vehicle detections from the uploaded source. Object counts are not calibrated queue length or speed measurements.' };
    const href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = href; link.download = `urbansarthi-traffic-report-${Date.now()}.json`; link.click(); URL.revokeObjectURL(href);
  }

  return <main className="ul-lab">
    <header className="ul-page-head">
      <div>
        <div className="ul-overline"><span className="ul-orbit"/> URBANSARTHI / TRAFFIC WORKSPACE</div>
        <h1>See what is happening <em>on the road.</em></h1>
        <p>Review vehicles and road activity from a junction video or image. Use the results to support traffic decisions.</p>
      </div>
      <div className="ul-head-status"><span className={`ul-status-dot ${videoReadiness ? 'ready' : ''}`}/><div><b>{systemStatusLoading ? 'Getting Traffic Lab ready' : modelReadiness ? 'Ready for your footage' : 'Example report available'}</b><small>{systemStatus?.readiness_note || (modelReadiness ? 'Ready for a road clip or image' : 'The example report stays available while the connection is restored')}</small></div></div>
    </header>

    <WorkspaceDataState loading={systemStatusLoading && !sampleReady} fallback={Boolean(previewReport) && sampleReady} title="Preparing Traffic Lab" detail="Checking the latest connection. You can keep using the example report while this connects." fallbackTitle="Traffic Lab sample is ready" fallbackDetail="The example scene is available now. Upload your own road footage to create a new analysis; a returning service will update its status automatically."/>

    <div className="ul-process-strip">
      <div><span>01</span><section><b>Add road footage</b><small>Choose a video clip or one road image.</small></section></div>
      <div><span>02</span><section><b>Review vehicle counts</b><small>See the detected classes and scene summary.</small></section></div>
      <div><span>03</span><section><b>Use the results</b><small>Carry verified evidence into traffic planning.</small></section></div>
    </div>

    <div className="ul-section-heading"><div><span>01 / OBSERVATION</span><h2>Capture the road.</h2></div><p>Choose a junction video or image. Your file is processed for this report and is not stored as a media asset.</p></div>
    <div className="ul-observation-grid">
      <section className="ul-panel ul-input-panel">
        <div className="ul-panel-head"><div><span className="ul-panel-kicker">ADD ROAD FOOTAGE</span><h3>Road footage</h3></div><span className="ul-live-tag"><i/> PRIVATE UPLOAD</span></div>
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
          <label className="ul-control"><span>Detection sensitivity <b>{Math.round(confidence * 100)}%</b></span><input type="range" min="0.1" max="0.8" step="0.05" value={confidence} onChange={(event) => setConfidence(Number(event.target.value))}/><small>Raise to reduce low-confidence boxes.</small></label>
          {mode === 'video' ? <label className="ul-control"><span>Frames to sample</span><select value={sampleEvery} onChange={(event) => setSampleEvery(event.target.value)}><option value="1">Every 1 second</option><option value="2">Every 2 seconds</option><option value="3">Every 3 seconds</option><option value="5">Every 5 seconds</option></select><small>Automatically capped at 180 frames.</small></label> : <div className="ul-control ul-image-note"><span><ShieldCheck size={15}/> Private processing</span><small>Only the selected image is used to prepare this report.</small></div>}
        </div>
        {mode === 'video' && <details className="ul-calibration-details">
          <summary><SlidersHorizontal size={14}/> Advanced road-zone settings <span>OPTIONAL ADVANCED SETTINGS</span></summary>
          <p>Define normalized polygons (x/y from 0 to 1) on the camera frame. Use exactly four IDs to unlock approach-level timing: <code>north_south_through</code>, <code>east_west_through</code>, <code>north_south_turn</code>, <code>east_west_turn</code>. Detection centres inside each polygon are counted by approach. Adjust every polygon to your footage; the example is not pre-calibrated.</p>
          <textarea rows={7} value={approachRoisJson} onChange={(event) => setApproachRoisJson(event.target.value)} placeholder={'[\n  {"id":"north_south_through","name":"North / south through","polygon":[[0.35,0.02],[0.65,0.02],[0.65,0.42],[0.35,0.42]]},\n  {"id":"east_west_through","name":"East / west through","polygon":[[0.02,0.42],[0.42,0.42],[0.42,0.68],[0.02,0.68]]},\n  {"id":"north_south_turn","name":"North / south turn","polygon":[[0.35,0.68],[0.65,0.68],[0.65,0.98],[0.35,0.98]]},\n  {"id":"east_west_turn","name":"East / west turn","polygon":[[0.58,0.42],[0.98,0.42],[0.98,0.68],[0.58,0.68]]}\n]'} />
          <label className="ul-distance-assumption"><span>Monitored corridor distance per counted vehicle</span><input type="number" min="0.001" max="100" step="0.1" value={segmentDistanceKm} onChange={(event) => setSegmentDistanceKm(event.target.value)}/><small>Operator assumption in km. Used only for the preliminary emissions estimate.</small></label>
        </details>}
        {error && <div className="ul-inline-error"><AlertTriangle size={15}/><span>{error}</span></div>}
        <button className="ul-primary-button ul-analyze-button" onClick={analyzeScene} disabled={!file || busy}>
          {busy ? <><LoaderCircle size={16} className="ul-spin"/> Analyzing footage…</> : <><ScanLine size={16}/> Analyze footage <ArrowUpRight size={16}/></>}
        </button>
        {systemStatus && !videoReadiness && <div className="ul-setup-hint"><CircleHelp size={15}/><span>{systemStatus.readiness_note || systemStatus.note || 'Traffic analysis is not ready yet.'} The example report remains available. Try again after the service reconnects.</span></div>}
        
      </section>

      <section className="ul-panel ul-evidence-panel">
        <div className="ul-panel-head"><div><span className="ul-panel-kicker">SCENE OUTPUT</span><h3>Scene report</h3></div>{report && <button className="ul-text-button" onClick={downloadReport}><ArrowDownToLine size={14}/> Download report</button>}</div>
        {!visibleReport ? <div className="ul-empty-evidence"><div className="ul-scan-illustration"><span/><span/><span/><i/></div><b>Waiting for source evidence</b><p>Upload a clip or image and analyze it to create a report tied to your road footage.</p><div className="ul-empty-track"><span>01 Capture</span><i/><span>02 Detect</span><i/><span>03 Verify</span></div></div> : <>
          <div className="ul-report-status"><span><CheckCircle2 size={16}/></span><div><b>{previewReport ? 'Illustrative traffic scenario' : reportRestored ? 'Last successful analysis' : 'Analysis complete'}</b><small>{visibleReport.preview_only ? 'Illustrative example' : 'Traffic analysis'} · {visibleReport.source_filename || file?.name}</small></div><em>{previewReport ? 'SAMPLE VIEW' : reportRestored ? 'SAVED RESULT' : 'LATEST RESULT'}</em></div>
          {previewReport ? <div className="ul-saved-report-note ul-preview-report-note">Illustrative preview · these values are not live detections and are not sent to the Traffic Agent. Upload footage to create a new report.</div> : reportRestored && <div className="ul-saved-report-note">Restored from this browser · {reportSavedAt ? new Date(reportSavedAt).toLocaleString() : 'Saved earlier'}. This is a saved analysis, not a new upload.</div>}
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
          {(visibleReport.annotated_frame || visibleReport.annotated_image) && <details className="ul-annotated-details" open><summary>Inspect annotated frame <ChevronDown size={14}/></summary><img src={`data:image/jpeg;base64,${visibleReport.annotated_frame || visibleReport.annotated_image}`} alt="Annotated road frame"/></details>}
        </>}
      </section>
    </div>

    <section className="ul-agent-handoff">
      <div className="ul-agent-handoff-copy">
        <span className="ul-panel-kicker">02 / AUTONOMOUS DECISION SUPPORT</span>
        <h2>Evidence captured. Let TrafficSaarthi work.</h2>
        <p>Your latest road analysis can be reviewed by the operations assistant. It can estimate corridor emissions, prepare signal timings and run a 60-minute forecast for operator review.</p>
        <div className="ul-handoff-points"><span>Evidence inspection</span><span>Signal-plan drafting</span><span>60-minute forecast</span><span>Human approval</span></div>
      </div>
      <Link className="ul-agent-handoff-button" to="/authority/traffic-agent">Open Traffic Agent <ArrowUpRight size={17}/></Link>
    </section>
    <footer className="ul-lab-footer"><div><ShieldCheck size={14}/><span>Road evidence</span><i/> <span>Operator-reviewed decisions</span></div><span>URBANSARTHI · TRAFFIC INTELLIGENCE</span></footer>
  </main>;
}
