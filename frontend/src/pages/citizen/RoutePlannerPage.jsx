import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeftRight, ArrowRight, Clock, Leaf, MapPin, Navigation, Route, ShieldAlert, LocateFixed, Search, Utensils, HeartPulse, Landmark, Fuel, ExternalLink } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import PageIntro from '../../components/shared/PageIntro.jsx';
import CityMap, { getLocationCoordinates } from '../../components/maps/CityMap.jsx';
import { EmptyState, ErrorNotice } from '../../components/shared/Toast.jsx';
import { api } from '../../services/api/client.js';
import { useApp } from '../../context/AppContext.jsx';
import { estimateRouteOnly } from '../../services/publicRouting.js';

const formatDuration = (seconds) => seconds == null ? '—' : seconds >= 3600 ? `${Math.floor(seconds / 3600)} hr ${Math.round((seconds % 3600) / 60)} min` : `${Math.max(1, Math.round(seconds / 60))} min`;
const formatDistance = (meters) => meters == null ? '—' : meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
const formatCO2 = (grams) => grams == null || !Number.isFinite(Number(grams)) ? 'Not available' : Number(grams) >= 1000 ? `${(Number(grams) / 1000).toFixed(2)} kg` : `${Math.round(Number(grams))} g`;

const routePalette = ['#26764f', '#8b9f4e', '#b17b3d', '#497d78', '#806c98'];
const routeIdentity = (route) => route?.id ?? `${route?.mode}-${route?.label}`;
function buildGoogleMapsUrl(route, origin, destination, mode) {
  if (!origin?.resolved || !destination?.resolved) return '';
  const coordinates = route?.geometry?.coordinates || [];
  const waypoints = coordinates.length >= 3 ? [...new Set([0.25, 0.5, 0.75]
    .map((fraction) => coordinates[Math.min(coordinates.length - 2, Math.max(1, Math.round((coordinates.length - 1) * fraction)))])
    .filter((point) => Array.isArray(point) && point.length >= 2)
    .map(([lon, lat]) => `${lat},${lon}`))] : [];
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

function finiteMetric(route, key) {
  if (route?.[key] == null || route?.[key] === '') return Number.POSITIVE_INFINITY;
  const value = Number(route[key]);
  return Number.isFinite(value) && value >= 0 ? value : Number.POSITIVE_INFINITY;
}
function sortRouteOptions(routes = [], preference = 'balanced') {
  const source = routes.map((route, index) => ({ route, index }));
  const co2Values = source.map(({ route }) => finiteMetric(route, 'estimated_co2_grams')).filter(Number.isFinite);
  const timeValues = source.map(({ route }) => finiteMetric(route, 'duration_seconds')).filter(Number.isFinite);
  const pollutionValues = source.map(({ route }) => finiteMetric(route, 'pollution_score')).filter(Number.isFinite);
  const rangeScore = (value, values) => {
    if (!Number.isFinite(value) || !values.length) return 0.5;
    const low = Math.min(...values), high = Math.max(...values);
    return high - low < 1e-9 ? 0.5 : (value - low) / (high - low);
  };
  source.sort((a, b) => {
    const ar = a.route, br = b.route;
    if (preference === 'fastest') {
      return finiteMetric(ar, 'duration_seconds') - finiteMetric(br, 'duration_seconds')
        || finiteMetric(ar, 'distance_meters') - finiteMetric(br, 'distance_meters') || a.index - b.index;
    }
    if (preference === 'cleanest') {
      const ap = finiteMetric(ar, 'pollution_score'), bp = finiteMetric(br, 'pollution_score');
      const pollutionOrder = pollutionValues.length ? ap - bp : 0;
      return pollutionOrder || finiteMetric(ar, 'estimated_co2_grams') - finiteMetric(br, 'estimated_co2_grams')
        || finiteMetric(ar, 'duration_seconds') - finiteMetric(br, 'duration_seconds') || a.index - b.index;
    }
    const score = (route) => {
      const time = rangeScore(finiteMetric(route, 'duration_seconds'), timeValues);
      const co2 = rangeScore(finiteMetric(route, 'estimated_co2_grams'), co2Values);
      const pollution = rangeScore(finiteMetric(route, 'pollution_score'), pollutionValues);
      return pollutionValues.length ? 0.40 * time + 0.35 * pollution + 0.25 * co2 : 0.70 * time + 0.30 * co2;
    };
    return score(ar) - score(br) || finiteMetric(ar, 'duration_seconds') - finiteMetric(br, 'duration_seconds') || a.index - b.index;
  });
  return source.map(({ route }, index) => ({
    ...route,
    label: route.data_quality !== 'road-network-route'
      ? (route.label || 'Distance/time estimate')
      : index === 0
        ? (preference === 'fastest' ? 'Fastest route' : preference === 'cleanest' ? (route.pollution_score == null ? 'Lowest CO₂ route' : 'Lowest-impact route') : 'Recommended balance')
        : `Alternative route ${index + 1}`,
    preference_rank: `${preference}-#${index + 1}`,
  }));
}

function initialPoint(label = '') { const clean = String(label || '').trim(); const [lat, lon] = clean ? getLocationCoordinates(clean) : [null, null]; const known = ['New Delhi Railway Station', 'India Gate', 'Delhi NCR', 'New Delhi', 'Rajiv Chowk', 'Akshardham', 'Connaught Place', 'ITO Crossing', 'Mumbai', 'Bengaluru', 'Chennai', 'Kolkata', 'Hyderabad', 'Pune', 'Lucknow', 'Ahmedabad', 'Jaipur'].includes(clean); return { label: clean, latitude: known ? lat : null, longitude: known ? lon : null, resolved: known }; }
async function resolveMappedPlace(query) {
  const clean = String(query || '').trim();
  if (!clean) throw new Error('Enter a starting point and destination.');
  const response = await api.get(`/routing/geocode?q=${encodeURIComponent(clean)}&limit=5`, { timeoutMs: 8500, fallbackGraceMs: 0 });
  const results = Array.isArray(response?.results) ? response.results : [];
  if (!results.length) throw new Error(response?.message || `No mapped location matched “${clean}”. Try a nearby landmark or full address.`);
  const selected = results.find((item) => String(item.label || '').toLowerCase() === clean.toLowerCase()) || results[0];
  const latitude = Number(selected.latitude), longitude = Number(selected.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) throw new Error(`The location “${clean}” did not return valid map coordinates.`);
  return { label: selected.label || clean, latitude, longitude, resolved: true };
}
export default function RoutePlannerPage({ embedded = false }) {
  const { notify } = useApp(); const location = useLocation(); const navigate = useNavigate();
  const [origin, setOrigin] = useState(() => initialPoint(location.state?.from || ''));
  const [destination, setDestination] = useState(() => initialPoint(location.state?.to || ''));
  const [nearbyPlaces, setNearbyPlaces] = useState([]); const [nearbyBusy, setNearbyBusy] = useState(false); const [nearbyKind, setNearbyKind] = useState('all');
  const [currentLocationBusy, setCurrentLocationBusy] = useState(false);
  const planRunRef = useRef(0);
  const pointLabelsRef = useRef({ origin: origin.label, destination: destination.label });
  const [preference, setPreference] = useState('balanced'); const [mode, setMode] = useState('driving');
  const [result, setResult] = useState(null); const [selectedRouteId, setSelectedRouteId] = useState(null); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [showCoords, setShowCoords] = useState(false);
  const markers = [origin.resolved && { id: 'origin', lat: origin.latitude, lng: origin.longitude, title: origin.label, kind: 'normal' }, destination.resolved && { id: 'destination', lat: destination.latitude, lng: destination.longitude, title: destination.label, kind: 'critical' }].filter(Boolean);
  const updatePoint = (key, field, value) => {
    // Any edit invalidates an in-flight route response so an older journey
    // cannot overwrite the newer endpoints on the map.
    planRunRef.current += 1;
    setBusy(false);
    if (field === 'label') {
      pointLabelsRef.current[key] = value;
    }
    (key === 'origin' ? setOrigin : setDestination)((point) => ({ ...point, [field]: value, ...(field === 'label' ? { resolved: false } : {}) }));
    setResult(null); setError('');
  };
  const swap = () => {
    planRunRef.current += 1;
    setBusy(false);
    pointLabelsRef.current = { origin: destination.label, destination: origin.label };
    setOrigin(destination); setDestination(origin); setResult(null); setError('');
  };
  const useCurrentLocation = () => {
    if (!navigator.geolocation) { setError('This browser does not support location access.'); return; }
    setCurrentLocationBusy(true); setError('');
    navigator.geolocation.getCurrentPosition(async (position) => {
      const latitude = position.coords.latitude, longitude = position.coords.longitude;
      let label = 'My current location';
      try { const reverse = await api.get(`/routing/reverse-geocode?latitude=${latitude}&longitude=${longitude}`); label = reverse.label || label; } catch {}
      planRunRef.current += 1; setBusy(false);
      pointLabelsRef.current.origin = label;
      setOrigin({ label, latitude, longitude, resolved: true }); setResult(null); setCurrentLocationBusy(false);
    }, (geoError) => { setCurrentLocationBusy(false); setError(geoError.code === 1 ? 'Location permission was denied. You can still search for any place.' : 'Could not retrieve your current location. Try again or search for a place.'); }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
  };
  const loadNearbyPlaces = useCallback(async () => {
    if (!destination.resolved || !Number.isFinite(Number(destination.latitude)) || !Number.isFinite(Number(destination.longitude))) return;
    setNearbyBusy(true);
    try { const response = await api.get(`/routing/nearby-places?latitude=${destination.latitude}&longitude=${destination.longitude}&radius_m=3000&kind=${nearbyKind}`); setNearbyPlaces(response.places || []); }
    catch { setNearbyPlaces([]); } finally { setNearbyBusy(false); }
  }, [destination.latitude, destination.longitude, destination.resolved, nearbyKind]);
  async function plan(event) {
    event?.preventDefault?.();
    const runId = ++planRunRef.current;
    const originQuery = origin.label.trim();
    const destinationQuery = destination.label.trim();
    setBusy(true); setError(''); setResult(null); setSelectedRouteId(null);
    try {
      if (!originQuery || !destinationQuery) throw new Error('Enter both a starting point and destination.');
      const [resolvedOrigin, resolvedDestination] = await Promise.all([
        origin.resolved ? Promise.resolve(origin) : resolveMappedPlace(originQuery),
        destination.resolved ? Promise.resolve(destination) : resolveMappedPlace(destinationQuery),
      ]);
      if (runId !== planRunRef.current) return;
      // A geocoding response for text that the user has since changed must not
      // silently route to the previously typed place.
      if (pointLabelsRef.current.origin.trim() !== originQuery || pointLabelsRef.current.destination.trim() !== destinationQuery) {
        throw new Error('Your locations changed while we were resolving them. Press Show route options again.');
      }
      pointLabelsRef.current = { origin: resolvedOrigin.label, destination: resolvedDestination.label };
      setOrigin(resolvedOrigin); setDestination(resolvedDestination);
      if (Math.abs(Number(resolvedOrigin.latitude) - Number(resolvedDestination.latitude)) < 1e-7
        && Math.abs(Number(resolvedOrigin.longitude) - Number(resolvedDestination.longitude)) < 1e-7) {
        throw new Error('Choose two different locations to plan a route.');
      }
      if (!['driving', 'walking', 'cycling'].includes(mode)) {
        throw new Error('Choose driving, walking or cycling here. Bus and train journeys are available in Public transport.');
      }
      const requestBody = {
        origin_latitude: Number(resolvedOrigin.latitude), origin_longitude: Number(resolvedOrigin.longitude),
        destination_latitude: Number(resolvedDestination.latitude), destination_longitude: Number(resolvedDestination.longitude),
        origin_label: resolvedOrigin.label, destination_label: resolvedDestination.label, preference, modes: [mode],
      };

      // Route planning and its external OSM lookups run on the configured API
      // host. The browser never calls third-party road routers directly, so
      // their CORS/preflight policies cannot break the route planner.
      let payload = null;
      let backendError = null;
      try {
        payload = await api.post('/routing/plan', requestBody, { timeoutMs: 40000 });
      } catch (requestError) {
        backendError = requestError;
      }
      if (runId !== planRunRef.current) return;
      if (pointLabelsRef.current.origin !== resolvedOrigin.label || pointLabelsRef.current.destination !== resolvedDestination.label) return;

      const returnedRoutes = Array.isArray(payload?.routes) ? payload.routes : [];
      const backendRoadRoutes = returnedRoutes.filter((route) =>
        route?.data_quality === 'road-network-route' && (route?.geometry?.coordinates || []).length >= 2
      );
      const backendEstimate = returnedRoutes.find((route) => route?.data_quality === 'estimated' && Number(route?.distance_meters) > 0);
      const selectedRoutes = backendRoadRoutes.length ? backendRoadRoutes : backendEstimate ? [backendEstimate] : [];
      const fallbackEstimate = !selectedRoutes.length && backendError
        ? estimateRouteOnly(resolvedOrigin, resolvedDestination, mode, backendError.message || 'The UrbanSaarthi API is temporarily unavailable.')
        : null;
      if (fallbackEstimate) selectedRoutes.push(fallbackEstimate);
      if (!selectedRoutes.length) {
        const reason = backendError?.message || payload?.warnings?.[0];
        throw new Error(reason ? `A route could not be loaded. ${reason}` : 'No mapped road route or estimate was returned. Check the locations and try again.');
      }

      const estimateOnly = selectedRoutes.every((route) => route.data_quality === 'estimated');
      const identifiedRoutes = selectedRoutes.map((route, index) => ({
        ...route,
        id: route.id || `route-${mode}-${index}-${Math.round(Number(route.distance_meters) || 0)}-${Math.round(Number(route.duration_seconds) || 0)}`,
      }));
      const orderedRoutes = sortRouteOptions(identifiedRoutes, preference);
      const orderedPayload = {
        ...(payload || {}),
        routes: orderedRoutes,
        warnings: [
          ...(payload?.warnings || []),
          ...(estimateOnly ? ['No mapped road path is available right now. The shown distance, time and CO₂ are estimates only.'] : orderedRoutes.length < 3 ? [`${orderedRoutes.length} distinct mapped route(s) were available for this journey.`] : []),
          ...(backendError ? ['The API could not be reached. This local distance/time estimate has no road geometry or live enrichment.'] : []),
        ],
        route_source: estimateOnly ? (payload ? 'UrbanSaarthi estimate' : 'Local distance/time estimate') : 'UrbanSaarthi API · OpenStreetMap routing',
      };
      setResult(orderedPayload);
      setSelectedRouteId(routeIdentity(orderedRoutes[0]));
    } catch (err) {
      if (runId === planRunRef.current) setError(err.message || 'Route planning failed.');
    } finally {
      if (runId === planRunRef.current) setBusy(false);
    }
  }
  useEffect(() => { if (result) loadNearbyPlaces(); }, [result, loadNearbyPlaces]);
  function selectRoute(route) { setSelectedRouteId(route.id ?? `${route.mode}-${route.label}`); notify(`Selected ${route.label || route.mode} route. The map and Google Maps handoff now use this option.`); }
  const displayRoutes = useMemo(() => sortRouteOptions(result?.routes || [], preference), [result, preference]);
  const selectedRoute = displayRoutes.find((route) => routeIdentity(route) === selectedRouteId) || displayRoutes[0] || null;
  const routeOptions = displayRoutes.map((route, index) => ({
    id: routeIdentity(route),
    label: route.label || `Route ${String.fromCharCode(65 + index)}`,
    color: routePalette[index % routePalette.length],
    selected: routeIdentity(route) === routeIdentity(selectedRoute),
    coordinates: route.geometry?.coordinates?.map?.(([lon, lat]) => ({ lat, lng: lon })) || [],
  }));
  const mappedRoutes = displayRoutes.filter((route) => (route.geometry?.coordinates || []).length > 1 && route.data_quality === 'road-network-route');
  const emissionValues = displayRoutes.map((route) => Number(route.estimated_co2_grams)).filter((value) => Number.isFinite(value));
  const lowestEmission = emissionValues.length ? Math.min(...emissionValues) : null;
  const highestEmission = emissionValues.length ? Math.max(...emissionValues) : null;
  const selectedEmission = selectedRoute?.estimated_co2_grams == null ? null : Number(selectedRoute.estimated_co2_grams);
  const selectedEmissionDownside = selectedEmission == null || lowestEmission == null ? null : Math.max(0, selectedEmission - lowestEmission);
  const carbonSpread = lowestEmission == null || highestEmission == null ? null : Math.max(0, highestEmission - lowestEmission);
  const googleMapsUrl = buildGoogleMapsUrl(selectedRoute, origin, destination, mode);
  return <>
    <PageIntro eyebrow={embedded ? 'CITY TRAVEL' : 'LIVE JOURNEY PLANNER'} title={embedded ? 'Where are you headed today?' : 'Plan a trip'} description="Compare mapped road alternatives by travel time, distance and estimated tailpipe CO₂, then open your chosen route in Google Maps." />
    <ErrorNotice message={error} onRetry={plan}/>
    <div className="planner-layout"><form className="panel planner-form" onSubmit={plan}><div className="panel-head"><div><div className="eyebrow">YOUR JOURNEY</div><h3>Where to?</h3></div><button type="button" className="icon-btn" title="Swap origin and destination" onClick={swap}><ArrowLeftRight size={16}/></button></div>
      <label className="location-input"><span className="route-origin-dot"/><span><small>Starting from</small><input value={origin.label} onChange={(e) => updatePoint('origin', 'label', e.target.value)} aria-label="Starting location" placeholder="Search a place or address" autoComplete="off"/></span></label>
      <label className="location-input"><span className="route-destination-dot"/><span><small>Going to</small><input value={destination.label} onChange={(e) => updatePoint('destination', 'label', e.target.value)} aria-label="Destination" placeholder="Search a place or address" autoComplete="off"/></span></label>
      <div className="route-location-actions"><button type="button" className="text-action coordinate-toggle" onClick={() => setShowCoords(!showCoords)}>{showCoords ? 'Hide' : 'Edit'} map coordinates</button><button className="text-action" type="button" onClick={useCurrentLocation} disabled={currentLocationBusy}><LocateFixed size={14}/>{currentLocationBusy ? 'Finding location…' : 'Use my location'}</button></div>
      {showCoords && <div className="coordinates-grid">{[['origin','latitude','Origin latitude'],['origin','longitude','Origin longitude'],['destination','latitude','Destination latitude'],['destination','longitude','Destination longitude']].map(([key,field,label])=><label key={label}>{label}<input type="number" step="any" value={key==='origin'?origin[field]:destination[field]} onChange={(e)=>updatePoint(key,field,e.target.value)} required/></label>)}</div>}
      <div className="field-label">ROUTE PREFERENCE</div><div className="route-pref-options">{[['fastest','Fastest',Clock],['balanced','Balanced',Route],['cleanest','Cleanest',Leaf]].map(([value,label,Icon])=><button type="button" key={value} className={preference===value?'selected':''} onClick={()=>setPreference(value)}><Icon size={14}/>{label}</button>)}</div>
      <label className="mode-select">Travel mode<select value={mode} onChange={(e)=>setMode(e.target.value)}><option value="driving">Driving</option><option value="walking">Walking</option><option value="cycling">Cycling</option></select></label>
      <button className="primary full plan-submit" type="submit" disabled={busy}><Navigation size={16}/>{busy ? 'Updating route…' : 'Show route options'}</button><small className="route-auto-note">Enter both places and choose Show route options when you are ready. Bus and train journeys are in Public transport.</small>
    </form><section className="panel planner-map-panel"><div className="panel-head"><div><div className="eyebrow">ROUTE MAP</div><h3>{origin.label} → {destination.label}</h3></div><span className={`status-pill ${mappedRoutes.length >= 3 ? 'status-success' : ''}`}>{busy ? 'Checking live routes…' : mappedRoutes.length >= 3 ? '3 road routes mapped' : mappedRoutes.length ? `${mappedRoutes.length} mapped route${mappedRoutes.length === 1 ? '' : 's'}` : result ? 'Distance estimate only' : 'Awaiting route'}</span></div><CityMap markers={markers} route={selectedRoute?.geometry?.coordinates?.map?.(([lon,lat]) => ({lat,lng:lon})) || []} routeOptions={routeOptions} zoom={12}/><div className="route-map-legend">{routeOptions.filter((item) => item.coordinates.length > 1).slice(0, 3).map((item) => <span key={item.id} className={item.selected ? 'active' : ''}><i style={{ background: item.color }} />{item.label}{item.selected && <small>Selected</small>}</span>)}</div><div className="map-foot"><span><MapPin size={13}/> {mappedRoutes.length ? 'Routes follow mapped roads' : 'No road path is available for this estimate'}</span><small>Map data © OpenStreetMap</small></div>{googleMapsUrl && <div className="route-map-actions"><span>{selectedRoute ? `Selected: ${selectedRoute.label || selectedRoute.mode}` : 'Choose a mapped route'}</span><a className="primary" href={googleMapsUrl} target="_blank" rel="noreferrer"><ExternalLink size={14}/> {selectedRoute?.data_quality === 'estimated' ? 'Calculate directions in Google Maps' : 'Open selected route in Google Maps'}</a></div>}</section></div>
    <section className="route-results"><div className="section-heading"><div><div className="eyebrow">ROUTE OPTIONS</div><h3>{result ? (mappedRoutes.length ? `${mappedRoutes.length} mapped road routes` : 'Journey estimate') : 'Compare available journeys'}</h3></div>{result?.public_trip_id && <span className="status-pill">Trip ref {result.public_trip_id}</span>}</div>
      {result?.warnings?.length > 0 && <div className="warning-stack">{result.warnings.map((warning, i) => <div key={i}><ShieldAlert size={14}/>{warning}</div>)}</div>}
      {displayRoutes.length > 0 && <div className="route-carbon-insight">
        <div className="route-carbon-insight-copy"><span>CARBON TRADE-OFF</span><h4>{carbonSpread == null ? 'Compare the estimated footprint' : `${formatCO2(carbonSpread)} spread across these options`}</h4><p>{selectedEmissionDownside == null ? 'Choose a route to compare its estimated tailpipe impact with the lowest-footprint option.' : selectedEmissionDownside <= 0.5 ? 'Your selected route has the lowest estimated tailpipe footprint in this comparison.' : `Your selected route carries approximately ${formatCO2(selectedEmissionDownside)} more tailpipe CO₂ than the lowest-footprint option.`}</p></div>
        <div className="route-carbon-insight-metric"><strong>{selectedEmissionDownside == null ? '—' : selectedEmissionDownside <= 0.5 ? 'Lowest' : `+${formatCO2(selectedEmissionDownside)}`}</strong><small>Selected route downside</small></div>
      </div>}
      {busy ? <div className="panel route-options-loading"><div className="loading-lines">Checking road-routing providers and sorting alternatives…</div></div> : displayRoutes.length ? <div className="route-carbon-grid">{displayRoutes.map((route, index) => {
        const key = routeIdentity(route);
        const active = key === routeIdentity(selectedRoute);
        const mapped = (route.geometry?.coordinates || []).length > 1 && route.data_quality === 'road-network-route';
        const estimateOnly = route.data_quality === 'estimated';
        const mapsUrl = buildGoogleMapsUrl({ ...route, geometry: route.geometry?.coordinates?.length > 1 ? route.geometry : { coordinates: [] } }, origin, destination, mode);
        const color = routePalette[index % routePalette.length];
        const grams = route.estimated_co2_grams == null || !Number.isFinite(Number(route.estimated_co2_grams)) ? null : Number(route.estimated_co2_grams);
        const emissions = displayRoutes.filter((item) => item.estimated_co2_grams != null).map((item) => Number(item.estimated_co2_grams)).filter((value) => Number.isFinite(value));
        const lowest = emissions.length ? Math.min(...emissions) : null;
        const highest = emissions.length ? Math.max(...emissions) : null;
        const fastest = Math.min(...displayRoutes.map((item) => Number(item.duration_seconds) || Infinity));
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
          <div className="route-carbon-footnote">{mapped ? 'Road-network path' : estimateOnly ? 'Distance/time estimate · no mapped path' : 'Distance estimate'} · {route.mode === 'driving' ? 'Petrol car proxy · 6.5 L/100 km · ≈149 g/km' : route.mode === 'transit' ? 'Transit emissions unavailable' : 'Zero direct tailpipe emissions'}</div>
          {route.warnings?.length > 0 && <div className="route-carbon-warning">{route.warnings[0]}</div>}
          <div className="route-carbon-actions"><button className={active ? 'secondary' : 'primary'} onClick={() => selectRoute(route)}>{active ? 'On map' : 'View route'} <ArrowRight size={14}/></button>{mapsUrl && <a className="route-google-link" href={mapsUrl} target="_blank" rel="noreferrer"><ExternalLink size={14}/> {mapped ? 'Google Maps' : 'Calculate in Google Maps'}</a>}</div>
        </article>;
      })}</div> : <div className="panel"><EmptyState title={result ? 'No route options returned' : 'Your route options will appear here'} description={result ? 'The routing provider did not return a usable road path for these inputs. No straight-line route is drawn.' : 'Enter your journey preferences and request a route. Mapped alternatives appear here with Google Maps handoff.'}/></div>}
      {displayRoutes.length > 0 && <p className="route-emissions-disclaimer">CO₂ values are estimates for route comparison, not live measurements. Driving estimates use UrbanSaarthi’s passenger petrol-car fuel-use assumption; actual emissions vary by vehicle, fuel, load, speed and traffic. Walking and cycling show zero direct tailpipe emissions.</p>}
    </section>
    <section className="route-nearby-section"><div className="section-heading"><div><div className="eyebrow">AROUND YOUR DESTINATION</div><h3>Useful places along your trip</h3><p>Real mapped places near {destination.label || 'your destination'}.</p></div><select value={nearbyKind} onChange={(e) => setNearbyKind(e.target.value)} aria-label="Nearby place category"><option value="all">All useful places</option><option value="food">Food and cafés</option><option value="health">Health</option><option value="sights">Places to visit</option><option value="essentials">Essentials</option></select></div>
      {nearbyBusy ? <div className="panel nearby-empty">Finding nearby places…</div> : nearbyPlaces.length ? <div className="route-nearby-grid">{nearbyPlaces.slice(0, 8).map((place) => <article className="panel nearby-place-card" key={place.id}><span className="nearby-place-icon">{['restaurant','cafe','fast_food'].includes(place.category) ? <Utensils size={17}/> : ['hospital','clinic','pharmacy'].includes(place.category) ? <HeartPulse size={17}/> : ['fuel','toilets','bank','atm'].includes(place.category) ? <Fuel size={17}/> : <Landmark size={17}/>}</span><div><b>{place.name}</b><small>{String(place.category || 'place').replaceAll('_', ' ')} · {(place.distance_meters / 1000).toFixed(1)} km</small>{place.opening_hours && <small>{place.opening_hours}</small>}</div><a href={`https://www.openstreetmap.org/?mlat=${place.latitude}&mlon=${place.longitude}#map=17/${place.latitude}/${place.longitude}`} target="_blank" rel="noreferrer" aria-label={`Open ${place.name} in map`}><ExternalLink size={15}/></a></article>)}</div> : <div className="panel nearby-empty">No mapped places were returned for this area. Try another category or destination.</div>}
    </section>
  </>;
}
