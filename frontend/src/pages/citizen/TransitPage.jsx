import { useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, Bus, Clock3, ExternalLink, LocateFixed, MapPin, Newspaper, Navigation, RefreshCw, Search, Train } from 'lucide-react';
import PageIntro from '../../components/shared/PageIntro.jsx';
import { EmptyState, ErrorNotice } from '../../components/shared/Toast.jsx';
import useApiResource from '../../hooks/useApiResource.js';
import { api, endpoints } from '../../services/api/client.js';
import CityMap from '../../components/maps/CityMap.jsx';
import './transit-premium.css';

const publishedAt = (value) => value ? new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Publication time unavailable';
const displayMode = (mode) => ({ rail: 'Train', metro: 'Metro', bus: 'Bus', tram: 'Tram' }[String(mode || '').toLowerCase()] || 'Transit');

export default function TransitPage() {
  const [mode, setMode] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [city, setCity] = useState('');
  const [topic, setTopic] = useState('');
  const [news, setNews] = useState(null);
  const [newsBusy, setNewsBusy] = useState(false);
  const [newsError, setNewsError] = useState('');
  const [nearby, setNearby] = useState(null);
  const [nearbyBusy, setNearbyBusy] = useState(false);
  const [nearbyError, setNearbyError] = useState('');
  const [selectedStop, setSelectedStop] = useState(null);
  const [arrivals, setArrivals] = useState(null);
  const [arrivalBusy, setArrivalBusy] = useState(false);
  const [journeys, setJourneys] = useState(null);
  const [planError, setPlanError] = useState('');
  const [planBusy, setPlanBusy] = useState(false);
  const [locating, setLocating] = useState(false);

  const { data: routes, loading: routesLoading, error: routesError, reload: reloadRoutes } = useApiResource(() => api.get(endpoints.transitRoutes), []);
  const { data: stops, loading: stopsLoading } = useApiResource(() => api.get(endpoints.transitStops()), []);
  const { data: alerts, error: alertsError, reload: reloadAlerts } = useApiResource(() => api.get(endpoints.transitAlerts), []);
  const routeList = Array.isArray(routes) ? routes : [];
  const stopList = Array.isArray(stops) ? stops : [];
  const filteredRoutes = useMemo(() => routeList.filter((route) => mode === 'all' || (mode === 'train' ? ['rail', 'train'].includes(String(route.mode).toLowerCase()) : String(route.mode).toLowerCase() === mode)), [routeList, mode]);
  const nearbyStops = nearby?.stops || [];

  async function searchUpdates(event) {
    event.preventDefault();
    if (!city.trim()) { setNewsError('Enter a city or region to search for service updates.'); return; }
    setNewsBusy(true); setNewsError(''); setNews(null);
    try {
      const params = new URLSearchParams({ city: city.trim(), mode, query: topic.trim(), limit: '10' });
      const result = await api.get(`/transit/live-intel?${params.toString()}`, { timeoutMs: 20000 });
      setNews(result);
      if (result.status === 'unavailable') setNewsError(result.note || 'Live search is unavailable.');
    } catch (err) { setNewsError(err.message || 'Could not search transport updates.'); }
    finally { setNewsBusy(false); }
  }

  async function findNearby(point) {
    setNearbyBusy(true); setNearbyError(''); setNearby(null); setSelectedStop(null); setArrivals(null);
    try {
      const params = new URLSearchParams({ latitude: point.latitude, longitude: point.longitude, radius_m: '4000' });
      const result = await api.get(`/transit/nearby?${params.toString()}`, { timeoutMs: 22000 });
      setNearby({ ...result, point });
      if (!result.stops?.length) setNearbyError(result.note || 'No mapped stops found in this area.');
    } catch (err) { setNearbyError(err.message || 'Nearby transport stops are unavailable.'); }
    finally { setNearbyBusy(false); }
  }

  const useMyLocation = () => {
    if (!navigator.geolocation) { setNearbyError('This browser does not support location access.'); return; }
    setLocating(true); setNearbyError('');
    navigator.geolocation.getCurrentPosition(async ({ coords }) => {
      let label = 'Your current location';
      try { const reverse = await api.get(`/routing/reverse-geocode?latitude=${coords.latitude}&longitude=${coords.longitude}`); label = reverse?.label || label; } catch { /* coordinates remain usable */ }
      setLocating(false);
      await findNearby({ latitude: coords.latitude, longitude: coords.longitude, label });
    }, (error) => { setLocating(false); setNearbyError(error.code === 1 ? 'Location permission was denied. Search for a city or retry.' : 'Could not retrieve your current location.'); }, { enableHighAccuracy: true, timeout: 14000, maximumAge: 60000 });
  };

  async function loadArrivals(stop) {
    setSelectedStop(stop); setArrivals(null); setArrivalBusy(true);
    const externalId = stop.external_id || stop.ref || stop.id;
    if (!externalId || stop.schedule_available === false || String(externalId).startsWith('osm-')) {
      setArrivals({ status: 'no_arrival_data', arrivals: [], note: 'This stop is mapped, but it has no connected operator timetable. Live arrivals require a GTFS schedule and preferably GTFS-Realtime.' });
      setArrivalBusy(false); return;
    }
    try { setArrivals(await api.get(`/transit/stops/${encodeURIComponent(externalId)}/arrivals?minutes_ahead=180&limit=30`)); }
    catch (err) { setArrivals({ status: 'unavailable', arrivals: [], note: err.message || 'Arrival data is unavailable for this stop.' }); }
    finally { setArrivalBusy(false); }
  }

  async function planJourney(event) {
    event.preventDefault(); setPlanBusy(true); setPlanError(''); setJourneys(null);
    try {
      if (!from.trim() || !to.trim()) throw new Error('Enter both the starting place and destination.');
      const geocode = async (text) => {
        const response = await api.get(`/routing/geocode?q=${encodeURIComponent(text)}&limit=5`, { timeoutMs: 12000 });
        const first = (response.results || []).find((item) => String(item.label || '').toLowerCase() === text.toLowerCase()) || response.results?.[0];
        if (!first) throw new Error(`Could not find “${text}”. Try a station or landmark.`);
        return first;
      };
      const [origin, destination] = await Promise.all([geocode(from.trim()), geocode(to.trim())]);
      const params = new URLSearchParams({ origin_latitude: origin.latitude, origin_longitude: origin.longitude, destination_latitude: destination.latitude, destination_longitude: destination.longitude });
      setJourneys(await api.get(`/transit/plan?${params.toString()}`, { timeoutMs: 15000 }));
    } catch (err) { setPlanError(err.message || 'Could not plan this public transport trip.'); }
    finally { setPlanBusy(false); }
  }

  return <div className="transit-premium-page">
    <PageIntro eyebrow="PUBLIC TRANSPORT" title="Bus & train" description="Explore transport networks, search current service updates and check timetable data where an operator feed is connected." action={<button className="utility" type="button" onClick={() => { reloadRoutes(); reloadAlerts(); }}><RefreshCw size={14}/>Refresh feeds</button>} />
    <ErrorNotice message={routesError || alertsError} onRetry={() => { reloadRoutes(); reloadAlerts(); }}/>

    <section className="panel transit-intel-panel">
      <div className="transit-section-heading"><div><span className="eyebrow">LATEST SERVICE INTELLIGENCE</span><h3>What's happening on your network?</h3><p>Search recent reporting about delays, disruptions, new services and travel advisories.</p></div><Newspaper size={21}/></div>
      <form className="transit-intel-form" onSubmit={searchUpdates}>
        <label><small>City / region</small><input value={city} onChange={(e) => setCity(e.target.value)} placeholder="e.g. Lucknow, Delhi, Mumbai" required/></label>
        <label><small>What are you looking for?</small><input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Delays, route changes, service alerts…"/></label>
        <label><small>Transport mode</small><select value={mode} onChange={(e) => setMode(e.target.value)}><option value="all">All transport</option><option value="bus">Bus</option><option value="train">Train</option><option value="metro">Metro</option></select></label>
        <button className="primary" type="submit" disabled={newsBusy}><Search size={15}/>{newsBusy ? 'Searching…' : 'Find latest updates'}</button>
      </form>
      {newsError && <div className="transit-error"><AlertTriangle size={14}/>{newsError}</div>}
      {news?.items?.length ? <div className="transit-news-grid">{news.items.map((item, index) => <article className="transit-news-card" key={item.url || index}><div className="transit-news-meta"><span>{item.source || news.provider}</span><time>{publishedAt(item.published_at)}</time></div><a href={item.url} target="_blank" rel="noreferrer">{item.title}<ExternalLink size={13}/></a>{item.snippet && <p>{item.snippet}</p>}</article>)}</div> : !newsBusy && news && <EmptyState title="No recent service stories found" description={news.note || 'Try a broader city or topic.'}/>}
      <div className="transit-source-note"><span>{news?.provider || 'Tavily Search / Google News RSS fallback'}</span><small>News results are reporting, not live vehicle locations, arrivals or proof of current delay.</small></div>
    </section>

    <div className="transit-main-grid">
      <section className="panel transit-planner-panel">
        <div className="transit-section-heading"><div><span className="eyebrow">JOURNEY PLANNER</span><h3>Plan by public transport</h3></div><Navigation size={19}/></div>
        <form className="transit-plan-form" onSubmit={planJourney}>
          <label><small>From</small><input value={from} onChange={(e) => setFrom(e.target.value)} placeholder="Starting station or area" required/></label>
          <label><small>To</small><input value={to} onChange={(e) => setTo(e.target.value)} placeholder="Destination station or area" required/></label>
          <button className="primary full" type="submit" disabled={planBusy}><Navigation size={15}/>{planBusy ? 'Finding options…' : 'Find public transport'}</button>
        </form>
        {planError && <div className="transit-error">{planError}</div>}
        {journeys && <div className="transit-journey-list"><b>{journeys.status === 'available' ? `${journeys.options?.length || 0} journey options` : 'No timetable journey found'}</b>{(journeys.options || []).map((option, index) => <article key={option.id || index}><div><strong>{option.label || option.route_name || option.route_short_name || `Option ${index + 1}`}</strong><small>{displayMode(option.mode || option.route_mode)}</small></div><span>{option.duration_seconds == null ? '—' : `${Math.max(1, Math.round(option.duration_seconds / 60))} min`}</span></article>)}{(journeys.limitations || []).map((item) => <small className="transit-limitation" key={item}>{item}</small>)}</div>}
        {!journeys && <div className="transit-planner-empty"><MapPin size={17}/><span>Journey options appear when a connected timetable covers the selected places.</span></div>}
      </section>

      <section className="panel transit-feed-panel">
        <div className="transit-section-heading"><div><span className="eyebrow">CONNECTED NETWORK</span><h3>Routes & service alerts</h3></div><span className="status-pill">{routeList.length} routes</span></div>
        <div className="transit-mode-tabs">{[['all','All'],['bus','Bus'],['train','Train'],['metro','Metro']].map(([value,label]) => <button key={value} type="button" className={mode === value ? 'active' : ''} onClick={() => setMode(value)}>{value === 'bus' ? <Bus size={14}/> : value === 'all' ? <Navigation size={14}/> : <Train size={14}/>} {label}</button>)}</div>
        {routesLoading ? <div className="loading-lines">Loading connected routes…</div> : filteredRoutes.length ? <div className="transit-route-list">{filteredRoutes.slice(0, 10).map((route) => <article key={route.id}><span className="transit-route-icon">{String(route.mode).toLowerCase() === 'bus' ? <Bus size={16}/> : <Train size={16}/>}</span><div><b>{route.short_name || route.long_name || route.external_id}</b><small>{route.long_name || route.agency_name || displayMode(route.mode)}</small></div><em>{displayMode(route.mode)}</em></article>)}</div> : <EmptyState title="No operator routes connected" description="Nearby mapped stops are still discoverable. Timetables require an agency GTFS feed."/>}
        <div className="transit-alerts"><div className="transit-alert-heading"><AlertTriangle size={15}/><b>Active service alerts</b><span>{Array.isArray(alerts) ? alerts.length : 0}</span></div>{Array.isArray(alerts) && alerts.length ? alerts.slice(0, 4).map((alert, index) => <article key={alert.id || index}><b>{alert.header || alert.title || 'Service advisory'}</b><small>{alert.description || alert.effect || 'Check the operator for details.'}</small></article>) : <small>No active operator alerts returned.</small>}</div>
      </section>
    </div>

    <section className="panel transit-nearby-panel">
      <div className="transit-section-heading"><div><span className="eyebrow">NEAR YOU</span><h3>Nearby bus stops & stations</h3><p>{nearby?.point?.label || 'Location is only requested when you tap the button.'}</p></div><button className="secondary" type="button" onClick={useMyLocation} disabled={locating || nearbyBusy}><LocateFixed size={15}/>{locating ? 'Locating…' : nearbyBusy ? 'Searching…' : 'Use my location'}</button></div>
      {nearbyError && <div className="transit-error">{nearbyError}</div>}
      {nearbyBusy && <div className="loading-lines">Finding nearby stations and stops…</div>}
      {nearby && <>
        {!!nearbyStops.length && <div className="transit-nearby-map"><CityMap markers={[{ id: 'nearby-position', lat: nearby.point.latitude, lng: nearby.point.longitude, title: nearby.point.label, kind: 'critical' }, ...nearbyStops.slice(0, 50).map((stop) => ({ id: stop.id, lat: stop.latitude, lng: stop.longitude, title: stop.name, description: `${displayMode(stop.mode)} · ${Math.round(stop.distance_meters)} m`, kind: 'normal' }))]} zoom={13}/></div>}
        {nearbyStops.length ? <div className="transit-stops-grid">{nearbyStops.slice(0, 20).map((stop) => <button type="button" className={`transit-stop-card ${selectedStop?.id === stop.id ? 'active' : ''}`} key={stop.id} onClick={() => loadArrivals(stop)}><span>{stop.mode === 'bus' ? <Bus size={16}/> : <Train size={16}/>}</span><div><b>{stop.name}</b><small>{displayMode(stop.mode)} · {Math.round(stop.distance_meters)} m · {stop.source}</small></div><ArrowRight size={14}/></button>)}</div> : <EmptyState title="No nearby stops returned" description={nearby.note || 'No mapped transit stops were found around your location.'}/>}
      </>}
      {!nearby && !nearbyBusy && <div className="transit-location-empty"><LocateFixed size={18}/><span>Tap Use my location to find mapped stops and stations around you.</span></div>}
      {selectedStop && <div className="transit-arrivals-panel"><div className="transit-section-heading"><div><span className="eyebrow">STOP INFORMATION</span><h3>{selectedStop.name}</h3></div><span className="status-pill">{displayMode(selectedStop.mode)}</span></div>{arrivalBusy ? <div className="loading-lines">Checking timetable…</div> : arrivals?.arrivals?.length ? <div className="transit-arrivals-list">{arrivals.arrivals.map((arrival, index) => <article key={`${arrival.expected_at}-${index}`}><div><b>{arrival.route || 'Service'}</b><small>{arrival.source || arrival.data_quality || 'Operator feed'}</small></div><strong>{new Date(arrival.expected_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</strong><span>{arrival.delay_seconds == null ? 'Delay n/a' : `${Math.round(arrival.delay_seconds / 60)} min delay`}</span></article>)}</div> : <p className="transit-limitation">{arrivals?.note || 'No schedule data is available for this stop.'}</p>}</div>}
    </section>
  </div>;
}
