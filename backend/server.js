/**
 * ZeroLatency CAT RMS — Backend Server
 * ─────────────────────────────────────
 * 1. Connects to PostgreSQL (via .env)
 * 2. Subscribes to MQTT telemetry from HiveMQ
 * 3. Updates equipment table + triggers anomaly detection in-DB
 * 4. Runs server-side anomaly rules (fuel theft, high idle, heartbeat)
 * 5. Serves REST API for the React dashboard
 */

require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const mqtt    = require('mqtt');
const { Pool } = require('pg');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const QRCode  = require('qrcode');

const app = express();
app.use(cors({ origin: '*' }));   // Allow Vite dev server (port 5173)
app.use(express.json());

// ── PostgreSQL Connection Pool ──────────────────────────────────────
const db = new Pool({
  user:     process.env.DB_USER,
  host:     process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port:     parseInt(process.env.DB_PORT, 10),
});

db.on('error', (err) => console.error('[DB Pool] Unexpected error:', err));

// ═══════════════════════════════════════════════════════════════════
//  AUTH / RBAC — Login-based sessions (DEALER / MANAGER / OPERATOR)
// ═══════════════════════════════════════════════════════════════════
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-insecure-secret-change-me';
const JWT_EXPIRES_IN = '8h';

// Verifies the bearer token, then re-reads the user's role/assignment fresh
// from the DB on every request so a Manager's machine list can never go stale.
async function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required.' });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const result = await db.query(
      `SELECT user_id, username, role, display_name, assigned_equipment_ids FROM app_users WHERE user_id = $1`,
      [payload.sub]
    );
    if (result.rowCount === 0) return res.status(401).json({ error: 'Account no longer exists.' });

    const u = result.rows[0];
    req.user = {
      userId: u.user_id,
      username: u.username,
      role: u.role,
      displayName: u.display_name,
      assignedEquipment: u.assigned_equipment_ids || null // null = unrestricted (DEALER/OPERATOR)
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired session. Please log in again.' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have permission to perform this action.' });
    }
    next();
  };
}

// Returns the manager's assigned-equipment array, or null when access is unrestricted.
function managerScope(req) {
  return req.user.role === 'MANAGER' ? (req.user.assignedEquipment || []) : null;
}

