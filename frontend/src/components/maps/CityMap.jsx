import { useEffect } from 'react';
import { MapContainer, Marker, Popup, TileLayer, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';

const cityCenters = {
  'Delhi NCR': [28.6139, 77.2090], 'New Delhi': [28.6139, 77.2090],
  'Rajiv Chowk': [28.6328, 77.2197], 'Akshardham': [28.6127, 77.2773], 'Connaught Place': [28.6315, 77.2167], 'ITO Crossing': [28.6289, 77.2410],
  Mumbai: [19.0760, 72.8777], Bengaluru: [12.9716, 77.5946], Chennai: [13.0827, 80.2707],
  Kolkata: [22.5726, 88.3639], Hyderabad: [17.3850, 78.4867], Pune: [18.5204, 73.8567],
  Lucknow: [26.8467, 80.9462], Ahmedabad: [23.0225, 72.5714], Jaipur: [26.9124, 75.7873],
  'New Delhi Railway Station': [28.6429, 77.2196], 'India Gate': [28.6129, 77.2295],
};
export const getLocationCoordinates = (label) => cityCenters[label] || cityCenters['Delhi NCR'];

const dotIcon = (kind = 'normal') => L.divIcon({
  className: `map-pin map-pin-${kind}`,
  html: '<span></span>', iconSize: [18, 18], iconAnchor: [9, 9],
});

function Recenter({ center, zoom }) {
  const map = useMap();
  useEffect(() => { map.setView(center, zoom, { animate: false }); }, [map, center[0], center[1], zoom]);
  return null;
}

export default function CityMap({ city = 'Delhi NCR', markers = [], route = [], zoom = 12, className = '' }) {
  const center = getLocationCoordinates(city);
  const routeCoords = (route || []).filter((point) => Number.isFinite(point?.lat) && Number.isFinite(point?.lng)).map((point) => [point.lat, point.lng]);
  return <div className={`leaflet-map ${className}`}>
    <MapContainer center={center} zoom={zoom} scrollWheelZoom className="leaflet-canvas">
      <Recenter center={center} zoom={zoom} />
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      {routeCoords.length > 1 && <Polyline positions={routeCoords} pathOptions={{ color: '#8daa4c', weight: 5, opacity: 0.9 }} />}
      {markers.map((marker, index) => <Marker key={marker.id ?? `${marker.lat}-${marker.lng}-${index}`} position={[marker.lat, marker.lng]} icon={dotIcon(marker.kind || 'normal')}><Popup><b>{marker.title || 'Location'}</b>{marker.description && <div>{marker.description}</div>}</Popup></Marker>)}
    </MapContainer>
    <span className="map-attribution">Leaflet | © OpenStreetMap</span>
  </div>;
}
