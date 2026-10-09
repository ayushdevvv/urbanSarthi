import { useMemo } from 'react';
import { Activity, ArrowRight, Bus, Cloud, Leaf, MapPin, Navigation, Route, Wind } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import CityMap, { getLocationCoordinates } from '../../components/maps/CityMap.jsx';
import PageIntro from '../../components/shared/PageIntro.jsx';
import { EmptyState, ErrorNotice } from '../../components/shared/Toast.jsx';
import useApiResource from '../../hooks/useApiResource.js';
import { api, endpoints } from '../../services/api/client.js';

const HOME_DEFAULTS = { from: 'New Delhi Railway Station', to: 'India Gate' };
export default function CitizenHomePage() {
  const navigate = useNavigate();
  const { data: aqiData, loading: aqiLoading, error: aqiError, reload: reloadAqi } = useApiResource(() => api.get(endpoints.aqi()), []);
  const { data: transitRoutes, loading: transitLoading, error: transitError } = useApiResource(() => api.get(endpoints.transitRoutes), []);
  const latestAqi = (aqiData || []).filter((item) => item.aqi !== null && item.aqi !== undefined).sort((a, b) => new Date(b.observed_at) - new Date(a.observed_at))[0];
  const markers = useMemo(() => (aqiData || []).filter((item) => Number.isFinite(item.latitude) && Number.isFinite(item.longitude)).map((item) => ({ id: `aqi-${item.id}`, lat: item.latitude, lng: item.longitude, title: item.station_name, description: `AQI: ${item.aqi ?? 'not supplied'} · ${item.source}`, kind: item.aqi >= 200 ? 'critical' : item.aqi >= 100 ? 'busy' : 'normal' })), [aqiData]);
  const routeMarkers = [HOME_DEFAULTS.from, HOME_DEFAULTS.to].map((name, index) => { const [lat, lng] = getLocationCoordinates(name); return { id: `route-${index}`, lat, lng, title: name }; });
  return <>
    <PageIntro eyebrow="NAMASTE, COMMUTER" title="Where are you headed today?" description="Choose a route that balances your time, cost and pollution exposure." action={<button className="utility" onClick={() => navigate('/citizen/air-quality')}><Wind size={15}/> View air quality</button>} />
    <div className="home-planner-grid"><section className="panel route-widget"><div className="route-widget-head"><div><div className="eyebrow">QUICK ROUTE PLANNER</div><h3>Your next journey</h3></div><Route size={18}/></div><div className="route-location"><span className="route-origin-dot"/><div><small>From</small><b>{HOME_DEFAULTS.from}</b></div></div><div className="route-location"><span className="route-destination-dot"/><div><small>To</small><b>{HOME_DEFAULTS.to}</b></div></div><button className="primary full" onClick={() => navigate('/citizen/plan')}><Navigation size={15}/> Plan your journey</button><div className="preference-pills"><span><Activity size={13}/> Fastest</span><span><Route size={13}/> Balanced</span><span><Leaf size={13}/> Cleanest</span></div></section>
      <section className="panel home-map-panel"><div className="home-map-top"><span><MapPin size={14}/> DELHI NCR · CITY MAP</span><button className="text-action" onClick={() => navigate('/citizen/air-quality')}>View air quality <ArrowRight size={13}/></button></div><CityMap markers={markers.length ? markers : routeMarkers} zoom={12} className="citizen-home-map"/><div className="map-at-a-glance"><div><small>Latest AQI</small><b>{aqiLoading ? 'Loading…' : latestAqi ? latestAqi.aqi ?? 'Not supplied' : '—'}</b><span>{latestAqi?.station_name || (aqiError ? 'AQI unavailable' : 'No recent station observation')}</span></div><div><small>Transit routes</small><b>{transitLoading ? 'Loading…' : transitRoutes?.length ?? '—'}</b><span>{transitError ? 'Transit data unavailable' : 'From configured feed'}</span></div></div></section></div>
    <div className="citizen-shortcuts"><button className="shortcut-card" onClick={() => navigate('/citizen/air-quality')}><span className="shortcut-icon green"><Wind size={19}/></span><div><b>Know the air before you go</b><small>{latestAqi ? `${latestAqi.station_name} · AQI ${latestAqi.aqi ?? 'not supplied'}` : aqiError ? 'AQI feed unavailable' : 'Check nearby air quality stations'}</small></div><ArrowRight size={17}/></button><button className="shortcut-card" onClick={() => navigate('/citizen/transit')}><span className="shortcut-icon blue"><Bus size={19}/></span><div><b>Public transport</b><small>{transitRoutes?.length ?? '—'} routes listed by the configured transit feed</small></div><ArrowRight size={17}/></button><button className="shortcut-card" onClick={() => navigate('/citizen/trips')}><span className="shortcut-icon amber"><Leaf size={19}/></span><div><b>Your travel activity</b><small>Review saved journeys and mobility impact</small></div><ArrowRight size={17}/></button></div>
    {aqiError && <ErrorNotice message={aqiError} onRetry={reloadAqi}/>}
  </>;
}
