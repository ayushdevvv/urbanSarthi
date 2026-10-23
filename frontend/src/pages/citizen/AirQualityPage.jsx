import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, AlertTriangle, Bell, Clock, ExternalLink, LocateFixed, MapPin, RefreshCw, Route, Search, Wind } from 'lucide-react';
import PageIntro from '../../components/shared/PageIntro.jsx';
import CityMap from '../../components/maps/CityMap.jsx';
import { ErrorNotice } from '../../components/shared/Toast.jsx';
import useApiResource from '../../hooks/useApiResource.js';
import { api, endpoints } from '../../services/api/client.js';
import { useApp } from '../../context/AppContext.jsx';
import './location-aqi.css';

const value = (n, unit = '') => n == null || !Number.isFinite(Number(n)) ? '—' : `${Math.round(Number(n) * 10) / 10}${unit}`;
const indexValue = (item) => item?.openweather_index ?? item?.us_aqi ?? null;
const hourLabel = (s) => { try { return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(s)); } catch { return s || '—'; } };
const categoryClass = (name = '') => String(name).toLowerCase().replaceAll(' ', '-');
const currentSeason = () => { const month = new Date().getMonth() + 1; return month >= 6 && month <= 9 ? 'Monsoon' : month >= 3 && month <= 5 ? 'Summer' : 'Winter'; };
const dayPart = () => { const hour = new Date().getHours(); return hour >= 6 && hour < 18 ? 'Day' : 'Night'; };
const pickPlace = (response, query) => {
  const results = response?.results || [];
  if (!results.length) throw new Error(`No mapped place found for “${query}”. Try a landmark, neighbourhood, or full address.`);
  return results.find((item) => String(item.label).toLowerCase() === query.trim().toLowerCase()) || results[0];
};

