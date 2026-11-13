import { useMemo, useState } from 'react';
import { Activity, AlertTriangle, Clock3, ExternalLink, Gauge, LocateFixed, MapPin, Newspaper, RefreshCw, Search, TrafficCone } from 'lucide-react';
import PageIntro from '../../components/shared/PageIntro.jsx';
import { EmptyState } from '../../components/shared/Toast.jsx';
import CityMap from '../../components/maps/CityMap.jsx';
import { api } from '../../services/api/client.js';
import './traffic-conditions.css';

const number = (value, suffix = '') => value == null || !Number.isFinite(Number(value)) ? '—' : `${Math.round(Number(value) * 10) / 10}${suffix}`;
const distance = (value) => value == null ? '—' : Number(value) >= 1000 ? `${(Number(value) / 1000).toFixed(1)} km` : `${Math.round(Number(value))} m`;
const timeLabel = (value) => value ? new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Time not supplied';
const colorFor = (status) => ({ heavy: '#c9574f', closed: '#a93333', slow: '#d79a36', moving: '#438e69' }[status] || '#87928b');

function TrafficRoadCard({ road }) {
  const flow = road.traffic;
  return <article className="tc-road-card">
    <div className="tc-road-title"><span className="tc-road-mark" style={{ background: colorFor(flow?.status) }}/><div><b>{road.name}</b><small>{String(road.road_type || 'road').replaceAll('_', ' ')} · {distance(road.distance_meters)} away</small></div></div>
    <div className="tc-road-status"><span className={`tc-status-dot ${flow?.status || 'unknown'}`}/><b>{flow ? flow.status === 'closed' ? 'Closed' : flow.status === 'heavy' ? 'Heavy traffic' : flow.status === 'slow' ? 'Slow traffic' : 'Moving well' : 'Live speed unavailable'}</b></div>
    <div className="tc-road-metrics"><div><small>Current speed</small><strong>{number(flow?.current_speed_kmph, ' km/h')}</strong></div><div><small>Free-flow speed</small><strong>{number(flow?.free_flow_speed_kmph, ' km/h')}</strong></div><div><small>Delay ratio</small><strong>{flow?.congestion_ratio == null ? '—' : `${Math.round((1 - Math.min(1, flow.congestion_ratio)) * 100)}%`}</strong></div></div>
  </article>;
}

