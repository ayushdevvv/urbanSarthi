import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, AlertTriangle, Camera, CheckCircle2, CloudOff, FlaskConical, ImagePlus, Leaf, LoaderCircle, RotateCcw, ShieldCheck, Sparkles, Upload, Wind } from 'lucide-react';
import PageIntro from '../../components/shared/PageIntro.jsx';
import { api } from '../../services/api/client.js';
import './aqi-vision.css';

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const EMPTY_READINGS = { pm25: '', pm10: '', temperature: '', humidity: '', season: 'Monsoon', day_or_night: 'Day' };

function makeSampleResult() {
  return {
    mode: 'sample', model: 'Sample preview', predicted_category: 'Moderate', confidence: 78,
    probabilities: [
      { category: 'Good', probability: 4 }, { category: 'Moderate', probability: 78 },
      { category: 'Poor', probability: 8 }, { category: 'Satisfactory', probability: 6 },
      { category: 'Severe', probability: 2 }, { category: 'Very Poor', probability: 2 },
    ],
    note: 'Example values are shown because the model service did not return a result. They do not describe your photos or current air conditions.',
  };
}

const CATEGORY_HELP = {
  Good: 'The model predicts the Good category for the supplied inputs.',
  Satisfactory: 'The model predicts the Satisfactory category for the supplied inputs.',
  Moderate: 'The model predicts the Moderate category for the supplied inputs.',
  Poor: 'The model predicts the Poor category for the supplied inputs.',
  'Very Poor': 'The model predicts the Very Poor category for the supplied inputs.',
  Severe: 'The model predicts the Severe category for the supplied inputs.',
};

