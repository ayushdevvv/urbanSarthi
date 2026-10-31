import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, AlertTriangle, ArrowDownToLine, ArrowUpRight, Bot, Check, CheckCircle2,
  ChevronDown, CircleHelp, Clock3, Cpu, FileVideo, Gauge, GitBranch, LoaderCircle,
  Play, ScanLine, ShieldCheck, SlidersHorizontal, Sparkles, Video, XCircle,
} from 'lucide-react';
import { api } from '../../services/api/client.js';
import { useApp } from '../../context/AppContext.jsx';
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

function TrendChart({ timeline }) {
  const points = useMemo(() => {
    if (!Array.isArray(timeline) || timeline.length < 2) return '';
    const values = timeline.map((item) => Number(item.queue_total ?? item.queue ?? 0));
    const max = Math.max(1, ...values);
    return values.map((value, index) => `${(index / (values.length - 1)) * 100},${88 - (value / max) * 70}`).join(' ');
  }, [timeline]);
  if (!points) return <div className="ul-chart-empty">Run the 60-minute workflow to generate a queue forecast.</div>;
  const end = timeline[timeline.length - 1];
  const start = timeline[0];
  return <div className="ul-chart-wrap">
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="ul-chart" role="img" aria-label="Queue forecast over 60 minutes">
      {[22, 44, 66, 88].map((y) => <line key={y} x1="0" y1={y} x2="100" y2={y} className="ul-chart-grid" />)}
      <polyline points={points} className="ul-chart-line" />
      {timeline.map((item, index) => {
        if (index % Math.max(1, Math.floor(timeline.length / 5)) !== 0 && index !== timeline.length - 1) return null;
        const values = timeline.map((entry) => Number(entry.queue_total ?? entry.queue ?? 0));
        const max = Math.max(1, ...values);
        const x = (index / (timeline.length - 1)) * 100;
        const y = 88 - (Number(item.queue_total ?? item.queue ?? 0) / max) * 70;
        return <circle key={`${item.minute}-${index}`} cx={x} cy={y} r="1.25" className="ul-chart-dot" />;
      })}
    </svg>
    <div className="ul-chart-labels"><span>MIN 00</span><span>MIN 15</span><span>MIN 30</span><span>MIN 45</span><span>MIN 60</span></div>
    <div className="ul-chart-summary"><div><span>Queue at start</span><b>{start?.queue_total ?? '—'}</b></div><div><span>Queue at +60m</span><b>{end?.queue_total ?? '—'}</b></div><div><span>Queue delta</span><b className={Number(end?.queue_total) <= Number(start?.queue_total) ? 'is-positive' : 'is-negative'}>{(Number(start?.queue_total) > 0) ? `${(((Number(end?.queue_total) - Number(start?.queue_total)) / Number(start?.queue_total)) * 100).toFixed(1)}%` : '—'}</b></div></div>
  </div>;
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
  const [junctions, setJunctions] = useState([]);
  const [junctionId, setJunctionId] = useState('');
  const [confidence, setConfidence] = useState(0.3);
  const [sampleEvery, setSampleEvery] = useState('1');
  const [segmentDistanceKm, setSegmentDistanceKm] = useState('0.5');
  const [approachRoisJson, setApproachRoisJson] = useState('');
  const [scenario, setScenario] = useState('signal_priority');
  const [cycleSeconds, setCycleSeconds] = useState('90');
  const [prompt, setPrompt] = useState('Review the traffic evidence, draft a safe adaptive signal plan and run the 60-minute forecast.');
  const [busy, setBusy] = useState(false);
  const [agentBusy, setAgentBusy] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [error, setError] = useState('');
  const [workflow, setWorkflow] = useState(null);
  const [dispatchPreview, setDispatchPreview] = useState(null);
  const fileInput = useRef(null);

  useEffect(() => {
    let alive = true;
    Promise.allSettled([
      api.get('/traffic-detection/video-status'),
      api.get('/traffic/junctions'),
    ]).then(([statusResult, junctionResult]) => {
      if (!alive) return;
      if (statusResult.status === 'fulfilled') setSystemStatus(statusResult.value);
      else setSystemStatus({ ready: false, opencv_available: false, video_analysis_ready: false, note: statusResult.reason?.message || 'Backend is unreachable.' });
      if (junctionResult.status === 'fulfilled') {
        const items = Array.isArray(junctionResult.value) ? junctionResult.value : [];
        setJunctions(items);
        if (items.length) setJunctionId(String(items[0].id));
      }
    });
    return () => { alive = false; };
  }, []);

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const vehicleTotal = report?.tracking_ids_available ? (report?.total_vehicles ?? 0) : (report?.peak_vehicles_in_frame ?? report?.total_vehicles ?? 0);
  const countEntries = Object.entries(CLASS_LABELS).filter(([key]) => report?.counts && key in report.counts);
  const forecastTimeline = workflow?.simulation?.timeline || [];
  const modelReadiness = Boolean(systemStatus?.ready);
  const videoReadiness = Boolean(systemStatus?.video_analysis_ready);
  const trackingDescription = report?.tracking_ids_available ? 'Unique tracked IDs across sampled frames' : 'Peak simultaneous detections because track IDs were unavailable';

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
    setWorkflow(null);
    setDispatchPreview(null);
    setError('');
  }

  function switchMode(nextMode) {
    setMode(nextMode);
    setFile(null);
    if (report) setReportRestored(true);
    setWorkflow(null);
    setDispatchPreview(null);
    setError('');
    setPreviewUrl((old) => { if (old) URL.revokeObjectURL(old); return ''; });
  }

  async function analyzeScene() {
    if (!file) { setError(`Upload a ${mode === 'video' ? 'traffic video' : 'road image'} first.`); return; }
    setBusy(true); setError(''); setWorkflow(null); setDispatchPreview(null);
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
      const data = await api.postForm(endpoint, body);
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
      setError(e.message || 'The vision pipeline failed. Check the API and model status.');
    } finally { setBusy(false); }
  }

  async function runAgentWorkflow() {
    if (!report) { setError('Analyze real footage before running the operations agent.'); return; }
    if (!junctionId) { setError('No junction is available. Seed or register a junction in the authority API first.'); return; }
    setAgentBusy(true); setError(''); setDispatchPreview(null);
    try {
      const data = await api.post('/traffic-detection/ops-workflow', {
        junction_id: Number(junctionId),
        report: compactReport(report),
        scenario,
        prompt,
        cycle_seconds: Number(cycleSeconds),
        segment_distance_km: Number(segmentDistanceKm) || 0.5,
      });
      setWorkflow(data);
      notify(data.agent?.agent_mode === 'langgraph_groq_tool_calling' ? 'LangGraph tools completed. Draft is awaiting operator review.' : 'Analysis tools completed. Draft is awaiting operator review.');
    } catch (e) {
      setError(e.message || 'The operations workflow could not be completed.');
    } finally { setAgentBusy(false); }
  }

  async function reviewPlan(action) {
    if (!workflow?.plan?.id) return;
    setReviewBusy(true); setError('');
    try {
      const result = await api.post(`/signals/plans/${workflow.plan.id}/${action}`, { note: action === 'approve' ? 'Reviewed in Traffic Analysis. Approval is for the draft record only; physical dispatch remains disabled.' : 'Rejected by operator during review in Traffic Analysis.' });
      setWorkflow((old) => ({ ...old, plan: { ...old.plan, status: result.status || (action === 'approve' ? 'approved' : 'rejected'), review_note: result.review_note } }));
      if (action === 'approve') notify('Plan approved. No physical signal controller was contacted.');
      else notify('Draft rejected.');
    } catch (e) { setError(e.message || 'Could not save the operator review.'); }
    finally { setReviewBusy(false); }
  }

  async function createDispatchPreview() {
    if (!workflow?.plan?.id || workflow.plan.status !== 'approved') return;
    setReviewBusy(true); setError('');
    try {
      const data = await api.post(`/signals/plans/${workflow.plan.id}/dispatch-preview`, {});
      setDispatchPreview(data);
    } catch (e) { setError(e.message || 'Dispatch preview could not be created.'); }
    finally { setReviewBusy(false); }
  }

  function downloadReport() {
    if (!report) return;
    const payload = { project: 'Traffic Intelligence', generated_at: new Date().toISOString(), evidence: compactReport(report), agent: workflow?.agent || null, tools: workflow?.tools || [], draft_plan: workflow?.plan || null, forecast: workflow?.simulation || null, note: workflow?.simulation?.mode === 'native_sumo_simulation' ? 'Native SUMO ran 3,600 simulated seconds on the bundled synthetic grid. Video is not map-matched; human review required; physical dispatch disabled.' : 'Forecast data uses the supplied SUMO-generated dataset and trained XGBoost models. The video is not a lane-calibrated input to that forecast. Human review required; physical dispatch disabled.' };
    const href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = href; link.download = `urbansarthi-traffic-report-${Date.now()}.json`; link.click(); URL.revokeObjectURL(href);
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

    <div className="ul-section-heading"><div><span>01 / OBSERVATION</span><h2>Capture the road.</h2></div><p>Upload footage from a junction. The video is processed by your backend and is not saved as a media asset.</p></div>
    <div className="ul-observation-grid">
      <section className="ul-panel ul-input-panel">
        <div className="ul-panel-head"><div><span className="ul-panel-kicker">SOURCE INGESTION</span><h3>Traffic evidence</h3></div><span className="ul-live-tag"><i/> LOCAL UPLOAD</span></div>
        <div className="ul-tabs"><button className={mode === 'video' ? 'active' : ''} onClick={() => switchMode('video')}><FileVideo size={15}/> Video clip</button><button className={mode === 'image' ? 'active' : ''} onClick={() => switchMode('image')}><ScanLine size={15}/> Single frame</button></div>
        <div className={`ul-dropzone ${file ? 'has-file' : ''}`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); pickFile(event.dataTransfer.files?.[0]); }}>
          {file && previewUrl ? <div className="ul-preview-media">
            {mode === 'video' ? <video src={previewUrl} controls muted playsInline /> : <img src={previewUrl} alt="Selected road scene" />}
            <button className="ul-remove-file" onClick={() => { setFile(null); if (report) setReportRestored(true); setWorkflow(null); setPreviewUrl((old) => { if (old) URL.revokeObjectURL(old); return ''; }); }} aria-label="Remove uploaded file"><XCircle size={17}/></button>
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
        <div className="ul-panel-head"><div><span className="ul-panel-kicker">MEASURED OUTPUT</span><h3>Scene report</h3></div>{report && <button className="ul-text-button" onClick={downloadReport}><ArrowDownToLine size={14}/> Export JSON</button>}</div>
        {!report ? <div className="ul-empty-evidence"><div className="ul-scan-illustration"><span/><span/><span/><i/></div><b>Waiting for source evidence</b><p>Run the detector to populate class counts, track metrics and a report tied to your uploaded footage.</p><div className="ul-empty-track"><span>01 Capture</span><i/><span>02 Detect</span><i/><span>03 Verify</span></div></div> : <>
          <div className="ul-report-status"><span><CheckCircle2 size={16}/></span><div><b>{reportRestored ? 'Last successful analysis' : 'Inference completed'}</b><small>{report.model || 'YOLO detector'} · {report.source_filename || file?.name}</small></div><em>{reportRestored ? 'SAVED RESULT' : 'MODEL OUTPUT'}</em></div>
          {reportRestored && <div className="ul-saved-report-note">Restored from this browser · {reportSavedAt ? new Date(reportSavedAt).toLocaleString() : 'Saved earlier'}. This is a previous analysis, not a new inference.</div>}
          <div className="ul-metric-grid">
            <div className="ul-metric-card"><span>{report.tracking_ids_available ? 'Tracked vehicles' : report.mode === 'video' ? 'Peak vehicles' : 'Vehicles detected'}</span><strong>{vehicleTotal}</strong><small>{report.tracking_ids_available ? 'Unique IDs across sampled frames' : report.mode === 'video' ? 'IDs not returned by tracker' : 'From this frame only'}</small></div>
            <div className="ul-metric-card"><span>Peak in frame</span><strong>{report.peak_vehicles_in_frame ?? report.total_vehicles ?? 0}</strong><small>Highest concurrent count</small></div>
            <div className="ul-metric-card"><span>Mean per frame</span><strong>{report.mean_vehicles_per_sampled_frame ?? report.total_vehicles ?? 0}</strong><small>{report.video?.sampled_frames ?? 1} sampled frames</small></div>
            <div className="ul-metric-card"><span>Scene density</span><strong className={`ul-density-${String(report.congestion_estimate || 'unknown').toLowerCase()}`}>{report.congestion_estimate || '—'}</strong><small>Count-based heuristic only</small></div>
          </div>
          <div className="ul-class-counts">{countEntries.map(([key, label]) => {
            const max = Math.max(1, ...countEntries.map(([className]) => Number(report.counts?.[className] || 0)));
            const value = Number(report.counts?.[key] || 0);
            return <div className="ul-class-row" key={key}><span>{label}</span><div className="ul-class-track"><i style={{ width: `${(value / max) * 100}%` }}/></div><b>{value}</b></div>;
          })}</div>
          <div className="ul-report-foot"><div><Clock3 size={14}/><span>{formatDuration(report.video?.duration_seconds)}</span></div><div><ScanLine size={14}/><span>{report.video?.sampled_frames ?? 1} frames</span></div><div><Gauge size={14}/><span>{Math.round((report.confidence_threshold ?? confidence) * 100)}% threshold</span></div></div>
          <div className="ul-disclaimer"><AlertTriangle size={14}/><span>{report.congestion_note || 'The report describes detected objects, not calibrated queue length or speed.'}</span></div>
          {(report.annotated_frame || report.annotated_image) && <details className="ul-annotated-details" open><summary>Inspect annotated frame <ChevronDown size={14}/></summary><img src={`data:image/jpeg;base64,${report.annotated_frame || report.annotated_image}`} alt="YOLO annotated road frame"/></details>}
        </>}
      </section>
    </div>

    <div className="ul-section-heading ul-operator-heading"><div><span>02 / DECISION SUPPORT</span><h2>Simulate before sign-off.</h2></div><p>The agent assembles evidence, drafts timing and runs a 60-minute scenario. Native SUMO is used when installed; otherwise the trained XGBoost scenario is labelled as a fallback. It cannot operate physical lights.</p></div>
    <section className="ul-panel ul-agent-panel">
      <div className="ul-agent-top"><div className="ul-agent-title"><div className="ul-agent-glyph"><Bot size={21}/></div><div><span className="ul-panel-kicker">TRAFFIC SARTHI / TOOL-CALLING AGENT</span><h3>Operations workflow</h3><p>Inspect evidence, build a candidate plan, forecast a scenario, then wait for the operator.</p></div></div><span className={`ul-agent-mode ${systemStatus?.ready ? 'connected' : ''}`}><i/>{workflow?.agent?.agent_mode === 'langgraph_groq_tool_calling' ? 'LANGGRAPH + GROQ' : 'LOCAL TOOL FALLBACK'}</span></div>
      <div className="ul-agent-form-grid">
        <label className="ul-control"><span>Target junction</span><select value={junctionId} onChange={(event) => setJunctionId(event.target.value)}><option value="">Select a registered junction</option>{junctions.map((junction) => <option key={junction.id} value={junction.id}>{junction.name} · #{junction.id}</option>)}</select>{junctions.length === 0 && <small>No junctions returned by the backend yet.</small>}</label>
        <label className="ul-control"><span>60-minute scenario</span><select value={scenario} onChange={(event) => setScenario(event.target.value)}><option value="baseline">Baseline</option><option value="signal_priority">Signal priority sensitivity</option><option value="demand_surge">Demand surge sensitivity</option></select><small>Native SUMO if installed, otherwise trained XGBoost sensitivity.</small></label>
        <label className="ul-control"><span>Draft cycle length</span><select value={cycleSeconds} onChange={(event) => setCycleSeconds(event.target.value)}><option value="60">60 seconds</option><option value="75">75 seconds</option><option value="90">90 seconds</option><option value="105">105 seconds</option><option value="120">120 seconds</option></select><small>Four phases with clearance times.</small></label>
      </div>
      <label className="ul-control ul-prompt-control"><span>Operator instruction</span><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} maxLength={700} rows={2}/></label>
      <div className="ul-agent-actions"><span><ShieldCheck size={15}/> Draft only, human approval required</span><button className="ul-primary-button" onClick={runAgentWorkflow} disabled={!report || !junctionId || agentBusy}>{agentBusy ? <><LoaderCircle size={16} className="ul-spin"/> Running tools…</> : <><Sparkles size={16}/> Run agent + 60 min forecast <Play size={14}/></>}</button></div>
      {workflow && <div className="ul-workflow-results">
        <div className="ul-workflow-section-title"><div><span className="ul-panel-kicker">WORKFLOW COMPLETE</span><h4>Evidence, plan, forecast</h4></div><span className="ul-complete-pill"><CheckCircle2 size={14}/> {workflow.agent?.agent_mode === 'langgraph_groq_tool_calling' ? 'LLM tool calls' : 'Deterministic tools'}</span></div>
        <div className="ul-tool-trace">{(workflow.tools || []).map((tool) => <span key={tool}><Check size={13}/>{tool.replaceAll('_', ' ')}</span>)}</div>
        {workflow.emissions_estimate && <div className="ul-emissions-evidence"><div><span>ESTIMATED TAILPIPE EMISSIONS</span><b>CO₂ {Number(workflow.emissions_estimate.totals?.co2_g || 0).toFixed(1)} g</b></div><div><b>NOx {Number(workflow.emissions_estimate.totals?.nox_g || 0).toFixed(3)} g</b><b>PM {Number(workflow.emissions_estimate.totals?.pm_g || 0).toFixed(3)} g</b></div><small>{workflow.emissions_estimate.factor_version} · {workflow.emissions_estimate.segment_distance_km} km corridor assumption. Estimates are not measured exhaust or ambient AQI.</small></div>}
        {workflow.agent?.response && <div className="ul-agent-response"><div className="ul-response-icon"><Bot size={17}/></div><div><b>Agent assessment</b><p>{workflow.agent.response}</p>{workflow.agent.llm_note && <small>{workflow.agent.llm_note}</small>}</div></div>}
        {workflow.plan && <div className="ul-draft-card"><div className="ul-draft-head"><div><span className="ul-panel-kicker">CANDIDATE PLAN #{workflow.plan.id}</span><h4>{workflow.plan.cycle_seconds}s adaptive timing draft</h4></div><span className={`ul-state-pill status-${workflow.plan.status}`}>{workflow.plan.status}</span></div><p>{workflow.plan.rationale}</p><div className="ul-phase-list">{workflow.plan.phases?.map((phase) => <div key={phase.movement || phase.name}><span>{phase.name}</span><div className="ul-phase-bar"><i style={{ width: `${Math.min(100, (phase.green_seconds / Math.max(1, workflow.plan.cycle_seconds)) * 100)}%` }}/></div><b>{phase.green_seconds}s green</b><small>+ {phase.yellow_seconds}s yellow · {phase.all_red_seconds}s all-red</small></div>)}</div>
          {workflow.plan.status !== 'approved' && workflow.plan.status !== 'rejected' ? <div className="ul-review-actions"><div><ShieldCheck size={15}/><span><b>Human review required</b><small>Approval saves the decision. It does not dispatch a real controller command.</small></span></div><div className="ul-review-buttons"><button className="ul-danger-button" onClick={() => reviewPlan('reject')} disabled={reviewBusy}>Reject draft</button><button className="ul-approve-button" onClick={() => reviewPlan('approve')} disabled={reviewBusy}>{reviewBusy ? <LoaderCircle size={15} className="ul-spin"/> : <Check size={15}/>} Approve draft</button></div></div> : <div className="ul-reviewed-line"><CheckCircle2 size={16}/><span>Operator decision saved: <b>{workflow.plan.status}</b></span>{workflow.plan.status === 'approved' && <button className="ul-secondary-button" onClick={createDispatchPreview} disabled={reviewBusy}>{reviewBusy ? 'Preparing…' : 'Create dispatch preview'}</button>}</div>}
        </div>}
        <div className="ul-simulation-card"><div className="ul-simulation-head"><div><span className="ul-panel-kicker">60-MINUTE TRAFFIC SCENARIO</span><h4>{workflow.simulation?.name || 'Queue forecast'}</h4></div><span className="ul-model-tag"><Activity size={13}/> {(workflow.simulation?.engine_label || workflow.simulation?.engine || '').toLowerCase().includes('sumo') || workflow.simulation?.mode === 'native_sumo_simulation' ? 'NATIVE SUMO / 3,600s RUN' : 'XGBOOST / TRAINED HORIZONS'}</span></div><div className="ul-forecast-summary"><div><span>Road network</span><b>{workflow.simulation?.summary?.road_count ?? workflow.simulation?.training_data?.road_edges ?? '—'}</b></div><div><span>Heavy roads at start</span><b>{workflow.simulation?.summary?.heavy_roads_start ?? '—'}</b></div><div><span>Heavy roads at +60m</span><b>{workflow.simulation?.summary?.heavy_roads_end ?? '—'}</b></div><div><span>Model coverage</span><b>60 min</b></div></div><TrendChart timeline={forecastTimeline}/>
          {workflow.simulation?.emissions_comparison?.available && <div className="ul-emissions-evidence"><div><span>SUMO BASELINE VS CANDIDATE · ESTIMATED DELTA</span><b>CO₂ {Number(workflow.simulation.emissions_comparison.change_percent?.co2_g ?? 0).toFixed(2)}%</b></div><div><b>NOx {Number(workflow.simulation.emissions_comparison.change_percent?.nox_g ?? 0).toFixed(2)}%</b><b>PM {Number(workflow.simulation.emissions_comparison.change_percent?.pm_g ?? 0).toFixed(2)}%</b></div><small>Negative values indicate lower estimated emissions in the candidate run. Factors are indicative, not local fleet-calibrated.</small></div>}
          <div className="ul-model-caveat"><CircleHelp size={15}/><span>{workflow.simulation?.engine_fallback_note || workflow.simulation?.caveats?.[0] || 'Forecast uses the bundled trained model and is not a live city feed.'} {workflow.simulation?.mode === 'native_sumo_simulation' ? 'Video-derived vehicle mix scales generated demand on the synthetic grid; it is not map-matched to this network.' : 'XGBoost forecast does not evaluate the candidate plan or calculate an emissions delta.'}</span></div>
        </div>
      </div>}
      {dispatchPreview && <div className="ul-dispatch-preview"><div><ShieldCheck size={16}/><b>Dispatch preview generated, no hardware command sent</b></div><pre>{JSON.stringify(dispatchPreview, null, 2)}</pre></div>}
    </section>

    <footer className="ul-lab-footer"><div><GitBranch size={14}/><span>Evidence-backed workflow</span><i/> <span>Human review</span><i/> <span>No physical dispatch</span></div><span>URBANSARTHI · TRAFFIC INTELLIGENCE</span></footer>
  </main>;
}