// ── Haversine Distance (meters) ──────────────────────────────────────
function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth radius in meters
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dPhi = toRad(lat2 - lat1);
  const dLambda = toRad(lon2 - lon1);
  const a =
    Math.sin(dPhi / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLambda / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const OPERATOR_PROXIMITY_METERS = 15;

// ── Sites Cache (loaded once at boot — static for the hackathon demo) ──
let sitesCache = {};
async function loadSitesCache() {
  try {
    const result = await db.query(`SELECT site_id, name, center_latitude, center_longitude, geofence_radius_meters FROM sites`);
    sitesCache = {};
    result.rows.forEach(row => {
      sitesCache[row.site_id] = {
        name: row.name,
        lat: Number(row.center_latitude),
        lng: Number(row.center_longitude),
        radius: Number(row.geofence_radius_meters)
      };
    });
    console.log(`[Sites] Loaded ${result.rows.length} site(s) into memory cache.`);
  } catch (err) {
    console.error('[Sites] Failed to load sites cache:', err.message);
  }
}
loadSitesCache();

// ── Contract Pacing Calculation ──────────────────────────────────────
function computePacing(row) {
  const shiftHours = Number(row.daily_shift_hours || 8);
  const checkIn = new Date(row.check_in_date);
  const checkOut = new Date(row.check_out_date);
  const today = new Date();

  const totalDays = Math.max(1, Math.round((checkOut - checkIn) / 86_400_000) + 1);
  const plannedHours = totalDays * shiftHours;

  let daysElapsed = Math.round((today - checkIn) / 86_400_000) + 1;
  daysElapsed = Math.min(Math.max(daysElapsed, 1), totalDays);

  const expectedHours = (daysElapsed / totalDays) * plannedHours;
  const loggedHours = Number(row.telemetry?.totalEngineHours || 0);
  const pacingPct = expectedHours > 0 ? (loggedHours / expectedHours) * 100 : 0;
  const elapsedFraction = daysElapsed / totalDays;

  let status = 'ON_TRACK';
  let projectedOverrunDays = null;

  if (pacingPct < 60 && elapsedFraction >= 0.5) {
    status = 'LAGGING';
    const remainingContractDays = totalDays - daysElapsed;
    const actualDailyRate = loggedHours / daysElapsed;
    if (actualDailyRate > 0) {
      projectedOverrunDays = Math.max(0, Math.round(
        (plannedHours - loggedHours) / actualDailyRate - remainingContractDays
      ));
    }
  } else if (pacingPct >= 100) {
    status = 'AHEAD';
  }

  return {
    equipmentId: row.equipment_id,
    siteId: row.current_site_id,
    checkInDate: row.check_in_date,
    checkOutDate: row.check_out_date,
    totalContractDays: totalDays,
    daysElapsed,
    dailyShiftHours: shiftHours,
    plannedHours: Number(plannedHours.toFixed(1)),
    expectedHours: Number(expectedHours.toFixed(1)),
    loggedHours: Number(loggedHours.toFixed(1)),
    pacingPct: Number(pacingPct.toFixed(1)),
    status,
    projectedOverrunDays
  };
}

// ── In-Memory Anomaly Store (for fast dashboard reads) ──────────────
const activeAnomalies = [];
const MAX_ANOMALIES = 50;
const lastFuelReadings = {};       // { equipmentId: fuelLevelPct }
const lastHeartbeats   = {};       // { equipmentId: timestamp }

function pushAnomaly(equipmentId, type, severity, description) {
  const anomaly = {
    id: Date.now() + '-' + Math.random().toString(36).substr(2, 5),
    equipmentId,
    type,
    severity,
    description,
    detectedAt: new Date().toISOString(),
    resolved: false
  };
  activeAnomalies.unshift(anomaly);
  if (activeAnomalies.length > MAX_ANOMALIES) activeAnomalies.pop();
  console.log(`\x1b[31m[ANOMALY] ${type} — ${equipmentId}: ${description}\x1b[0m`);

  // Also persist to DB (fire-and-forget)
  db.query(
    `INSERT INTO anomaly_flags (equipment_id, anomaly_type, severity, description)
     VALUES ($1, $2, $3, $4)`,
    [equipmentId, type, severity, description]
  ).catch(err => console.error('[Anomaly DB Write]', err.message));
}

// ── MQTT Consumer ───────────────────────────────────────────────────
const MQTT_BROKER  = 'mqtt://broker.hivemq.com:1883';
const TOPIC_FILTER = 'zerolatency/machines/+/telemetry';

const mqttClient = mqtt.connect(MQTT_BROKER);

mqttClient.on('connect', () => {
  console.log('[MQTT] Connected to HiveMQ broker.');
  mqttClient.subscribe(TOPIC_FILTER, (err) => {
    if (err) console.error('[MQTT] Subscribe error:', err);
    else     console.log(`[MQTT] Subscribed to: ${TOPIC_FILTER}`);
  });
});

// ── Remote Ignition Command Dispatch (Cloud → Edge) ──────────────────
function publishIgnitionCommand(equipmentId, action, extra = {}) {
  const topic = `zerolatency/machines/${equipmentId}/ignition`;
  const command = { action, timestamp: new Date().toISOString(), ...extra };
  mqttClient.publish(topic, JSON.stringify(command));
  console.log(`[MQTT] Published ${action} → ${topic}`);
}

// Tells the simulator to teleport a machine's simulated GPS to a new point —
// used whenever a machine is (re)assigned to a site (checkout / manager check-in)
// so the Operator's proximity + geofence handshake has a realistic chance of
// passing instead of comparing against wherever the machine happened to spawn.
function publishRelocateCommand(equipmentId, lat, lng) {
  const topic = `zerolatency/machines/${equipmentId}/relocate`;
  const command = { lat, lng, timestamp: new Date().toISOString() };
  mqttClient.publish(topic, JSON.stringify(command));
  console.log(`[MQTT] Published RELOCATE → ${topic} (${lat.toFixed(6)}, ${lng.toFixed(6)})`);
}

// Picks a random point comfortably inside a site's geofence (60% of its radius)
// so a freshly-assigned machine lands "at the site" without always sitting
// dead-center, which would look artificial on the map.
function jitteredPointInSite(site) {
  const jitterRadius = site.radius * 0.6;
  const angle = Math.random() * 2 * Math.PI;
  const dist = Math.random() * jitterRadius;
  const dLat = (dist * Math.cos(angle)) / 111_320; // meters → degrees latitude
  const dLng = (dist * Math.sin(angle)) / (111_320 * Math.cos(site.lat * Math.PI / 180));
  return { lat: site.lat + dLat, lng: site.lng + dLng };
}

mqttClient.on('message', async (_topic, message) => {
  try {
    const payload = JSON.parse(message.toString());
    const { equipmentId, location, metrics, timestamp } = payload;

    // ── 1. Update equipment table (triggers fire automatically) ──
    const updateResult = await db.query(`
      UPDATE equipment
      SET
        current_latitude  = $1,
        current_longitude = $2,
        updated_at        = NOW(),
        telemetry = jsonb_build_object(
          'engineStatus',    $3::text,
          'fuelLevelPct',    $4::numeric,
          'totalEngineHours',$5::numeric,
          'totalIdleHours',  $6::numeric,
          'rpm',             $7::integer,
          'lastUpdated',     $8::text
        )
      WHERE equipment_id = $9
      RETURNING *
    `, [
      location.lat, location.lng,
      metrics.engineStatus, metrics.fuelLevelPct,
      metrics.totalEngineHours, metrics.totalIdleHours,
      metrics.rpm, timestamp,
      equipmentId
    ]);

    const equipmentRow = updateResult.rows[0];
    if (!equipmentRow) return; // machine not in DB, ignore

    // ── 2. Server-Side Anomaly Rules ──

    // Rule: Unauthorized operation (engine on, but no operator assigned in DB / not checked-in)
    if (metrics.engineStatus !== 'OFF' &&
        (equipmentRow.current_operator_id === null || equipmentRow.status === 'AVAILABLE')) {
      pushAnomaly(equipmentId, 'UNAUTHENTICATED_OPERATION', 'CRITICAL',
        `Engine is ${metrics.engineStatus} but no verified operator/site assignment exists.`);

      // Transmit instant remote lock signal (throttled — no need to spam LOCK every 3s)
      const lockKey = `lock_${equipmentId}`;
      if (!lastHeartbeats[lockKey] || Date.now() - lastHeartbeats[lockKey] > 60_000) {
        publishIgnitionCommand(equipmentId, 'LOCK');
        lastHeartbeats[lockKey] = Date.now();
      }
    }

    // Rule: Execution Geofence Breach (machine assigned to a site, operating, but drifted outside radius)
    if (equipmentRow.current_site_id && equipmentRow.status === 'RENTED') {
      const site = sitesCache[equipmentRow.current_site_id];
      if (site) {
        const dMachSite = haversineMeters(location.lat, location.lng, site.lat, site.lng);
        if (dMachSite > site.radius) {
          const key = `geofence_${equipmentId}`;
          if (!lastHeartbeats[key] || Date.now() - lastHeartbeats[key] > 180_000) {
            pushAnomaly(equipmentId, 'GEOFENCE_BREACH', 'HIGH',
              `Machine is ${Math.round(dMachSite)}m from ${site.name} center — exceeds ${site.radius}m geofence radius.`);
            lastHeartbeats[key] = Date.now();
          }
        }
      }
    }

    // Rule: High idle ratio (idle > 30% of total engine hours for the session)
    if (metrics.totalEngineHours > 0) {
      const idleRatio = metrics.totalIdleHours / (metrics.totalEngineHours + metrics.totalIdleHours);
      if (idleRatio > 0.30) {
        // Only fire once per 60 ticks to avoid spam
        const key = `idle_${equipmentId}`;
        if (!lastHeartbeats[key] || Date.now() - lastHeartbeats[key] > 180_000) {
          pushAnomaly(equipmentId, 'HIGH_IDLE_RATIO', 'MEDIUM',
            `Idle ratio is ${(idleRatio * 100).toFixed(1)}% — asset may be underutilized.`);
          lastHeartbeats[key] = Date.now();
        }
      }
    }

    // Rule: Fuel theft (fuel drops > 5% while engine OFF)
    if (metrics.engineStatus === 'OFF') {
      const prevFuel = lastFuelReadings[equipmentId];
      if (prevFuel !== undefined) {
        const drop = prevFuel - metrics.fuelLevelPct;
        if (drop >= 5.0) {
          pushAnomaly(equipmentId, 'FUEL_THEFT_SUSPECTED', 'CRITICAL',
            `Fuel dropped ${drop.toFixed(1)}% while engine is OFF (${prevFuel.toFixed(1)}% → ${metrics.fuelLevelPct.toFixed(1)}%).`);
        }
      }
    }
    lastFuelReadings[equipmentId] = metrics.fuelLevelPct;

    // Update heartbeat
    lastHeartbeats[equipmentId] = Date.now();

  } catch (err) {
    console.error('[MQTT Message Error]:', err.message);
  }
});

// ── Heartbeat Monitor (check every 60s) ─────────────────────────────
setInterval(async () => {
  const now = Date.now();
  try {
    const result = await db.query(
      `SELECT equipment_id, telemetry->>'engineStatus' as engine_status FROM equipment`
    );
    result.rows.forEach(row => {
      const lastSeen = lastHeartbeats[row.equipment_id];
      if (row.engine_status === 'RUNNING' && lastSeen && (now - lastSeen > 30_000)) {
        pushAnomaly(row.equipment_id, 'HEARTBEAT_TIMEOUT', 'HIGH',
          `Engine RUNNING but no telemetry received for ${Math.round((now - lastSeen)/1000)}s — possible dead zone or tampering.`);
      }
    });
  } catch (e) { /* ignore DB errors in monitor */ }
}, 60_000);

// ═══════════════════════════════════════════════════════════════════
//  AUTH ROUTES (public — issued before the auth gate below)
// ═══════════════════════════════════════════════════════════════════

// POST /api/auth/login — verifies credentials, issues a JWT session
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }
  try {
    const result = await db.query(`SELECT * FROM app_users WHERE username = $1`, [username]);
    if (result.rowCount === 0) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }
    const user = result.rows[0];
    const passwordOk = await bcrypt.compare(password, user.password_hash);
    if (!passwordOk) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    const token = jwt.sign({ sub: user.user_id }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    res.json({
      token,
      user: {
        username: user.username,
        role: user.role,
        displayName: user.display_name,
        assignedEquipment: user.assigned_equipment_ids || null
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 🔒 Everything registered below this line requires a valid Bearer session
app.use('/api', authenticateToken);

// ═══════════════════════════════════════════════════════════════════
//  REST API ENDPOINTS
// ═══════════════════════════════════════════════════════════════════

// GET /api/equipment — fleet list with live telemetry (scoped for MANAGER)
app.get('/api/equipment', async (req, res) => {
  try {
    const scope = managerScope(req);
    const result = await db.query(`
      SELECT
        equipment_id, type, status,
        current_latitude, current_longitude,
        current_site_id, current_operator_id,
        check_in_date, check_out_date,
        telemetry, updated_at
      FROM equipment
      WHERE ($1::text[] IS NULL OR equipment_id = ANY($1::text[]))
      ORDER BY equipment_id ASC
    `, [scope]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/equipment/stats — aggregated KPIs for dashboard header (scoped for MANAGER)
app.get('/api/equipment/stats', async (req, res) => {
  try {
    const scope = managerScope(req);
    const result = await db.query(`
      SELECT
        COUNT(*) AS total_fleet,
        COUNT(*) FILTER (WHERE status = 'AVAILABLE')         AS available,
        COUNT(*) FILTER (WHERE status = 'RENTED')            AS rented,
        COUNT(*) FILTER (WHERE status = 'RESERVED')          AS reserved,
        COUNT(*) FILTER (WHERE status = 'UNDER_MAINTENANCE') AS maintenance,
        COUNT(*) FILTER (WHERE status = 'UNAUTHORIZED_USE')  AS unauthorized,
        COUNT(*) FILTER (WHERE status = 'UNASSIGNED')        AS unassigned,
        COUNT(*) FILTER (WHERE telemetry->>'engineStatus' = 'RUNNING') AS engine_running,
        COUNT(*) FILTER (WHERE telemetry->>'engineStatus' = 'IDLE')    AS engine_idle,
        COUNT(*) FILTER (WHERE telemetry->>'engineStatus' = 'OFF')     AS engine_off,
        COALESCE(AVG((telemetry->>'fuelLevelPct')::numeric), 0)        AS avg_fuel,
        COALESCE(SUM((telemetry->>'totalEngineHours')::numeric), 0)    AS total_engine_hours,
        COALESCE(SUM((telemetry->>'totalIdleHours')::numeric), 0)      AS total_idle_hours
      FROM equipment
      WHERE ($1::text[] IS NULL OR equipment_id = ANY($1::text[]))
    `, [scope]);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/anomalies — recent anomaly alerts (scoped for MANAGER)
app.get('/api/anomalies', async (req, res) => {
  const scope = managerScope(req);
  const filtered = scope !== null
    ? activeAnomalies.filter(a => scope.includes(a.equipmentId))
    : activeAnomalies;
  res.json(filtered);
});

// GET /api/sites — site directory (for map overlays & operator/manager portals)
app.get('/api/sites', async (_req, res) => {
  try {
    const result = await db.query(`
      SELECT site_id, name, center_latitude, center_longitude, geofence_radius_meters
      FROM sites ORDER BY site_id ASC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/checkout — initiate a rental handshake
app.post('/api/checkout', requireRole('DEALER'), async (req, res) => {
  const { equipmentId, siteId, operatorId, checkOutDate } = req.body;
  try {
    // Relocate the machine's simulated GPS into the target site's geofence (see the
    // matching comment in /api/manager/check-in) — otherwise the Operator's later
    // machine↔site geofence check would compare against wherever the machine spawned.
    const site = sitesCache[siteId];
    const relocated = site ? jitteredPointInSite(site) : null;

    const result = await db.query(`
      UPDATE equipment
      SET status = 'RESERVED',
          current_site_id = $1,
          current_operator_id = $2,
          check_out_date = $3,
          current_latitude = COALESCE($5, current_latitude),
          current_longitude = COALESCE($6, current_longitude),
          updated_at = NOW()
      WHERE equipment_id = $4
        AND status = 'AVAILABLE'
      RETURNING *
    `, [siteId, operatorId, checkOutDate, equipmentId, relocated?.lat ?? null, relocated?.lng ?? null]);

    if (result.rowCount === 0) {
      return res.status(409).json({ error: 'Equipment not available for checkout.' });
    }

    if (relocated) {
      publishRelocateCommand(equipmentId, relocated.lat, relocated.lng);
    }

    // Log to rental history
    await db.query(`
      INSERT INTO rental_history (equipment_id, event_type, site_id, operator_id, entry_method, notes)
      VALUES ($1, 'CHECKOUT', $2, $3, 'DASHBOARD', 'Checked out via dealer dashboard')
    `, [equipmentId, siteId, operatorId]);

    res.json({ message: 'Checkout initiated — status set to RESERVED.', machine: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/checkin — return equipment
app.post('/api/checkin', requireRole('DEALER'), async (req, res) => {
  const { equipmentId } = req.body;
  try {
    const result = await db.query(`
      UPDATE equipment
      SET status = 'AVAILABLE',
          current_site_id = NULL,
          current_operator_id = NULL,
          check_in_date = NULL,
          check_out_date = NULL,
          updated_at = NOW()
      WHERE equipment_id = $1
        AND status IN ('RENTED', 'RESERVED', 'UNAUTHORIZED_USE')
      RETURNING *
    `, [equipmentId]);

    if (result.rowCount === 0) {
      return res.status(409).json({ error: 'Equipment is not currently rented.' });
    }

    await db.query(`
      INSERT INTO rental_history (equipment_id, event_type, notes)
      VALUES ($1, 'CHECKIN', 'Returned via dealer dashboard')
    `, [equipmentId]);

    res.json({ message: 'Check-in complete — equipment returned.', machine: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
//  DEALER: EQUIPMENT PROVISIONING & QR CODE ISSUANCE
// ═══════════════════════════════════════════════════════════════════

// POST /api/equipment — Dealer registers a brand-new machine (unassigned, awaiting site check-in)
app.post('/api/equipment', requireRole('DEALER'), async (req, res) => {
  const { equipmentId, type } = req.body;
  if (!equipmentId || !type) {
    return res.status(400).json({ error: 'equipmentId and type are required.' });
  }
  const id = equipmentId.trim().toUpperCase();
  try {
    const result = await db.query(`
      INSERT INTO equipment (equipment_id, type, status, telemetry)
      VALUES ($1, $2, 'UNASSIGNED',
        '{"engineStatus":"OFF","fuelLevelPct":100.0,"totalEngineHours":0.0,"totalIdleHours":0.0,"rpm":0,"lastUpdated":null}'::jsonb)
      RETURNING *
    `, [id, type]);

    res.status(201).json({
      message: `${id} registered. Download its QR code and attach it to the machine before delivery.`,
      machine: result.rows[0]
    });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: `Equipment ID ${id} already exists.` });
    res.status(500).json({ error: err.message });
  }
});

// GET /api/equipment/:id/qrcode — PNG QR code encoding { equipmentId } for label printing / scanning
app.get('/api/equipment/:id/qrcode', async (req, res) => {
  try {
    const equipmentId = req.params.id.toUpperCase();
    const check = await db.query(`SELECT equipment_id FROM equipment WHERE equipment_id = $1`, [equipmentId]);
    if (check.rowCount === 0) return res.status(404).json({ error: 'Equipment not found.' });

    const payload = JSON.stringify({ equipmentId });
    const pngBuffer = await QRCode.toBuffer(payload, { width: 320, margin: 2 });
    res.type('png').send(pngBuffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/history/:equipmentId — rental audit trail
app.get('/api/history/:equipmentId', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT * FROM rental_history
      WHERE equipment_id = $1
      ORDER BY created_at DESC
      LIMIT 50
    `, [req.params.equipmentId]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/forecast — demand forecasting for equipment (fleet-wide, DEALER only)
app.get('/api/forecast', requireRole('DEALER'), async (req, res) => {
  try {
    // For the hackathon demo, we simulate a simple forecasting model
    // that predicts demand for the next month based on active fleet composition and recent usage.
    const result = await db.query(`
      SELECT 
        type,
        COUNT(*) as total_fleet,
        COUNT(*) FILTER (WHERE status = 'RENTED') as currently_rented,
        ROUND(AVG((telemetry->>'totalEngineHours')::numeric), 1) as avg_engine_hours
      FROM equipment
      GROUP BY type
    `);
    
    // Simple predictive logic: if utilization is high, predict high demand.
    const forecast = result.rows.map(row => {
      const utilization = row.currently_rented / row.total_fleet;
      let trend = 'STABLE';
      let predictedDemand = Math.ceil(row.total_fleet * 0.5); // base demand

      if (utilization > 0.7 || row.avg_engine_hours > 200) {
        trend = 'UP';
        predictedDemand = Math.ceil(row.total_fleet * 1.2); // high demand predicted
      } else if (utilization < 0.3) {
        trend = 'DOWN';
        predictedDemand = Math.max(1, Math.floor(row.total_fleet * 0.3));
      }

      return {
        type: row.type,
        current_utilization_pct: Math.round(utilization * 100),
        trend,
        predicted_demand_next_month: predictedDemand,
        recommendation: trend === 'UP' ? 'Pre-position more assets' : (trend === 'DOWN' ? 'Relocate idle assets' : 'Maintain current stock')
      };
    });

    res.json(forecast);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
//  PHASE 3: OPERATOR QR HANDSHAKE (Haversine Proximity + Geofence)
// ═══════════════════════════════════════════════════════════════════

// POST /api/operator/verify-scan — verify operator proximity & site geofence, unlock ignition
app.post('/api/operator/verify-scan', requireRole('OPERATOR'), async (req, res) => {
  const { equipmentId, operatorLat, operatorLng } = req.body;
  const operatorId = req.user.username; // identity comes from the logged-in session, never the client payload

  if (!equipmentId || operatorLat === undefined || operatorLng === undefined) {
    return res.status(400).json({ error: 'equipmentId, operatorLat and operatorLng are required.' });
  }

  try {
    const eqResult = await db.query(`SELECT * FROM equipment WHERE equipment_id = $1`, [equipmentId]);
    if (eqResult.rowCount === 0) {
      return res.status(404).json({ error: 'Equipment not found. Check the ID and try again.' });
    }
    const eq = eqResult.rows[0];

    if (!eq.current_site_id) {
      return res.status(409).json({ error: 'This machine has not been checked in to a site yet. Ask your Site Manager to check it in first.' });
    }
    if (eq.current_latitude === null || eq.current_longitude === null) {
      return res.status(409).json({ error: 'No live GPS telemetry available for this machine yet. Wait for the next telemetry tick.' });
    }

    const machineLat = Number(eq.current_latitude);
    const machineLng = Number(eq.current_longitude);

    // Step 1: Operator ↔ Machine proximity check (Haversine)
    const dOpMach = haversineMeters(Number(operatorLat), Number(operatorLng), machineLat, machineLng);
    const proximityPassed = dOpMach <= OPERATOR_PROXIMITY_METERS;

    // Step 2: Machine ↔ Site geofence check (Haversine)
    const site = sitesCache[eq.current_site_id];
    let dMachSite = null;
    let radius = null;
    let geofencePassed = false;
    if (site) {
      dMachSite = haversineMeters(machineLat, machineLng, site.lat, site.lng);
      radius = site.radius;
      geofencePassed = dMachSite <= radius;
    }

    const steps = {
      proximityCheck: {
        passed: proximityPassed,
        distanceMeters: Math.round(dOpMach),
        thresholdMeters: OPERATOR_PROXIMITY_METERS
      },
      geofenceCheck: {
        passed: geofencePassed,
        distanceMeters: dMachSite !== null ? Math.round(dMachSite) : null,
        thresholdMeters: radius,
        siteName: site ? site.name : null
      }
    };

    if (!proximityPassed || !geofencePassed) {
      return res.status(403).json({
        success: false,
        message: 'Verification failed — ignition remains locked.',
        steps
      });
    }

    // Both spatial checks passed → unlock ignition
    const updateResult = await db.query(`
      UPDATE equipment
      SET status = 'RENTED', current_operator_id = $1, updated_at = NOW()
      WHERE equipment_id = $2
      RETURNING *
    `, [operatorId, equipmentId]);

    await db.query(`
      INSERT INTO rental_history (equipment_id, event_type, site_id, operator_id, entry_method, notes)
      VALUES ($1, 'IGNITION_UNLOCK', $2, $3, 'QR', 'Operator verified proximity + geofence — ignition unlocked')
    `, [equipmentId, eq.current_site_id, operatorId]);

    publishIgnitionCommand(equipmentId, 'UNLOCK', { operator_id: operatorId });
    console.log(`\x1b[32m[HANDSHAKE] ${equipmentId} — Ignition UNLOCKED for operator ${operatorId}\x1b[0m`);

    res.json({
      success: true,
      message: 'Verification passed — MQTT unlock signal dispatched. Ignition energized.',
      steps,
      machine: updateResult.rows[0]
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
//  PREDICTIVE CONTRACT PACING & EXTENSION
// ═══════════════════════════════════════════════════════════════════

// GET /api/pacing — pacing % for every equipment currently under an active contract (scoped for MANAGER)
app.get('/api/pacing', async (req, res) => {
  try {
    const scope = managerScope(req);
    const result = await db.query(`
      SELECT equipment_id, current_site_id, check_in_date, check_out_date, daily_shift_hours, telemetry
      FROM equipment
      WHERE check_in_date IS NOT NULL AND check_out_date IS NOT NULL
        AND ($1::text[] IS NULL OR equipment_id = ANY($1::text[]))
    `, [scope]);

    const pacing = result.rows.map(computePacing);

    // Throttled MEDIUM-severity alert for lagging contracts
    pacing.filter(p => p.status === 'LAGGING').forEach(p => {
      const key = `pacing_${p.equipmentId}`;
      if (!lastHeartbeats[key] || Date.now() - lastHeartbeats[key] > 180_000) {
        pushAnomaly(p.equipmentId, 'PREDICTED_OVERRUN', 'MEDIUM',
          `Pacing at ${p.pacingPct}% (expected ${p.expectedHours}h, logged ${p.loggedHours}h)` +
          (p.projectedOverrunDays !== null ? ` — projected ${p.projectedOverrunDays} day(s) overrun.` : '.'));
        lastHeartbeats[key] = Date.now();
      }
    });

    res.json(pacing);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/manager/extend-rental — one-click contract extension
app.post('/api/manager/extend-rental', requireRole('DEALER', 'MANAGER'), async (req, res) => {
  const { equipmentId, extraDays } = req.body;
  const days = parseInt(extraDays, 10) || 3;

  if (req.user.role === 'MANAGER' && !(req.user.assignedEquipment || []).includes(equipmentId)) {
    return res.status(403).json({ error: 'You can only extend contracts for machines you manage.' });
  }

  try {
    const result = await db.query(`
      UPDATE equipment
      SET check_out_date = check_out_date + $1::int, updated_at = NOW()
      WHERE equipment_id = $2
      RETURNING *
    `, [days, equipmentId]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Equipment not found.' });
    }

    await db.query(`
      INSERT INTO rental_history (equipment_id, event_type, notes)
      VALUES ($1, 'EXTENSION', $2)
    `, [equipmentId, `Contract extended by ${days} day(s).`]);

    res.json({ message: `Contract extended by ${days} day(s).`, machine: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
//  PHASE 2: MANAGER SITE CHECK-IN (QR scan → assign machine to a site)
// ═══════════════════════════════════════════════════════════════════

// POST /api/manager/check-in — Manager scans a machine's QR label and checks it into their site
app.post('/api/manager/check-in', requireRole('MANAGER'), async (req, res) => {
  const { equipmentId, siteId, checkInDate, checkOutDate, dailyShiftHours } = req.body;
  if (!equipmentId || !siteId || !checkInDate || !checkOutDate) {
    return res.status(400).json({ error: 'equipmentId, siteId, checkInDate and checkOutDate are required.' });
  }

  try {
    const eqResult = await db.query(`SELECT * FROM equipment WHERE equipment_id = $1`, [equipmentId]);
    if (eqResult.rowCount === 0) {
      return res.status(404).json({ error: 'Equipment not found. Scan a valid QR code.' });
    }
    const eq = eqResult.rows[0];

    const alreadyOwned = (req.user.assignedEquipment || []).includes(equipmentId);
    if (eq.status !== 'UNASSIGNED' && !alreadyOwned) {
      return res.status(409).json({ error: `${equipmentId} is already checked in and managed by another site.` });
    }

    const siteCheck = await db.query(`SELECT site_id FROM sites WHERE site_id = $1`, [siteId]);
    if (siteCheck.rowCount === 0) {
      return res.status(404).json({ error: `Site ${siteId} not found.` });
    }

    // No preliminary location check is enforced at this step — per spec, the manager is
    // trusted to be physically at the delivery site when performing the check-in scan.
    //
    // Status → RENTED (not AVAILABLE): the machine is now under an active site rental
    // contract (check-in/check-out dates + daily shift hours are set here), so it should
    // read as "on rent" rather than "sitting idle in the yard". This also avoids a false
    // UNAUTHORIZED_USE flag — the sync_equipment_status trigger (database.sql) auto-flags
    // any machine whose engine starts running while status = 'AVAILABLE'. The Operator's
    // QR handshake (Phase 3) still has to run separately to physically unlock the ignition.
    //
    // Relocate the machine's simulated GPS into the site's geofence: without this, a
    // machine could be checked in to a site on the other side of the map from wherever
    // it happened to spawn, permanently failing the Operator's later machine↔site
    // geofence check. Real machines only get scanned in once they've actually been
    // delivered to the site, so snapping the simulated position here mirrors that.
    const site = sitesCache[siteId];
    const relocated = site ? jitteredPointInSite(site) : null;

    const updateResult = await db.query(`
      UPDATE equipment
      SET status = 'RENTED',
          current_site_id = $1,
          check_in_date = $2,
          check_out_date = $3,
          daily_shift_hours = $4,
          current_latitude = COALESCE($6, current_latitude),
          current_longitude = COALESCE($7, current_longitude),
          updated_at = NOW()
      WHERE equipment_id = $5
      RETURNING *
    `, [siteId, checkInDate, checkOutDate, dailyShiftHours || 8.0, equipmentId, relocated?.lat ?? null, relocated?.lng ?? null]);

    if (relocated) {
      publishRelocateCommand(equipmentId, relocated.lat, relocated.lng);
    }

    if (!alreadyOwned) {
      await db.query(`
        UPDATE app_users
        SET assigned_equipment_ids = array_append(COALESCE(assigned_equipment_ids, ARRAY[]::text[]), $1)
        WHERE user_id = $2
      `, [equipmentId, req.user.userId]);
    }

    await db.query(`
      INSERT INTO rental_history (equipment_id, event_type, site_id, entry_method, notes)
      VALUES ($1, 'CHECKIN', $2, 'QR', $3)
    `, [equipmentId, siteId, `Checked in by ${req.user.displayName} (${req.user.username}) via QR scan.`]);

    res.json({
      message: `${equipmentId} checked in to ${siteId} and added to your managed fleet.`,
      machine: updateResult.rows[0]
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Start Server ────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log('╔═══════════════════════════════════════════════════════╗');
  console.log(`║   ZeroLatency CAT RMS — API running on port ${PORT}      ║`);
  console.log('╚═══════════════════════════════════════════════════════╝');
});