export default function AqiVisionPage() {
  const [inputMode, setInputMode] = useState('camera');
  const [activeSlot, setActiveSlot] = useState('front');
  const [cameraActive, setCameraActive] = useState(false);
  const [files, setFiles] = useState({ front: null, rear: null });
  const [previews, setPreviews] = useState({ front: '', rear: '' });
  const [readings, setReadings] = useState(EMPTY_READINGS);
  const [result, setResult] = useState(null);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [cameraError, setCameraError] = useState('');
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const previewUrlsRef = useRef({ front: '', rear: '' });
  const cameraBusyRef = useRef(false);

  useEffect(() => {
    let alive = true;
    api.get('/aqi-vision/status').then((data) => { if (alive) setStatus(data); }).catch(() => {
      if (alive) setStatus({ ready: false, inference_dependencies_available: false });
    });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => {});
    }
  }, [cameraActive, inputMode]);

  const stopCamera = useCallback(() => {
    if (streamRef.current) streamRef.current.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraActive(false);
  }, []);

  useEffect(() => () => {
    if (streamRef.current) streamRef.current.getTracks().forEach((track) => track.stop());
    for (const url of Object.values(previewUrlsRef.current)) if (url) URL.revokeObjectURL(url);
  }, []);

  const setCapture = (slot, file) => {
    if (!file) return;
    if (previewUrlsRef.current[slot]) URL.revokeObjectURL(previewUrlsRef.current[slot]);
    const url = URL.createObjectURL(file);
    previewUrlsRef.current[slot] = url;
    setFiles((old) => ({ ...old, [slot]: file }));
    setPreviews((old) => ({ ...old, [slot]: url }));
    setResult(null);
    setError('');
  };

  const startCamera = async () => {
    setCameraError('');
    if (streamRef.current) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Camera access needs HTTPS or localhost and a supported browser. You can upload both images instead.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false,
      });
      streamRef.current = stream;
      setInputMode('camera');
      setCameraActive(true);
      setResult(null);
      setError('');
      window.setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      }, 60);
    } catch (e) {
      setCameraError(e?.name === 'NotAllowedError'
        ? 'Camera permission was blocked. Allow access in browser settings or upload both images.'
        : 'Could not start the camera. Check if another app is using it, or upload the images.');
    }
  };

  const makeCameraFile = async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) throw new Error('Camera is still starting. Try again in a moment.');
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Camera frame capture is not supported by this browser.');
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88));
    if (!blob) throw new Error('Could not capture this camera frame. Try again.');
    return new File([blob], `urbansaarthi-aqi-${activeSlot}-${Date.now()}.jpg`, { type: 'image/jpeg' });
  };

  const captureCurrentView = async () => {
    if (cameraBusyRef.current) return;
    cameraBusyRef.current = true;
    try {
      const image = await makeCameraFile();
      setCapture(activeSlot, image);
      setCameraError('');
      setActiveSlot(activeSlot === 'front' ? 'rear' : 'front');
    } catch (e) {
      setCameraError(e?.message || 'Could not capture the camera frame.');
    } finally {
      cameraBusyRef.current = false;
    }
  };

  const chooseImage = (slot, file) => {
    if (!file) return;
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError('Use JPG, PNG, or WebP images for both views.');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError('Each image must be 8 MB or smaller.');
      return;
    }
    setCapture(slot, file);
  };

  const removeCapture = (slot) => {
    if (previewUrlsRef.current[slot]) URL.revokeObjectURL(previewUrlsRef.current[slot]);
    previewUrlsRef.current[slot] = '';
    setFiles((old) => ({ ...old, [slot]: null }));
    setPreviews((old) => ({ ...old, [slot]: '' }));
    setResult(null);
    setError('');
  };

  const changeReadings = (key, value) => {
    setReadings((old) => ({ ...old, [key]: value }));
    setResult(null);
    setError('');
  };

  const useExampleReadings = () => {
    setReadings({ pm25: '26.115', pm10: '41.0112', temperature: '26.95', humidity: '43.451', season: 'Monsoon', day_or_night: 'Night' });
    setResult(null);
    setError('');
  };

  const runAnalysis = async (event) => {
    event.preventDefault();
    if (busy) return;
    if (!files.front || !files.rear) {
      setError('Add both a front road photo and a rear road photo before running the model.');
      return;
    }
    const numericRules = [
      ['pm25', 'PM2.5', 0, 2000], ['pm10', 'PM10', 0, 2000], ['temperature', 'Temperature', -50, 70], ['humidity', 'Humidity', 0, 100],
    ];
    for (const [key, label, min, max] of numericRules) {
      const value = Number(readings[key]);
      if (readings[key] === '' || !Number.isFinite(value) || value < min || value > max) {
        setError(`${label} must be a number between ${min} and ${max}${key === 'pm25' || key === 'pm10' ? ' µg/m³' : key === 'temperature' ? ' °C' : '%'}.`);
        return;
      }
    }
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const form = new FormData();
      form.append('front_image', files.front);
      form.append('rear_image', files.rear);
      for (const key of Object.keys(readings)) form.append(key, readings[key]);
      const data = await api.postForm('/aqi-vision/analyze', form);
      setResult(data);
      setStatus((old) => ({ ...(old || {}), ready: true }));
    } catch (e) {
      const message = e?.message || 'AQI analysis did not complete.';
      // Only infrastructure/model failures use the explicit demo fallback; input errors stay actionable.
      if (!e?.status || e.status === 404 || e.status >= 500) {
        setError(`${message} The model did not produce this result, so a example report is shown.`);
        setResult(makeSampleResult());
      } else {
        setError(message);
      }
    } finally {
      setBusy(false);
    }
  };

  const isSample = result?.mode === 'sample';
  const hasResult = Boolean(result);

  return <div className="aqi-vision-page">
    <PageIntro
      eyebrow="MULTIMODAL AI · CAMERA + SENSOR INPUTS"
      title="AQI vision"
      description="Capture two road views, add the available sensor readings, and predict an AQI category with your trained UrbanSarthi model."
      action={<span className={`traffic-model-pill ${status?.ready ? 'ready' : 'pending'}`}><span />{status?.ready ? 'Model files detected' : 'Model service unconfirmed'}</span>}
    />

    {!status?.ready && <div className="aqiv-inline-note"><CloudOff size={17} /><span><b>Model service not connected.</b> You can prepare the inputs. If inference fails, the page uses a example preview, never a fake model result.</span></div>}

    <div className="aqiv-hero-grid">
      <section className="panel aqiv-capture-panel">
        <div className="traffic-panel-heading">
          <div><span className="traffic-kicker">STEP 01 · IMAGE INPUT</span><h3>Capture both road views</h3><p>The supplied model requires a front and rear image. Each frame is sent only when you analyze.</p></div>
          <span className="traffic-lock"><ShieldCheck size={15}/> Camera permission required</span>
        </div>
        <div className="traffic-source-tabs" role="tablist" aria-label="AQI image source">
          <button disabled={busy} className={inputMode === 'camera' ? 'active' : ''} role="tab" aria-selected={inputMode === 'camera'} onClick={() => { setInputMode('camera'); setResult(null); setError(''); }}><Camera size={16}/> Camera</button>
          <button disabled={busy} className={inputMode === 'upload' ? 'active' : ''} role="tab" aria-selected={inputMode === 'upload'} onClick={() => { setInputMode('upload'); stopCamera(); setResult(null); setError(''); }}><Upload size={16}/> Upload pair</button>
        </div>
        {inputMode === 'camera' ? <>
          <div className={`aqiv-viewfinder ${cameraActive ? 'is-camera' : ''}`}>
            {cameraActive ? <>
              <video ref={videoRef} autoPlay muted playsInline aria-label="Camera preview" />
              <div className="traffic-camera-overlay"><span><i /> CAMERA ON</span><span>{activeSlot === 'front' ? 'FRONT VIEW' : 'REAR VIEW'}</span></div>
              <div className="traffic-focus-corners"><i/><i/><i/><i/></div>
            </> : <div className="traffic-empty-camera"><div className="traffic-camera-orb"><Camera size={29}/></div><b>Ready to capture two views</b><p>Start the camera, frame a road view, capture it, then turn the camera toward the opposite view and capture again.</p><button className="primary" onClick={startCamera}><Camera size={15}/> Start camera</button></div>}
          </div>
          <div className="aqiv-slot-select" aria-label="Choose the image view to capture">
            <button disabled={busy} className={activeSlot === 'front' ? 'active' : ''} onClick={() => setActiveSlot('front')}><span className={files.front ? 'captured' : ''}>{files.front ? <CheckCircle2 size={14}/> : '1'}</span><b>Front view</b><small>{files.front ? 'Captured' : 'Capture this view first'}</small></button>
            <button disabled={busy} className={activeSlot === 'rear' ? 'active' : ''} onClick={() => setActiveSlot('rear')}><span className={files.rear ? 'captured' : ''}>{files.rear ? <CheckCircle2 size={14}/> : '2'}</span><b>Rear view</b><small>{files.rear ? 'Captured' : 'Capture the opposite view'}</small></button>
          </div>
          <div className="traffic-capture-actions">
            {cameraActive ? <>
              <button className="primary" disabled={busy} onClick={captureCurrentView}><Camera size={15}/> Capture {activeSlot} view</button>
              <button className="traffic-secondary" onClick={stopCamera}><Activity size={15}/> Stop camera</button>
            </> : <button className="traffic-secondary" onClick={startCamera}><RotateCcw size={15}/> Start camera again</button>}
          </div>
        </> : <div className="aqiv-upload-grid">
          {['front', 'rear'].map((slot) => <div className="aqiv-upload-slot" key={slot}>
            <div className="aqiv-image-preview">{previews[slot] ? <img src={previews[slot]} alt={`${slot} road view preview`} /> : <div><ImagePlus size={25}/><b>{slot === 'front' ? 'Front road view' : 'Rear road view'}</b><small>JPG, PNG or WebP · max 8 MB</small></div>}</div>
            <label className="traffic-secondary aqiv-file-label"><Upload size={15}/>{files[slot] ? 'Replace image' : `Choose ${slot} image`}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={(event) => { chooseImage(slot, event.target.files?.[0]); event.target.value = ''; }} /></label>
          </div>)}
        </div>}
        {inputMode === 'camera' && Object.values(files).some(Boolean) && <div className="aqiv-captured-grid">
          {['front', 'rear'].map((slot) => <article className={`aqiv-captured-card ${files[slot] ? 'filled' : ''}`} key={slot}>
            <div className="aqiv-captured-thumb">{previews[slot] ? <img src={previews[slot]} alt={`${slot} captured view`} /> : <ImagePlus size={18}/>}</div>
            <div className="aqiv-captured-details"><b>{slot === 'front' ? 'Front view' : 'Rear view'}</b><small>{files[slot] ? 'Ready for analysis' : 'Not captured yet'}</small>
              <div>{files[slot] && <button type="button" disabled={busy} onClick={() => removeCapture(slot)}>Remove</button>}<button type="button" disabled={busy} onClick={() => { setActiveSlot(slot); setInputMode('camera'); if (!cameraActive) startCamera(); }}> {files[slot] ? 'Retake' : 'Capture'} </button></div>
            </div>
          </article>)}
        </div>}
        {cameraError && <p className="traffic-error-line"><AlertTriangle size={14}/>{cameraError}</p>}
        <div className="aqiv-image-checklist">
          <span className={files.front ? 'done' : ''}><CheckCircle2 size={14}/> Front image {files.front ? 'added' : 'required'}</span>
          <span className={files.rear ? 'done' : ''}><CheckCircle2 size={14}/> Rear image {files.rear ? 'added' : 'required'}</span>
        </div>
        <p className="aqiv-private-note"><ShieldCheck size={14}/> No recording is stored by this page. Only the two chosen/captured frames are sent for inference when you submit.</p>
      </section>

      <section className="panel aqiv-input-panel">
        <div className="traffic-panel-heading">
          <div><span className="traffic-kicker">STEP 02 · SENSOR INPUTS</span><h3>Add conditions</h3><p>Enter readings from a trusted sensor or source. The model does not fetch official readings automatically.</p></div>
          <Wind size={20} className="aqiv-heading-icon"/>
        </div>
        <form onSubmit={runAnalysis}>
          <div className="aqiv-form-grid">
            <label><span>PM2.5 <small>µg/m³</small></span><input disabled={busy} inputMode="decimal" type="number" required min="0" max="2000" step="any" value={readings.pm25} onChange={(e) => changeReadings('pm25', e.target.value)} placeholder="e.g. 26.1" /></label>
            <label><span>PM10 <small>µg/m³</small></span><input disabled={busy} inputMode="decimal" type="number" required min="0" max="2000" step="any" value={readings.pm10} onChange={(e) => changeReadings('pm10', e.target.value)} placeholder="e.g. 41.0" /></label>
            <label><span>Temperature <small>°C</small></span><input disabled={busy} inputMode="decimal" type="number" required min="-50" max="70" step="any" value={readings.temperature} onChange={(e) => changeReadings('temperature', e.target.value)} placeholder="e.g. 26.9" /></label>
            <label><span>Humidity <small>%</small></span><input disabled={busy} inputMode="decimal" type="number" required min="0" max="100" step="any" value={readings.humidity} onChange={(e) => changeReadings('humidity', e.target.value)} placeholder="e.g. 43.5" /></label>
            <label><span>Season</span><select disabled={busy} value={readings.season} onChange={(e) => changeReadings('season', e.target.value)}><option>Monsoon</option><option>Summer</option><option>Winter</option></select></label>
            <label><span>Time of day</span><select disabled={busy} value={readings.day_or_night} onChange={(e) => changeReadings('day_or_night', e.target.value)}><option>Day</option><option>Night</option></select></label>
          </div>
          <button type="button" disabled={busy} className="aqiv-example-link" onClick={useExampleReadings}><FlaskConical size={14}/> Fill example readings <span>sample inputs</span></button>
          <button type="submit" className="primary full aqiv-analyze-button" disabled={busy}>{busy ? <><LoaderCircle size={16} className="spin"/> Running AQI model…</> : <><Sparkles size={16}/> Predict AQI category <span>→</span></>}</button>
        </form>
        {error && <div className="aqiv-error"><AlertTriangle size={15}/><span>{error}</span></div>}
        <div className="aqiv-model-spec"><div><span>IMAGE INPUT</span><b>2 × 128 × 128 RGB</b></div><div><span>MODEL OUTPUT</span><b>6 categories</b></div><div><span>INFERENCE</span><b>Backend · CPU/GPU when available</b></div></div>
      </section>
    </div>

    <section className={`panel aqiv-result-panel ${hasResult ? 'has-result' : ''}`}>
      <div className="traffic-panel-heading"><div><span className="traffic-kicker">STEP 03 · MODEL OUTPUT</span><h3>Prediction report</h3><p>Confidence describes the model's distribution for this input, not a guarantee of real world accuracy.</p></div>{hasResult && <span className={`traffic-status-label ${isSample ? 'sample' : ''}`}>{isSample ? 'EXAMPLE' : 'MODEL RESULT'}</span>}</div>
      {!hasResult ? <div className="aqiv-result-empty"><span><Leaf size={24}/></span><b>Your report will appear here</b><p>Capture or upload both views, enter the six required fields, then run the model.</p><div className="aqiv-result-steps"><i>1</i> Images <span>→</span> <i>2</i> Readings <span>→</span> <i>3</i> Prediction</div></div> : <>
        <div className="aqiv-result-summary">
          <div className={`aqiv-category-orb category-${(result.predicted_category || 'moderate').toLowerCase().replaceAll(' ', '-')}`}><span>{isSample ? <FlaskConical size={26}/> : <Wind size={26}/>}</span></div>
          <div className="aqiv-result-main"><span>{isSample ? 'EXAMPLE REPORT' : 'PREDICTED AQI CATEGORY'}</span><h2>{result.predicted_category}</h2><p>{isSample ? result.note : (CATEGORY_HELP[result.predicted_category] || result.note)}</p></div>
          <div className="aqiv-confidence"><b>{Number(result.confidence).toFixed(1)}<small>%</small></b><span>MODEL CONFIDENCE</span></div>
        </div>
        <div className="aqiv-probabilities"><div className="aqiv-prob-heading"><b>Category probabilities</b><small>{isSample ? 'Example values' : 'Model output · not calibrated as a probability of true AQI'}</small></div>
          {(result.probabilities || []).map((item) => <div className="aqiv-prob-row" key={item.category}><span>{item.category}</span><div><i style={{ width: `${Math.min(100, Math.max(0, Number(item.probability) || 0))}%` }}/></div><b>{Number(item.probability).toFixed(1)}%</b></div>)}
        </div>
        {result.inputs && <div className="aqiv-used-inputs"><b>Inputs used</b><div><span>PM2.5 <b>{result.inputs['PM2.5']} µg/m³</b></span><span>PM10 <b>{result.inputs.PM10} µg/m³</b></span><span>Temperature <b>{result.inputs.Temperature} °C</b></span><span>Humidity <b>{result.inputs.Humidity}%</b></span><span>Season <b>{result.inputs.Season}</b></span><span>Time <b>{result.inputs.Day_or_Night}</b></span></div></div>}
        <div className={`aqiv-result-disclaimer ${isSample ? 'sample' : ''}`}><AlertTriangle size={15}/><span>{isSample ? 'These example values are not generated by the trained model and do not describe your conditions.' : result.note}</span></div>
        <button className="traffic-secondary aqiv-reset-result" onClick={() => { setResult(null); setError(''); }}><RotateCcw size={14}/> Clear report and try again</button>
      </>}
    </section>

    <div className="aqiv-bottom-grid">
      <section className="panel aqiv-info-panel"><span className="traffic-kicker">HOW IT WORKS</span><h3>Built for paired road imagery</h3><div className="aqiv-info-row"><i>01</i><span><b>Two image encoders</b><small>Separate ResNet18 branches process the front and rear road views resized to the training size.</small></span></div><div className="aqiv-info-row"><i>02</i><span><b>Sensor preprocessing</b><small>The supplied scaler and one hot encoder transform the six fields into the nine features expected by the saved network.</small></span></div><div className="aqiv-info-row"><i>03</i><span><b>Category prediction</b><small>The classifier returns one of six labels and a softmax distribution. It does not return a numeric AQI.</small></span></div></section>
      <section className="panel aqiv-info-panel aqiv-limits-panel"><span className="traffic-kicker">IMPORTANT LIMITS</span><h3>Read the result responsibly</h3><div className="aqiv-limit-line"><CheckCircle2 size={15}/><span><b>Model checkpoint verified</b><small>Loaded with the architecture and preprocessing provided in the uploaded notebook.</small></span></div><div className="aqiv-limit-line"><AlertTriangle size={15}/><span><b>Not an official reading</b><small>Use a trusted sensor or official monitoring station for the numeric AQI and health guidance.</small></span></div><div className="aqiv-limit-line"><Activity size={15}/><span><b>Training results are not independent validation</b><small>The notebook reports 82.09% test accuracy and macro F1 0.7226; deployment accuracy can differ.</small></span></div></section>
    </div>
  </div>;
}
