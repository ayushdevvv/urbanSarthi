import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, Copy, Cpu, DownloadCloud, RadioTower, RefreshCw, Router, Send, Signal, Wifi, WifiOff } from 'lucide-react';
import PageIntro from '../../components/shared/PageIntro.jsx';
import { api, API_BASE_URL } from '../../services/api/client.js';
import { useApp } from '../../context/AppContext.jsx';
import './monitoring-pages.css';

const fmt = (value, digits = 1) => value == null || !Number.isFinite(Number(value)) ? '—' : Number(value).toLocaleString(undefined, { maximumFractionDigits: digits });
const age = (value) => { if (!value) return 'No timestamp'; const mins = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000)); return mins < 1 ? 'Just now' : mins < 60 ? `${mins} min ago` : `${Math.floor(mins / 60)} hr ago`; };
const CODE = (endpoint) => `curl -X POST '${endpoint}' \
  -H 'Content-Type: application/json' \
  -H "X-Ingestion-Key: $INGESTION_API_KEY" \
  -d '{
    "external_station_id": "YOUR_DEVICE_ID",
    "station_name": "Your station name",
    "latitude": YOUR_LATITUDE,
    "longitude": YOUR_LONGITUDE,
    "source": "iot-http",
    "pm25": ACTUAL_PM25_READING,
    "pm10": ACTUAL_PM10_READING,
    "raw_payload": { "device": "ESP32", "sensor": "PMS5003" }
  }'`;

