import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

const defaultCenter = [9.082, 8.6753];

function decodePolyline(encoded = '') {
  const points = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;

  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < encoded.length);
    latitude += (result & 1) ? ~(result >> 1) : (result >> 1);

    result = 0;
    shift = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < encoded.length);
    longitude += (result & 1) ? ~(result >> 1) : (result >> 1);
    points.push([latitude / 1e5, longitude / 1e5]);
  }

  return points;
}

function colorForMarker(key) {
  return key === 'destination' ? '#b35c54' : key === 'driver' ? '#47825c' : '#172f4e';
}

export default function RideMapCanvas({ pickupPoint, destinationPoint, driverPoint, encodedPolyline, onPick }) {
  const container = useRef(null);
  const map = useRef(null);
  const onPickRef = useRef(onPick);
  const encodedPolylineRef = useRef(encodedPolyline);
  const markers = useRef({});

  useEffect(() => { onPickRef.current = onPick; }, [onPick]);
  useEffect(() => { encodedPolylineRef.current = encodedPolyline; }, [encodedPolyline]);

  useEffect(() => {
    if (!container.current || map.current) return undefined;
    const instance = new maplibregl.Map({
      container: container.current,
      style: 'https://tiles.openfreemap.org/styles/liberty',
      center: [defaultCenter[1], defaultCenter[0]],
      zoom: 5,
      attributionControl: true,
    });
    map.current = instance;
    instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    const clickListener = (event) => onPickRef.current?.({ lat: event.lngLat.lat, lng: event.lngLat.lng });
    instance.on('click', clickListener);
    instance.on('load', () => {
      if (instance.getSource('movara-route')) return;
      instance.addSource('movara-route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      instance.addLayer({ id: 'movara-route-line', type: 'line', source: 'movara-route', paint: { 'line-color': '#b89a62', 'line-width': 5, 'line-opacity': 0.94 } });
      const currentPolyline = encodedPolylineRef.current;
      if (currentPolyline) {
        instance.getSource('movara-route').setData({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: decodePolyline(currentPolyline).map(([lat, lng]) => [lng, lat]) } }] });
      }
    });

    return () => {
      instance.off('click', clickListener);
      Object.values(markers.current).forEach((marker) => marker?.remove());
      markers.current = {};
      instance.remove();
      if (map.current === instance) map.current = null;
    };
  }, []);

  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    const entries = [['pickup', pickupPoint, 'Pickup'], ['destination', destinationPoint, 'Destination'], ['driver', driverPoint, 'Driver location']];
    entries.forEach(([key, point, title]) => {
      if (point) {
        if (!markers.current[key]) {
          const element = document.createElement('div');
          element.className = 'map-marker';
          element.style.backgroundColor = colorForMarker(key);
          element.title = title;
          markers.current[key] = new maplibregl.Marker({ element }).setLngLat([point[1], point[0]]).addTo(instance);
        } else markers.current[key].setLngLat([point[1], point[0]]);
      } else if (markers.current[key]) {
        markers.current[key].remove();
        markers.current[key] = null;
      }
    });

    if (pickupPoint && destinationPoint) {
      const bounds = new maplibregl.LngLatBounds();
      [pickupPoint, destinationPoint, driverPoint].filter(Boolean).forEach(([lat, lng]) => bounds.extend([lng, lat]));
      instance.fitBounds(bounds, { padding: 64, maxZoom: 15, duration: 650 });
    } else if (pickupPoint || destinationPoint) {
      const point = pickupPoint ?? destinationPoint;
      instance.flyTo({ center: [point[1], point[0]], zoom: 14, duration: 650 });
    }

    const source = instance.getSource('movara-route');
    if (source) {
      source.setData({ type: 'FeatureCollection', features: encodedPolyline ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: decodePolyline(encodedPolyline).map(([lat, lng]) => [lng, lat]) } }] : [] });
    }
  }, [pickupPoint, destinationPoint, driverPoint, encodedPolyline]);

  return <div className="google-map-canvas" ref={container} role="application" aria-label="OpenStreetMap. Click to set pickup and destination." />;
}