export default function TrafficConditionsPage() {
  const [query, setQuery] = useState('');
  const [place, setPlace] = useState(null);
  const [traffic, setTraffic] = useState(null);
  const [news, setNews] = useState(null);
  const [loading, setLoading] = useState(false);
  const [newsLoading, setNewsLoading] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);

  const load = async (point, label) => {
    setLoading(true); setNewsLoading(true); setError('');
    setTraffic(null); setNews(null);
    setPlace({ ...point, label }); setQuery(label);
    const params = new URLSearchParams({ latitude: point.latitude, longitude: point.longitude, radius_m: '3500' });
    const newsParams = new URLSearchParams({ latitude: point.latitude, longitude: point.longitude, area: label, limit: '8' });

    // Road geometry/flow is the primary result. News is independent so a slow
    // search provider never holds the map and road status behind a Promise.all.
    const roadRequest = api.get(`/traffic/nearby?${params.toString()}`, { timeoutMs: 11500, fallbackGraceMs: 0 });
    const newsRequest = api.get(`/traffic/news?${newsParams.toString()}`, { timeoutMs: 6500, fallbackGraceMs: 0 })
      .then((value) => setNews(value))
      .catch((err) => setNews({ status: 'unavailable', provider: null, items: [], note: err.message || 'Traffic news is unavailable.' }))
      .finally(() => setNewsLoading(false));

    try {
      const trafficResult = await roadRequest;
      setTraffic(trafficResult);
      setLastUpdated(new Date().toISOString());
      if (!trafficResult?.roads?.length) {
        setError(trafficResult?.note || 'Road geometry is temporarily unavailable for this area. The map and incident search remain available; try Refresh shortly.');
      }
    } catch (err) {
      setTraffic(null);
      setError(err?.message || 'Nearby road information could not be loaded.');
    } finally { setLoading(false); }
    await newsRequest;
  };

  const searchArea = async (event) => {
    event?.preventDefault?.();
    const clean = query.trim();
    if (!clean) { setError('Enter a city, neighbourhood or road to search.'); return; }
    setLoading(true); setError('');
    try {
      let results = [];
      try {
        const response = await api.get(`/routing/geocode?q=${encodeURIComponent(clean)}&limit=5`, { timeoutMs: 8500, fallbackGraceMs: 0 });
        results = response?.results || [];
      } catch { /* One bounded lookup only; don't send the same query twice. */ }
      const selected = results.find((item) => String(item.label || '').toLowerCase() === clean.toLowerCase()) || results[0];
      if (!selected || !Number.isFinite(Number(selected.latitude)) || !Number.isFinite(Number(selected.longitude))) {
        throw new Error(`No mapped location found for “${clean}”. Try a nearby landmark or full address.`);
      }
      await load({ latitude: Number(selected.latitude), longitude: Number(selected.longitude) }, selected.label || clean);
    } catch (err) { setError(err?.message || 'Could not find that area.'); setLoading(false); }
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) { setError('This browser does not support location access. Search for an area instead.'); return; }
    setLocating(true); setError('');
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      const point = { latitude: coords.latitude, longitude: coords.longitude };
      // Begin the useful lookup immediately; reverse geocoding is a label enhancement only.
      void load(point, 'Your current location');
      setLocating(false);
      api.get(`/routing/reverse-geocode?latitude=${coords.latitude}&longitude=${coords.longitude}`, { timeoutMs: 3500, fallbackGraceMs: 2000 })
        .then((reverse) => {
          const label = reverse?.label || 'Your current location';
          setPlace((current) => current ? { ...current, label } : current);
          setQuery(label);
        }).catch(() => {});
    }, (geoError) => {
      setLocating(false);
      setError(geoError.code === 1 ? 'Location permission was denied. You can still search for any area.' : 'Could not retrieve your location. Check device location services and retry.');
    }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 120000 });
  };

  const roads = useMemo(() => traffic?.roads || [], [traffic]);
  const measured = roads.filter((road) => road.traffic);
  const mapLines = roads.filter((road) => road.geometry?.length > 1).map((road) => ({
    id: road.id, selected: true, color: colorFor(road.traffic?.status), coordinates: road.geometry,
    pathOptions: { color: colorFor(road.traffic?.status), weight: road.traffic ? 6 : 3, opacity: road.traffic ? 0.9 : 0.45 },
  }));
  const markers = [
    ...(place ? [{ id: 'traffic-search-point', lat: place.latitude, lng: place.longitude, title: place.label, description: 'Selected traffic search area', kind: 'normal' }] : []),
    ...(traffic?.incidents || []).filter((item) => Number.isFinite(Number(item.latitude)) && Number.isFinite(Number(item.longitude))).map((item) => ({ id: `incident-${item.id}`, lat: Number(item.latitude), lng: Number(item.longitude), title: item.type, description: item.from || item.to || 'Traffic incident', kind: 'critical' })),
  ];
  const summary = traffic?.traffic_summary || {};

  return <div className="traffic-conditions-page">
    <PageIntro eyebrow="YOUR LOCAL ROADS" title="Traffic conditions" description="See mapped roads, provider-reported traffic flow, incidents and nearby traffic updates." action={<button className="utility" type="button" onClick={() => place && load(place, place.label)} disabled={!place || loading}><RefreshCw size={14}/>{loading ? 'Refreshing…' : 'Refresh'}</button>} />
    <section className="panel tc-search-panel">
      <form className="tc-search-form" onSubmit={searchArea}>
        <label><span className="eyebrow">SEARCH ANY AREA</span><span className="tc-search-input"><MapPin size={17}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="City, neighbourhood, road or landmark" autoComplete="off"/></span></label>
        <button className="primary" type="submit" disabled={loading || locating}><Search size={15}/>Find traffic</button>
        <button className="secondary" type="button" onClick={useMyLocation} disabled={locating || loading}><LocateFixed size={15}/>{locating ? 'Locating…' : 'Use my location'}</button>
      </form>
      {error && <div className="tc-inline-error"><AlertTriangle size={15}/>{error}</div>}
      <div className="tc-search-foot"><span><i className="tc-live-pulse"/> Location access happens only when you tap “Use my location”.</span>{place && <small>{place.label}</small>}</div>
    </section>

    {loading && <section className="panel tc-loading"><Activity size={19}/><b>Loading nearby road intelligence</b><span>Discovering mapped roads and checking available live providers…</span></section>}

    {traffic && <>
      <div className="tc-kpi-grid">
        <article className="panel tc-kpi"><span><Gauge size={16}/>Live speed readings</span><strong>{roads.length ? measured.length : '—'}</strong><small>{roads.length ? `of ${roads.length} mapped roads` : 'Road discovery unavailable'}</small></article>
        <article className="panel tc-kpi"><span><TrafficCone size={16}/>Heavy / closed</span><strong>{roads.length ? number(summary.heavy_roads, '') : '—'}</strong><small>{roads.length ? 'Provider-observed segments' : 'Waiting for road mapping'}</small></article>
        <article className="panel tc-kpi"><span><Activity size={16}/>Slow traffic</span><strong>{roads.length ? number(summary.slow_roads, '') : '—'}</strong><small>{roads.length ? 'Provider-observed segments' : 'Waiting for road mapping'}</small></article>
        <article className="panel tc-kpi"><span><AlertTriangle size={16}/>Incidents</span><strong>{traffic.incidents?.length ?? '—'}</strong><small>{traffic.incident_status === 'available' ? 'Provider incident feed' : 'Incident feed unavailable'}</small></article>
      </div>
      <section className="panel tc-map-panel">
        <div className="panel-head"><div><div className="eyebrow">NEARBY ROAD NETWORK</div><h3>{place?.label || 'Selected area'}</h3><p>{roads.length ? `${roads.length} mapped road segments within ${distance(traffic.radius_m)}` : `Road geometry is temporarily unavailable within ${distance(traffic.radius_m)}`}</p></div><span className={`status-pill ${measured.length ? 'status-success' : ''}`}>{measured.length ? 'Live flow available' : 'Mapped roads only'}</span></div>
        {markers.length || mapLines.length ? <CityMap city={place?.label || 'Lucknow'} markers={markers} routeOptions={mapLines} zoom={14} className="tc-map"/> : <div className="tc-map-empty"><EmptyState title="Map unavailable" description="Try a nearby landmark or refresh the map."/></div>}
        <div className="tc-map-legend"><span><i style={{background:'#c9574f'}}/>Heavy / closed</span><span><i style={{background:'#d79a36'}}/>Slow</span><span><i style={{background:'#438e69'}}/>Moving</span><span><i style={{background:'#87928b'}}/>No speed data</span><small>Road shapes: OpenStreetMap · flow colours: TomTom when configured</small></div>
      </section>
      <div className="tc-content-grid">
        <section className="panel tc-roads-panel"><div className="panel-head"><div><div className="eyebrow">ROAD-BY-ROAD</div><h3>Nearby roads</h3></div><span className="status-pill">{roads.length} found</span></div>
          {roads.length ? <div className="tc-road-list">{roads.slice(0, 16).map((road) => <TrafficRoadCard key={road.id} road={road}/>)}</div> : <EmptyState title="Road mapping is temporarily unavailable" description="The base map and incident feed remain available. Refresh to retry nearby road discovery."/>}
          {!measured.length && <p className="tc-source-note">{traffic.traffic_note || 'Live speed readings are not available. The map shows mapped roads without assigning guessed congestion levels.'}</p>}
        </section>
        <section className="panel tc-incidents-panel"><div className="panel-head"><div><div className="eyebrow">DISRUPTIONS</div><h3>Traffic incidents</h3></div><AlertTriangle size={18}/></div>
          {traffic.incidents?.length ? traffic.incidents.slice(0, 8).map((incident) => <article className="tc-incident" key={incident.id}><span><AlertTriangle size={15}/></span><div><b>{incident.type}</b><small>{[incident.from, incident.to].filter(Boolean).join(' → ') || 'Nearby road incident'}</small><small>{incident.delay_seconds ? `${Math.round(incident.delay_seconds / 60)} min reported delay` : 'Delay not supplied'} · {timeLabel(incident.observed_at)}</small></div></article>) : <EmptyState title="No live incidents returned" description={traffic.incident_note || 'Incident coverage depends on the connected traffic provider.'}/>}
        </section>
      </div>
      <section className="panel tc-news-panel"><div className="panel-head"><div><div className="eyebrow">LOCAL MOBILITY UPDATES</div><h3>Traffic news nearby</h3><p>Recent reporting related to road conditions around {place?.label}.</p></div><Newspaper size={19}/></div>
        {newsLoading ? <div className="tc-news-loading"><Activity size={15}/> Checking recent traffic reports…</div> : news?.items?.length ? <div className="tc-news-grid">{news.items.map((item, index) => <article className="tc-news-card" key={item.url || index}><div className="tc-news-meta"><span>{item.source || news.provider || 'News source'}</span><time>{timeLabel(item.published_at)}</time></div><a href={item.url} target="_blank" rel="noreferrer">{item.title}<ExternalLink size={13}/></a>{item.snippet && <p>{item.snippet}</p>}</article>)}</div> : <EmptyState title="No nearby traffic stories found" description={news?.note || 'News search is unavailable right now.'}/>}
        <div className="tc-news-foot"><span>{news?.provider || 'News search'}</span><small>News is reporting, not live traffic telemetry. Check publisher timestamps.</small></div>
      </section>
    </>}
    {!traffic && !loading && !error && <section className="panel tc-empty-start"><div className="tc-empty-icon"><MapPin size={23}/></div><h3>Start with an area</h3><p>Search a city or road, or choose Use my location. UrbanSaarthi will discover nearby mapped roads and check available live traffic and incident feeds.</p></section>}
    {lastUpdated && traffic && <div className="tc-updated"><Clock3 size={13}/> Checked {new Date(lastUpdated).toLocaleTimeString()} · {traffic.provider || 'Road map source unavailable'}</div>}
  </div>;
}
