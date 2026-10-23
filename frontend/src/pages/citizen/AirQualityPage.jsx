import { useMemo } from 'react';
import { Activity, Bell, Clock, Wind } from 'lucide-react';
import PageIntro from '../../components/shared/PageIntro.jsx';
import CityMap from '../../components/maps/CityMap.jsx';
import { EmptyState, ErrorNotice } from '../../components/shared/Toast.jsx';
import useApiResource from '../../hooks/useApiResource.js';
import { api, endpoints } from '../../services/api/client.js';
import { useApp } from '../../context/AppContext.jsx';

const value = (n, unit = '') => n == null ? '—' : `${n}${unit}`;
function age(date, reference = false) { if (reference) return 'Reference estimate · not live'; if (!date) return 'Time unavailable'; const mins = Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 60000)); return mins < 1 ? 'Updated just now' : mins < 60 ? `Updated ${mins} min ago` : `Updated ${Math.floor(mins / 60)} hr ago`; }
const REFERENCE_STATIONS = [
  { id: 'ref-delhi', station_name: 'Delhi city reference', latitude: 28.6139, longitude: 77.2090, aqi: 164, pm25: 78, pm10: 142, no2: 31, o3: 22, category: 'Unhealthy for sensitive groups', source: 'City reference estimate', observed_at: null },
  { id: 'ref-lucknow', station_name: 'Lucknow city reference', latitude: 26.8467, longitude: 80.9462, aqi: 118, pm25: 43, pm10: 91, no2: 24, o3: 19, category: 'Sensitive groups should take care', source: 'City reference estimate', observed_at: null },
  { id: 'ref-mumbai', station_name: 'Mumbai city reference', latitude: 19.0760, longitude: 72.8777, aqi: 92, pm25: 32, pm10: 64, no2: 18, o3: 27, category: 'Moderate', source: 'City reference estimate', observed_at: null },
  { id: 'ref-bengaluru', station_name: 'Bengaluru city reference', latitude: 12.9716, longitude: 77.5946, aqi: 74, pm25: 25, pm10: 51, no2: 16, o3: 24, category: 'Moderate', source: 'City reference estimate', observed_at: null },
  { id: 'ref-kolkata', station_name: 'Kolkata city reference', latitude: 22.5726, longitude: 88.3639, aqi: 131, pm25: 49, pm10: 106, no2: 28, o3: 21, category: 'Sensitive groups should take care', source: 'City reference estimate', observed_at: null },
  { id: 'ref-chennai', station_name: 'Chennai city reference', latitude: 13.0827, longitude: 80.2707, aqi: 68, pm25: 21, pm10: 46, no2: 14, o3: 25, category: 'Moderate', source: 'City reference estimate', observed_at: null },
];
export default function AirQualityPage() {
  const { notify } = useApp();
  const { data, loading, error, reload } = useApiResource(() => api.get(endpoints.aqi()), []);
  const usingFallback = !Array.isArray(data) || data.length === 0;
  const stations = (usingFallback ? REFERENCE_STATIONS : [...data]).sort((a,b) => (b.aqi ?? -1) - (a.aqi ?? -1));
  const markers = useMemo(() => stations.filter((x) => Number.isFinite(x.latitude) && Number.isFinite(x.longitude)).map((x) => ({ id: x.id, lat: x.latitude, lng: x.longitude, title: x.station_name, description: `AQI ${x.aqi ?? 'not supplied'} · ${x.source}`, kind: x.aqi >= 200 ? 'critical' : x.aqi >= 100 ? 'busy' : 'normal' })), [data]);
  const validAqi = stations.filter((s) => s.aqi != null);
  const average = validAqi.length ? Math.round(validAqi.reduce((sum, s) => sum + s.aqi, 0) / validAqi.length) : null;
  const primary = stations.find((s) => s.aqi != null) || stations[0];
  return <>
    <PageIntro eyebrow="CPCB / CONFIGURED STATION OBSERVATIONS" title="Know the air before you go" description="Review recent station readings and pollutant measurements reported by connected sources." action={<button className="utility" onClick={reload}><Activity size={15}/> Refresh readings</button>} />
    {usingFallback && <div className="notice aqi-reference-banner"><Activity size={15}/><span><b>City reference estimates are shown.</b> Live station readings could not be confirmed, so these values are illustrative and are not official or live measurements.</span><button className="utility" onClick={reload}>Retry live feed</button></div>}
    <ErrorNotice message={error} onRetry={reload}/>
    <div className="aqi-top-grid"><section className="panel aqi-map-panel"><div className="panel-head"><div><div className="eyebrow">STATION MAP</div><h3>Available observations</h3></div><span className="status-pill">{stations.length} stations</span></div><CityMap markers={markers} zoom={11} className="aqi-map"/><div className="map-foot"><span><Wind size={13}/> Station locations</span><small>Only configured coordinates are shown</small></div></section>
      <aside className="panel aqi-feature"><div className="aqi-gauge"><div><b>{average ?? '—'}</b><small>AVG AQI</small></div></div><h3>{average == null ? 'AQI unavailable' : primary?.category || 'AQI reported by source'}</h3><p>{primary ? `${primary.station_name} · ${age(primary.observed_at, usingFallback)}` : 'No recent station observations were returned for this area.'}</p><div className="pollutant-block"><small>Primary pollutant · PM2.5</small><b>{value(primary?.pm25, ' µg/m³')}</b></div><button className="secondary full" onClick={() => notify('AQI notifications are not supported by the current API; no subscription was created.')}><Bell size={14}/>Notify me when AQI improves</button><p className="api-note">{usingFallback ? 'This reference view keeps the map and city-level indicators useful during a feed outage. Values are illustrative, not live.' : 'Pollutant concentrations and AQI values are displayed as supplied by the source. An AQI may be absent even when pollutant measurements exist.'}</p></aside></div>
    <div className="station-grid">{stations.map((station) => <article className="panel station-card" key={station.id}><div className="station-card-top"><span>{station.source}</span><b className={station.aqi == null ? '' : station.aqi >= 200 ? 'aqi-critical' : station.aqi >= 100 ? 'aqi-warning' : 'aqi-normal'}>{station.aqi ?? '—'}</b></div><h3>{station.station_name}</h3><small>{age(station.observed_at, usingFallback)}</small><div className="pollutant-grid"><div><small>PM2.5</small><b>{value(station.pm25)}</b></div><div><small>PM10</small><b>{value(station.pm10)}</b></div><div><small>NO₂</small><b>{value(station.no2)}</b></div><div><small>O₃</small><b>{value(station.o3)}</b></div></div><div className="station-card-footer"><span>{station.category || 'Category not supplied'}</span><span>{station.latitude.toFixed(3)}, {station.longitude.toFixed(3)}</span></div></article>)}</div>
  </>;
}
