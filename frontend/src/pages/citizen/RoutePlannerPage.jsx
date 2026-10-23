import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeftRight, ArrowRight, Clock, Leaf, MapPin, Navigation, Route, ShieldAlert, LocateFixed, Search, Utensils, HeartPulse, Landmark, Fuel, ExternalLink } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import PageIntro from '../../components/shared/PageIntro.jsx';
import CityMap, { getLocationCoordinates } from '../../components/maps/CityMap.jsx';
import { EmptyState, ErrorNotice } from '../../components/shared/Toast.jsx';
import { api } from '../../services/api/client.js';
import { useApp } from '../../context/AppContext.jsx';

const formatDuration = (seconds) => seconds == null ? '—' : seconds >= 3600 ? `${Math.floor(seconds / 3600)} hr ${Math.round((seconds % 3600) / 60)} min` : `${Math.max(1, Math.round(seconds / 60))} min`;
const formatDistance = (meters) => meters == null ? '—' : meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
function initialPoint(label) { const [lat, lon] = getLocationCoordinates(label); const known = ['New Delhi Railway Station', 'India Gate', 'Delhi NCR', 'New Delhi', 'Rajiv Chowk', 'Akshardham', 'Connaught Place', 'ITO Crossing', 'Mumbai', 'Bengaluru', 'Chennai', 'Kolkata', 'Hyderabad', 'Pune', 'Lucknow', 'Ahmedabad', 'Jaipur'].includes(label); return { label, latitude: lat, longitude: lon, resolved: known }; }
function googleMapsDirectionsUrl(origin, destination, mode, route) {
  const params = new URLSearchParams({
    api: '1',
    origin: `${Number(origin.latitude)},${Number(origin.longitude)}`,
    destination: `${Number(destination.latitude)},${Number(destination.longitude)}`,
    travelmode: mode === 'walking' ? 'walking' : mode === 'cycling' ? 'bicycling' : mode === 'transit' ? 'transit' : 'driving',
  });
  const coordinates = route?.geometry?.coordinates;
  if (Array.isArray(coordinates) && coordinates.length > 2) {
    // Send a few points from the selected road geometry as waypoints so Google Maps
    // follows the selected corridor as closely as its routing engine allows.
    const count = Math.min(7, coordinates.length - 2);
    const waypoints = Array.from({ length: count }, (_, i) => {
      const index = Math.round(((i + 1) / (count + 1)) * (coordinates.length - 1));
      const [longitude, latitude] = coordinates[index] || [];
      return Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude)) ? `${Number(latitude)},${Number(longitude)}` : null;
    }).filter(Boolean);
    if (waypoints.length) params.set('waypoints', waypoints.join('|'));
  }
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