async function getAmbientWeather(latitude, longitude) {
  const params = new URLSearchParams({
    latitude: String(latitude), longitude: String(longitude), timezone: 'auto',
    current: 'temperature_2m,relative_humidity_2m',
    hourly: 'temperature_2m,relative_humidity_2m', forecast_days: '2',
  });
  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Weather grid returned ${response.status}`);
  const payload = await response.json();
  const hourly = (payload.hourly?.time || []).map((time, index) => ({
    time,
    temperature: payload.hourly?.temperature_2m?.[index],
    humidity: payload.hourly?.relative_humidity_2m?.[index],
  }));
  return { temperature: payload.current?.temperature_2m, humidity: payload.current?.relative_humidity_2m, hourly, provider: 'Open-Meteo weather' };
}

function nearestHourlyWeather(weather, time) {
  if (!weather?.hourly?.length || !time) return weather;
  const target = new Date(time).getTime();
  if (!Number.isFinite(target)) return weather;
  const nearest = weather.hourly.reduce((best, item) => {
    const diff = Math.abs(new Date(item.time).getTime() - target);
    return diff < best.diff ? { item, diff } : best;
  }, { item: null, diff: Infinity });
  return nearest.item && nearest.diff < 5 * 60 * 60 * 1000
    ? { ...weather, temperature: nearest.item.temperature ?? weather.temperature, humidity: nearest.item.humidity ?? weather.humidity, forecastTime: nearest.item.time }
    : weather;
}

async function predictTrainedCategory(point, pollutants, weather) {
  const pm25 = Number(pollutants?.pm25), pm10 = Number(pollutants?.pm10);
  if (!Number.isFinite(pm25) || !Number.isFinite(pm10) || !Number.isFinite(Number(weather?.temperature)) || !Number.isFinite(Number(weather?.humidity))) {
    return { model: null, modelNote: 'The model requires PM2.5, PM10, temperature and humidity for this point. Inputs were incomplete, so no category was invented.' };
  }
  const form = new FormData();
  form.set('pm25', String(pm25)); form.set('pm10', String(pm10));
  form.set('temperature', String(weather.temperature)); form.set('humidity', String(weather.humidity));
  form.set('season', currentSeason()); form.set('day_or_night', dayPart());
  form.set('city', point.label || 'Selected route location');
  form.set('latitude', String(point.latitude)); form.set('longitude', String(point.longitude));
  try {
    const model = await api.postForm('/aqi-vision/predict-form', form);
    return { model, modelNote: '' };
  } catch (error) {
    return { model: null, modelNote: error?.message || 'The trained model is unavailable at this point.' };
  }
}

async function loadPointOutlook(point, includeModelForecast = false) {
  const coords = `latitude=${Number(point.latitude)}&longitude=${Number(point.longitude)}`;
  const [airResult, weatherResult] = await Promise.allSettled([
    api.get(`/aqi/location-forecast?${coords}`),
    getAmbientWeather(point.latitude, point.longitude),
  ]);
  const air = airResult.status === 'fulfilled' ? airResult.value : { status: 'unavailable', provider: null, current: {}, forecast: [], note: airResult.reason?.message || 'Air-quality feed unavailable.' };
  const weather = weatherResult.status === 'fulfilled' ? weatherResult.value : null;
  const currentPrediction = await predictTrainedCategory(point, air.current || {}, weather);
  let modelForecast = [];
  if (includeModelForecast && Array.isArray(air.forecast) && air.forecast.length && weather) {
    const now = Date.now();
    const futureWindows = air.forecast.filter((item) => item?.time && new Date(item.time).getTime() > now && Number.isFinite(Number(item.pm25)) && Number.isFinite(Number(item.pm10))).slice(0, 2);
    for (const forecast of futureWindows) {
      const forecastWeather = nearestHourlyWeather(weather, forecast.time);
      const predicted = await predictTrainedCategory(point, forecast, forecastWeather);
      modelForecast.push({ time: forecast.time, providerCategory: forecast.category, providerIndex: indexValue(forecast), ...predicted });
    }
  }
  return { ...point, air, weather, ...currentPrediction, modelForecast };
}

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
  const { data, loading: stationsLoading, error: stationError, reload } = useApiResource(() => api.get(endpoints.aqi()), []);
  const [searchMode, setSearchMode] = useState('location');
  const [locationQuery, setLocationQuery] = useState('');
  const [originQuery, setOriginQuery] = useState('');
  const [destinationQuery, setDestinationQuery] = useState('');
  const [suggestions, setSuggestions] = useState({ location: [], origin: [], destination: [] });
  const [outlooks, setOutlooks] = useState([]);
  const [routeGeometry, setRouteGeometry] = useState([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [outlookError, setOutlookError] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);
  const suggestionTimer = useRef(null);

  useEffect(() => () => window.clearTimeout(suggestionTimer.current), []);
  const requestSuggestions = (field, query) => {
    window.clearTimeout(suggestionTimer.current);
    if (query.trim().length < 2) { setSuggestions((old) => ({ ...old, [field]: [] })); return; }
    suggestionTimer.current = window.setTimeout(async () => {
      try {
        const response = await api.get(`/routing/geocode?q=${encodeURIComponent(query.trim())}&limit=5`);
        setSuggestions((old) => ({ ...old, [field]: response.results || [] }));
      } catch { /* search remains editable while the geocoder is unavailable */ }
    }, 280);
  };

  async function resolveQuery(query) {
    const clean = query.trim();
    if (!clean) throw new Error('Enter a place, address, or route endpoint first.');
    return pickPlace(await api.get(`/routing/geocode?q=${encodeURIComponent(clean)}&limit=5`), clean);
  }

  async function fetchOutlooks(points, geometry = []) {
    setSearchBusy(true); setOutlookError(''); setOutlooks([]); setRouteGeometry(geometry);
    try {
      const results = [];
      // Run predictions one by one to avoid loading several copies of the model at once.
      for (let index = 0; index < points.length; index++) results.push(await loadPointOutlook(points[index], index === Math.floor((points.length - 1) / 2)));
      setOutlooks(results); setLastUpdated(new Date().toISOString());
      if (results.every((item) => item.air?.status === 'unavailable')) setOutlookError('Air-quality providers could not return a forecast for these coordinates. Retry when connectivity returns.');
    } catch (error) {
      setOutlookError(error?.message || 'Could not load an air-quality outlook for that search.');
    } finally { setSearchBusy(false); }
  }

  async function searchForecast(event) {
    event?.preventDefault?.();
    setSearchBusy(true); setOutlookError(''); setOutlooks([]);
    try {
      if (searchMode === 'location') {
        const selected = await resolveQuery(locationQuery);
        const point = { id: 'selected-location', label: selected.label, latitude: Number(selected.latitude), longitude: Number(selected.longitude), pointType: 'Selected location' };
        setLocationQuery(selected.label);
        setRouteGeometry([]);
        await fetchOutlooks([point]);
      } else {
        const [origin, destination] = await Promise.all([resolveQuery(originQuery), resolveQuery(destinationQuery)]);
        const planned = await api.post('/routing/plan', {
          origin_latitude: Number(origin.latitude), origin_longitude: Number(origin.longitude),
          destination_latitude: Number(destination.latitude), destination_longitude: Number(destination.longitude),
          origin_label: origin.label, destination_label: destination.label, preference: 'balanced', modes: ['driving'],
        });
        const route = planned?.routes?.[0];
        const coordinates = route?.geometry?.coordinates || [];
        const geometry = coordinates.map(([longitude, latitude]) => ({ lat: Number(latitude), lng: Number(longitude) }));
        let points;
        let geometryWarning = '';
        if (coordinates.length >= 3) {
          const samples = [0, 0.5, 1].map((fraction, index) => {
            const slot = Math.round(fraction * (coordinates.length - 1));
            const [longitude, latitude] = coordinates[slot];
            return { id: `route-point-${index}`, label: ['Route start', 'Along selected route', 'Destination'][index], latitude: Number(latitude), longitude: Number(longitude), pointType: ['Start', 'Along route', 'Destination'][index] };
          });
          points = samples;
        } else {
          points = [
            { id: 'route-origin', label: origin.label, latitude: Number(origin.latitude), longitude: Number(origin.longitude), pointType: 'Origin' },
            { id: 'route-destination', label: destination.label, latitude: Number(destination.latitude), longitude: Number(destination.longitude), pointType: 'Destination' },
          ];
          geometryWarning = 'The routing service did not return a road polyline; showing forecasts at the route endpoints only.';
        }
        setOriginQuery(origin.label); setDestinationQuery(destination.label);
        await fetchOutlooks(points, geometry);
        if (route?.warnings?.length) setOutlookError(route.warnings.join(' '));
        else if (geometryWarning) setOutlookError(geometryWarning);
      }
    } catch (error) {
      setOutlookError(error?.message || 'Could not resolve this location or route.');
    } finally { setSearchBusy(false); }
  }

  function useCurrentLocation() {
    if (!navigator.geolocation) { setOutlookError('Location access is not supported by this browser.'); return; }
    setOutlookError(''); setSearchBusy(true);
    navigator.geolocation.getCurrentPosition(async ({ coords }) => {
      let label = 'Your current location';
      try { const reverse = await api.get(`/routing/reverse-geocode?latitude=${coords.latitude}&longitude=${coords.longitude}`); label = reverse.label || label; } catch { /* coordinates remain enough for a forecast */ }
      setLocationQuery(label); setSearchMode('location');
      await fetchOutlooks([{ id: 'current-location', label, latitude: coords.latitude, longitude: coords.longitude, pointType: 'Current location' }]);
    }, (geoError) => { setSearchBusy(false); setOutlookError(geoError.code === 1 ? 'Location permission was denied. Search for a place instead or allow location access.' : 'Could not get your location. Check browser location services and retry.'); }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
  }

  const usingFallback = !Array.isArray(data) || data.length === 0;
  const stations = (usingFallback ? REFERENCE_STATIONS : [...data]).sort((a, b) => (b.aqi ?? -1) - (a.aqi ?? -1));
  const stationMarkers = useMemo(() => stations.filter((item) => Number.isFinite(item.latitude) && Number.isFinite(item.longitude)).map((item) => ({ id: item.id, lat: item.latitude, lng: item.longitude, title: item.station_name, description: `AQI ${item.aqi ?? 'not supplied'} · ${item.source}`, kind: item.aqi >= 200 ? 'critical' : item.aqi >= 100 ? 'busy' : 'normal' })), [data]);
  const validAqi = stations.filter((station) => station.aqi != null);
  const average = validAqi.length ? Math.round(validAqi.reduce((sum, station) => sum + station.aqi, 0) / validAqi.length) : null;
  const primary = stations.find((station) => station.aqi != null) || stations[0];
  const routeMarkers = outlooks.map((item, index) => ({ id: item.id || `outlook-${index}`, lat: item.latitude, lng: item.longitude, title: item.label, description: `${item.air?.provider || 'Provider unavailable'} · ${item.air?.current?.category || 'No category'}`, kind: (item.air?.current?.openweather_index >= 4 || item.air?.current?.us_aqi >= 151) ? 'critical' : 'busy' }));
  const mapMarkers = outlooks.length ? routeMarkers : stationMarkers;

  return <div className="citizen-air-quality-page">
    <PageIntro eyebrow="LOCATION AND ROUTE FORECAST" title="Air quality before you go" description="Search a place or driving route to compare provider forecasts and run the trained AQI category model at sampled route points." action={<button className="utility" onClick={() => { void reload(); if (outlooks.length) void fetchOutlooks(outlooks.map(({ id, label, latitude, longitude, pointType }) => ({ id, label, latitude, longitude, pointType })), routeGeometry); }} disabled={searchBusy}><RefreshCw size={14}/>{searchBusy ? 'Updating…' : 'Refresh outlook'}</button>} />
    <ErrorNotice message={stationError} onRetry={reload}/>
    {usingFallback && <div className="notice aqi-reference-banner"><Activity size={15}/><span><b>Reference station cards are shown below.</b> They are illustrative city estimates, not official or live measurements. Search above for a location-specific provider forecast.</span><button className="utility" onClick={reload}>Retry station feed</button></div>}

    <section className="panel aqi-route-search-panel">
      <div className="panel-head"><div><div className="eyebrow">FORECAST AREA</div><h3>Where should we check?</h3><p>Live location/hourly data comes from the configured provider. The trained model returns an AQI category, not a numeric AQI forecast.</p></div><button type="button" className="utility" onClick={useCurrentLocation} disabled={searchBusy}><LocateFixed size={14}/>Use my location</button></div>
      <div className="route-pref-options aqi-forecast-tabs"><button type="button" className={searchMode === 'location' ? 'selected' : ''} onClick={() => setSearchMode('location')}><MapPin size={14}/>One location</button><button type="button" className={searchMode === 'route' ? 'selected' : ''} onClick={() => setSearchMode('route')}><Route size={14}/>A route</button></div>
      <form className="aqi-route-search-form" onSubmit={searchForecast}>
        {searchMode === 'location' ? <label>Place, locality or address<input list="aqi-location-suggestions" value={locationQuery} onChange={(event) => { setLocationQuery(event.target.value); requestSuggestions('location', event.target.value); }} placeholder="e.g. Hazratganj, Lucknow" autoComplete="off"/><datalist id="aqi-location-suggestions">{suggestions.location.map((place) => <option key={place.place_id || place.label} value={place.label}/>)}</datalist></label> : <><label>Route origin<input list="aqi-origin-suggestions" value={originQuery} onChange={(event) => { setOriginQuery(event.target.value); requestSuggestions('origin', event.target.value); }} placeholder="Starting place" autoComplete="off"/><datalist id="aqi-origin-suggestions">{suggestions.origin.map((place) => <option key={place.place_id || place.label} value={place.label}/>)}</datalist></label><label>Destination<input list="aqi-destination-suggestions" value={destinationQuery} onChange={(event) => { setDestinationQuery(event.target.value); requestSuggestions('destination', event.target.value); }} placeholder="Destination" autoComplete="off"/><datalist id="aqi-destination-suggestions">{suggestions.destination.map((place) => <option key={place.place_id || place.label} value={place.label}/>)}</datalist></label></>}
        <button className="primary" type="submit" disabled={searchBusy}><Search size={15}/>{searchBusy ? 'Loading AQI and model…' : 'Get forecast & model cards'}</button>
      </form>
    </section>

    {outlookError && <div className="aqi-route-error"><AlertTriangle size={16}/><span>{outlookError}</span><button type="button" onClick={searchForecast}>Retry</button></div>}
    {outlooks.length > 0 && <>
      <section className="panel aqi-route-map-panel"><div className="panel-head"><div><div className="eyebrow">{searchMode === 'route' ? 'SELECTED ROUTE' : 'SELECTED LOCATION'}</div><h3>{searchMode === 'route' ? `${originQuery} to ${destinationQuery}` : outlooks[0].label}</h3></div><span className="status-pill">{outlooks.length} forecast point{outlooks.length === 1 ? '' : 's'}</span></div><CityMap markers={mapMarkers} route={routeGeometry} zoom={12}/><div className="map-foot"><span><MapPin size={13}/> {searchMode === 'route' ? 'Route samples and road polyline' : 'Provider forecast grid point'}</span><small>Map tiles © OpenStreetMap</small></div></section>
      <section className="aqi-model-result-section"><div className="section-heading"><div><div className="eyebrow">LOCATION FORECAST AND TRAINED MODEL</div><h3>{searchMode === 'route' ? 'Air outlook along your route' : 'Your local air outlook'}</h3><p>Updated {lastUpdated ? new Date(lastUpdated).toLocaleTimeString() : 'when requested'}.</p></div><span className="status-pill">{outlooks.filter((item) => item.model).length} model result(s)</span></div>
        <div className="aqi-route-card-grid">{outlooks.map((item, index) => {
          const current = item.air?.current || {};
          const reading = indexValue(current);
          const openWeatherScale = current.openweather_index != null;
          const hourly = (item.air?.forecast || []).filter((point) => indexValue(point) != null).slice(0, 3);
          return <article className="panel aqi-route-card" key={item.id || `${item.latitude}-${item.longitude}`}>
            <div className="aqi-route-card-top"><span className="aqi-route-point-type">{item.pointType || `Point ${index + 1}`}</span><span className={`aqi-mini-category category-${categoryClass(current.category)}`}>{current.category || 'Provider unavailable'}</span></div>
            <h3>{item.label}</h3><small className="aqi-route-coordinates">{Number(item.latitude).toFixed(4)}, {Number(item.longitude).toFixed(4)}</small>
            <div className="aqi-route-primary-value"><div><small>{openWeatherScale ? 'OpenWeather index · 1–5' : 'US AQI · 0–500'}</small><strong>{reading == null ? '—' : Math.round(reading)}</strong></div><span>{item.air?.provider || 'Air feed unavailable'}</span></div>
            <div className="aqi-route-pollutants"><div><small>PM2.5</small><b>{value(current.pm25, ' µg/m³')}</b></div><div><small>PM10</small><b>{value(current.pm10, ' µg/m³')}</b></div><div><small>Temp</small><b>{value(item.weather?.temperature, '°C')}</b></div><div><small>Humidity</small><b>{value(item.weather?.humidity, '%')}</b></div></div>
            <div className={`aqi-trained-model-card ${item.model ? 'has-model-result' : ''}`}><div><span className="eyebrow">TRAINED MODEL CATEGORY</span><strong>{item.model?.predicted_category || 'Prediction unavailable'}</strong><small>{item.model ? `${value(item.model.confidence, '%')} confidence · six-class model` : item.modelNote || 'The model needs provider inputs to run.'}</small></div>{item.model && <div className="aqi-model-confidence"><b>{Math.round(Number(item.model.confidence) || 0)}%</b><small>confidence</small></div>}</div>
            {item.model?.probabilities?.length > 0 && <div className="aqi-model-probabilities">{item.model.probabilities.slice().sort((a, b) => b.probability - a.probability).slice(0, 3).map((prediction) => <div key={prediction.category}><span>{prediction.category}</span><i><b style={{ width: `${Math.max(0, Math.min(100, Number(prediction.probability) || 0))}%` }}/></i><strong>{value(prediction.probability, '%')}</strong></div>)}</div>}
            {item.modelForecast?.length > 0 && <div className="aqi-trained-forecast"><div><b>Trained-model outlook</b><small>Predicted categories from the forecast pollutant/weather inputs</small></div><div className="aqi-trained-forecast-grid">{item.modelForecast.map((forecast) => <article key={forecast.time}><small>{hourLabel(forecast.time)}</small><strong>{forecast.model?.predicted_category || 'Unavailable'}</strong><span>{forecast.model ? `${Math.round(Number(forecast.model.confidence) || 0)}% confidence` : forecast.modelNote || 'Missing inputs'}</span></article>)}</div></div>}
            <div className="aqi-route-hourly"><b>Next forecast windows</b>{hourly.length ? hourly.map((forecast) => <span key={forecast.time}><small>{hourLabel(forecast.time)}</small><strong>{Math.round(indexValue(forecast))}</strong><small>{forecast.category}</small></span>) : <small>No hourly points returned by the provider.</small>}</div>
            <small className="aqi-route-provider-note">{item.air?.note || 'The provider does not supply a current forecast here.'}</small>
          </article>;
        })}</div>
        <div className="aqi-model-disclaimer"><Activity size={16}/><span><b>Model scope:</b> the supplied model classifies air-quality category and was trained with two road images plus pollutant/weather inputs. These route cards run its form-based path with neutral image placeholders because route imagery is not available automatically. For a full image-assisted result, use <a href="/citizen/aqi-vision">AQI Vision</a> and provide front and rear road images. Location is used to fetch environmental inputs; it is not itself a model feature.</span></div>
      </section>
    </>}

    <section className="aqi-reference-section"><div className="section-heading"><div><div className="eyebrow">CITY STATION OVERVIEW</div><h3>{usingFallback ? 'Reference stations' : 'Recent station observations'}</h3><p>{usingFallback ? 'Illustrative values used only when the observation feed is empty.' : 'Values and timestamps as supplied by the station observation source.'}</p></div><span className="status-pill">{stationsLoading ? 'Updating…' : `${stations.length} stations`}</span></div>
      <div className="aqi-reference-summary"><section className="panel aqi-reference-average"><div className="aqi-gauge"><div><b>{average ?? '—'}</b><small>AVG AQI</small></div></div><h3>{primary?.category || 'AQI unavailable'}</h3><p>{primary ? `${primary.station_name} · ${usingFallback ? 'Reference estimate · not live' : primary.observed_at || 'Observation time unavailable'}` : 'No recent station observation was returned.'}</p><div className="pollutant-block"><small>Primary pollutant · PM2.5</small><b>{value(primary?.pm25, ' µg/m³')}</b></div><button className="secondary full" onClick={() => notify('AQI notifications are not supported by the current API; no subscription was created.')}><Bell size={14}/>Notify me when AQI improves</button></section><section className="panel aqi-reference-map"><div className="panel-head"><div><div className="eyebrow">STATION MAP</div><h3>City reference points</h3></div><Wind size={17}/></div><CityMap markers={stationsLoading ? [] : stationMarkers} zoom={5}/><div className="map-foot"><span><MapPin size={13}/> Station locations</span><small>Only configured coordinates are shown</small></div></section></div>
      <div className="station-grid">{stations.map((station) => <article className="panel station-card" key={station.id}><div className="station-card-top"><span>{station.source || 'Station source'}</span><b className={station.aqi == null ? '' : station.aqi >= 200 ? 'aqi-critical' : station.aqi >= 100 ? 'aqi-warning' : 'aqi-normal'}>{station.aqi ?? '—'}</b></div><h3>{station.station_name}</h3><small>{usingFallback ? 'Reference estimate · not live' : station.observed_at || 'Time unavailable'}</small><div className="pollutant-grid"><div><small>PM2.5</small><b>{value(station.pm25)}</b></div><div><small>PM10</small><b>{value(station.pm10)}</b></div><div><small>NO₂</small><b>{value(station.no2)}</b></div><div><small>O₃</small><b>{value(station.o3)}</b></div></div><div className="station-card-footer"><span>{station.category || 'Category not supplied'}</span><span>{Number(station.latitude).toFixed(3)}, {Number(station.longitude).toFixed(3)}</span></div></article>)}</div>
    </section>
  </div>;
}
