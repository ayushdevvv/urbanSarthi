import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, AlertTriangle, CarFront, Clock3, Gauge, LocateFixed, MapPin, Pause, Play, RefreshCw, Route, Search, ShieldCheck, TrendingUp } from 'lucide-react';
import PageIntro from '../../components/shared/PageIntro.jsx';
import InlineLoadingIndicator from '../../components/shared/InlineLoadingIndicator.jsx';
import TrafficSimulationScene from '../authority/TrafficSimulationScene.jsx';
import trafficSimulationSeed from '../../data/trafficSimulationSeed.json';
import CityMap from '../../components/maps/CityMap.jsx';
import { api } from '../../services/api/client.js';
import { searchPublicPlaces } from '../../services/publicRouting.js';
import { readApiSnapshot, saveLocalRecord, readLocalRecord } from '../../services/apiSnapshot.js';
import './traffic-simulation.css';

const SCENARIO_KEY = 'urbansarthi.activeTrafficScenario';
const DEFAULT_POINT = { latitude: '28.6139', longitude: '77.2090', label: 'New Delhi' };
const EMPTY_POINT = { latitude: '', longitude: '', label: 'Your location' };
const SCENARIOS = {
  baseline: { label: 'Baseline traffic', multiplier: 1 },
  demand_surge: { label: 'Higher demand', multiplier: 1.45 },
  signal_priority: { label: 'Signal-priority sensitivity', multiplier: 0.72 },
};
const fmt = (value, suffix = '') => value === null || value === undefined || !Number.isFinite(Number(value)) ? '—' : `${Math.round(Number(value) * 10) / 10}${suffix}`;
const int = (value) => Number(value || 0).toLocaleString('en-IN');
const savedScenario = () => { try { const value = localStorage.getItem(SCENARIO_KEY); return SCENARIOS[value] ? value : 'baseline'; } catch { return 'baseline'; } };

function pickPlace(response, query) {
  const results = response?.results || [];
  if (!results.length) throw new Error(`No mapped place found for “${query}”. Try a landmark, locality, or full address.`);
  return results.find((item) => String(item.label).toLowerCase() === query.trim().toLowerCase()) || results[0];
}

async function resolveTrafficPlace(query) {
  let results = [];
  try {
    const response = await api.get(`/routing/geocode?q=${encodeURIComponent(query)}&limit=5`, { timeoutMs: 9000 });
    results = response?.results || [];
  } catch { /* public geocoder below keeps citizen search usable */ }
  if (!results.length) results = await searchPublicPlaces(query, 5);
  return pickPlace({ results }, query);
}

function queueLevel(value) {
  return value < 3 ? 'Free' : value < 10 ? 'Moderate' : 'Heavy';
}

// This bundled reference is a display-safe fallback only. Its source file contains
// a 30-minute network snapshot; minutes 30–60 hold the reference horizon rather
// than claiming an unavailable second model prediction.
function buildReferenceScenario(seed = trafficSimulationSeed, selectedScenario = 'baseline') {
  const baseRoads = Array.isArray(seed?.roads) ? seed.roads : [];
  const duration = 60;
  const step = 5;
  const startQueue = Number(seed?.queue_now) || 0;
  const horizonQueue = Number(seed?.predicted_queue_30min) || startQueue;
  const heavyStart = Number(seed?.heavy_roads_now) || 0;
  const heavyHorizon = Number(seed?.heavy_roads_30min) || heavyStart;
  const scenarioFactor = (minute) => {
    const progress = minute / duration;
    if (selectedScenario === 'demand_surge') return 1 + 0.22 * progress;
    if (selectedScenario === 'signal_priority') return Math.max(0.76, 1 - 0.14 * progress);
    return 1;
  };
  const timeline = [];
  for (let minute = 0; minute <= duration; minute += step) {
    const horizonProgress = Math.min(1, minute / 30);
    const factor = scenarioFactor(minute);
    const roads = baseRoads.map((road) => {
      const initial = Number(road.queue_now) || 0;
      const target = Number(road.predicted_queue_30min ?? initial) || 0;
      const queue = Math.max(0, (initial + (target - initial) * horizonProgress) * factor);
      return { road: road.road, queue: Number(queue.toFixed(1)), level: queueLevel(queue), vehicles: null };
    }).sort((a, b) => b.queue - a.queue);
    const networkQueue = Math.max(0, (startQueue + (horizonQueue - startQueue) * horizonProgress) * factor);
    const heavyRoads = Math.max(0, Math.min(Number(seed?.road_count) || 80, Math.round(heavyStart + (heavyHorizon - heavyStart) * horizonProgress)));
    timeline.push({
      minute,
      queue_total: Math.round(networkQueue),
      vehicles: minute === 0 ? Number(seed?.vehicles_now) || null : null,
      heavy_roads: heavyRoads,
      moderate_roads: null,
      free_roads: null,
      roads,
    });
  }
  const initial = timeline[0];
  const final = timeline[timeline.length - 1];
  return {
    mode: 'network-profile',
    scenario: selectedScenario,
    duration_minutes: duration,
    step_minutes: step,
    generated_at: null,
    summary: {
      queue_start: initial.queue_total,
      queue_end: final.queue_total,
      queue_change_percent: Number(((final.queue_total - initial.queue_total) / Math.max(initial.queue_total, 1) * 100).toFixed(1)),
      road_count: Number(seed?.road_count) || 80,
      heavy_roads_start: initial.heavy_roads,
      heavy_roads_end: final.heavy_roads,
    },
    timeline,
    notes: [
      seed?.note || 'Traffic network scenario.',
      'This scenario represents a network-level traffic outlook.',
      'The network horizon is extended to 60 minutes for playback.',
      ...(selectedScenario === 'demand_surge' ? ['The demand-surge variation is a sensitivity view, not a separately trained forecast.'] : selectedScenario === 'signal_priority' ? ['The signal-priority variation is a sensitivity view, not a measured signal-control outcome.'] : []),
    ],
  };
}

