import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, AlertTriangle, Camera, CheckCircle2, ChevronRight, CircleHelp, CloudOff, ImagePlus, LoaderCircle, RefreshCw, ScanLine, ShieldCheck, Sparkles, Upload, Video, VideoOff, X } from 'lucide-react';
import PageIntro from '../../components/shared/PageIntro.jsx';
import { api } from '../../services/api/client.js';

const DEMO_COUNTS = { car: 7, bus: 1, motorbike: 4, bicycle: 2 };
const VEHICLE_LABELS = { car: 'Cars', bus: 'Buses', motorbike: 'Motorbikes', bicycle: 'Bicycles' };

function makeDemoResult() {
  const total = Object.values(DEMO_COUNTS).reduce((sum, count) => sum + count, 0);
  return {
    mode: 'sample', model: 'Example preview', counts: DEMO_COUNTS, total_vehicles: total,
    total_detections: total + 2, congestion_estimate: 'High',
    congestion_note: 'Illustrative sample only. These counts were not detected from your image or camera.',
    detections: [],
  };
}

export default function TrafficVisionPage() {
  const [inputMode, setInputMode] = useState('camera');
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
      const imageFile = sourceFile || (inputMode === 'camera' ? await makeCameraFile() : file);
      if (!imageFile) throw new Error('Start the camera or choose an image first.');
      if (imageFile.size > 8 * 1024 * 1024) throw new Error('This image is larger than 8 MB. Choose a smaller image.');
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(imageFile.type)) throw new Error('Please use a JPG, PNG, or WebP image.');
      const form = new FormData();
      form.append('file', imageFile);
      const data = await api.postForm(`/traffic-detection/analyze?confidence=${confidence}`, form);
      setResult(data);
      setStatus((old) => ({ ...(old || {}), ready: true }));
      if (inputMode === 'camera') {
        const url = URL.createObjectURL(imageFile);
        if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = url;
        setPreview(url);
      }
    } catch (e) {
      // A clearly labelled sample is a deliberate fallback; never present it as model output.
      const msg = e?.message || 'Traffic analysis is temporarily unavailable.';
      setError(`${msg} Showing a sample preview instead.`);
      setResult(makeDemoResult());
      if (inputMode === 'camera' && videoRef.current?.videoWidth) {
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
    if (!liveScan || !cameraActive) return undefined;
    let cancelled = false;
    let timer;
    const tick = async () => {
      if (cancelled) return;
      await runAnalysis();
      if (!cancelled) timer = window.setTimeout(tick, 4500);
    };
    timer = window.setTimeout(tick, 300);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [liveScan, cameraActive, runAnalysis]);

  const useForSignalPlan = async () => {
    if (!result || result.mode !== 'model') return;
    if (!junctionId) { setSignalMessage('Create or register a junction in the authority workspace first.'); return; }
    setSignalBusy(true); setSignalMessage('');
    try {
      await api.post('/traffic/observations', {
        junction_id: Number(junctionId), source: 'yolo11_image_detection', vehicle_count: Number(result.total_vehicles || 0),
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
  const isSample = result?.mode === 'sample';
  const imageToShow = result?.annotated_image && !isSample ? `data:image/jpeg;base64,${result.annotated_image}` : preview;

  return <div className="traffic-vision-page">
    <PageIntro eyebrow="COMPUTER VISION · MVP" title="Traffic vision" description="Use your camera or upload a road image. YOLO11 detects vehicles and returns counts by vehicle type with an annotated frame." action={<span className={`traffic-model-pill ${status?.ready ? 'ready' : 'pending'}`}><span />{status?.ready ? 'Model service ready' : 'Example preview ready'}</span>} />

    {!status?.ready && <div className="traffic-inline-note"><CloudOff size={16}/><span><b>Model service not confirmed.</b> You can still explore the flow; if inference is unavailable, a an example preview is available.</span></div>}

    <div className="traffic-hero-grid">
      <section className="panel traffic-capture-panel">
        <div className="traffic-panel-heading"><div><span className="traffic-kicker">CAPTURE SOURCE</span><h3>Bring a road into focus</h3><p>Camera frames are only sent when you analyze them.</p></div><span className="traffic-lock"><ShieldCheck size={15}/> Private by default</span></div>
        <div className="traffic-source-tabs" role="tablist" aria-label="Traffic image source">
          <button className={inputMode === 'camera' ? 'active' : ''} onClick={() => { setInputMode('camera'); clearResult(); }} role="tab" aria-selected={inputMode === 'camera'}><Camera size={16}/> Camera</button>
          <button className={inputMode === 'upload' ? 'active' : ''} onClick={() => { setInputMode('upload'); clearResult(); stopCamera(); }} role="tab" aria-selected={inputMode === 'upload'}><Upload size={16}/> Upload image</button>
        </div>
        <div className={`traffic-viewfinder ${cameraActive && inputMode === 'camera' ? 'is-camera' : ''}`}>
          {inputMode === 'camera' && cameraActive ? <>
            <video ref={videoRef} autoPlay muted playsInline aria-label="Camera preview" />
            <div className="traffic-camera-overlay"><span><i/> CAMERA ON</span><span>LIVE PREVIEW</span></div>
            <div className="traffic-focus-corners"><i/><i/><i/><i/></div>
          </> : inputMode === 'upload' && preview ? <div className="traffic-upload-preview"><img src={preview} alt="Selected road scene"/><button className="traffic-clear-image" onClick={() => { setFile(null); setPreview(''); setResult(null); if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current); previewUrlRef.current = ''; }} aria-label="Remove selected image"><X size={15}/></button></div> : <div className="traffic-empty-camera"><div className="traffic-camera-orb"><Camera size={29}/></div><b>{inputMode === 'camera' ? 'Ready when you are' : 'Choose a road image'}</b><p>{inputMode === 'camera' ? 'Start your device camera, then capture a frame or enable live scan.' : 'JPG, PNG or WebP · up to 8 MB'}</p>{inputMode === 'upload' && <label className="primary traffic-choose-file"><ImagePlus size={15}/> Browse images<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => { setSelectedFile(e.target.files?.[0]); e.target.value = ''; }} hidden /></label>}</div>}
          <canvas ref={canvasRef} hidden />
        </div>
        {cameraError && <div className="traffic-error-line"><AlertTriangle size={15}/>{cameraError}</div>}
        {error && <div className="traffic-error-line"><AlertTriangle size={15}/><span>{error}</span></div>}
        <div className="traffic-capture-actions">
          {inputMode === 'camera' ? cameraActive ? <>
            <button className="primary" disabled={busy} onClick={() => runAnalysis()}>{busy ? <LoaderCircle className="spin" size={16}/> : <ScanLine size={16}/>} {busy ? 'Analyzing frame…' : 'Analyze frame'}</button>
            <button className={`traffic-secondary ${liveScan ? 'is-active' : ''}`} disabled={busy && !liveScan} onClick={() => { setLiveScan(!liveScan); if (!liveScan) setResult(null); }}><Activity size={16}/>{liveScan ? 'Stop live scan' : 'Live scan'}</button>
            <button className="traffic-icon-button" onClick={stopCamera} aria-label="Turn camera off" title="Turn camera off"><VideoOff size={17}/></button>
          </> : <button className="primary" onClick={startCamera}><Video size={16}/> Start camera</button> : <>
            <label className="primary" htmlFor="traffic-image-upload"><Upload size={16}/> {file ? 'Replace image' : 'Choose image'}<input id="traffic-image-upload" type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => { setSelectedFile(e.target.files?.[0]); e.target.value = ''; }} hidden /></label>
            <button className="traffic-secondary" disabled={!file || busy} onClick={() => runAnalysis(file)}>{busy ? <LoaderCircle className="spin" size={16}/> : <ScanLine size={16}/>} {busy ? 'Analyzing…' : 'Analyze image'}</button>
          </>}
        </div>
        <div className="traffic-confidence-row"><label htmlFor="traffic-confidence">Detection confidence <b>{Math.round(confidence * 100)}%</b></label><input id="traffic-confidence" type="range" min="0.1" max="0.8" step="0.05" value={confidence} onChange={(e) => setConfidence(Number(e.target.value))}/><span>Lower finds more objects · higher is stricter</span></div>
      </section>

      <section className="panel traffic-results-panel" aria-live="polite">
        <div className="traffic-panel-heading"><div><span className="traffic-kicker">ANALYSIS OUTPUT</span><h3>Detection summary</h3><p>Vehicle counts are based on one analyzed frame.</p></div>{result && <button className="traffic-icon-button" onClick={clearResult} aria-label="Clear analysis"><RefreshCw size={16}/></button>}</div>
        {result ? <>
          <div className={`traffic-result-mode ${isSample ? 'sample' : 'actual'}`}><span>{isSample ? <Sparkles size={15}/> : <CheckCircle2 size={15}/>}</span><div><b>{isSample ? 'Example preview' : 'YOLO11 analysis complete'}</b><small>{isSample ? 'Example values · not detected from your scene' : 'Model output · uploaded frame is not stored by this feature'}</small></div></div>
          <div className="traffic-total-card"><div><span>Total vehicles detected</span><b>{total}</b><small>{isSample ? 'Example count' : `${result.total_detections} total objects detected, including other classes`}</small></div><div className={`traffic-level level-${String(result.congestion_estimate || 'low').toLowerCase()}`}><span>{isSample ? 'Example level' : 'Preliminary level'}</span><b>{result.congestion_estimate}</b></div></div>
          <div className="traffic-count-list">{Object.entries(VEHICLE_LABELS).map(([key, label]) => <div className="traffic-count-row" key={key}><span><i className={`vehicle-dot ${key}`}/>{label}</span><b>{result.counts?.[key] ?? 0}</b><div className="traffic-count-track"><i style={{ width: `${Math.min(100, ((result.counts?.[key] ?? 0) / Math.max(1, ...Object.values(result.counts || {}))) * 100)}%` }}/></div></div>)}</div>
          {result.congestion_note && <p className="traffic-result-note"><CircleHelp size={15}/>{result.congestion_note}</p>}
          {result.detections?.length > 0 && <div className="traffic-detection-footer">{result.detections.length} objects · {Math.round(confidence * 100)}% confidence threshold</div>}
          {!isSample && <div className="traffic-signal-bridge"><label>Use this frame for a draft signal plan<select value={junctionId} onChange={(e) => setJunctionId(e.target.value)}><option value="">Select junction</option>{junctions.map((j) => <option key={j.id} value={j.id}>{j.name} · {j.id}</option>)}</select></label><button className="primary" onClick={useForSignalPlan} disabled={signalBusy || !junctionId}>{signalBusy ? 'Preparing plan…' : 'Create signal recommendation'}</button>{signalMessage && <p>{signalMessage}</p>}<small>Single image detections do not measure queue length, speed, or lane specific demand. Review the draft before simulation.</small><button className="traffic-secondary" onClick={() => navigate('/authority/signals')}>Open signal plans</button></div>}
        </> : <div className="traffic-results-empty"><div className="traffic-results-icon"><ScanLine size={25}/></div><b>Your results will appear here</b><p>Start the camera or upload a road image, then analyze a frame to see vehicle counts and detections.</p><div className="traffic-mini-steps"><span><i>01</i> Capture</span><ChevronRight size={14}/><span><i>02</i> Detect</span><ChevronRight size={14}/><span><i>03</i> Review</span></div></div>}
      </section>
    </div>

    {result && <section className="panel traffic-annotated-panel"><div className="traffic-panel-heading"><div><span className="traffic-kicker">FRAME REVIEW</span><h3>{isSample ? 'Preview frame' : 'Annotated frame'}</h3><p>{isSample ? 'This example has no model generated detection boxes.' : 'Boxes and labels are drawn by the supplied YOLO11 model.'}</p></div><span className="traffic-status-label">{isSample ? 'EXAMPLE' : 'MODEL OUTPUT'}</span></div>
      {imageToShow ? <div className="traffic-annotated-image"><img src={imageToShow} alt={isSample ? 'Example preview frame, example image without model annotations' : 'Road image with YOLO11 detection boxes'}/>{isSample && <div className="traffic-sample-watermark">EXAMPLE PREVIEW</div>}</div> : <div className="empty-state"><b>No frame preview available</b><p>Analyze a camera frame or upload an image to display the visual result.</p></div>}
    </section>}

    <div className="traffic-bottom-grid">
      <section className="panel traffic-how-panel"><div className="traffic-panel-heading"><div><span className="traffic-kicker">HOW IT WORKS</span><h3>From frame to insight</h3></div></div><div className="traffic-how-steps"><div><span>01</span><div><b>Capture a scene</b><p>Use a device camera or select a road image.</p></div></div><div><span>02</span><div><b>YOLO11 inference</b><p>The backend detects trained classes at a 640 pixel inference size.</p></div></div><div><span>03</span><div><b>Review counts</b><p>Cars, buses, motorbikes and bicycles are counted separately.</p></div></div></div></section>
      <section className="panel traffic-limits-panel"><div className="traffic-panel-heading"><div><span className="traffic-kicker">TRANSPARENT BY DESIGN</span><h3>What this MVP can tell you</h3></div></div><div className="traffic-limit-row"><CheckCircle2 size={16}/><span><b>Vehicle detections</b><small>For the five classes in the supplied project: bicycle, bus, car, motorbike and person.</small></span></div><div className="traffic-limit-row"><AlertTriangle size={16}/><span><b>Not a live traffic flow metric</b><small>Vehicle count thresholds for low, medium, or high congestion are preliminary and vary with camera angle and road size.</small></span></div><div className="traffic-limit-row"><ShieldCheck size={16}/><span><b>Camera privacy</b><small>Camera stays in your browser; only a frame is sent when you analyze. No audio is requested.</small></span></div></section>
    </div>
  </div>;
}
