import { useEffect, useMemo } from 'react';
import { CircleMarker, MapContainer, Popup, TileLayer, useMap } from 'react-leaflet';

const DEFAULT_CENTER = [10.7769, 106.7009];

function MapViewport({ points }) {
  const map = useMap();

  useEffect(() => {
    map.invalidateSize();
    if (points.length === 1) {
      map.setView(points[0], 15);
    } else if (points.length > 1) {
      map.fitBounds(points, { padding: [32, 32], maxZoom: 16 });
    }
  }, [map, points]);

  return null;
}

export default function SiteMap({ sites, currentLocation }) {
  const points = useMemo(
    () => sites.map(({ lat, lng }) => [Number(lat), Number(lng)]),
    [sites],
  );
  const bounds = useMemo(
    () => currentLocation ? [...points, currentLocation] : points,
    [currentLocation, points],
  );

  return (
    <MapContainer
      className="large-map leaflet-map"
      center={currentLocation ?? points[0] ?? DEFAULT_CENTER}
      zoom={14}
      scrollWheelZoom
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <MapViewport points={bounds} />
      {sites.map((site, index) => (
        <CircleMarker
          key={site.code ?? site._id}
          center={points[index]}
          radius={9}
          pathOptions={{
            color: '#fff',
            weight: 3,
            fillColor: '#e95d40',
            fillOpacity: 1,
          }}
        >
          <Popup>
            <strong>{site.name}</strong>
            <br />
            {site.address}
            <br />
            {points[index][0].toFixed(5)}, {points[index][1].toFixed(5)}
          </Popup>
        </CircleMarker>
      ))}
      {currentLocation && (
        <CircleMarker
          center={currentLocation}
          radius={8}
          pathOptions={{ color: '#fff', weight: 2, fillColor: '#3678d4', fillOpacity: 1 }}
        >
          <Popup>Vị trí hiện tại của bạn</Popup>
        </CircleMarker>
      )}
    </MapContainer>
  );
}