export default function IotNetworkPage() {
  const { notify } = useApp();
  const [readings, setReadings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [lastSent, setLastSent] = useState(null);
  const [form, setForm] = useState({ id: '', name: '', lat: '', lon: '', aqi: '', pm25: '', pm10: '', no2: '', o3: '', co: '' });
  const [formError, setFormError] = useState('');
  const refresh = useCallback(async () => { setLoading(true); try { const data = await api.get('/aqi/observations?max_age_hours=720&limit=200'); setReadings(Array.isArray(data) ? data : []); } catch (error) { notify(error.message || 'Could not load sensor observations.'); } finally { setLoading(false); } }, [notify]);
  useEffect(() => { refresh(); }, [refresh]);
  const deviceRows = useMemo(() => {
    const latest = new Map();
    readings.forEach((row) => { const key = row.external_station_id || row.station_name; if (!latest.has(key)) latest.set(key, row); });
    return [...latest.values()].sort((a, b) => new Date(b.observed_at) - new Date(a.observed_at));
  }, [readings]);
  const endpoint = `${API_BASE_URL}/aqi/observations`;
  async function copy(text) { try { await navigator.clipboard.writeText(text); notify('Copied to clipboard.'); } catch { notify('Clipboard access is unavailable in this browser.'); } }
  async function sendReading(event) {
    event.preventDefault(); setSending(true); setFormError('');
    try {
      if (!form.id.trim() || !form.name.trim() || form.lat === '' || form.lon === '') throw new Error('Add the actual device ID, station name and sensor coordinates.');
      const measurements = ['aqi', 'pm25', 'pm10', 'no2', 'o3', 'co'].filter((key) => form[key] !== '');
      if (!measurements.length) throw new Error('Enter at least one measurement from the connected sensor. Empty fields are not converted to zero.');
      const payload = {
        external_station_id: form.id.trim(), station_name: form.name.trim(), latitude: Number(form.lat), longitude: Number(form.lon), source: 'iot-http',
        ...Object.fromEntries(measurements.map((key) => [key, Number(form[key])])),
        raw_payload: { device_type: 'ESP32 / air sensor', transport: 'HTTP', submitted_from: 'Authority sensor console' },
      };
      const saved = await api.post('/aqi/observations', payload); setLastSent(saved); notify('Sensor observation accepted and stored.'); await refresh();
    } catch (error) { setFormError(error.message || 'Sensor observation could not be ingested.'); notify(error.message || 'Sensor observation could not be ingested.'); }
    finally { setSending(false); }
  }
  const freshCount = deviceRows.filter((row) => Date.now() - new Date(row.observed_at).getTime() < 15 * 60 * 1000).length;
  return <main className="monitor-page iot-page">
    <PageIntro eyebrow="FIELD NETWORK" title="IoT sensor network" description="Connect air-quality stations, receive readings and inspect the health of your ground monitoring network." action={<button className="monitor-button" onClick={refresh} disabled={loading}><RefreshCw size={14} className={loading ? 'monitor-spin' : ''}/>{loading ? 'Refreshing' : 'Refresh network'}</button>} />
    <section className="iot-hero"><div className="iot-hero-copy"><span className="monitor-overline"><RadioTower size={14}/> AIR MONITORING NETWORK</span><h2>Ground truth,<br/><em>from every corner.</em></h2><p>Bring distributed air sensors into one view. Every accepted observation becomes part of the station history and can be compared with the area forecast.</p><div className="iot-hero-actions"><a href="#connect-sensor" className="monitor-primary">Connect a sensor <Signal size={15}/></a><span><i/> HTTP ingestion available</span></div></div><div className="iot-network-visual"><div className="iot-network-core"><RadioTower size={29}/><span>AIR NETWORK</span></div><i className="iot-wave wave-one"/><i className="iot-wave wave-two"/><i className="iot-wave wave-three"/><span className="iot-node node-a"><Wifi size={14}/></span><span className="iot-node node-b"><Activity size={14}/></span><span className="iot-node node-c"><Signal size={14}/></span></div></section>
    <section className="monitor-kpis iot-kpis"><article className="monitor-kpi"><div className="kpi-icon green"><Router size={17}/></div><span>Stations observed</span><strong>{deviceRows.length}</strong><em>Unique station IDs in saved readings</em></article><article className="monitor-kpi"><div className="kpi-icon blue"><Wifi size={17}/></div><span>Recently active</span><strong>{freshCount}</strong><em>Telemetry received in the last 15 minutes</em></article><article className="monitor-kpi"><div className="kpi-icon amber"><DownloadCloud size={17}/></div><span>Saved observations</span><strong>{readings.length}</strong><em>Last 30 days · latest 200 returned</em></article><article className="monitor-kpi"><div className="kpi-icon mint"><Activity size={17}/></div><span>Last accepted reading</span><strong className="iot-last-time">{readings[0] ? age(readings[0].observed_at) : '—'}</strong><em>Based on stored observation time</em></article></section>

    <section className="monitor-grid iot-content-grid"><article className="monitor-panel sensor-registry"><div className="monitor-panel-heading"><div><span className="monitor-kicker">SENSOR REGISTRY</span><h3>Observed stations</h3><p>Stations are listed after at least one telemetry payload has been accepted.</p></div><span className="monitor-live-badge">{deviceRows.length} stations</span></div>
      {deviceRows.length ? <div className="iot-device-list">{deviceRows.slice(0, 8).map((row) => { const ageMs = Date.now() - new Date(row.observed_at).getTime(); const state = ageMs < 15 * 60 * 1000 ? 'fresh' : ageMs < 24 * 60 * 60 * 1000 ? 'delayed' : 'stale'; return <div className="iot-device-row" key={row.external_station_id || row.station_name}><span className="device-icon"><Cpu size={16}/></span><div className="device-meta"><b>{row.station_name}</b><small>{row.external_station_id || 'No external station ID'} · {row.source}</small></div><div className="device-values"><b>{fmt(row.pm25)} <small>PM2.5</small></b><b>{row.aqi != null ? <>{fmt(row.aqi, 0)} <small>AQI</small></> : <>{fmt(row.pm10)} <small>PM10</small></>}</b></div><span className={`device-state state-${state}`}><i/>{state}</span></div>; })}</div> : <div className="monitor-empty"><RadioTower size={22}/><b>Your network is ready for its first reading</b><span>Send telemetry from a connected device or use the test form to verify ingestion.</span></div>}
    </article>
    <article className="monitor-panel iot-connect-panel" id="connect-sensor"><div className="monitor-panel-heading"><div><span className="monitor-kicker">DEVICE CONNECTION</span><h3>Send a sensor reading</h3><p>Test the same HTTP endpoint your ESP32 or gateway can call.</p></div><span className="iot-connection-mark"><Signal size={17}/></span></div>
      <form className="iot-form" onSubmit={sendReading}><div className="iot-form-grid"><label>Station ID<input required value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value })}/></label><label>Station name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Actual station name"/></label><label>Latitude<input type="number" min="-90" max="90" step="any" required value={form.lat} onChange={(e) => setForm({ ...form, lat: e.target.value })}/></label><label>Longitude<input type="number" min="-180" max="180" step="any" required value={form.lon} onChange={(e) => setForm({ ...form, lon: e.target.value })}/></label><label>AQI · optional, source-provided<input type="number" min="0" max="1000" value={form.aqi} onChange={(e) => setForm({ ...form, aqi: e.target.value })}/></label><label>PM2.5 · µg/m³<input type="number" min="0" step="any" value={form.pm25} onChange={(e) => setForm({ ...form, pm25: e.target.value })}/></label><label>PM10 · µg/m³<input type="number" min="0" step="any" value={form.pm10} onChange={(e) => setForm({ ...form, pm10: e.target.value })}/></label><label>NO₂ · µg/m³<input type="number" min="0" step="any" value={form.no2} onChange={(e) => setForm({ ...form, no2: e.target.value })}/></label><label>O₃ · µg/m³<input type="number" min="0" step="any" value={form.o3} onChange={(e) => setForm({ ...form, o3: e.target.value })}/></label><label>CO · sensor unit<input type="number" min="0" step="any" value={form.co} onChange={(e) => setForm({ ...form, co: e.target.value })}/></label></div><button className="monitor-primary full-width" type="submit" disabled={sending}>{sending ? 'Sending reading…' : <><Send size={15}/> Ingest sensor reading</>}</button>{formError && <div className="iot-note iot-form-error"><AlertTriangle size={15}/><span>{formError}</span></div>}</form>
      {lastSent && <div className="iot-success"><CheckCircle2 size={15}/><span>Observation #{lastSent.id} accepted · {new Date(lastSent.observed_at).toLocaleString()}</span></div>}
    </article></section>

    <section className="monitor-panel iot-api-panel"><div className="monitor-panel-heading"><div><span className="monitor-kicker">FOR DEVICE DEVELOPERS</span><h3>HTTP ingestion endpoint</h3><p>Configure your edge device to POST a JSON observation to this endpoint.</p></div><div className="iot-api-actions"><button className="monitor-button" onClick={() => copy(endpoint)}><Copy size={14}/>Copy endpoint</button><a className="monitor-button" href="/esp32_pms5003_http.ino" download><DownloadCloud size={14}/>ESP32 sketch</a></div></div><div className="iot-endpoint-value">{endpoint}</div><div className="iot-code-wrap"><pre>{CODE(endpoint)}</pre><button className="monitor-copy-code" onClick={() => copy(CODE(endpoint))}><Copy size={14}/>Copy payload example</button></div><div className="iot-note"><WifiOff size={15}/><span>HTTP JSON ingestion is live. Use actual hardware measurements only. The backend checks X-Ingestion-Key in production; device-level key provisioning and MQTT are not included. The bundled ESP32 sketch uses plain HTTP for a trusted private LAN only; use HTTPS/TLS before sending readings over a public network. A station appears only after a real payload is stored.</span></div></section>
  </main>;
}
