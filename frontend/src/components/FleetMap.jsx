import { MapContainer, TileLayer, CircleMarker, Circle, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

/* ── Marker color per machine state ─────────────────────────────
   Green = Operating (engine running)   Yellow = Idle
   Blue  = Checked-in / Reserved        Red    = Anomaly / Unauthorized
   Gray  = Available                    Purple = Maintenance             */
function markerColor(eq) {
  const engine = (eq.telemetry?.engineStatus || 'OFF').toUpperCase();
  if (eq.status === 'UNAUTHORIZED_USE') return '#E53935';
  if (eq.status === 'UNDER_MAINTENANCE') return '#9C27B0';
  if (eq.status === 'RENTED' && engine === 'RUNNING') return '#4CAF50';
  if (eq.status === 'RENTED' && engine === 'IDLE') return '#FF9800';
  if (eq.status === 'RESERVED') return '#2196F3';
  return '#9E9E9E'; // AVAILABLE / OFF
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
      <div className="section-header" style={{ padding: '16px 20px 0' }}>
        <h2>🗺️ Live Fleet Map</h2>
        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
          {withGps.length} asset(s) with live GPS
        </span>
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
              pathOptions={{ color: '#FFC20E', fillColor: '#FFC20E', fillOpacity: 0.06, weight: 1.5, dashArray: '4 4' }}
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
                    <><br /><span style={{ color: '#E53935', fontWeight: 700 }}>⚠ {flags.join(', ')}</span></>
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
