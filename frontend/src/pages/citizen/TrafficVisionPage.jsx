import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, AlertTriangle, Camera, CheckCircle2, ChevronRight, CircleHelp, CloudOff, Download, FileVideo, ImagePlus, LoaderCircle, Link2, RefreshCw, ScanLine, ShieldCheck, Sparkles, Upload, Video, VideoOff, X } from 'lucide-react';
import PageIntro from '../../components/shared/PageIntro.jsx';
import { api } from '../../services/api/client.js';

const REFERENCE_COUNTS = { car: 7, bus: 1, motorbike: 4, bicycle: 2 };
const VEHICLE_LABELS = { car: 'Cars', bus: 'Buses', motorbike: 'Motorbikes', bicycle: 'Bicycles' };

function makeReferenceResult() {
  const total = Object.values(REFERENCE_COUNTS).reduce((sum, count) => sum + count, 0);
  return {
    mode: 'reference', model: 'Reference scenario', counts: REFERENCE_COUNTS, total_vehicles: total,
    total_detections: total + 2, congestion_estimate: 'High',
    congestion_note: 'Reference scenario only. These counts were not detected from your image or camera.',
    detections: [],
  };
}

export default function TrafficVisionPage() {
  const [inputMode, setInputMode] = useState('upload');
  const [cameraActive, setCameraActive] = useState(false);
  const [liveScan, setLiveScan] = useState(false);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  const [confidence, setConfidence] = useState(0.25);
  const [cameraError, setCameraError] = useState('');
  const [cctvUrl, setCctvUrl] = useState('');
  const [cctvLiveActive, setCctvLiveActive] = useState(false);
  const [junctions, setJunctions] = useState([]);
  const [junctionId, setJunctionId] = useState('');
  const [signalBusy, setSignalBusy] = useState(false);
  const [signalMessage, setSignalMessage] = useState('');
  const navigate = useNavigate();
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const canvasRef = useRef(null);
  const busyRef = useRef(false);
  const previewUrlRef = useRef('');

  useEffect(() => {
    let alive = true;
    api.get('/traffic/junctions').then((items) => { if (alive) { setJunctions(Array.isArray(items) ? items : []); if (items?.length) setJunctionId(String(items[0].id)); } }).catch(() => {});
    api.get('/traffic-detection/status').then((data) => { if (alive) setStatus(data); }).catch(() => {
      if (alive) setStatus({ ready: false, weights_present: false, inference_dependency_available: false });
    });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (videoRef.current && streamRef.current) videoRef.current.srcObject = streamRef.current;
  }, [cameraActive, inputMode]);

  useEffect(() => () => {
    stopCamera();
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) streamRef.current.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraActive(false);
    setLiveScan(false);
  }, []);

  const startCamera = async () => {
    setCameraError('');
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Camera access needs a modern browser and a secure HTTPS connection. Try uploading an image instead.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      streamRef.current = stream;
      setCameraActive(true);
      setInputMode('camera');
      setResult(null);
      setError('');
      window.setTimeout(() => { if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play().catch(() => {}); } }, 50);
    } catch (e) {
      setCameraError(e?.name === 'NotAllowedError' ? 'Camera permission was blocked. Allow camera access in your browser settings or upload an image.' : 'Could not start the camera. Check that another app is not using it, or upload an image.');
    }
  };

  const setSelectedFile = (nextFile) => {
    if (!nextFile) return;
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    const url = URL.createObjectURL(nextFile);
    previewUrlRef.current = url;
    setFile(nextFile);
    setPreview(url);
    setCctvLiveActive(false);
    setResult(null);
    setError('');
    setInputMode('upload');
    stopCamera();
  };

  const makeCameraFile = async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) throw new Error('Camera is still warming up. Try again in a moment.');
    const canvas = canvasRef.current || document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88));
    if (!blob) throw new Error('Could not capture a camera frame. Please try again.');
    return new File([blob], `urbansaarthi-camera-${Date.now()}.jpg`, { type: 'image/jpeg' });
  };

  const runAnalysis = useCallback(async (sourceFile = null) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      const imageFile = sourceFile || (inputMode === 'camera' || inputMode === 'cctv' ? await makeCameraFile() : file);
      if (!imageFile) throw new Error('Start a camera/CCTV feed or choose an image or video first.');
      const isVideo = String(imageFile.type || '').startsWith('video/') || /\.(mp4|webm|mov|avi|m4v)$/i.test(imageFile.name || '');
      if (imageFile.size > (isVideo ? 100 : 8) * 1024 * 1024) throw new Error(isVideo ? 'This video is larger than 100 MB. Choose a smaller clip.' : 'This image is larger than 8 MB. Choose a smaller image.');
      if (isVideo && inputMode === 'cctv') throw new Error('Capture a frame from the CCTV feed rather than uploading a video stream.');
      if (!isVideo && !['image/jpeg', 'image/png', 'image/webp'].includes(imageFile.type)) throw new Error('Please use a JPG, PNG, or WebP image.');
      if (isVideo && !['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo', 'application/octet-stream'].includes(imageFile.type) && !/\.(mp4|webm|mov|avi|m4v)$/i.test(imageFile.name || '')) throw new Error('Please use MP4, WebM, MOV or AVI video.');
      const form = new FormData();
      form.append('file', imageFile);
      const data = await api.postForm(isVideo ? `/traffic-detection/analyze-video?confidence=${confidence}&sample_frames=18` : `/traffic-detection/analyze?confidence=${confidence}`, form);
      setResult(data);
      setStatus((old) => ({ ...(old || {}), ready: true }));
      if (inputMode === 'camera' || inputMode === 'cctv') {
        const url = URL.createObjectURL(imageFile);
        if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = url;
        setPreview(url);
      }
    } catch (e) {
      // A clearly labelled sample is a deliberate fallback; never present it as model output.
      const msg = e?.message || 'Traffic analysis is temporarily unavailable.';
      setError(`${msg} Showing an indicative reference scenario; these are not detections from the submitted media.`);
      setResult(makeReferenceResult());
      if ((inputMode === 'camera' || inputMode === 'cctv') && videoRef.current?.videoWidth) {
        try {
          const snapshot = await makeCameraFile();
          const url = URL.createObjectURL(snapshot);
          if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
          previewUrlRef.current = url;
          setPreview(url);
        } catch { /* The labelled sample summary remains useful even if snapshot capture fails. */ }
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [inputMode, file, confidence]);

  useEffect(() => {
    if (!liveScan || !(cameraActive || (inputMode === 'cctv' && cctvLiveActive))) return undefined;
    let cancelled = false;
    let timer;
    const tick = async () => {
      if (cancelled) return;
      await runAnalysis();
      if (!cancelled) timer = window.setTimeout(tick, 4500);
    };
    timer = window.setTimeout(tick, 300);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [liveScan, cameraActive, inputMode, cctvLiveActive, runAnalysis]);

  const connectCctv = () => {
    setCameraError(''); setError(''); setResult(null);
    const trimmed = cctvUrl.trim();
    if (!/^https?:\/\//i.test(trimmed)) { setCameraError('Use an HTTP or HTTPS browser-playable feed URL. Raw RTSP streams need a server-side stream gateway.'); return; }
    stopCamera(); setInputMode('cctv'); setCctvLiveActive(true); setLiveScan(false);
    window.setTimeout(() => { if (videoRef.current) videoRef.current.play?.().catch(() => {}); }, 100);
  };

  const exportReport = () => {
    if (!result) return;
    const win = window.open('', '_blank', 'width=900,height=700');
    if (!win) { setError('Allow pop-ups to print or save this report as PDF.'); return; }
    const safeText = (value) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const isVideo = result.mode === 'video_model';
    const countsMarkup = Object.entries(VEHICLE_LABELS).map(([key, label]) => `<tr><td>${safeText(label)}</td><td>${safeText(result.counts?.[key] ?? 0)}</td></tr>`).join('');
    const annotationMarkup = result.annotated_image ? `<img class="annotated" src="data:image/jpeg;base64,${result.annotated_image}" alt="YOLO annotated sample frame">` : '';
    const details = isVideo ? `Video duration: ${safeText(result.video?.duration_seconds ?? 'N/A')} seconds · ${safeText(result.video?.sampled_frames ?? 0)} sampled frames of ${safeText(result.video?.source_frames ?? 0)}` : `Frame size: ${safeText(result.image_size?.width ?? 'N/A')} × ${safeText(result.image_size?.height ?? 'N/A')}`;
    const caveat = safeText(result.congestion_note || 'Traffic counts are model estimates for the provided media.');
    win.document.write(`<!doctype html><html><head><title>UrbanSaarthi Traffic Analysis Report</title><meta charset="utf-8"><style>*{box-sizing:border-box}body{font:14px/1.6 Inter,Arial,sans-serif;color:#172033;max-width:920px;margin:34px auto;padding:0 28px}.brand{font-size:11px;letter-spacing:2px;color:#5575e8;font-weight:800}.rule{height:4px;background:linear-gradient(90deg,#5677ed,#90a7ff);border-radius:10px;margin:12px 0 24px}h1{font-size:30px;letter-spacing:-1px;margin:0}h2{font-size:15px;margin:24px 0 10px}.sub{color:#657086;font-size:12px}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:20px 0}.card{padding:14px;border:1px solid #e1e6ef;border-radius:12px}.card small{display:block;color:#6b7587;font-size:10px}.card b{font-size:23px;letter-spacing:-1px}.pill{display:inline-block;border-radius:99px;background:#edf2ff;color:#4868dc;padding:5px 9px;font-size:10px;font-weight:800}table{border-collapse:collapse;width:100%}td,th{text-align:left;padding:10px;border-bottom:1px solid #e5e9f0}th{font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#6c778a}.annotated{display:block;width:100%;max-height:390px;object-fit:contain;background:#f4f6fa;border:1px solid #e4e8f0;border-radius:12px;margin-top:14px}.caveat{background:#f5f7fb;border-left:3px solid #718bef;padding:12px 14px;border-radius:6px;color:#566176;font-size:11px}.foot{border-top:1px solid #e3e8f0;margin-top:28px;padding-top:12px;color:#8a93a3;font-size:10px}@media print{button{display:none}body{margin:0 auto}.cards{break-inside:avoid}}</style></head><body><div class="brand">URBANSAARTHI · TRAFFIC INTELLIGENCE</div><div class="rule"></div><h1>Traffic analysis report</h1><p class="sub">Generated ${safeText(new Date().toLocaleString())} · ${isVideo ? 'Sampled video analysis' : 'Image/frame analysis'}</p><span class="pill">${safeText(result.model || 'Reference scenario')} · ${safeText(result.mode === 'reference' ? 'DEMO REFERENCE' : 'MODEL OUTPUT')}</span><div class="cards"><div class="card"><small>${isVideo ? 'Average vehicles / sampled frame' : 'Vehicles detected'}</small><b>${safeText(result.total_vehicles ?? 0)}</b></div><div class="card"><small>Preliminary congestion</small><b>${safeText(result.congestion_estimate ?? 'N/A')}</b></div><div class="card"><small>Total object detections</small><b>${safeText(result.total_detections ?? 0)}</b></div></div><p class="sub">${details}</p><h2>Vehicle class breakdown</h2><table><thead><tr><th>Vehicle category</th><th>Count</th></tr></thead><tbody>${countsMarkup}</tbody></table>${annotationMarkup}<h2>Interpretation and limitations</h2><p class="caveat">${caveat}</p><div class="foot">UrbanSaarthi prototype report. Counts depend on camera angle, image quality, detector classes and confidence threshold. This report does not independently validate real-world queue length, speed or traffic delay.<br><button onclick="window.print()">Print / Save as PDF</button></div><script>setTimeout(()=>window.print(),350)</script></body></html>`);
    win.document.close();
  };

  const useForSignalPlan = async () => {
    if (!result || !['model', 'video_model'].includes(result.mode)) return;
    if (!junctionId) { setSignalMessage('Create or register a junction in the authority workspace first.'); return; }
    setSignalBusy(true); setSignalMessage('');
    try {
      await api.post('/traffic/observations', {
        junction_id: Number(junctionId), source: result.mode === 'video_model' ? 'yolo11_video_sampled_detection' : 'yolo11_image_detection', vehicle_count: Number(result.total_vehicles || 0),
        queue_length_m: 0, congestion_score: Math.min(100, Math.round((Number(result.total_vehicles || 0) / 20) * 100)),
        detection_summary: { model: result.model, counts: result.counts, total_detections: result.total_detections, confidence_threshold: result.confidence_threshold, image_size: result.image_size, caveat: 'Single frame count only. Queue length, speed, and lane demand were not measured.' },
        lane_demand: {},
      });
      const plan = await api.post(`/signals/recommendations/${Number(junctionId)}`, {});
      setSignalMessage(`Draft signal recommendation created for junction ${junctionId}, plan ${plan.id}.`);
    } catch (e) { setSignalMessage(e.message || 'Could not create a signal recommendation.'); }
    finally { setSignalBusy(false); }
  };

  const clearResult = () => { setResult(null); setError(''); };
  const total = result?.total_vehicles ?? 0;
  const isSample = result?.mode === 'reference';
  const imageToShow = result?.annotated_image && !isSample ? `data:image/jpeg;base64,${result.annotated_image}` : preview;

  return <div className="traffic-vision-page">
    <PageIntro eyebrow="COMPUTER VISION" title="Traffic Camera Intelligence" description="Upload road imagery or video, connect a browser-compatible CCTV feed, and generate a YOLO vehicle-analysis report." action={<span className={`traffic-model-pill ${status?.ready ? 'ready' : 'pending'}`}><span />{status?.ready ? 'Model service ready' : 'Model service needs setup'}</span>} />

    {!status?.ready && <div className="traffic-inline-note"><CloudOff size={16}/><span><b>Model service not confirmed.</b> Install the listed inference dependencies to enable image-based vehicle detection. Reference values remain clearly separated from model results.</span></div>}

    <div className="traffic-hero-grid">
      <section className="panel traffic-capture-panel">
        <div className="traffic-panel-heading"><div><span className="traffic-kicker">CAPTURE SOURCE</span><h3>Bring a road into focus</h3><p>Camera frames are only sent when you analyze them.</p></div><span className="traffic-lock"><ShieldCheck size={15}/> Private by default</span></div>
        <div className="traffic-source-tabs" role="tablist" aria-label="Traffic camera source">
          <button className={inputMode === 'upload' ? 'active' : ''} onClick={() => { setInputMode('upload'); clearResult(); setCctvLiveActive(false); stopCamera(); }} role="tab" aria-selected={inputMode === 'upload'}><Upload size={16}/> Upload media</button>
          <button className={inputMode === 'camera' ? 'active' : ''} onClick={() => { setInputMode('camera'); clearResult(); setCctvLiveActive(false); stopCamera(); }} role="tab" aria-selected={inputMode === 'camera'}><Camera size={16}/> Device camera</button>
          <button className={inputMode === 'cctv' ? 'active' : ''} onClick={() => { setInputMode('cctv'); clearResult(); stopCamera(); }} role="tab" aria-selected={inputMode === 'cctv'}><Video size={16}/> CCTV live</button>
        </div>
        <div className={`traffic-viewfinder ${(cameraActive && inputMode === 'camera') || (cctvLiveActive && inputMode === 'cctv') ? 'is-camera' : ''}`}>
          {inputMode === 'camera' && cameraActive ? <>
            <video ref={videoRef} autoPlay muted playsInline aria-label="Camera preview" />
            <div className="traffic-camera-overlay"><span><i/> CAMERA ON</span><span>LIVE PREVIEW</span></div>
            <div className="traffic-focus-corners"><i/><i/><i/><i/></div>
          </> : inputMode === 'cctv' && cctvLiveActive ? <><video ref={videoRef} src={cctvUrl} autoPlay muted playsInline controls onError={() => setCameraError('This feed could not be played in the browser. Try an HTTPS MP4/WebM or browser-compatible HLS URL, and check camera access/CORS.') } aria-label="CCTV live preview"/><div className="traffic-camera-overlay"><span><i/> CCTV FEED</span><span>USER-CONFIGURED SOURCE</span></div><div className="traffic-focus-corners"><i/><i/><i/><i/></div></> : inputMode === 'upload' && preview ? <div className="traffic-upload-preview">{file?.type?.startsWith('video/') ? <video src={preview} controls muted playsInline aria-label="Selected traffic video"/> : <img src={preview} alt="Selected road scene"/>}<button className="traffic-clear-image" onClick={() => { setFile(null); setPreview(''); setResult(null); if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current); previewUrlRef.current = ''; }} aria-label="Remove selected media"><X size={15}/></button></div> : inputMode === 'cctv' ? <div className="traffic-cctv-connect"><div className="traffic-camera-orb"><Link2 size={27}/></div><b>Connect a CCTV feed</b><p>Use a browser-playable HTTPS video URL. Raw RTSP links need a backend stream gateway.</p><label>Stream URL<input type="url" value={cctvUrl} onChange={e => setCctvUrl(e.target.value)} placeholder="https://camera.example.com/live.m3u8" /></label><button className="primary" onClick={connectCctv}><Video size={15}/> Connect feed</button></div> : <div className="traffic-empty-camera"><div className="traffic-camera-orb"><Camera size={29}/></div><b>{inputMode === 'camera' ? 'Ready when you are' : 'Upload a road image or video'}</b><p>{inputMode === 'camera' ? 'Start your device camera, then analyze a frame or enable repeated scanning.' : 'JPG, PNG, WebP up to 8 MB · MP4, WebM, MOV or AVI up to 100 MB'}</p>{inputMode === 'upload' && <label className="primary traffic-choose-file"><ImagePlus size={15}/> Browse media<input type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime,video/x-msvideo,.m4v,.avi" onChange={(e) => { setSelectedFile(e.target.files?.[0]); e.target.value = ''; }} hidden /></label>}</div>}
          <canvas ref={canvasRef} hidden />
        </div>
        {cameraError && <div className="traffic-error-line"><AlertTriangle size={15}/>{cameraError}</div>}
        {error && <div className="traffic-error-line"><AlertTriangle size={15}/><span>{error}</span></div>}
        <div className="traffic-capture-actions">
          {inputMode === 'camera' ? cameraActive ? <>
            <button className="primary" disabled={busy} onClick={() => runAnalysis()}>{busy ? <LoaderCircle className="spin" size={16}/> : <ScanLine size={16}/>} {busy ? 'Analyzing frame…' : 'Analyze frame'}</button>
            <button className={`traffic-secondary ${liveScan ? 'is-active' : ''}`} disabled={busy && !liveScan} onClick={() => { setLiveScan(!liveScan); if (!liveScan) setResult(null); }}><Activity size={16}/>{liveScan ? 'Stop live scan' : 'Live scan'}</button>
            <button className="traffic-icon-button" onClick={stopCamera} aria-label="Turn camera off" title="Turn camera off"><VideoOff size={17}/></button>
          </> : <button className="primary" onClick={startCamera}><Video size={16}/> Start camera</button> : inputMode === 'cctv' ? cctvLiveActive ? <>
            <button className="primary" disabled={busy} onClick={() => runAnalysis()}>{busy ? <LoaderCircle className="spin" size={16}/> : <ScanLine size={16}/>} {busy ? 'Analyzing frame…' : 'Analyze CCTV frame'}</button>
            <button className={`traffic-secondary ${liveScan ? 'is-active' : ''}`} disabled={busy && !liveScan} onClick={() => { setLiveScan(!liveScan); if (!liveScan) setResult(null); }}><Activity size={16}/>{liveScan ? 'Stop live scan' : 'Repeated scan'}</button>
            <button className="traffic-icon-button" onClick={() => { setCctvLiveActive(false); setLiveScan(false); }} aria-label="Disconnect CCTV feed"><VideoOff size={17}/></button>
          </> : null : <>
            <label className="primary" htmlFor="traffic-media-upload"><Upload size={16}/> {file ? 'Replace media' : 'Choose media'}<input id="traffic-media-upload" type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime,video/x-msvideo,.m4v,.avi" onChange={(e) => { setSelectedFile(e.target.files?.[0]); e.target.value = ''; }} hidden /></label>
            <button className="traffic-secondary" disabled={!file || busy} onClick={() => runAnalysis(file)}>{busy ? <LoaderCircle className="spin" size={16}/> : file?.type?.startsWith('video/') ? <FileVideo size={16}/> : <ScanLine size={16}/>} {busy ? 'Analyzing…' : file?.type?.startsWith('video/') ? 'Analyze video' : 'Analyze image'}</button>
          </>}
        </div>
        <div className="traffic-confidence-row"><label htmlFor="traffic-confidence">Detection confidence <b>{Math.round(confidence * 100)}%</b></label><input id="traffic-confidence" type="range" min="0.1" max="0.8" step="0.05" value={confidence} onChange={(e) => setConfidence(Number(e.target.value))}/><span>Lower finds more objects · higher is stricter</span></div>
      </section>

      <section className="panel traffic-results-panel" aria-live="polite">
        <div className="traffic-panel-heading"><div><span className="traffic-kicker">ANALYSIS OUTPUT</span><h3>Detection summary</h3><p>{result?.mode === 'video_model' ? `Sampled ${result.video?.sampled_frames || 0} video frames, not every frame.` : 'Vehicle counts are based on the analyzed frame.'}</p></div>{result && <button className="traffic-icon-button" onClick={clearResult} aria-label="Clear analysis"><RefreshCw size={16}/></button>}</div>
        {result ? <>
          <div className={`traffic-result-mode ${isSample ? 'sample' : 'actual'}`}><span>{isSample ? <Sparkles size={15}/> : <CheckCircle2 size={15}/>}</span><div><b>{isSample ? 'Reference scenario' : result.mode === 'video_model' ? 'Video analysis complete' : 'YOLO11 analysis complete'}</b><small>{isSample ? 'Indicative values · not detected from your scene' : result.mode === 'video_model' ? `${result.video?.sampled_frames || 0} sampled frames · sampled YOLO output` : 'Model output · uploaded frame is not stored by this feature'}</small></div></div>
          <div className="traffic-total-card"><div><span>{isSample ? 'Vehicles in reference scenario' : result.mode === 'video_model' ? 'Average vehicles per sampled frame' : 'Total vehicles detected'}</span><b>{total}</b><small>{isSample ? 'No detections were returned for this frame' : result.mode === 'video_model' ? `Peak ${result.peak_vehicles_in_sample ?? '—'} vehicles in a sampled frame` : `${result.total_detections} total objects detected, including other classes`}</small></div><div className={`traffic-level level-${String(result.congestion_estimate || 'low').toLowerCase()}`}><span>{isSample ? 'Reference level' : 'Preliminary level'}</span><b>{result.congestion_estimate}</b></div></div>
          <div className="traffic-count-list">{Object.entries(VEHICLE_LABELS).map(([key, label]) => <div className="traffic-count-row" key={key}><span><i className={`vehicle-dot ${key}`}/>{label}</span><b>{result.counts?.[key] ?? 0}</b><div className="traffic-count-track"><i style={{ width: `${Math.min(100, ((result.counts?.[key] ?? 0) / Math.max(1, ...Object.values(result.counts || {}))) * 100)}%` }}/></div></div>)}</div>
          {result.congestion_note && <p className="traffic-result-note"><CircleHelp size={15}/>{result.congestion_note}</p>}
          {!isSample && <button className="traffic-secondary traffic-report-button" onClick={exportReport}><Download size={15}/> Print / save report as PDF</button>}
          {result.mode === 'video_model' && result.short_clip_trend && <div className={`traffic-trend-callout ${result.short_clip_trend.direction}`}><div><b>Short-clip trend</b><span>{result.short_clip_trend.direction === 'rising' ? 'Vehicle count rising' : result.short_clip_trend.direction === 'falling' ? 'Vehicle count falling' : 'Vehicle count broadly stable'}</span></div><strong>{result.short_clip_trend.change_percent > 0 ? '+' : ''}{result.short_clip_trend.change_percent}%</strong><small>{result.short_clip_trend.note}</small></div>}
          {result.mode === 'video_model' && result.frames?.length > 0 && <div className="traffic-frame-timeline"><b>Sampled frame timeline</b><div>{result.frames.map(frame => <span key={frame.sample} title={`Frame ${frame.frame} · ${frame.vehicles} vehicles`}><i style={{height: `${Math.max(12, Math.min(100, frame.vehicles * 9))}%`}}/><small>{frame.timestamp_seconds ?? frame.sample}s</small></span>)}</div></div>}
          {result.detections?.length > 0 && <div className="traffic-detection-footer">{result.detections.length} objects · {Math.round(confidence * 100)}% confidence threshold</div>}
          {!isSample && <div className="traffic-signal-bridge"><label>Use this frame for a draft signal plan<select value={junctionId} onChange={(e) => setJunctionId(e.target.value)}><option value="">Select junction</option>{junctions.map((j) => <option key={j.id} value={j.id}>{j.name} · {j.id}</option>)}</select></label><button className="primary" onClick={useForSignalPlan} disabled={signalBusy || !junctionId}>{signalBusy ? 'Preparing plan…' : 'Create signal recommendation'}</button>{signalMessage && <p>{signalMessage}</p>}<small>Single image detections do not measure queue length, speed, or lane specific demand. Review the draft before simulation.</small><button className="traffic-secondary" onClick={() => navigate('/authority/traffic-lab')}>Open signal plans</button></div>}
        </> : <div className="traffic-results-empty"><div className="traffic-results-icon"><ScanLine size={25}/></div><b>Your results will appear here</b><p>Upload an image or short road video, start the device camera, or connect a browser-compatible CCTV feed to generate a report.</p><div className="traffic-mini-steps"><span><i>01</i> Capture</span><ChevronRight size={14}/><span><i>02</i> Detect</span><ChevronRight size={14}/><span><i>03</i> Review</span></div></div>}
      </section>
    </div>

    {result && <section className="panel traffic-annotated-panel"><div className="traffic-panel-heading"><div><span className="traffic-kicker">FRAME REVIEW</span><h3>{isSample ? 'Reference frame' : 'Annotated frame'}</h3><p>{isSample ? 'This reference scenario has no model-generated detection boxes.' : 'Boxes and labels are drawn by the supplied YOLO11 model.'}</p></div><span className="traffic-status-label">{isSample ? 'REFERENCE' : 'MODEL OUTPUT'}</span></div>
      {imageToShow ? <div className="traffic-annotated-image"><img src={imageToShow} alt={isSample ? 'Reference scenario frame, reference image without model annotations' : 'Road image with YOLO11 detection boxes'}/>{isSample && <div className="traffic-sample-watermark">REFERENCE SCENARIO</div>}</div> : <div className="empty-state"><b>No frame preview available</b><p>Analyze a camera frame or upload an image to display the visual result.</p></div>}
    </section>}

    <div className="traffic-bottom-grid">
      <section className="panel traffic-how-panel"><div className="traffic-panel-heading"><div><span className="traffic-kicker">HOW IT WORKS</span><h3>From frame to insight</h3></div></div><div className="traffic-how-steps"><div><span>01</span><div><b>Capture a scene</b><p>Upload an image/video, use a device camera, or connect a browser-playable CCTV source.</p></div></div><div><span>02</span><div><b>YOLO11 inference</b><p>The backend detects trained classes at a 640 pixel inference size.</p></div></div><div><span>03</span><div><b>Review counts</b><p>Cars, buses, motorbikes and bicycles are counted separately.</p></div></div></div></section>
      <section className="panel traffic-limits-panel"><div className="traffic-panel-heading"><div><span className="traffic-kicker">TRANSPARENT BY DESIGN</span><h3>What this MVP can tell you</h3></div></div><div className="traffic-limit-row"><CheckCircle2 size={16}/><span><b>Vehicle detections</b><small>Cars, buses, motorbikes and bicycles are aggregated in this report; all detector classes remain in the object total.</small></span></div><div className="traffic-limit-row"><AlertTriangle size={16}/><span><b>Not a live traffic flow metric</b><small>Vehicle count thresholds for low, medium, or high congestion are preliminary and vary with camera angle and road size.</small></span></div><div className="traffic-limit-row"><ShieldCheck size={16}/><span><b>Camera privacy</b><small>Browser cameras stay in your browser until analysis. Uploads are processed by the backend, and CCTV access depends on source permissions and CORS.</small></span></div></section>
    </div>
  </div>;
}