export default function TrafficInfoPage({ adminMode = false }) {
  const [point, setPoint] = useState(() => adminMode ? DEFAULT_POINT : EMPTY_POINT);
  const [provider, setProvider] = useState(null);
  const [scenario, setScenario] = useState(savedScenario);
  const [scenarioData, setScenarioData] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [frameIndex, setFrameIndex] = useState(0);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);
  const [searchMode, setSearchMode] = useState('location');
  const [locationQuery, setLocationQuery] = useState(() => adminMode ? 'New Delhi' : '');
  const [originQuery, setOriginQuery] = useState('New Delhi Railway Station');
  const [destinationQuery, setDestinationQuery] = useState('India Gate');
  const [suggestions, setSuggestions] = useState({ location: [], origin: [], destination: [] });
  const [routeGeometry, setRouteGeometry] = useState([]);
  const [routeAlternatives, setRouteAlternatives] = useState([]);
  const [selectedTrafficRouteId, setSelectedTrafficRouteId] = useState(null);
  const [showRouteAlternatives, setShowRouteAlternatives] = useState(true);
  const [showTrafficCrowd, setShowTrafficCrowd] = useState(true);
  const [roadFlowPoints, setRoadFlowPoints] = useState([]);
  const [mapMarkers, setMapMarkers] = useState([]);
  const [mappedRoute, setMappedRoute] = useState(null);
  const [searchBusy, setSearchBusy] = useState(false);
  const [locationBusy, setLocationBusy] = useState(false);
  const [nearbyRoads, setNearbyRoads] = useState([]);
  const [nearbyRoadsBusy, setNearbyRoadsBusy] = useState(false);
  const timerRef = useRef(null);
  const suggestTimer = useRef(null);

  const publishScenario = useCallback((next) => {
    setScenario(next);
    if (adminMode) {
      try { localStorage.setItem(SCENARIO_KEY, next); } catch { /* in-memory scenario still works */ }
      window.dispatchEvent(new CustomEvent('urbansarthi:traffic-scenario', { detail: { scenario: next, label: SCENARIOS[next]?.label } }));
    }
  }, [adminMode]);

  useEffect(() => {
    if (adminMode) return undefined;
    const sync = (event) => setScenario(event?.detail?.scenario || savedScenario());
    window.addEventListener('storage', sync);
    window.addEventListener('urbansarthi:traffic-scenario', sync);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener('urbansarthi:traffic-scenario', sync);
    };
  }, [adminMode]);

  const refresh = useCallback(async (overridePoint = point, overrideScenario = scenario, showProgress = false) => {
    const latitude = Number(overridePoint.latitude), longitude = Number(overridePoint.longitude);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      setError('Enter a valid location or choose one from the suggestions.'); return;
    }
    // Keep the workspace visible. Route-entry refreshes are silent; explicit
    // operator requests show progress only inside the relevant page panel.
    setFrameIndex(0); setPlaying(false);
    setActionLoading(Boolean(showProgress)); setError('');
    const params = new URLSearchParams({ minutes: '60', step_minutes: '5', scenario: overrideScenario });
    const scenarioPath = `/traffic/simulation/scenario?${params.toString()}`;
    try {
      const [current, timeline] = await Promise.all([
        api.get(`/traffic/current?latitude=${latitude}&longitude=${longitude}`).catch(() => null),
        api.get(scenarioPath),
      ]);
      if (!Array.isArray(timeline?.timeline) || timeline.timeline.length < 2 || !timeline.summary) {
        throw new Error('The simulation service returned an incomplete timeline.');
      }
      const snapshot = readApiSnapshot(scenarioPath);
      setProvider(current?.flow ? current : null);
      setScenarioData(timeline);
      setFrameIndex(0); setPlaying(false); setLastUpdated(new Date(snapshot?.savedAt || Date.now()).toISOString());
      if (snapshot) saveLocalRecord(`traffic-simulation:${overrideScenario}`, timeline, snapshot.savedAt);
      if (current?.flow == null) setError('');
    } catch (err) {
      setProvider(null);
      const isServiceFailure = !err?.status || err.status >= 500 || err.status === 408 || err.status === 429;
      const saved = isServiceFailure ? readLocalRecord(`traffic-simulation:${overrideScenario}`) : null;
      if (saved?.value?.timeline?.length) {
        setScenarioData(saved.value);
        setFrameIndex(0); setPlaying(false);
        setLastUpdated(new Date(saved.savedAt).toISOString());
      } else {
        setScenarioData(buildReferenceScenario(trafficSimulationSeed, overrideScenario));
        setLastUpdated(new Date().toISOString());
        setError('');
      }
    } finally { setActionLoading(false); }
  }, [point, scenario]);


  useEffect(() => {
    if (!playing || !adminMode || !scenarioData?.timeline?.length) return undefined;
    timerRef.current = window.setInterval(() => setFrameIndex((current) => {
      const last = scenarioData.timeline.length - 1;
      if (current >= last) { setPlaying(false); return last; }
      return current + 1;
    }), 1000);
    return () => window.clearInterval(timerRef.current);
  }, [playing, adminMode, scenarioData]);

  useEffect(() => () => { window.clearTimeout(suggestTimer.current); window.clearInterval(timerRef.current); }, []);

  const requestSuggestions = (field, query) => {
    window.clearTimeout(suggestTimer.current);
    if (query.trim().length < 2) { setSuggestions((old) => ({ ...old, [field]: [] })); return; }
    suggestTimer.current = window.setTimeout(async () => {
      try {
        const response = await api.get(`/routing/geocode?q=${encodeURIComponent(query.trim())}&limit=5`);
        setSuggestions((old) => ({ ...old, [field]: response.results || [] }));
      } catch { /* keep text search available if the geocoder is offline */ }
    }, 280);
  };

  const inspectRouteTraffic = async (route) => {
    const coordinates = route?.geometry?.coordinates || [];
    if (coordinates.length < 2) { setRoadFlowPoints([]); return; }
    const probeIndexes = [...new Set([Math.floor(coordinates.length * 0.18), Math.floor(coordinates.length * 0.38), Math.floor(coordinates.length * 0.58), Math.floor(coordinates.length * 0.78)])].filter((index) => index > 0 && index < coordinates.length - 1);
    const probeResults = await Promise.all(probeIndexes.map(async (index) => {
      const [longitude, latitude] = coordinates[index];
      try {
        const response = await api.get(`/traffic/current?latitude=${encodeURIComponent(latitude)}&longitude=${encodeURIComponent(longitude)}`);
        if (!response?.flow || response.flow.current_speed_kmph == null || response.flow.free_flow_speed_kmph == null) return null;
        const ratio = Number(response.flow.current_speed_kmph) / Math.max(1, Number(response.flow.free_flow_speed_kmph));
        return { id: `traffic-flow-${index}`, lat: Number(latitude), lng: Number(longitude), title: ratio < .4 ? 'Heavy traffic' : ratio < .72 ? 'Slow traffic' : 'Moving traffic', description: `${response.provider} · ${Math.round(response.flow.current_speed_kmph)} / ${Math.round(response.flow.free_flow_speed_kmph)} km/h`, kind: ratio < .4 ? 'critical' : ratio < .72 ? 'busy' : 'normal', currentSpeed: response.flow.current_speed_kmph, freeFlowSpeed: response.flow.free_flow_speed_kmph, provider: response.provider };
      } catch { return null; }
    }));
    setRoadFlowPoints(probeResults.filter(Boolean));
  };

  const selectTrafficRoute = async (route, index = 0) => {
    if (!route) return;
    const id = route.id ?? `${route.mode}-${route.label}-${index}`;
    setSelectedTrafficRouteId(id);
    const geometry = route?.geometry?.coordinates?.map?.(([lon, lat]) => ({ lat, lng: lon })) || [];
    setRouteGeometry(geometry);
    setMappedRoute({ label: route.label || `Route ${index + 1}`, distance: route.distance_meters, duration: route.duration_seconds, provider: route.provider });
    await inspectRouteTraffic(route);
  };

  const inspectLocationTraffic = async (selectedPoint) => {
    try {
      const response = await api.get(`/traffic/current?latitude=${encodeURIComponent(Number(selectedPoint.latitude))}&longitude=${encodeURIComponent(Number(selectedPoint.longitude))}`);
      if (!response?.flow || response.flow.current_speed_kmph == null || response.flow.free_flow_speed_kmph == null) { setRoadFlowPoints([]); return; }
      const ratio = Number(response.flow.current_speed_kmph) / Math.max(1, Number(response.flow.free_flow_speed_kmph));
      setRoadFlowPoints([{ id: 'traffic-flow-selected-location', lat: Number(selectedPoint.latitude), lng: Number(selectedPoint.longitude), title: ratio < .4 ? 'Heavy traffic' : ratio < .72 ? 'Slow traffic' : 'Moving traffic', description: `${response.provider} · ${Math.round(response.flow.current_speed_kmph)} / ${Math.round(response.flow.free_flow_speed_kmph)} km/h`, kind: ratio < .4 ? 'critical' : ratio < .72 ? 'busy' : 'normal' }]);
    } catch { setRoadFlowPoints([]); }
  };

  const loadNearbyRoads = async (selectedPoint) => {
    const latitude = Number(selectedPoint?.latitude), longitude = Number(selectedPoint?.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      setError('Choose a location or allow access to your current location.');
      return;
    }
    setNearbyRoadsBusy(true); setError('');
    try {
      const response = await api.get(`/traffic/nearby-roads?latitude=${encodeURIComponent(latitude)}&longitude=${encodeURIComponent(longitude)}&radius_m=2500`, { timeoutMs: 24000 });
      const roads = Array.isArray(response?.roads) ? response.roads : [];
      setNearbyRoads(roads);
      setRoadFlowPoints(roads.filter((road) => Number.isFinite(Number(road.latitude)) && Number.isFinite(Number(road.longitude))).map((road, index) => ({
        id: road.id || `nearby-road-${index}`, lat: Number(road.latitude), lng: Number(road.longitude),
        title: `${road.road_name || 'Nearby road'} · ${road.status || 'No reading'}`,
        description: road.current_speed_kmph == null ? `${Math.round(Number(road.distance_meters) || 0)} m away` : `${Math.round(Number(road.current_speed_kmph))} km/h`,
        kind: road.status === 'Heavy' || road.status === 'Closed' ? 'critical' : road.status === 'Slow' ? 'busy' : 'normal',
      })));
      setMapMarkers([{ id: 'traffic-location', lat: latitude, lng: longitude, title: selectedPoint.label || 'Selected location', description: 'Traffic lookup centre' }]);
      if (!roads.length) setError('No named roads were found near this location. Try a wider nearby area.');
      return response;
    } catch (err) {
      setNearbyRoads([]); setRoadFlowPoints([]);
      setError(err?.message || 'Nearby traffic could not be loaded. Try again in a moment.');
      return null;
    } finally { setNearbyRoadsBusy(false); }
  };

  const searchRoadActivity = async (event) => {
    event?.preventDefault?.();
    setSearchBusy(true); setError('');
    try {
      if (searchMode === 'location') {
        const query = locationQuery.trim();
        if (!query) throw new Error('Enter a place, neighbourhood, or address.');
        const selected = await resolveTrafficPlace(query);
        const nextPoint = { latitude: String(selected.latitude), longitude: String(selected.longitude), label: selected.label };
        setPoint(nextPoint); setLocationQuery(selected.label); setMappedRoute(null); setRouteGeometry([]); setRouteAlternatives([]); setSelectedTrafficRouteId(null); setRoadFlowPoints([]);
        setMapMarkers([{ id: 'traffic-location', lat: Number(selected.latitude), lng: Number(selected.longitude), title: selected.label, description: 'Selected area for traffic lookup' }]);
        if (adminMode) {
          await refresh(nextPoint, scenario, true);
          await inspectLocationTraffic(nextPoint);
        } else {
          await loadNearbyRoads(nextPoint);
        }
      } else {
        const from = originQuery.trim(), to = destinationQuery.trim();
        if (!from || !to) throw new Error('Enter both a starting point and destination.');
        const [origin, destination] = await Promise.all([
          resolveTrafficPlace(from),
          resolveTrafficPlace(to),
        ]);
        const nextPoint = { latitude: String(origin.latitude), longitude: String(origin.longitude), label: origin.label };
        setPoint(nextPoint); setOriginQuery(origin.label); setDestinationQuery(destination.label);
        setMapMarkers([
          { id: 'traffic-origin', lat: Number(origin.latitude), lng: Number(origin.longitude), title: origin.label, description: 'Route origin' },
          { id: 'traffic-destination', lat: Number(destination.latitude), lng: Number(destination.longitude), title: destination.label, description: 'Route destination', kind: 'critical' },
        ]);
        try {
          const trip = await api.post('/routing/plan', {
            origin_latitude: Number(origin.latitude), origin_longitude: Number(origin.longitude),
            destination_latitude: Number(destination.latitude), destination_longitude: Number(destination.longitude),
            origin_label: origin.label, destination_label: destination.label, preference: 'balanced', modes: ['driving'],
          }, { cacheResponse: true });
          const routes = Array.isArray(trip?.routes) ? trip.routes : [];
          setRouteAlternatives(routes);
          const route = routes[0];
          if (route) await selectTrafficRoute(route, 0);
          else { setRouteGeometry([]); setMappedRoute(null); setRoadFlowPoints([]); }
        } catch {
          setRouteGeometry([]); setRouteAlternatives([]); setRoadFlowPoints([]); setMappedRoute({ label: 'Route endpoints mapped', provider: 'Route planner' });
          setError('');
        }
        if (adminMode) await refresh(nextPoint, scenario, true);
      }
    } catch (err) { setError(err?.message || 'Could not look up that place. Try a nearby landmark or locality.'); }
    finally { setSearchBusy(false); }
  };

  const useCurrentLocation = () => {
    if (!navigator.geolocation) { setError('Location access is not supported by this browser.'); return; }
    setLocationBusy(true); setError('');
    navigator.geolocation.getCurrentPosition(async ({ coords }) => {
      let label = 'Your current location';
      try { const reverse = await api.get(`/routing/reverse-geocode?latitude=${coords.latitude}&longitude=${coords.longitude}`, { timeoutMs: 8000 }); label = reverse.label || label; } catch { /* coordinates remain usable */ }
      const nextPoint = { latitude: coords.latitude.toFixed(6), longitude: coords.longitude.toFixed(6), label };
      setPoint(nextPoint); setLocationQuery(label); setSearchMode('location'); setMappedRoute(null); setRouteGeometry([]); setRouteAlternatives([]); setSelectedTrafficRouteId(null); setRoadFlowPoints([]); setNearbyRoads([]);
      setMapMarkers([{ id: 'traffic-location', lat: coords.latitude, lng: coords.longitude, title: label, description: 'Your selected location' }]);
      if (adminMode) {
        await refresh(nextPoint, scenario, true);
        await inspectLocationTraffic(nextPoint);
      } else {
        await loadNearbyRoads(nextPoint);
      }
      setLocationBusy(false);
    }, (geoError) => {
      setLocationBusy(false);
      setError(geoError.code === 1 ? 'Location permission was denied. Allow access or search for a place.' : 'Could not get your current location.');
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
  };

  const timeline = scenarioData?.timeline || [];
  const frame = timeline[Math.min(frameIndex, Math.max(0, timeline.length - 1))] || null;
  const previousFrame = timeline[Math.max(0, frameIndex - 1)] || null;
  const roads = useMemo(() => [...(frame?.roads || [])].sort((a, b) => Number(b.queue || 0) - Number(a.queue || 0)), [frame]);
  const chartPoints = useMemo(() => {
    const data = timeline.slice(0, frameIndex + 1); if (data.length < 2) return '';
    const maxValue = Math.max(1, ...data.map((x) => Number(x.queue_total || 0)));
    return data.map((item, i) => `${(i / Math.max(data.length - 1, 1)) * 100},${96 - (Number(item.queue_total || 0) / maxValue) * 82}`).join(' ');
  }, [timeline, frameIndex]);
  const startPlayback = () => { if (!timeline.length) return; if (frameIndex >= timeline.length - 1) setFrameIndex(0); setPlaying(true); };
  const scenarioLabel = SCENARIOS[scenario]?.label || 'Baseline traffic';
  const mapRoute = routeGeometry.length > 1 ? routeGeometry : [];
  const activeTrafficRoute = routeAlternatives.find((route, index) => (route.id ?? `${route.mode}-${route.label}-${index}`) === selectedTrafficRouteId) || routeAlternatives[0] || null;
  const trafficWaypoints = (activeTrafficRoute?.geometry?.coordinates || []).filter((_, index, all) => index > 0 && index < all.length - 1 && index % Math.max(1, Math.floor(all.length / 7)) === 0).slice(0, 6).map(([lon, lat]) => `${lat},${lon}`);
  const selectedGoogleMapsUrl = searchMode === 'route' && mappedRoute
    ? `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(originQuery)}&destination=${encodeURIComponent(destinationQuery)}&travelmode=driving${trafficWaypoints.length ? `&waypoints=${encodeURIComponent(trafficWaypoints.join('|'))}` : ''}`
    : '';


  return <div className="traffic-info-page traffic-scenario-page">
    <PageIntro eyebrow={adminMode ? 'NETWORK OPERATIONS' : 'YOUR LOCAL ROAD CONDITIONS'} title={adminMode ? 'Traffic Simulation' : 'Traffic & road conditions'} description={adminMode ? 'Choose an area, set a signal scenario, and play through a 60-minute traffic simulation.' : 'Use your location to find nearby roads, see which streets are heavy, and inspect available traffic conditions.'} action={<button className="utility" onClick={() => adminMode ? refresh(point, scenario, true) : point.latitude ? loadNearbyRoads(point) : useCurrentLocation()} disabled={actionLoading || searchBusy || locationBusy || nearbyRoadsBusy}><RefreshCw size={14} className={(actionLoading || nearbyRoadsBusy) ? 'monitor-spin' : ''}/>{actionLoading || nearbyRoadsBusy ? 'Updating…' : adminMode ? 'Refresh outlook' : 'Refresh nearby roads'}</button>} />

    {adminMode ? <section className="panel traffic-location-panel traffic-admin-location-panel"><div className="traffic-info-heading"><span className="traffic-info-icon"><Activity size={18}/></span><div><h3>Simulation area</h3><p>Enter a place or use your current location, then run the 60-minute playback.</p></div></div>
      <form className="traffic-coordinate-form traffic-place-form traffic-admin-place-form" onSubmit={searchRoadActivity}><label>Enter a location<input list="traffic-admin-location-suggestions" value={locationQuery} onChange={(e) => { setLocationQuery(e.target.value); requestSuggestions('location', e.target.value); }} placeholder="City, neighbourhood, road, or junction" autoComplete="off"/><datalist id="traffic-admin-location-suggestions">{suggestions.location.map((place) => <option key={place.place_id || place.label} value={place.label}/>)}</datalist></label><button className="secondary" type="button" onClick={useCurrentLocation} disabled={searchBusy || locationBusy}><LocateFixed size={15}/>{locationBusy ? 'Finding…' : 'Use my location'}</button><label>Traffic scenario<select value={scenario} onChange={(e) => publishScenario(e.target.value)}><option value="baseline">Balanced flow</option><option value="demand_surge">High demand</option><option value="signal_priority">Signal priority</option></select></label><button className="primary" type="submit" disabled={actionLoading || searchBusy}><Activity size={15}/>{actionLoading || searchBusy ? 'Preparing…' : 'Run 60-minute simulation'}</button></form>
      <div className="traffic-scenario-note"><ShieldCheck size={15}/><span><b>{scenarioLabel}.</b> Plan changes update this animated simulation. Live signal controllers are not connected.</span></div>
    </section> : <section className="panel traffic-location-panel"><div className="traffic-info-heading"><span className="traffic-info-icon"><MapPin size={18}/></span><div><h3>Find traffic near a place or along a route</h3><p>Suggestions appear while you type. The selected area refreshes the traffic data and map.</p></div><button className="utility" type="button" onClick={useCurrentLocation} disabled={locationBusy}><LocateFixed size={14}/>{locationBusy ? 'Finding location…' : 'Use my location'}</button></div>
      <div className="route-pref-options traffic-search-tabs"><button type="button" className={searchMode === 'location' ? 'selected' : ''} onClick={() => setSearchMode('location')}><MapPin size={14}/>A location</button><button type="button" className={searchMode === 'route' ? 'selected' : ''} onClick={() => setSearchMode('route')}><Route size={14}/>A route</button></div>
      <form className="traffic-coordinate-form traffic-place-form" onSubmit={searchRoadActivity}>
        {searchMode === 'location' ? <label>Place, area, or address<input list="traffic-location-suggestions" value={locationQuery} onChange={(e) => { setLocationQuery(e.target.value); requestSuggestions('location', e.target.value); }} placeholder="e.g. Hazratganj, Lucknow" autoComplete="off"/><datalist id="traffic-location-suggestions">{suggestions.location.map((place) => <option key={place.place_id || place.label} value={place.label}/>)}</datalist></label> : <><label>Starting point<input list="traffic-origin-suggestions" value={originQuery} onChange={(e) => { setOriginQuery(e.target.value); requestSuggestions('origin', e.target.value); }} placeholder="Search start location" autoComplete="off"/><datalist id="traffic-origin-suggestions">{suggestions.origin.map((place) => <option key={place.place_id || place.label} value={place.label}/>)}</datalist></label><label>Destination<input list="traffic-destination-suggestions" value={destinationQuery} onChange={(e) => { setDestinationQuery(e.target.value); requestSuggestions('destination', e.target.value); }} placeholder="Search destination" autoComplete="off"/><datalist id="traffic-destination-suggestions">{suggestions.destination.map((place) => <option key={place.place_id || place.label} value={place.label}/>)}</datalist></label></>}
        <button className="primary" type="submit" disabled={searchBusy || actionLoading}><Search size={15}/>{searchBusy ? 'Finding roads…' : 'Show map & road activity'}</button>
      </form>
      <div className="traffic-scenario-note"><Activity size={15}/><span>Nearby road conditions are matched to the selected location. Each road is shown separately so you can see where traffic is heavy, slow or moving.</span></div>
    </section>}

    {error && <div className="traffic-scenario-note"><AlertTriangle size={15}/><span>{error}</span></div>}
    {adminMode && provider?.flow && <section className="traffic-provider-strip panel"><span className="traffic-provider-check"><Activity size={16}/></span><div><b>Road segment reading available</b><small>{provider.provider} · {point.latitude}, {point.longitude}</small></div><div className="traffic-provider-value"><small>Current speed</small><b>{fmt(provider.flow.current_speed_kmph, ' km/h')}</b></div><div className="traffic-provider-value"><small>Free flow</small><b>{fmt(provider.flow.free_flow_speed_kmph, ' km/h')}</b></div></section>}

    {(actionLoading || searchBusy || nearbyRoadsBusy) && <section className="panel traffic-action-progress"><InlineLoadingIndicator compact label={searchBusy || nearbyRoadsBusy ? 'Finding nearby roads' : 'Updating the 60-minute simulation'}/></section>}

    {!adminMode && <>
      <section className="panel traffic-map-panel traffic-citizen-map-panel">
        <div className="panel-head"><div><div className="eyebrow">NEARBY ROAD MAP</div><h3>{point.latitude ? point.label : 'Your nearby roads'}</h3></div><span className="status-pill">2.5 km radius</span></div>
        <div className="traffic-map-toggles"><label><input type="checkbox" checked={showTrafficCrowd} onChange={(e) => setShowTrafficCrowd(e.target.checked)}/> Show traffic conditions</label></div>
        <CityMap markers={[...mapMarkers, ...(showTrafficCrowd ? roadFlowPoints : [])]} route={mapRoute} routeOptions={showRouteAlternatives ? routeAlternatives.map((route, index) => ({ id: route.id ?? `${route.mode}-${route.label}-${index}`, color: ['#26764f', '#8b9f4e', '#b17b3d', '#497d78', '#806c98'][index % 5], selected: (route.id ?? `${route.mode}-${route.label}-${index}`) === selectedTrafficRouteId, coordinates: route.geometry?.coordinates?.map?.(([lon, lat]) => ({ lat, lng: lon })) || [] })) : []} zoom={13} className="traffic-user-map"/>
        <div className="map-foot"><span><MapPin size={13}/> {point.latitude ? 'Roads around your selected location' : 'Use your location or search for an area'}</span><small>Map tiles © OpenStreetMap</small></div>
        {showTrafficCrowd && <div className="traffic-crowd-legend"><span><i className="crowd-heavy"/> Heavy</span><span><i className="crowd-slow"/> Slow</span><span><i className="crowd-moving"/> Moving</span><small>{nearbyRoads.length ? `${nearbyRoads.length} nearby road${nearbyRoads.length === 1 ? '' : 's'}` : 'Traffic details appear after location search'}</small></div>}
        {mappedRoute && <div className="traffic-map-route-summary"><b>{mappedRoute.label}</b><span>{mappedRoute.distance == null ? 'Distance unavailable' : `${(mappedRoute.distance / 1000).toFixed(1)} km`}</span><span>{mappedRoute.duration == null ? 'Duration unavailable' : `${Math.round(mappedRoute.duration / 60)} min estimated`}</span><small>{mappedRoute.provider || 'Routing service'}</small>{selectedGoogleMapsUrl && <a href={selectedGoogleMapsUrl} target="_blank" rel="noreferrer" className="traffic-google-maps-link">Open selected route in Google Maps ↗</a>}</div>}
        {routeAlternatives.length > 1 && <div className="traffic-route-options">{routeAlternatives.slice(0, 5).map((route, index) => { const id = route.id ?? `${route.mode}-${route.label}-${index}`; const grams = Number.isFinite(Number(route.estimated_co2_grams)) ? Number(route.estimated_co2_grams) : null; const low = Math.min(...routeAlternatives.map((item) => Number(item.estimated_co2_grams)).filter(Number.isFinite)); const downside = grams == null || !Number.isFinite(low) ? null : Math.max(0, grams - low); return <button type="button" className={id === selectedTrafficRouteId ? 'selected' : ''} key={id} onClick={() => selectTrafficRoute(route, index)}><span><b>{route.label || `Route ${index + 1}`}</b><small>{route.provider || 'Routing provider'}</small><small className="traffic-route-co2">{grams == null ? 'CO₂ estimate unavailable' : `Est. CO₂ ${grams >= 1000 ? `${(grams / 1000).toFixed(2)} kg` : `${Math.round(grams)} g`}${downside != null && downside > 0.5 ? ` · +${Math.round(downside)} g vs lowest` : ' · lowest footprint'}`}</small></span><strong>{route.duration_seconds == null ? '—' : `${Math.max(1, Math.round(route.duration_seconds / 60))} min`}</strong><em>{route.distance_meters == null ? '—' : `${(route.distance_meters / 1000).toFixed(1)} km`}</em></button>; })}</div>}
      </section>

      <section className="panel traffic-road-list traffic-nearby-road-list">
        <div className="traffic-info-heading"><span className="traffic-info-icon"><Route size={18}/></span><div><h3>Traffic on nearby roads</h3><p>{point.latitude ? `Road conditions around ${point.label}, within 2.5 km.` : 'Use your current location to see which nearby roads are heavy, slow or moving.'}</p></div><span className="status-pill">{nearbyRoads.length} roads</span></div>
        {nearbyRoadsBusy ? <div className="traffic-nearby-loading"><InlineLoadingIndicator compact label="Checking nearby roads"/></div> : nearbyRoads.length ? <div className="traffic-nearby-road-grid">{nearbyRoads.map((road) => <article className="traffic-nearby-road-card" key={road.id || `${road.road_name}-${road.latitude}-${road.longitude}`}>
          <div className="traffic-nearby-road-top"><b>{road.road_name || 'Nearby road'}</b><span className={`traffic-road-status ${String(road.status || 'No reading').toLowerCase().replace(/\s+/g, '-')}`}>{road.status || 'No reading'}</span></div>
          <div className="traffic-nearby-road-metrics"><div><small>Current speed</small><strong>{road.current_speed_kmph == null ? '—' : `${Math.round(Number(road.current_speed_kmph))} km/h`}</strong></div><div><small>Free-flow speed</small><strong>{road.free_flow_speed_kmph == null ? '—' : `${Math.round(Number(road.free_flow_speed_kmph))} km/h`}</strong></div><div><small>Distance</small><strong>{road.distance_meters == null ? '—' : `${Math.round(Number(road.distance_meters))} m`}</strong></div></div>
          {road.congestion_percent != null && <div className="traffic-road-congestion"><span style={{ width: `${Math.max(0, Math.min(100, Number(road.congestion_percent)))}%` }}/></div>}
          <small className="traffic-nearby-road-foot">{road.observed_at ? `Updated ${new Date(road.observed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : road.status === 'No reading' ? 'Traffic reading unavailable' : 'Updated recently'}</small>
        </article>)}</div> : <div className="traffic-nearby-empty"><MapPin size={22}/><b>No location selected</b><p>Share your location or search an area to see nearby road names and traffic conditions.</p><button type="button" className="primary" onClick={useCurrentLocation} disabled={locationBusy}><LocateFixed size={15}/>{locationBusy ? 'Finding your location…' : 'Use my location'}</button></div>}
      </section>
    </>}

    {adminMode && (!scenarioData || !frame) && <section className="panel traffic-loading-panel"><Activity size={21}/><b>Traffic simulation</b><p>Choose an area and run the 60-minute simulation to explore queue movement and road conditions.</p></section>}
    {adminMode && scenarioData && frame && <>
      <section className="traffic-scenario-hero panel"><div className="traffic-scenario-hero-top"><div><span className="traffic-live-label"><i/>{scenarioLabel.toUpperCase()}</span><h2>60-minute traffic simulation</h2><p>Explore network demand and queue changes across the selected 60-minute scenario.</p></div><span className="traffic-trained-label"><ShieldCheck size={13}/> {playing ? 'Playback running' : 'Scenario ready'}</span></div>
        <div className="traffic-scenario-kpis"><div><small>Simulated time</small><strong>{frame.minute}<em> / 60 min</em></strong></div><div><small>Total queued vehicles</small><strong>{int(frame.queue_total)}</strong><span>{previousFrame && frame.queue_total !== previousFrame.queue_total ? `${frame.queue_total > previousFrame.queue_total ? '+' : ''}${int(frame.queue_total - previousFrame.queue_total)} since last step` : 'Starting snapshot'}</span></div><div><small>Heavy roads</small><strong>{frame.heavy_roads}<em> / {scenarioData.summary.road_count}</em></strong><span>{fmt((frame.heavy_roads / Math.max(scenarioData.summary.road_count || frame.roads.length, 1)) * 100, '%')} of road segments in heavy flow</span></div><div><small>Network queue change</small><strong>{fmt((frame.queue_total - timeline[0].queue_total) / Math.max(timeline[0].queue_total, 1) * 100, '%')}</strong><span>vs. minute 0</span></div></div>
        <div className="traffic-playback"><div className="traffic-playback-actions"><button type="button" className="primary" onClick={playing ? () => setPlaying(false) : startPlayback}>{playing ? <><Pause size={15}/>Pause playback</> : <><Play size={15}/>{frameIndex >= timeline.length - 1 ? 'Replay 60 minutes' : frameIndex > 0 ? 'Resume playback' : 'Play 60-minute forecast'}</>}</button><button type="button" className="utility" onClick={() => { setPlaying(false); setFrameIndex(0); }}><RefreshCw size={14}/>Reset</button><span>Selected time: {Math.min(60, frame.minute)} simulated minutes</span></div><input className="traffic-time-slider" type="range" min="0" max={timeline.length - 1} value={frameIndex} onChange={(e) => { setPlaying(false); setFrameIndex(Number(e.target.value)); }} aria-label="Forecast time"/><div className="traffic-time-labels"><span>Now</span><span>15 min</span><span>30 min</span><span>45 min</span><span>60 min</span></div><div className="traffic-forecast-chart"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Queue trend throughout the forecast"><polyline points={chartPoints || '0,70 100,70'} fill="none" stroke="currentColor" strokeWidth="2.4" vectorEffect="non-scaling-stroke"/></svg>{timeline.map((item, index) => <button key={item.minute} type="button" title={`${item.minute} min · ${item.queue_total} queued`} className={index === frameIndex ? 'active' : ''} style={{ left: `${index / Math.max(timeline.length - 1, 1) * 100}%` }} onClick={() => { setPlaying(false); setFrameIndex(index); }}><span>{item.minute}m</span></button>)}</div></div>
      </section>
      <TrafficSimulationScene roads={roads} frame={frame} scenario={scenario} playing={playing} areaName="Network model scenario"/>
      <section className="panel traffic-road-list"><div className="traffic-info-heading"><span className="traffic-info-icon"><Route size={18}/></span><div><h3>Road activity · minute {frame.minute}</h3><p>Vehicle queues and movement update as playback advances.</p></div><span className="status-pill">{roads.length} segments</span></div><div className="traffic-road-table"><div className="traffic-road-row traffic-road-header"><span>Road segment</span><span>Vehicle count</span><span>Queued vehicles</span><span>Congestion</span></div>{roads.slice(0, 18).map((road) => <div className="traffic-road-row" key={road.road}><b>{road.road}</b><span>{road.vehicles == null ? '—' : int(road.vehicles)}</span><span>{fmt(road.queue)}</span><span className={`road-level ${String(road.level).toLowerCase()}`}>{road.level}</span></div>)}</div><p className="traffic-model-footnote">{(scenarioData.notes || []).join(' ')}</p></section>
    </>}

  </div>;
}