export default function RoutePlannerPage({ embedded = false }) {
  const { notify } = useApp(); const location = useLocation();
  const [origin, setOrigin] = useState(() => initialPoint(location.state?.from || 'New Delhi Railway Station'));
  const [destination, setDestination] = useState(() => initialPoint(location.state?.to || 'India Gate'));
  const [placeSuggestions, setPlaceSuggestions] = useState({ origin: [], destination: [] });
  const [nearbyPlaces, setNearbyPlaces] = useState([]); const [nearbyBusy, setNearbyBusy] = useState(false); const [nearbyKind, setNearbyKind] = useState('all');
  const [resolving, setResolving] = useState(''); const [currentLocationBusy, setCurrentLocationBusy] = useState(false);
  const autoPlanTimer = useRef(null); const suggestTimer = useRef(null); const lastAutoKey = useRef('');
  useEffect(() => { if (!origin.resolved) resolveLocation('origin'); if (!destination.resolved) resolveLocation('destination'); }, []);
  const [preference, setPreference] = useState('balanced'); const [mode, setMode] = useState('driving');
  const [result, setResult] = useState(null); const [selectedRoute, setSelectedRoute] = useState(null); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [showCoords, setShowCoords] = useState(false);
  const markers = [{ id: 'origin', lat: origin.latitude, lng: origin.longitude, title: origin.label, kind: 'normal' }, { id: 'destination', lat: destination.latitude, lng: destination.longitude, title: destination.label, kind: 'critical' }];
  const updatePoint = (key, field, value) => {
    (key === 'origin' ? setOrigin : setDestination)((point) => ({ ...point, [field]: value, ...(field === 'label' ? { resolved: false } : {}) }));
    setResult(null); setSelectedRoute(null); setError('');
    if (field === 'label') {
      window.clearTimeout(suggestTimer.current);
      if (value.trim().length >= 2) suggestTimer.current = window.setTimeout(async () => {
        try {
          const response = await api.get(`/routing/geocode?q=${encodeURIComponent(value.trim())}&limit=5`);
          setPlaceSuggestions((old) => ({ ...old, [key]: response.results || [] }));
        } catch { /* typing remains available when the geocoder is offline */ }
      }, 300);
    }
  };
  const swap = () => { setOrigin(destination); setDestination(origin); setResult(null); setError(''); };
  async function resolveLocation(key, queryOverride) {
    const point = key === 'origin' ? origin : destination; const query = (queryOverride ?? point.label).trim();
    if (!query) return; if (point.resolved && !queryOverride) return;
    setResolving(key);
    try {
      const response = await api.get(`/routing/geocode?q=${encodeURIComponent(query)}&limit=5`);
      const results = response.results || []; setPlaceSuggestions((old) => ({ ...old, [key]: results }));
      if (!results.length) throw new Error(`No mapped location matched “${query}”. Try a landmark, area, or full address.`);
      const selected = results.find((item) => item.label.toLowerCase() === query.toLowerCase()) || results[0];
      (key === 'origin' ? setOrigin : setDestination)((old) => ({ ...old, label: selected.label, latitude: selected.latitude, longitude: selected.longitude, resolved: true }));
      setResult(null);
    } catch (err) { setError(err.message || 'Could not resolve the location.'); }
    finally { setResolving(''); }
  }
  const useCurrentLocation = () => {
    if (!navigator.geolocation) { setError('This browser does not support location access.'); return; }
    setCurrentLocationBusy(true); setError('');
    navigator.geolocation.getCurrentPosition(async (position) => {
      const latitude = position.coords.latitude, longitude = position.coords.longitude;
      let label = 'My current location';
      try { const reverse = await api.get(`/routing/reverse-geocode?latitude=${latitude}&longitude=${longitude}`); label = reverse.label || label; } catch {}
      setOrigin({ label, latitude, longitude, resolved: true }); setResult(null); setCurrentLocationBusy(false);
    }, (geoError) => { setCurrentLocationBusy(false); setError(geoError.code === 1 ? 'Location permission was denied. You can still search for any place.' : 'Could not retrieve your current location. Try again or search for a place.'); }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
  };
  const loadNearbyPlaces = useCallback(async () => {
    if (!destination.resolved || !Number.isFinite(Number(destination.latitude)) || !Number.isFinite(Number(destination.longitude))) return;
    setNearbyBusy(true);
    try { const response = await api.get(`/routing/nearby-places?latitude=${destination.latitude}&longitude=${destination.longitude}&radius_m=3000&kind=${nearbyKind}`); setNearbyPlaces(response.places || []); }
    catch { setNearbyPlaces([]); } finally { setNearbyBusy(false); }
  }, [destination.latitude, destination.longitude, destination.resolved, nearbyKind]);
  async function plan() {
    if (!origin.resolved) { await resolveLocation('origin'); return; }
    if (!destination.resolved) { await resolveLocation('destination'); return; }
    setBusy(true); setError(''); setResult(null);
    try {
      const payload = await api.post('/routing/plan', {
        origin_latitude: Number(origin.latitude), origin_longitude: Number(origin.longitude),
        destination_latitude: Number(destination.latitude), destination_longitude: Number(destination.longitude),
        origin_label: origin.label, destination_label: destination.label, preference, modes: [mode],
      });
      setResult(payload); setSelectedRoute(payload.routes?.[0] || null);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    if (!origin.resolved || !destination.resolved) return;
    const key = `${origin.latitude},${origin.longitude}|${destination.latitude},${destination.longitude}|${mode}|${preference}`;
    if (lastAutoKey.current === key) return;
    window.clearTimeout(autoPlanTimer.current);
    autoPlanTimer.current = window.setTimeout(() => { lastAutoKey.current = key; plan(); }, 450);
    return () => window.clearTimeout(autoPlanTimer.current);
    // plan uses the current values; the key scopes automatic updates to actual coordinate/mode changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin.latitude, origin.longitude, origin.resolved, destination.latitude, destination.longitude, destination.resolved, mode, preference]);
  useEffect(() => { loadNearbyPlaces(); }, [loadNearbyPlaces]);
  function selectRoute(route) {
    setSelectedRoute(route);
    const url = googleMapsDirectionsUrl(origin, destination, mode, route);
    window.open(url, '_blank', 'noopener,noreferrer');
    notify('Selected route opened in Google Maps. Google Maps may adjust the route while navigating.');
  }
  const displayedRoute = selectedRoute || result?.routes?.[0] || null;
  const googleMapsUrl = displayedRoute ? googleMapsDirectionsUrl(origin, destination, mode, displayedRoute) : null;
  return <>
    <PageIntro eyebrow={embedded ? 'CITY TRAVEL' : 'LIVE JOURNEY PLANNER'} title={embedded ? 'Where are you headed today?' : 'Plan a trip'} description="Search a place, choose from location suggestions, and compare routes with a road map and nearby recommendations." />
    <ErrorNotice message={error} onRetry={plan}/>
    <div className="planner-layout"><section className="panel planner-form"><div className="panel-head"><div><div className="eyebrow">YOUR JOURNEY</div><h3>Where to?</h3></div><button className="icon-btn" title="Swap origin and destination" onClick={swap}><ArrowLeftRight size={16}/></button></div>
      <label className="location-input"><span className="route-origin-dot"/><span><small>Starting from</small><input list="origin-place-suggestions" value={origin.label} onChange={(e) => updatePoint('origin', 'label', e.target.value)} onBlur={() => resolveLocation('origin')} aria-label="Starting location" placeholder="Search a place or address"/><datalist id="origin-place-suggestions">{placeSuggestions.origin.map((p) => <option key={p.place_id} value={p.label}/>)}</datalist></span></label>
      <label className="location-input"><span className="route-destination-dot"/><span><small>Going to</small><input list="destination-place-suggestions" value={destination.label} onChange={(e) => updatePoint('destination', 'label', e.target.value)} onBlur={() => resolveLocation('destination')} aria-label="Destination" placeholder="Search a place or address"/><datalist id="destination-place-suggestions">{placeSuggestions.destination.map((p) => <option key={p.place_id} value={p.label}/>)}</datalist></span></label>
      <div className="route-location-actions"><button className="text-action coordinate-toggle" onClick={() => setShowCoords(!showCoords)}>{showCoords ? 'Hide' : 'Edit'} map coordinates</button><button className="text-action" type="button" onClick={useCurrentLocation} disabled={currentLocationBusy}><LocateFixed size={14}/>{currentLocationBusy ? 'Finding location…' : 'Use my location'}</button></div>{resolving && <small className="route-resolving"><Search size={12}/> Finding mapped place…</small>}
      {showCoords && <div className="coordinates-grid">{[['origin','latitude','Origin latitude'],['origin','longitude','Origin longitude'],['destination','latitude','Destination latitude'],['destination','longitude','Destination longitude']].map(([key,field,label])=><label key={label}>{label}<input type="number" step="any" value={key==='origin'?origin[field]:destination[field]} onChange={(e)=>updatePoint(key,field,e.target.value)} required/></label>)}</div>}
      <div className="field-label">ROUTE PREFERENCE</div><div className="route-pref-options">{[['fastest','Fastest',Clock],['balanced','Balanced',Route],['cleanest','Cleanest',Leaf]].map(([value,label,Icon])=><button key={value} className={preference===value?'selected':''} onClick={()=>setPreference(value)}><Icon size={14}/>{label}</button>)}</div>
      <label className="mode-select">Travel mode<select value={mode} onChange={(e)=>setMode(e.target.value)}><option value="driving">Driving</option><option value="walking">Walking</option><option value="cycling">Cycling</option><option value="transit">Public transport</option></select></label>
      <button className="primary full plan-submit" onClick={plan} disabled={busy || resolving !== ''}><Navigation size={16}/>{busy ? 'Updating route…' : 'Show route options'}</button><small className="route-auto-note">Route and nearby recommendations refresh when a location is resolved or travel mode changes.</small>
    </section><section className="panel planner-map-panel"><div className="panel-head"><div><div className="eyebrow">ROUTE MAP</div><h3>{origin.label} → {destination.label}</h3></div><span className="status-pill">{displayedRoute ? 'Selected route' : result ? 'No route' : 'Preview'}</span></div><CityMap markers={markers} route={displayedRoute?.geometry?.coordinates?.map?.(([lon,lat]) => ({lat,lng:lon})) || []} zoom={12}/><div className="map-foot"><span><MapPin size={13}/> Origin & destination</span><small>Map tiles © OpenStreetMap</small></div>{googleMapsUrl && <div className="google-maps-route-action"><span><b>{displayedRoute.label || 'Selected route'}</b><small>{displayedRoute.provider || 'Routing service'} · {formatDistance(displayedRoute.distance_meters)} · {formatDuration(displayedRoute.duration_seconds)}</small></span><a className="primary" href={googleMapsUrl} target="_blank" rel="noreferrer"><Navigation size={15}/>Open selected route in Google Maps <ExternalLink size={14}/></a></div>}</section></div>
    <section className="route-results"><div className="section-heading"><div><div className="eyebrow">ROUTE OPTIONS</div><h3>{result ? `${result.routes?.length || 0} options returned` : 'Compare available journeys'}</h3></div>{result?.public_trip_id && <span className="status-pill">Trip ref {result.public_trip_id}</span>}</div>
      {result?.warnings?.length > 0 && <div className="warning-stack">{result.warnings.map((warning, i) => <div key={i}><ShieldAlert size={14}/>{warning}</div>)}</div>}
      {result?.routes?.length ? <div className="route-result-list">{result.routes.map((route) => <article className={`panel route-result ${displayedRoute === route ? 'route-result-selected' : ''}`} key={route.id ?? `${route.mode}-${route.label}`}><div className="route-result-icon"><Route size={18}/></div><div className="route-result-main"><b>{route.label || route.mode}</b><small>{route.mode} · {route.provider} · {route.data_quality}</small><div className="route-tags"><span><Clock size={13}/>{formatDuration(route.duration_seconds)}</span><span><MapPin size={13}/>{formatDistance(route.distance_meters)}</span>{route.transfers > 0 && <span>{route.transfers} transfers</span>}</div>{route.warnings?.map((warning) => <small className="route-warning" key={warning}>{warning}</small>)}</div><div className="route-result-end"><div><small>Estimated CO₂</small><b>{route.estimated_co2_grams == null ? '—' : `${Math.round(route.estimated_co2_grams)} g`}</b></div><button className="primary" onClick={() => selectRoute(route)}>Select & open Maps <ArrowRight size={14}/></button></div></article>)}</div> : <div className="panel"><EmptyState title={result ? 'No route options returned' : 'Your route options will appear here'} description={result ? 'The routing provider did not return any supported route alternatives for these inputs.' : 'Enter your journey preferences and request a route. The backend labels estimated backup routes and provider limitations.'}/></div>}
    </section>
    <section className="route-nearby-section"><div className="section-heading"><div><div className="eyebrow">AROUND YOUR DESTINATION</div><h3>Useful places along your trip</h3><p>Real mapped places near {destination.label || 'your destination'}.</p></div><select value={nearbyKind} onChange={(e) => setNearbyKind(e.target.value)} aria-label="Nearby place category"><option value="all">All useful places</option><option value="food">Food and cafés</option><option value="health">Health</option><option value="sights">Places to visit</option><option value="essentials">Essentials</option></select></div>
      {nearbyBusy ? <div className="panel nearby-empty">Finding nearby places…</div> : nearbyPlaces.length ? <div className="route-nearby-grid">{nearbyPlaces.slice(0, 8).map((place) => <article className="panel nearby-place-card" key={place.id}><span className="nearby-place-icon">{['restaurant','cafe','fast_food'].includes(place.category) ? <Utensils size={17}/> : ['hospital','clinic','pharmacy'].includes(place.category) ? <HeartPulse size={17}/> : ['fuel','toilets','bank','atm'].includes(place.category) ? <Fuel size={17}/> : <Landmark size={17}/>}</span><div><b>{place.name}</b><small>{String(place.category || 'place').replaceAll('_', ' ')} · {(place.distance_meters / 1000).toFixed(1)} km</small>{place.opening_hours && <small>{place.opening_hours}</small>}</div><a href={`https://www.openstreetmap.org/?mlat=${place.latitude}&mlon=${place.longitude}#map=17/${place.latitude}/${place.longitude}`} target="_blank" rel="noreferrer" aria-label={`Open ${place.name} in map`}><ExternalLink size={15}/></a></article>)}</div> : <div className="panel nearby-empty">No mapped places were returned for this area. Try another category or destination.</div>}
    </section>
  </>;
}
