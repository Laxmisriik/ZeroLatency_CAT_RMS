import { MapContainer, TileLayer, CircleMarker, Circle, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { Map as MapIcon, TriangleAlert } from 'lucide-react';

/* ── Marker color per machine state ─────────────────────────────
   Green = Operating (engine running)   Amber = Idle
   Blue  = Checked-in / Reserved        Red    = Anomaly / Unauthorized
   Gray  = Available                    Violet = Maintenance             */
function markerColor(eq) {
  const engine = (eq.telemetry?.engineStatus || 'OFF').toUpperCase();
  if (eq.status === 'UNAUTHORIZED_USE') return '#C5221F';
  if (eq.status === 'UNDER_MAINTENANCE') return '#6B4FBB';
  if (eq.status === 'RENTED' && engine === 'RUNNING') return '#1E7B34';
  if (eq.status === 'RENTED' && engine === 'IDLE') return '#B25E00';
  if (eq.status === 'RESERVED') return '#1A56DB';
  return '#8A8F98'; // AVAILABLE / OFF
}

export default function FleetMap({ equipment, sites, anomalies }) {
  const withGps = equipment.filter(eq => eq.current_latitude && eq.current_longitude);
  const center = withGps.length
    ? [Number(withGps[0].current_latitude), Number(withGps[0].current_longitude)]
    : [11.0168, 76.9558];

  const unresolvedByEquipment = {};
  anomalies.filter(a => !a.resolved).forEach(a => {
    unresolvedByEquipment[a.equipmentId] = unresolvedByEquipment[a.equipmentId] || [];
    unresolvedByEquipment[a.equipmentId].push(a.type);
  });

  return (
    <div className="map-panel">
      <div className="section-header" style={{ padding: '18px 20px 0' }}>
        <h2><MapIcon size={16} /> Live Fleet Map</h2>
        <span className="section-header-meta">{withGps.length} asset(s) with live GPS</span>
      </div>
      <div className="map-container">
        <MapContainer center={center} zoom={13} scrollWheelZoom={true} style={{ height: '100%', width: '100%' }}>
          <TileLayer
            attribution='&copy; OpenStreetMap contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          {sites.map(site => (
            <Circle
              key={site.site_id}
              center={[Number(site.center_latitude), Number(site.center_longitude)]}
              radius={Number(site.geofence_radius_meters)}
              pathOptions={{ color: '#DDAF00', fillColor: '#FFCD11', fillOpacity: 0.08, weight: 1.5, dashArray: '4 4' }}
            >
              <Popup>
                <strong>{site.name}</strong><br />
                Geofence radius: {site.geofence_radius_meters}m
              </Popup>
            </Circle>
          ))}

          {withGps.map(eq => {
            const flags = unresolvedByEquipment[eq.equipment_id] || [];
            return (
              <CircleMarker
                key={eq.equipment_id}
                center={[Number(eq.current_latitude), Number(eq.current_longitude)]}
                radius={9}
                pathOptions={{
                  color: flags.length ? '#E53935' : markerColor(eq),
                  fillColor: markerColor(eq),
                  fillOpacity: 0.85,
                  weight: flags.length ? 3 : 2
                }}
              >
                <Popup>
                  <strong>{eq.equipment_id}</strong> — {eq.type}<br />
                  Status: {eq.status}<br />
                  Engine: {eq.telemetry?.engineStatus || 'OFF'}<br />
                  Fuel: {Number(eq.telemetry?.fuelLevelPct || 0).toFixed(1)}%<br />
                  Site: {eq.current_site_id || '—'} | Operator: {eq.current_operator_id || '—'}
                  {flags.length > 0 && (
                    <><br /><span style={{ color: '#C5221F', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                      <TriangleAlert size={12} /> {flags.join(', ')}
                    </span></>
                  )}
                </Popup>
              </CircleMarker>
            );
          })}
        </MapContainer>
      </div>
    </div>
  );
}
