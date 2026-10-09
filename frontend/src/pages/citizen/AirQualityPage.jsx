import { useMemo } from 'react';
import { Activity, Bell, Clock, Wind } from 'lucide-react';
import PageIntro from '../../components/shared/PageIntro.jsx';
import CityMap from '../../components/maps/CityMap.jsx';
import { EmptyState, ErrorNotice } from '../../components/shared/Toast.jsx';
import useApiResource from '../../hooks/useApiResource.js';
import { api, endpoints } from '../../services/api/client.js';
import { useApp } from '../../context/AppContext.jsx';

const value = (n, unit = '') => n == null ? '—' : `${n}${unit}`;
function age(date) { if (!date) return 'Time unavailable'; const mins = Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 60000)); return mins < 1 ? 'Updated just now' : mins < 60 ? `Updated ${mins} min ago` : `Updated ${Math.floor(mins / 60)} hr ago`; }
export default function AirQualityPage() {
  const { notify } = useApp();
  const { data, loading, error, reload } = useApiResource(() => api.get(endpoints.aqi()), []);
  const stations = Array.isArray(data) ? [...data].sort((a,b) => (b.aqi ?? -1) - (a.aqi ?? -1)) : [];
  const markers = useMemo(() => stations.filter((x) => Number.isFinite(x.latitude) && Number.isFinite(x.longitude)).map((x) => ({ id: x.id, lat: x.latitude, lng: x.longitude, title: x.station_name, description: `AQI ${x.aqi ?? 'not supplied'} · ${x.source}`, kind: x.aqi >= 200 ? 'critical' : x.aqi >= 100 ? 'busy' : 'normal' })), [data]);
  const validAqi = stations.filter((s) => s.aqi != null);
  const average = validAqi.length ? Math.round(validAqi.reduce((sum, s) => sum + s.aqi, 0) / validAqi.length) : null;
  const primary = stations.find((s) => s.aqi != null) || stations[0];
  return <>
    <PageIntro eyebrow="CPCB / CONFIGURED STATION OBSERVATIONS" title="Know the air before you go" description="Review recent station readings and pollutant measurements reported by connected sources." action={<button className="utility" onClick={reload}><Activity size={15}/> Refresh readings</button>} />
    <ErrorNotice message={error} onRetry={reload}/>
    <div className="aqi-top-grid"><section className="panel aqi-map-panel"><div className="panel-head"><div><div className="eyebrow">STATION MAP</div><h3>Available observations</h3></div><span className="status-pill">{stations.length} stations</span></div><CityMap markers={markers} zoom={11} className="aqi-map"/><div className="map-foot"><span><Wind size={13}/> Station locations</span><small>Only configured coordinates are shown</small></div></section>
      <aside className="panel aqi-feature"><div className="aqi-gauge"><div><b>{average ?? '—'}</b><small>AVG AQI</small></div></div><h3>{average == null ? 'AQI unavailable' : primary?.category || 'AQI reported by source'}</h3><p>{primary ? `${primary.station_name} · ${age(primary.observed_at)}` : 'No recent station observations were returned for this area.'}</p><div className="pollutant-block"><small>Primary pollutant · PM2.5</small><b>{value(primary?.pm25, ' µg/m³')}</b></div><button className="secondary full" onClick={() => notify('AQI notifications are not supported by the current API; no subscription was created.')}><Bell size={14}/>Notify me when AQI improves</button><p className="api-note">Pollutant concentrations and AQI values are displayed as supplied by the source. An AQI may be absent even when pollutant measurements exist.</p></aside></div>
    <div className="station-grid">{loading ? <div className="panel loading-lines">Loading station observations…</div> : stations.length ? stations.map((station) => <article className="panel station-card" key={station.id}><div className="station-card-top"><span>{station.source}</span><b className={station.aqi == null ? '' : station.aqi >= 200 ? 'aqi-critical' : station.aqi >= 100 ? 'aqi-warning' : 'aqi-normal'}>{station.aqi ?? '—'}</b></div><h3>{station.station_name}</h3><small>{age(station.observed_at)}</small><div className="pollutant-grid"><div><small>PM2.5</small><b>{value(station.pm25)}</b></div><div><small>PM10</small><b>{value(station.pm10)}</b></div><div><small>NO₂</small><b>{value(station.no2)}</b></div><div><small>O₃</small><b>{value(station.o3)}</b></div></div><div className="station-card-footer"><span>{station.category || 'Category not supplied'}</span><span>{station.latitude.toFixed(3)}, {station.longitude.toFixed(3)}</span></div></article>) : <div className="panel station-empty"><EmptyState title="No recent AQI observations" description="Connect a permitted CPCB/CAAQMS or other authorized AQI feed, then refresh. OpenAQ pollutant concentration is not treated as an official CPCB AQI."/></div>}</div>
  </>;
}
