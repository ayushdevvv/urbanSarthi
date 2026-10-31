import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, AlertTriangle, CarFront, Clock3, Gauge, LocateFixed, MapPin, Pause, Play, RefreshCw, Route, Search, ShieldCheck, TrendingUp } from 'lucide-react';
import PageIntro from '../../components/shared/PageIntro.jsx';
import TrafficSimulationScene from '../authority/TrafficSimulationScene.jsx';
import CityMap from '../../components/maps/CityMap.jsx';
import { api } from '../../services/api/client.js';
import { readApiSnapshot, saveLocalRecord, readLocalRecord, publishDataStatus } from '../../services/apiSnapshot.js';
import './traffic-simulation.css';

const SCENARIO_KEY = 'urbansarthi.activeTrafficScenario';
const DEFAULT_POINT = { latitude: '28.6139', longitude: '77.2090', label: 'New Delhi' };
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

export default function TrafficInfoPage({ adminMode = false }) {
  const [point, setPoint] = useState(DEFAULT_POINT);
  const [provider, setProvider] = useState(null);
  const [scenarioData, setScenarioData] = useState(null);
  const [scenario, setScenario] = useState(savedScenario);
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [frameIndex, setFrameIndex] = useState(0);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);
  const [searchMode, setSearchMode] = useState('location');
  const [locationQuery, setLocationQuery] = useState('New Delhi');
  const [originQuery, setOriginQuery] = useState('New Delhi Railway Station');
  const [destinationQuery, setDestinationQuery] = useState('India Gate');
  const [suggestions, setSuggestions] = useState({ location: [], origin: [], destination: [] });
  const [routeGeometry, setRouteGeometry] = useState([]);
  const [routeAlternatives, setRouteAlternatives] = useState([]);
  const [selectedTrafficRouteId, setSelectedTrafficRouteId] = useState(null);
  const [showRouteAlternatives, setShowRouteAlternatives] = useState(true);
  const [showTrafficCrowd, setShowTrafficCrowd] = useState(true);
  const [roadFlowPoints, setRoadFlowPoints] = useState([]);
  const [mapMarkers, setMapMarkers] = useState([{ id: 'traffic-location', lat: 28.6139, lng: 77.2090, title: 'New Delhi', description: 'Selected traffic area' }]);
  const [mappedRoute, setMappedRoute] = useState(null);
  const [searchBusy, setSearchBusy] = useState(false);
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

  const refresh = useCallback(async (overridePoint = point, overrideScenario = scenario) => {
    const latitude = Number(overridePoint.latitude), longitude = Number(overridePoint.longitude);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      setError('Enter a valid location or choose one from the suggestions.'); return;
    }
    setLoading(true); setError('');
    const params = new URLSearchParams({ minutes: '60', step_minutes: '5', scenario: overrideScenario });
    const scenarioPath = `/traffic/simulation/scenario?${params.toString()}`;
    try {
      const [current, timeline] = await Promise.all([
        api.get(`/traffic/current?latitude=${latitude}&longitude=${longitude}`).catch(() => null),
        api.get(scenarioPath),
      ]);
      const snapshot = readApiSnapshot(scenarioPath);
      setProvider(current?.flow ? current : null);
      setScenarioData(timeline); setFrameIndex(0); setPlaying(false); setLastUpdated(new Date(snapshot?.savedAt || Date.now()).toISOString());
      if (snapshot) saveLocalRecord(`traffic-simulation:${overrideScenario}`, timeline, snapshot.savedAt);
      if (current?.flow == null) setError('No location-specific live speed feed is configured for this point. The network scenario is shown separately.');
    } catch (err) {
      setProvider(null);
      const saved = readLocalRecord(`traffic-simulation:${overrideScenario}`);
      if (saved?.value?.timeline?.length) {
        setScenarioData(saved.value); setFrameIndex(0); setPlaying(false);
        setLastUpdated(new Date(saved.savedAt).toISOString());
        publishDataStatus({ type: 'snapshot', path: `traffic-simulation:${overrideScenario}`, cachedAt: saved.savedAt, reason: 'Restored the last successful scenario saved in this browser.' });
      } else {
        setScenarioData(null);
        setError(`${err?.message || 'The simulation service is unavailable.'} No saved scenario is available for these inputs yet. Reconnect to refresh this view.`);
      }
    } finally { setLoading(false); }
  }, [point, scenario]);

  useEffect(() => {
    const timer = window.setTimeout(() => refresh(point, scenario), 220);
    return () => window.clearTimeout(timer);
  }, [point.latitude, point.longitude, scenario, refresh]);

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
    const sampleIndexes = [...new Set([Math.floor(coordinates.length * 0.18), Math.floor(coordinates.length * 0.38), Math.floor(coordinates.length * 0.58), Math.floor(coordinates.length * 0.78)])].filter((index) => index > 0 && index < coordinates.length - 1);
    const samples = await Promise.all(sampleIndexes.map(async (index) => {
      const [longitude, latitude] = coordinates[index];
      try {
        const response = await api.get(`/traffic/current?latitude=${encodeURIComponent(latitude)}&longitude=${encodeURIComponent(longitude)}`);
        if (!response?.flow || response.flow.current_speed_kmph == null || response.flow.free_flow_speed_kmph == null) return null;
        const ratio = Number(response.flow.current_speed_kmph) / Math.max(1, Number(response.flow.free_flow_speed_kmph));
        return { id: `traffic-flow-${index}`, lat: Number(latitude), lng: Number(longitude), title: ratio < .4 ? 'Heavy traffic' : ratio < .72 ? 'Slow traffic' : 'Moving traffic', description: `${response.provider} · ${Math.round(response.flow.current_speed_kmph)} / ${Math.round(response.flow.free_flow_speed_kmph)} km/h`, kind: ratio < .4 ? 'critical' : ratio < .72 ? 'busy' : 'normal', currentSpeed: response.flow.current_speed_kmph, freeFlowSpeed: response.flow.free_flow_speed_kmph, provider: response.provider };
      } catch { return null; }
    }));
    setRoadFlowPoints(samples.filter(Boolean));
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

  const searchRoadActivity = async (event) => {
    event?.preventDefault?.();
    setSearchBusy(true); setError('');
    try {
      if (searchMode === 'location') {
        const query = locationQuery.trim();
        if (!query) throw new Error('Enter a place, neighbourhood, or address.');
        const selected = pickPlace(await api.get(`/routing/geocode?q=${encodeURIComponent(query)}&limit=5`), query);
        const nextPoint = { latitude: String(selected.latitude), longitude: String(selected.longitude), label: selected.label };
        setPoint(nextPoint); setLocationQuery(selected.label); setMappedRoute(null); setRouteGeometry([]); setRouteAlternatives([]); setSelectedTrafficRouteId(null); setRoadFlowPoints([]);
        setMapMarkers([{ id: 'traffic-location', lat: Number(selected.latitude), lng: Number(selected.longitude), title: selected.label, description: 'Selected area for traffic lookup' }]);
        await refresh(nextPoint, scenario);
        await inspectLocationTraffic(nextPoint);
      } else {
        const from = originQuery.trim(), to = destinationQuery.trim();
        if (!from || !to) throw new Error('Enter both a starting point and destination.');
        const [origin, destination] = await Promise.all([
          api.get(`/routing/geocode?q=${encodeURIComponent(from)}&limit=5`).then((r) => pickPlace(r, from)),
          api.get(`/routing/geocode?q=${encodeURIComponent(to)}&limit=5`).then((r) => pickPlace(r, to)),
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
          setRouteGeometry([]); setRouteAlternatives([]); setRoadFlowPoints([]); setMappedRoute({ label: 'Route endpoints mapped', provider: 'Route service unavailable' });
          setError('Route geometry was not returned, so the map shows the selected start and destination. Road activity below follows the authority-selected network scenario.');
        }
        await refresh(nextPoint, scenario);
      }
    } catch (err) { setError(err?.message || 'Could not look up that place. Try a nearby landmark or locality.'); }
    finally { setSearchBusy(false); }
  };

  const useCurrentLocation = () => {
    if (!navigator.geolocation) { setError('Location access is not supported by this browser.'); return; }
    setError(''); navigator.geolocation.getCurrentPosition(async ({ coords }) => {
      let label = 'Your current location';
      try { const reverse = await api.get(`/routing/reverse-geocode?latitude=${coords.latitude}&longitude=${coords.longitude}`); label = reverse.label || label; } catch { /* coordinates remain usable */ }
      const nextPoint = { latitude: coords.latitude.toFixed(6), longitude: coords.longitude.toFixed(6), label };
      setPoint(nextPoint); setLocationQuery(label); setSearchMode('location'); setMappedRoute(null); setRouteGeometry([]); setRouteAlternatives([]); setSelectedTrafficRouteId(null); setRoadFlowPoints([]);
      setMapMarkers([{ id: 'traffic-location', lat: coords.latitude, lng: coords.longitude, title: label, description: 'Your selected location' }]);
      refresh(nextPoint, scenario);
      inspectLocationTraffic(nextPoint);
    }, (geoError) => setError(geoError.code === 1 ? 'Location permission was denied. Allow access or search for a place.' : 'Could not get your current location.'), { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
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
    <PageIntro eyebrow={adminMode ? 'NETWORK OPERATIONS' : 'YOUR LOCAL ROAD CONDITIONS'} title={adminMode ? 'Traffic Simulation' : 'Traffic & road conditions'} description={adminMode ? 'Choose an area, set a signal scenario, and play through a 60-minute traffic simulation.' : 'Search a location or journey to compare route options and inspect available traffic-flow readings along the way.'} action={<button className="utility" onClick={() => refresh()} disabled={loading}><RefreshCw size={14}/>{loading ? 'Updating…' : 'Refresh outlook'}</button>} />

    {adminMode ? <section className="panel traffic-location-panel traffic-admin-location-panel"><div className="traffic-info-heading"><span className="traffic-info-icon"><Activity size={18}/></span><div><h3>Simulation area</h3><p>Enter a place or use your current location, then run the 60-minute playback.</p></div></div>
      <form className="traffic-coordinate-form traffic-place-form traffic-admin-place-form" onSubmit={searchRoadActivity}><label>Enter a location<input list="traffic-admin-location-suggestions" value={locationQuery} onChange={(e) => { setLocationQuery(e.target.value); requestSuggestions('location', e.target.value); }} placeholder="City, neighbourhood, road, or junction" autoComplete="off"/><datalist id="traffic-admin-location-suggestions">{suggestions.location.map((place) => <option key={place.place_id || place.label} value={place.label}/>)}</datalist></label><button className="secondary" type="button" onClick={useCurrentLocation} disabled={searchBusy}><LocateFixed size={15}/>{searchBusy ? 'Finding…' : 'Use my location'}</button><label>Traffic scenario<select value={scenario} onChange={(e) => publishScenario(e.target.value)}><option value="baseline">Balanced flow</option><option value="demand_surge">High demand</option><option value="signal_priority">Signal priority</option></select></label><button className="primary" type="submit" disabled={loading || searchBusy}><Activity size={15}/>{loading || searchBusy ? 'Preparing…' : 'Run 60-minute simulation'}</button></form>
      <div className="traffic-scenario-note"><ShieldCheck size={15}/><span><b>{scenarioLabel}.</b> Plan changes update this animated simulation. Live signal controllers are not connected.</span></div>
    </section> : <section className="panel traffic-location-panel"><div className="traffic-info-heading"><span className="traffic-info-icon"><MapPin size={18}/></span><div><h3>Find traffic near a place or along a route</h3><p>Suggestions appear while you type. The selected area refreshes the traffic data and map.</p></div><button className="utility" type="button" onClick={useCurrentLocation}><LocateFixed size={14}/>Use my location</button></div>
      <div className="route-pref-options traffic-search-tabs"><button type="button" className={searchMode === 'location' ? 'selected' : ''} onClick={() => setSearchMode('location')}><MapPin size={14}/>A location</button><button type="button" className={searchMode === 'route' ? 'selected' : ''} onClick={() => setSearchMode('route')}><Route size={14}/>A route</button></div>
      <form className="traffic-coordinate-form traffic-place-form" onSubmit={searchRoadActivity}>
        {searchMode === 'location' ? <label>Place, area, or address<input list="traffic-location-suggestions" value={locationQuery} onChange={(e) => { setLocationQuery(e.target.value); requestSuggestions('location', e.target.value); }} placeholder="e.g. Hazratganj, Lucknow" autoComplete="off"/><datalist id="traffic-location-suggestions">{suggestions.location.map((place) => <option key={place.place_id || place.label} value={place.label}/>)}</datalist></label> : <><label>Starting point<input list="traffic-origin-suggestions" value={originQuery} onChange={(e) => { setOriginQuery(e.target.value); requestSuggestions('origin', e.target.value); }} placeholder="Search start location" autoComplete="off"/><datalist id="traffic-origin-suggestions">{suggestions.origin.map((place) => <option key={place.place_id || place.label} value={place.label}/>)}</datalist></label><label>Destination<input list="traffic-destination-suggestions" value={destinationQuery} onChange={(e) => { setDestinationQuery(e.target.value); requestSuggestions('destination', e.target.value); }} placeholder="Search destination" autoComplete="off"/><datalist id="traffic-destination-suggestions">{suggestions.destination.map((place) => <option key={place.place_id || place.label} value={place.label}/>)}</datalist></label></>}
        <button className="primary" type="submit" disabled={searchBusy || loading}><Search size={15}/>{searchBusy ? 'Finding roads…' : 'Show map & road activity'}</button>
      </form>
      <div className="traffic-scenario-note"><Activity size={15}/><span>Authority-selected scenario: <b>{scenarioLabel}</b>. Road queue levels below follow that scenario. The model road labels may not map one-to-one to every street in your searched route.</span></div>
    </section>}

    {error && <div className="traffic-scenario-note"><AlertTriangle size={15}/><span>{error}</span></div>}
    {provider?.flow && <section className="traffic-provider-strip panel"><span className="traffic-provider-check"><Activity size={16}/></span><div><b>Road segment reading available</b><small>{provider.provider} · {point.latitude}, {point.longitude}</small></div><div className="traffic-provider-value"><small>Current speed</small><b>{fmt(provider.flow.current_speed_kmph, ' km/h')}</b></div><div className="traffic-provider-value"><small>Free flow</small><b>{fmt(provider.flow.free_flow_speed_kmph, ' km/h')}</b></div></section>}

    {!scenarioData && <section className="panel traffic-loading-panel"><Activity size={21}/><b>{loading ? 'Preparing road activity…' : 'Road activity unavailable'}</b><p>The app will show the configured network forecast when the simulation endpoint responds.</p></section>}
    {scenarioData && frame && <>
      {!adminMode && <section className="panel traffic-map-panel"><div className="panel-head"><div><div className="eyebrow">MAPPED AREA / ROUTE</div><h3>{mappedRoute ? `${originQuery} to ${destinationQuery}` : point.label}</h3></div><span className="status-pill">{mappedRoute ? 'Route search' : 'Location search'}</span></div><div className="traffic-map-toggles"><label><input type="checkbox" checked={showRouteAlternatives} onChange={(e) => setShowRouteAlternatives(e.target.checked)}/> Show route alternatives</label><label><input type="checkbox" checked={showTrafficCrowd} onChange={(e) => setShowTrafficCrowd(e.target.checked)}/> Show traffic crowd layer</label></div><CityMap markers={[...mapMarkers, ...(showTrafficCrowd ? roadFlowPoints : [])]} route={mapRoute} routeOptions={showRouteAlternatives ? routeAlternatives.map((route, index) => ({ id: route.id ?? `${route.mode}-${route.label}-${index}`, color: ['#26764f', '#8b9f4e', '#b17b3d', '#497d78', '#806c98'][index % 5], selected: (route.id ?? `${route.mode}-${route.label}-${index}`) === selectedTrafficRouteId, coordinates: route.geometry?.coordinates?.map?.(([lon, lat]) => ({ lat, lng: lon })) || [] })) : []} zoom={13} className="traffic-user-map"/><div className="map-foot"><span><MapPin size={13}/> Selected place and route alternatives</span><small>Map tiles © OpenStreetMap</small></div>{showTrafficCrowd && <div className="traffic-crowd-legend"><span><i className="crowd-heavy"/> Heavy</span><span><i className="crowd-slow"/> Slow</span><span><i className="crowd-moving"/> Moving</span><small>{roadFlowPoints.length ? `${roadFlowPoints.length} provider readings on map` : 'No provider readings returned for this area'}</small></div>}{mappedRoute && <div className="traffic-map-route-summary"><b>{mappedRoute.label}</b><span>{mappedRoute.distance == null ? 'Distance unavailable' : `${(mappedRoute.distance / 1000).toFixed(1)} km`}</span><span>{mappedRoute.duration == null ? 'Duration unavailable' : `${Math.round(mappedRoute.duration / 60)} min estimated`}</span><small>{mappedRoute.provider || 'Routing service'}</small>{selectedGoogleMapsUrl && <a href={selectedGoogleMapsUrl} target="_blank" rel="noreferrer" className="traffic-google-maps-link">Open selected route in Google Maps ↗</a>}</div>}{routeAlternatives.length > 1 && <div className="traffic-route-options">{routeAlternatives.slice(0, 5).map((route, index) => { const id = route.id ?? `${route.mode}-${route.label}-${index}`; const grams = Number.isFinite(Number(route.estimated_co2_grams)) ? Number(route.estimated_co2_grams) : null; const low = Math.min(...routeAlternatives.map((item) => Number(item.estimated_co2_grams)).filter(Number.isFinite)); const downside = grams == null || !Number.isFinite(low) ? null : Math.max(0, grams - low); return <button type="button" className={id === selectedTrafficRouteId ? 'selected' : ''} key={id} onClick={() => selectTrafficRoute(route, index)}><span><b>{route.label || `Route ${index + 1}`}</b><small>{route.provider || 'Routing provider'} · {route.data_quality || 'mapped route'}</small><small className="traffic-route-co2">{grams == null ? 'CO₂ estimate unavailable' : `Est. CO₂ ${grams >= 1000 ? `${(grams / 1000).toFixed(2)} kg` : `${Math.round(grams)} g`}${downside != null && downside > 0.5 ? ` · +${Math.round(downside)} g vs lowest` : ' · lowest footprint'}`}</small></span><strong>{route.duration_seconds == null ? '—' : `${Math.max(1, Math.round(route.duration_seconds / 60))} min`}</strong><em>{route.distance_meters == null ? '—' : `${(route.distance_meters / 1000).toFixed(1)} km`}</em></button>; })}</div>}{searchMode === 'route' && showTrafficCrowd && !roadFlowPoints.length && <div className="traffic-layer-empty">No road-speed readings were returned along this route. Route geometry is available; the crowd layer appears when a traffic-flow provider returns readings.</div>}</section>}

      {adminMode ? <><section className="traffic-scenario-hero panel"><div className="traffic-scenario-hero-top"><div><span className="traffic-live-label"><i/>{scenarioLabel.toUpperCase()}</span><h2>60-minute traffic simulation</h2><p>{point.label || locationQuery} · playback advances through the selected scenario.</p></div><span className="traffic-trained-label"><ShieldCheck size={13}/> {playing ? 'Simulation running' : 'Ready to play'}</span></div>
        <div className="traffic-scenario-kpis"><div><small>Simulated time</small><strong>{frame.minute}<em> / 60 min</em></strong></div><div><small>Total queued vehicles</small><strong>{int(frame.queue_total)}</strong><span>{previousFrame && frame.queue_total !== previousFrame.queue_total ? `${frame.queue_total > previousFrame.queue_total ? '+' : ''}${int(frame.queue_total - previousFrame.queue_total)} since last step` : 'Starting snapshot'}</span></div><div><small>Heavy roads</small><strong>{frame.heavy_roads}<em> / {scenarioData.summary.road_count}</em></strong><span>{fmt((frame.heavy_roads / Math.max(frame.roads.length, 1)) * 100, '%')} of road segments in heavy flow</span></div><div><small>Network queue change</small><strong>{fmt((frame.queue_total - timeline[0].queue_total) / Math.max(timeline[0].queue_total, 1) * 100, '%')}</strong><span>vs. minute 0</span></div></div>
        <div className="traffic-playback"><div className="traffic-playback-actions"><button type="button" className="primary" onClick={playing ? () => setPlaying(false) : startPlayback}>{playing ? <><Pause size={15}/>Pause playback</> : <><Play size={15}/>{frameIndex >= timeline.length - 1 ? 'Replay 60 minutes' : frameIndex > 0 ? 'Resume playback' : 'Play 60-minute forecast'}</>}</button><button type="button" className="utility" onClick={() => { setPlaying(false); setFrameIndex(0); }}><RefreshCw size={14}/>Reset</button><span>Selected time: {Math.min(60, frame.minute)} simulated minutes</span></div><input className="traffic-time-slider" type="range" min="0" max={timeline.length - 1} value={frameIndex} onChange={(e) => { setPlaying(false); setFrameIndex(Number(e.target.value)); }} aria-label="Forecast time"/><div className="traffic-time-labels"><span>Now</span><span>15 min</span><span>30 min</span><span>45 min</span><span>60 min</span></div><div className="traffic-forecast-chart"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Queue trend throughout the forecast"><polyline points={chartPoints || '0,70 100,70'} fill="none" stroke="currentColor" strokeWidth="2.4" vectorEffect="non-scaling-stroke"/></svg>{timeline.map((item, index) => <button key={item.minute} type="button" title={`${item.minute} min · ${item.queue_total} queued`} className={index === frameIndex ? 'active' : ''} style={{ left: `${index / Math.max(timeline.length - 1, 1) * 100}%` }} onClick={() => { setPlaying(false); setFrameIndex(index); }}><span>{item.minute}m</span></button>)}</div></div>
      </section>
      <TrafficSimulationScene roads={roads} frame={frame} scenario={scenario} playing={playing} areaName={point.label || locationQuery}/>
      </> : <section className="panel traffic-scenario-hero traffic-user-summary"><div className="traffic-scenario-hero-top"><div><span className="traffic-live-label"><i/>{scenarioLabel.toUpperCase()}</span><h2>Road activity forecast</h2><p>Current snapshot from the authority-selected 60-minute scenario.</p></div><span className="traffic-trained-label"><Clock3 size={13}/> Minute {frame.minute}</span></div><div className="traffic-scenario-kpis"><div><small>Queued vehicles</small><strong>{int(frame.queue_total)}</strong></div><div><small>Heavy roads</small><strong>{frame.heavy_roads}<em> / {scenarioData.summary.road_count}</em></strong></div><div><small>Highest queue</small><strong>{fmt(Math.max(0, ...roads.map((road) => Number(road.queue || 0))))}</strong><span>vehicles on one road segment</span></div><div><small>Scenario time</small><strong>{frame.minute}<em> / 60 min</em></strong></div></div><p className="api-note">{scenarioData.mode === 'reference' ? 'Reference activity is displayed because the simulation service is unavailable. It is illustrative, not live or a model prediction.' : 'This is a network-level scenario. A live, location-specific road segment feed is shown separately when the provider supports it.'}</p></section>}

      <section className="panel traffic-road-list"><div className="traffic-info-heading"><span className="traffic-info-icon"><Route size={18}/></span><div><h3>{adminMode ? `Road activity · minute ${frame.minute}` : 'Most congested road segments'}</h3><p>{adminMode ? 'Vehicle queues and movement update as playback advances.' : 'Ranked by scenario queue size.'}</p></div><span className="status-pill">{roads.length} segments</span></div><div className="traffic-road-table"><div className="traffic-road-row traffic-road-header"><span>Road segment</span><span>Vehicle count</span><span>Queued vehicles</span><span>Congestion</span></div>{roads.slice(0, 18).map((road) => <div className="traffic-road-row" key={road.road}><b>{road.road}</b><span>{road.vehicles}</span><span>{fmt(road.queue)}</span><span className={`road-level ${String(road.level).toLowerCase()}`}>{road.level}</span></div>)}</div>{!adminMode && <p className="traffic-model-footnote">{(scenarioData.notes || []).join(' ')}</p>}</section>
      {!adminMode && <section className="panel traffic-data-note"><h3>Data source status</h3><p>{provider?.flow ? `A provider road-flow snapshot is available from ${provider.provider} at your selected point. Scenario road activity is shown separately.` : scenarioData.mode === 'reference' ? 'Live road-speed readings and the simulation service are unavailable. Reference road activity remains visible with an explicit label.' : 'No location-specific live road-flow reading is available for this point. The road table represents the selected network scenario, not live camera observations on your street.'}</p><small>View updated {lastUpdated ? new Date(lastUpdated).toLocaleTimeString() : 'just now'} · Selected scenario: {scenarioLabel}</small></section>}
    </>}
  </div>;
}
