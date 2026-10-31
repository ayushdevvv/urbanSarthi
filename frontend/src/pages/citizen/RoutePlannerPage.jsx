import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeftRight, ArrowRight, Clock, Leaf, MapPin, Navigation, Route, ShieldAlert, LocateFixed, Search, Utensils, HeartPulse, Landmark, Fuel, ExternalLink } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import PageIntro from '../../components/shared/PageIntro.jsx';
import CityMap, { getLocationCoordinates } from '../../components/maps/CityMap.jsx';
import { EmptyState, ErrorNotice } from '../../components/shared/Toast.jsx';
import { api } from '../../services/api/client.js';
import { useApp } from '../../context/AppContext.jsx';

const formatDuration = (seconds) => seconds == null ? '—' : seconds >= 3600 ? `${Math.floor(seconds / 3600)} hr ${Math.round((seconds % 3600) / 60)} min` : `${Math.max(1, Math.round(seconds / 60))} min`;
const formatDistance = (meters) => meters == null ? '—' : meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
const formatCO2 = (grams) => grams == null || !Number.isFinite(Number(grams)) ? 'Not available' : Number(grams) >= 1000 ? `${(Number(grams) / 1000).toFixed(2)} kg` : `${Math.round(Number(grams))} g`;

const routePalette = ['#26764f', '#8b9f4e', '#b17b3d', '#497d78', '#806c98'];
const routeIdentity = (route) => route?.id ?? `${route?.mode}-${route?.label}`;
function buildGoogleMapsUrl(route, origin, destination, mode) {
  if (!origin?.resolved || !destination?.resolved) return '';
  const coordinates = route?.geometry?.coordinates || [];
  if (coordinates.length < 2) return '';
  const waypoints = [...new Set([0.25, 0.5, 0.75]
    .map((fraction) => coordinates[Math.min(coordinates.length - 2, Math.max(1, Math.round((coordinates.length - 1) * fraction)))])
    .filter((point) => Array.isArray(point) && point.length >= 2)
    .map(([lon, lat]) => `${lat},${lon}`))];
  const travelMode = ({ driving: 'driving', walking: 'walking', cycling: 'bicycling', transit: 'transit' })[mode] || 'driving';
  const params = new URLSearchParams({
    api: '1',
    origin: `${origin.latitude},${origin.longitude}`,
    destination: `${destination.latitude},${destination.longitude}`,
    travelmode: travelMode,
  });
  if (waypoints.length) params.set('waypoints', waypoints.slice(0, 3).join('|'));
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}
function initialPoint(label) { const [lat, lon] = getLocationCoordinates(label); const known = ['New Delhi Railway Station', 'India Gate', 'Delhi NCR', 'New Delhi', 'Rajiv Chowk', 'Akshardham', 'Connaught Place', 'ITO Crossing', 'Mumbai', 'Bengaluru', 'Chennai', 'Kolkata', 'Hyderabad', 'Pune', 'Lucknow', 'Ahmedabad', 'Jaipur'].includes(label); return { label, latitude: lat, longitude: lon, resolved: known }; }
export default function RoutePlannerPage({ embedded = false }) {
  const { notify } = useApp(); const location = useLocation(); const navigate = useNavigate();
  const [origin, setOrigin] = useState(() => initialPoint(location.state?.from || 'New Delhi Railway Station'));
  const [destination, setDestination] = useState(() => initialPoint(location.state?.to || 'India Gate'));
  const [placeSuggestions, setPlaceSuggestions] = useState({ origin: [], destination: [] });
  const [nearbyPlaces, setNearbyPlaces] = useState([]); const [nearbyBusy, setNearbyBusy] = useState(false); const [nearbyKind, setNearbyKind] = useState('all');
  const [resolving, setResolving] = useState(''); const [currentLocationBusy, setCurrentLocationBusy] = useState(false);
  const autoPlanTimer = useRef(null); const suggestTimer = useRef(null); const lastAutoKey = useRef('');
  useEffect(() => { if (!origin.resolved) resolveLocation('origin'); if (!destination.resolved) resolveLocation('destination'); }, []);
  const [preference, setPreference] = useState('balanced'); const [mode, setMode] = useState('driving');
  const [result, setResult] = useState(null); const [selectedRouteId, setSelectedRouteId] = useState(null); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [showCoords, setShowCoords] = useState(false);
  const markers = [{ id: 'origin', lat: origin.latitude, lng: origin.longitude, title: origin.label, kind: 'normal' }, { id: 'destination', lat: destination.latitude, lng: destination.longitude, title: destination.label, kind: 'critical' }];
  const updatePoint = (key, field, value) => {
    (key === 'origin' ? setOrigin : setDestination)((point) => ({ ...point, [field]: value, ...(field === 'label' ? { resolved: false } : {}) }));
    setResult(null); setError('');
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
    setBusy(true); setError('');
    try {
      const payload = await api.post('/routing/plan', {
        origin_latitude: Number(origin.latitude), origin_longitude: Number(origin.longitude),
        destination_latitude: Number(destination.latitude), destination_longitude: Number(destination.longitude),
        origin_label: origin.label, destination_label: destination.label, preference, modes: [mode],
      }, { cacheResponse: true });
      setResult(payload); setSelectedRouteId(payload?.routes?.[0]?.id ?? null);
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
  function selectRoute(route) { setSelectedRouteId(route.id ?? `${route.mode}-${route.label}`); notify(`Selected ${route.label || route.mode} route. The map and Google Maps handoff now use this option.`); }
  const selectedRoute = result?.routes?.find((route) => routeIdentity(route) === selectedRouteId) || result?.routes?.[0] || null;
  const routeOptions = (result?.routes || []).map((route, index) => ({
    id: routeIdentity(route),
    label: route.label || `Route ${String.fromCharCode(65 + index)}`,
    color: routePalette[index % routePalette.length],
    selected: routeIdentity(route) === routeIdentity(selectedRoute),
    coordinates: route.geometry?.coordinates?.map?.(([lon, lat]) => ({ lat, lng: lon })) || [],
  }));
  const mappedRoutes = (result?.routes || []).filter((route) => (route.geometry?.coordinates || []).length > 1 && route.data_quality === 'road-network-route');
  const emissionValues = (result?.routes || []).map((route) => Number(route.estimated_co2_grams)).filter((value) => Number.isFinite(value));
  const lowestEmission = emissionValues.length ? Math.min(...emissionValues) : null;
  const highestEmission = emissionValues.length ? Math.max(...emissionValues) : null;
  const selectedEmission = selectedRoute?.estimated_co2_grams == null ? null : Number(selectedRoute.estimated_co2_grams);
  const selectedEmissionDownside = selectedEmission == null || lowestEmission == null ? null : Math.max(0, selectedEmission - lowestEmission);
  const carbonSpread = lowestEmission == null || highestEmission == null ? null : Math.max(0, highestEmission - lowestEmission);
  const googleMapsUrl = buildGoogleMapsUrl(selectedRoute, origin, destination, mode);
  return <>
    <PageIntro eyebrow={embedded ? 'CITY TRAVEL' : 'LIVE JOURNEY PLANNER'} title={embedded ? 'Where are you headed today?' : 'Plan a trip'} description="Compare mapped road alternatives by travel time, distance and estimated tailpipe CO₂, then open your chosen route in Google Maps." />
    <ErrorNotice message={error} onRetry={plan}/>
    <div className="planner-layout"><section className="panel planner-form"><div className="panel-head"><div><div className="eyebrow">YOUR JOURNEY</div><h3>Where to?</h3></div><button className="icon-btn" title="Swap origin and destination" onClick={swap}><ArrowLeftRight size={16}/></button></div>
      <label className="location-input"><span className="route-origin-dot"/><span><small>Starting from</small><input list="origin-place-suggestions" value={origin.label} onChange={(e) => updatePoint('origin', 'label', e.target.value)} onBlur={() => resolveLocation('origin')} aria-label="Starting location" placeholder="Search a place or address"/><datalist id="origin-place-suggestions">{placeSuggestions.origin.map((p) => <option key={p.place_id} value={p.label}/>)}</datalist></span></label>
      <label className="location-input"><span className="route-destination-dot"/><span><small>Going to</small><input list="destination-place-suggestions" value={destination.label} onChange={(e) => updatePoint('destination', 'label', e.target.value)} onBlur={() => resolveLocation('destination')} aria-label="Destination" placeholder="Search a place or address"/><datalist id="destination-place-suggestions">{placeSuggestions.destination.map((p) => <option key={p.place_id} value={p.label}/>)}</datalist></span></label>
      <div className="route-location-actions"><button className="text-action coordinate-toggle" onClick={() => setShowCoords(!showCoords)}>{showCoords ? 'Hide' : 'Edit'} map coordinates</button><button className="text-action" type="button" onClick={useCurrentLocation} disabled={currentLocationBusy}><LocateFixed size={14}/>{currentLocationBusy ? 'Finding location…' : 'Use my location'}</button></div>{resolving && <small className="route-resolving"><Search size={12}/> Finding mapped place…</small>}
      {showCoords && <div className="coordinates-grid">{[['origin','latitude','Origin latitude'],['origin','longitude','Origin longitude'],['destination','latitude','Destination latitude'],['destination','longitude','Destination longitude']].map(([key,field,label])=><label key={label}>{label}<input type="number" step="any" value={key==='origin'?origin[field]:destination[field]} onChange={(e)=>updatePoint(key,field,e.target.value)} required/></label>)}</div>}
      <div className="field-label">ROUTE PREFERENCE</div><div className="route-pref-options">{[['fastest','Fastest',Clock],['balanced','Balanced',Route],['cleanest','Cleanest',Leaf]].map(([value,label,Icon])=><button key={value} className={preference===value?'selected':''} onClick={()=>setPreference(value)}><Icon size={14}/>{label}</button>)}</div>
      <label className="mode-select">Travel mode<select value={mode} onChange={(e)=>setMode(e.target.value)}><option value="driving">Driving</option><option value="walking">Walking</option><option value="cycling">Cycling</option><option value="transit">Public transport</option></select></label>
      <button className="primary full plan-submit" onClick={plan} disabled={busy || resolving !== ''}><Navigation size={16}/>{busy ? 'Updating route…' : 'Show route options'}</button><small className="route-auto-note">Route and nearby recommendations refresh when a location is resolved or travel mode changes.</small>
    </section><section className="panel planner-map-panel"><div className="panel-head"><div><div className="eyebrow">ROUTE MAP</div><h3>{origin.label} → {destination.label}</h3></div><span className={`status-pill ${mappedRoutes.length >= 3 ? 'status-success' : ''}`}>{mappedRoutes.length >= 3 ? '3 road routes mapped' : result ? `${mappedRoutes.length} mapped route${mappedRoutes.length === 1 ? '' : 's'}` : 'Awaiting route'}</span></div><CityMap markers={markers} route={selectedRoute?.geometry?.coordinates?.map?.(([lon,lat]) => ({lat,lng:lon})) || []} routeOptions={routeOptions} zoom={12}/><div className="route-map-legend">{routeOptions.filter((item) => item.coordinates.length > 1).slice(0, 3).map((item) => <span key={item.id} className={item.selected ? 'active' : ''}><i style={{ background: item.color }} />{item.label}{item.selected && <small>Selected</small>}</span>)}</div><div className="map-foot"><span><MapPin size={13}/> Each line follows mapped roads</span><small>Map data © OpenStreetMap</small></div>{googleMapsUrl && <div className="route-map-actions"><span>{selectedRoute ? `Selected: ${selectedRoute.label || selectedRoute.mode}` : 'Choose a mapped route'}</span><a className="primary" href={googleMapsUrl} target="_blank" rel="noreferrer"><ExternalLink size={14}/> Open selected route in Google Maps</a></div>}</section></div>
    <section className="route-results"><div className="section-heading"><div><div className="eyebrow">ROUTE OPTIONS</div><h3>{result ? `${mappedRoutes.length} mapped road routes` : 'Compare available journeys'}</h3></div>{result?.public_trip_id && <span className="status-pill">Trip ref {result.public_trip_id}</span>}</div>
      {result?.warnings?.length > 0 && <div className="warning-stack">{result.warnings.map((warning, i) => <div key={i}><ShieldAlert size={14}/>{warning}</div>)}</div>}
      {result?.routes?.length > 0 && <div className="route-carbon-insight">
        <div className="route-carbon-insight-copy"><span>CARBON TRADE-OFF</span><h4>{carbonSpread == null ? 'Compare the estimated footprint' : `${formatCO2(carbonSpread)} spread across these options`}</h4><p>{selectedEmissionDownside == null ? 'Choose a route to compare its estimated tailpipe impact with the lowest-footprint option.' : selectedEmissionDownside <= 0.5 ? 'Your selected route has the lowest estimated tailpipe footprint in this comparison.' : `Your selected route carries approximately ${formatCO2(selectedEmissionDownside)} more tailpipe CO₂ than the lowest-footprint option.`}</p></div>
        <div className="route-carbon-insight-metric"><strong>{selectedEmissionDownside == null ? '—' : selectedEmissionDownside <= 0.5 ? 'Lowest' : `+${formatCO2(selectedEmissionDownside)}`}</strong><small>Selected route downside</small></div>
      </div>}
      {result?.routes?.length ? <div className="route-carbon-grid">{result.routes.map((route, index) => {
        const key = routeIdentity(route);
        const active = key === routeIdentity(selectedRoute);
        const mapped = (route.geometry?.coordinates || []).length > 1 && route.data_quality === 'road-network-route';
        const mapsUrl = buildGoogleMapsUrl(route, origin, destination, mode);
        const color = routePalette[index % routePalette.length];
        const grams = route.estimated_co2_grams == null || !Number.isFinite(Number(route.estimated_co2_grams)) ? null : Number(route.estimated_co2_grams);
        const emissions = (result.routes || []).filter((item) => item.estimated_co2_grams != null).map((item) => Number(item.estimated_co2_grams)).filter((value) => Number.isFinite(value));
        const lowest = emissions.length ? Math.min(...emissions) : null;
        const highest = emissions.length ? Math.max(...emissions) : null;
        const fastest = Math.min(...(result.routes || []).map((item) => Number(item.duration_seconds) || Infinity));
        const isLowest = grams != null && lowest != null && grams <= lowest + 0.05;
        const isFastest = Number(route.duration_seconds) === fastest;
        const delta = grams != null && lowest != null && lowest > 0 ? Math.round(((grams - lowest) / lowest) * 100) : 0;
        const downsideGrams = grams != null && lowest != null ? Math.max(0, grams - lowest) : null;
        const barWidth = grams == null || !highest ? 0 : Math.max(5, (grams / highest) * 100);
        return <article className={`panel route-carbon-card ${active ? 'route-carbon-card-selected' : ''}`} key={key} style={{ '--route-accent': color, '--route-accent-soft': `${color}17` }}>
          <div className="route-carbon-card-head">
            <div className="route-carbon-name"><span className="route-color-marker"/><div><small>ALTERNATIVE {String(index + 1).padStart(2, '0')}</small><h4>{route.label || `Route ${String.fromCharCode(65 + index)}`}</h4></div></div>
            <div className="route-carbon-badges">{isLowest && <span className="route-carbon-badge lowest"><Leaf size={11}/> Lowest CO₂</span>}{isFastest && <span className="route-carbon-badge fastest"><Clock size={11}/> Fastest</span>}</div>
          </div>
          <div className="route-carbon-stats"><div><span><Clock size={13}/> ARRIVAL</span><b>{formatDuration(route.duration_seconds)}</b></div><div><span><MapPin size={13}/> DISTANCE</span><b>{formatDistance(route.distance_meters)}</b></div></div>
          <div className="route-emission-card">
            <div className="route-emission-heading"><span>ESTIMATED TAILPIPE CO₂</span><span className="route-emission-leaf"><Leaf size={17}/></span></div>
            <div className="route-emission-value">{grams == null ? '—' : formatCO2(grams)}</div>
            <div className="route-emission-track"><i style={{ width: `${barWidth}%` }}/></div>
            <div className="route-emission-compare"><span>{isLowest ? 'Carbon advantage' : 'CO₂ downside vs lowest'}</span><b>{grams == null ? 'No estimate' : isLowest ? 'Lowest footprint' : `${formatCO2(downsideGrams)} more${lowest > 0 ? ` · +${delta}%` : ''}`}</b></div>
          </div>
          <div className="route-carbon-footnote">{mapped ? 'Road-network path' : 'Distance estimate'} · {route.mode === 'driving' ? 'Petrol car proxy · 6.5 L/100 km · ≈149 g/km' : route.mode === 'transit' ? 'Transit emissions unavailable' : 'Zero direct tailpipe emissions'}</div>
          {route.warnings?.length > 0 && <div className="route-carbon-warning">{route.warnings[0]}</div>}
          <div className="route-carbon-actions"><button className={active ? 'secondary' : 'primary'} onClick={() => selectRoute(route)}>{active ? 'On map' : 'View route'} <ArrowRight size={14}/></button>{mapped && <a className="route-google-link" href={mapsUrl} target="_blank" rel="noreferrer"><ExternalLink size={14}/> Google Maps</a>}</div>
        </article>;
      })}</div> : <div className="panel"><EmptyState title={result ? 'No route options returned' : 'Your route options will appear here'} description={result ? 'The routing provider did not return a usable road path for these inputs. No straight-line route is drawn.' : 'Enter your journey preferences and request a route. Mapped alternatives appear here with Google Maps handoff.'}/></div>}
      {result?.routes?.length > 0 && <p className="route-emissions-disclaimer">CO₂ values are estimates for route comparison, not live measurements. Driving estimates use UrbanSaarthi’s passenger petrol-car fuel-use assumption; actual emissions vary by vehicle, fuel, load, speed and traffic. Walking and cycling show zero direct tailpipe emissions.</p>}
    </section>
    <section className="route-nearby-section"><div className="section-heading"><div><div className="eyebrow">AROUND YOUR DESTINATION</div><h3>Useful places along your trip</h3><p>Real mapped places near {destination.label || 'your destination'}.</p></div><select value={nearbyKind} onChange={(e) => setNearbyKind(e.target.value)} aria-label="Nearby place category"><option value="all">All useful places</option><option value="food">Food and cafés</option><option value="health">Health</option><option value="sights">Places to visit</option><option value="essentials">Essentials</option></select></div>
      {nearbyBusy ? <div className="panel nearby-empty">Finding nearby places…</div> : nearbyPlaces.length ? <div className="route-nearby-grid">{nearbyPlaces.slice(0, 8).map((place) => <article className="panel nearby-place-card" key={place.id}><span className="nearby-place-icon">{['restaurant','cafe','fast_food'].includes(place.category) ? <Utensils size={17}/> : ['hospital','clinic','pharmacy'].includes(place.category) ? <HeartPulse size={17}/> : ['fuel','toilets','bank','atm'].includes(place.category) ? <Fuel size={17}/> : <Landmark size={17}/>}</span><div><b>{place.name}</b><small>{String(place.category || 'place').replaceAll('_', ' ')} · {(place.distance_meters / 1000).toFixed(1)} km</small>{place.opening_hours && <small>{place.opening_hours}</small>}</div><a href={`https://www.openstreetmap.org/?mlat=${place.latitude}&mlon=${place.longitude}#map=17/${place.latitude}/${place.longitude}`} target="_blank" rel="noreferrer" aria-label={`Open ${place.name} in map`}><ExternalLink size={15}/></a></article>)}</div> : <div className="panel nearby-empty">No mapped places were returned for this area. Try another category or destination.</div>}
    </section>
  </>;
}
