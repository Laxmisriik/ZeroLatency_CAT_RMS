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

mqttClient.on('message', async (_topic, message) => {
  try {
    const payload = JSON.parse(message.toString());
    const { equipmentId, location, metrics, timestamp, operatorId } = payload;

    // ── 1. Update equipment table (triggers fire automatically) ──
    await db.query(`
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
    `, [
      location.lat, location.lng,
      metrics.engineStatus, metrics.fuelLevelPct,
      metrics.totalEngineHours, metrics.totalIdleHours,
      metrics.rpm, timestamp,
      equipmentId
    ]);

    // ── 2. Server-Side Anomaly Rules ──

    // Rule: Unauthenticated operation (engine on, no operator)
    if (metrics.engineStatus !== 'OFF' && !operatorId) {
      pushAnomaly(equipmentId, 'UNAUTHENTICATED_OPERATION', 'HIGH',
        `Engine is ${metrics.engineStatus} but no operator is assigned.`);
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
//  REST API ENDPOINTS
// ═══════════════════════════════════════════════════════════════════

// GET /api/equipment — full fleet list with live telemetry
app.get('/api/equipment', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT
        equipment_id, type, status,
        current_latitude, current_longitude,
        current_site_id, current_operator_id,
        check_in_date, check_out_date,
        telemetry, updated_at
      FROM equipment
      ORDER BY equipment_id ASC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/equipment/stats — aggregated KPIs for dashboard header
app.get('/api/equipment/stats', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT
        COUNT(*) AS total_fleet,
        COUNT(*) FILTER (WHERE status = 'AVAILABLE')         AS available,
        COUNT(*) FILTER (WHERE status = 'RENTED')            AS rented,
        COUNT(*) FILTER (WHERE status = 'RESERVED')          AS reserved,
        COUNT(*) FILTER (WHERE status = 'UNDER_MAINTENANCE') AS maintenance,
        COUNT(*) FILTER (WHERE status = 'UNAUTHORIZED_USE')  AS unauthorized,
        COUNT(*) FILTER (WHERE telemetry->>'engineStatus' = 'RUNNING') AS engine_running,
        COUNT(*) FILTER (WHERE telemetry->>'engineStatus' = 'IDLE')    AS engine_idle,
        COUNT(*) FILTER (WHERE telemetry->>'engineStatus' = 'OFF')     AS engine_off,
        COALESCE(AVG((telemetry->>'fuelLevelPct')::numeric), 0)        AS avg_fuel,
        COALESCE(SUM((telemetry->>'totalEngineHours')::numeric), 0)    AS total_engine_hours,
        COALESCE(SUM((telemetry->>'totalIdleHours')::numeric), 0)      AS total_idle_hours
      FROM equipment
    `);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/anomalies — recent anomaly alerts
app.get('/api/anomalies', async (_req, res) => {
  res.json(activeAnomalies);
});

// POST /api/checkout — initiate a rental handshake
app.post('/api/checkout', async (req, res) => {
  const { equipmentId, siteId, operatorId, checkOutDate } = req.body;
  try {
    const result = await db.query(`
      UPDATE equipment
      SET status = 'RESERVED',
          current_site_id = $1,
          current_operator_id = $2,
          check_out_date = $3,
          updated_at = NOW()
      WHERE equipment_id = $4
        AND status = 'AVAILABLE'
      RETURNING *
    `, [siteId, operatorId, checkOutDate, equipmentId]);

    if (result.rowCount === 0) {
      return res.status(409).json({ error: 'Equipment not available for checkout.' });
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
app.post('/api/checkin', async (req, res) => {
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

// GET /api/forecast — demand forecasting for equipment
app.get('/api/forecast', async (req, res) => {
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

// ── Start Server ────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log('╔═══════════════════════════════════════════════════════╗');
  console.log(`║   ZeroLatency CAT RMS — API running on port ${PORT}      ║`);
  console.log('╚═══════════════════════════════════════════════════════╝');
});
