import { useState } from 'react';
import { ArrowLeftRight, ArrowRight, Clock, Leaf, MapPin, Navigation, Route, ShieldAlert } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import PageIntro from '../../components/shared/PageIntro.jsx';
import CityMap, { getLocationCoordinates } from '../../components/maps/CityMap.jsx';
import { EmptyState, ErrorNotice } from '../../components/shared/Toast.jsx';
import { api } from '../../services/api/client.js';
import { useApp } from '../../context/AppContext.jsx';

const formatDuration = (seconds) => seconds == null ? '—' : seconds >= 3600 ? `${Math.floor(seconds / 3600)} hr ${Math.round((seconds % 3600) / 60)} min` : `${Math.max(1, Math.round(seconds / 60))} min`;
const formatDistance = (meters) => meters == null ? '—' : meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
function initialPoint(label, isOrigin) { const [lat, lon] = getLocationCoordinates(label); return { label, latitude: lat, longitude: lon }; }
export default function RoutePlannerPage() {
  const { notify } = useApp(); const location = useLocation(); const navigate = useNavigate();
  const [origin, setOrigin] = useState(() => initialPoint(location.state?.from || 'New Delhi Railway Station', true));
  const [destination, setDestination] = useState(() => initialPoint(location.state?.to || 'India Gate', false));
  const [preference, setPreference] = useState('balanced'); const [mode, setMode] = useState('driving');
  const [result, setResult] = useState(null); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [showCoords, setShowCoords] = useState(false);
  const markers = [{ id: 'origin', lat: origin.latitude, lng: origin.longitude, title: origin.label, kind: 'normal' }, { id: 'destination', lat: destination.latitude, lng: destination.longitude, title: destination.label, kind: 'critical' }];
  const coordinateRoute = [markers[0], markers[1]].map((p) => ({ lat: Number(p.lat), lng: Number(p.lng) }));
  const updatePoint = (key, field, value) => (key === 'origin' ? setOrigin : setDestination)((point) => ({ ...point, [field]: value }));
  const swap = () => { setOrigin(destination); setDestination(origin); setResult(null); };
  async function plan() {
    setBusy(true); setError(''); setResult(null);
    try {
      const payload = await api.post('/routing/plan', {
        origin_latitude: Number(origin.latitude), origin_longitude: Number(origin.longitude),
        destination_latitude: Number(destination.latitude), destination_longitude: Number(destination.longitude),
        origin_label: origin.label, destination_label: destination.label, preference, modes: [mode],
      });
      setResult(payload);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  async function selectRoute(route) {
    if (!result?.trip_id || !route.id) return notify('This route option is not persisted by the API and cannot be selected as a saved trip.');
    try { await api.post(`/trips/${result.trip_id}/select-route?route_option_id=${route.id}`); notify('Route selected. View it in My trips.'); navigate('/citizen/trips'); }
    catch (err) { notify(err.message); }
  }
  return <>
    <PageIntro eyebrow="LIVE JOURNEY PLANNER" title="Plan a trip" description="Compare routes using the connected routing service and review its data quality notes." />
    <ErrorNotice message={error} onRetry={plan}/>
    <div className="planner-layout"><section className="panel planner-form"><div className="panel-head"><div><div className="eyebrow">YOUR JOURNEY</div><h3>Where to?</h3></div><button className="icon-btn" title="Swap origin and destination" onClick={swap}><ArrowLeftRight size={16}/></button></div>
      <label className="location-input"><span className="route-origin-dot"/><span><small>Starting from</small><input value={origin.label} onChange={(e) => updatePoint('origin', 'label', e.target.value)} aria-label="Starting location"/></span></label>
      <label className="location-input"><span className="route-destination-dot"/><span><small>Going to</small><input value={destination.label} onChange={(e) => updatePoint('destination', 'label', e.target.value)} aria-label="Destination"/></span></label>
      <button className="text-action coordinate-toggle" onClick={() => setShowCoords(!showCoords)}>{showCoords ? 'Hide' : 'Edit'} map coordinates</button>
      {showCoords && <div className="coordinates-grid">{[['origin','latitude','Origin latitude'],['origin','longitude','Origin longitude'],['destination','latitude','Destination latitude'],['destination','longitude','Destination longitude']].map(([key,field,label])=><label key={label}>{label}<input type="number" step="any" value={key==='origin'?origin[field]:destination[field]} onChange={(e)=>updatePoint(key,field,e.target.value)} required/></label>)}</div>}
      <div className="field-label">ROUTE PREFERENCE</div><div className="route-pref-options">{[['fastest','Fastest',Clock],['balanced','Balanced',Route],['cleanest','Cleanest',Leaf]].map(([value,label,Icon])=><button key={value} className={preference===value?'selected':''} onClick={()=>setPreference(value)}><Icon size={14}/>{label}</button>)}</div>
      <label className="mode-select">Travel mode<select value={mode} onChange={(e)=>setMode(e.target.value)}><option value="driving">Driving</option><option value="walking">Walking</option><option value="cycling">Cycling</option><option value="transit">Public transport</option></select></label>
      <button className="primary full plan-submit" onClick={plan} disabled={busy}><Navigation size={16}/>{busy ? 'Planning route…' : 'Show route options'}</button>
    </section><section className="panel planner-map-panel"><div className="panel-head"><div><div className="eyebrow">ROUTE MAP</div><h3>{origin.label} → {destination.label}</h3></div><span className="status-pill">{result ? 'API response' : 'Preview'}</span></div><CityMap markers={markers} route={result?.routes?.[0]?.geometry?.coordinates?.map?.(([lon,lat]) => ({lat,lng:lon})) || coordinateRoute} zoom={12}/><div className="map-foot"><span><MapPin size={13}/> Origin & destination</span><small>Map tiles © OpenStreetMap</small></div></section></div>
    <section className="route-results"><div className="section-heading"><div><div className="eyebrow">ROUTE OPTIONS</div><h3>{result ? `${result.routes?.length || 0} options returned` : 'Compare available journeys'}</h3></div>{result?.public_trip_id && <span className="status-pill">Trip ref {result.public_trip_id}</span>}</div>
      {result?.warnings?.length > 0 && <div className="warning-stack">{result.warnings.map((warning, i) => <div key={i}><ShieldAlert size={14}/>{warning}</div>)}</div>}
      {result?.routes?.length ? <div className="route-result-list">{result.routes.map((route) => <article className="panel route-result" key={route.id ?? `${route.mode}-${route.label}`}><div className="route-result-icon"><Route size={18}/></div><div className="route-result-main"><b>{route.label || route.mode}</b><small>{route.mode} · {route.provider} · {route.data_quality}</small><div className="route-tags"><span><Clock size={13}/>{formatDuration(route.duration_seconds)}</span><span><MapPin size={13}/>{formatDistance(route.distance_meters)}</span>{route.transfers > 0 && <span>{route.transfers} transfers</span>}</div>{route.warnings?.map((warning) => <small className="route-warning" key={warning}>{warning}</small>)}</div><div className="route-result-end"><div><small>Estimated CO₂</small><b>{route.estimated_co2_grams == null ? '—' : `${Math.round(route.estimated_co2_grams)} g`}</b></div><button className="primary" onClick={() => selectRoute(route)}>Select route <ArrowRight size={14}/></button></div></article>)}</div> : <div className="panel"><EmptyState title={result ? 'No route options returned' : 'Your route options will appear here'} description={result ? 'The routing provider did not return any supported route alternatives for these inputs.' : 'Enter your journey preferences and request a route. The backend labels estimated backup routes and provider limitations.'}/></div>}
    </section>
  </>;
}
