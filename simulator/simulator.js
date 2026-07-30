/**
 * ZeroLatency CAT RMS — Machine Simulator Engine
 * ------------------------------------------------
 * Generates synthetic, physics-based telemetry for a fleet of 8 machines.
 * Publishes to HiveMQ public broker every 3 seconds.
 *
 * Anomaly injection:
 *   - EQX1002 (AVAILABLE in DB) will randomly start running → triggers UNAUTHORIZED_USE
 *   - EQX1005 has excessively high idle hours → triggers HIGH_IDLE_RATIO anomaly
 *   - EQX1007 (AVAILABLE in DB) will occasionally have fuel drops while OFF → FUEL_THEFT
 */

require('dotenv').config();
const mqtt = require('mqtt');
const { Pool } = require('pg');

// ── MQTT Configuration ──────────────────────────────────────────────
const MQTT_BROKER = 'mqtt://broker.hivemq.com:1883';
const TOPIC_PREFIX = 'zerolatency/machines';
const PUBLISH_INTERVAL_MS = 3000;
const DISCOVERY_INTERVAL_MS = 10000; // how often to check the DB for newly-created equipment

const client = mqtt.connect(MQTT_BROKER);

// ── PostgreSQL Connection (read-only discovery of new equipment) ────
// Lets the simulator pick up machines the Dealer creates at runtime (via
// POST /api/equipment) without needing a restart or a hardcoded fleet entry.
const db = new Pool({
  user:     process.env.DB_USER     || 'catadmin',
  host:     process.env.DB_HOST     || 'localhost',
  database: process.env.DB_NAME     || 'smart_rental',
  password: process.env.DB_PASSWORD || 'caterpillar2026',
  port:     parseInt(process.env.DB_PORT, 10) || 5432,
});
db.on('error', (err) => console.error('[Simulator] DB pool error:', err.message));

// ── Fleet State (mirrors the 8 machines in database.sql) ────────────
const fleet = [
  {
    equipmentId: 'EQX1001', type: 'Excavator',
    lat: 11.0168, lng: 76.9558,
    // Idle-Misuse demo machine: idle ratio ~45% (idle_hours / total) → triggers HIGH_IDLE_RATIO
    fuel: 85.0, totalEngineHours: 60.0, totalIdleHours: 50.0,
    engineStatus: 'RUNNING', operatorId: 'OP101', siteId: 'S003'
  },
  {
    equipmentId: 'EQX1002', type: 'Crane',
    lat: 11.0200, lng: 76.9600,
    fuel: 95.0, totalEngineHours: 45.0, totalIdleHours: 2.1,
    engineStatus: 'OFF', operatorId: null, siteId: null,
    // ANOMALY VECTOR: will randomly start → unauthorized use
    _anomalyUnauthorizedStart: true,
    _anomalyCountdown: 10  // starts after 10 ticks (~30s)
  },
  {
    equipmentId: 'EQX1003', type: 'Bulldozer',
    lat: 11.0120, lng: 76.9500,
    // Operator Handshake demo machine: sits OFF + RESERVED at site S002, waiting for QR scan.
    // Engine stays OFF until an MQTT UNLOCK command arrives (see ignition command listener below).
    fuel: 60.0, totalEngineHours: 0.0, totalIdleHours: 0.0,
    engineStatus: 'OFF', operatorId: 'OP203', siteId: 'S002'
  },
  {
    equipmentId: 'EQX1004', type: 'Excavator',
    lat: 11.0250, lng: 76.9450,
    // Geofence-Breach demo machine: healthy pacing/idle ratio, single-issue = location security
    fuel: 72.3, totalEngineHours: 50.0, totalIdleHours: 5.0,
    engineStatus: 'RUNNING', operatorId: 'OP106', siteId: 'S004',
    // ANOMALY VECTOR: machine wanders outside its site geofence (S004, 600m radius)
    _anomalyGeofenceBreach: true,
    _geofenceBreachCountdown: 20  // triggers after 20 ticks (~60s)
  },
  {
    equipmentId: 'EQX1005', type: 'Bulldozer',
    lat: 11.0080, lng: 76.9720,
    // Predictive Overrun / Pacing-Lag demo machine: low logged hours vs. contract expectation
    fuel: 41.0, totalEngineHours: 70.0, totalIdleHours: 20.0,
    engineStatus: 'RUNNING', operatorId: 'OP301', siteId: 'S006',
    // ANOMALY VECTOR: high idle ratio — will flip to IDLE frequently
    _anomalyHighIdle: true
  },
  {
    equipmentId: 'EQX1006', type: 'Grader',
    lat: 11.0310, lng: 76.9380,
    // Under-utilization demo machine: on-track pacing but visibly low daily usage
    fuel: 58.5, totalEngineHours: 110.0, totalIdleHours: 42.0,
    engineStatus: 'IDLE', operatorId: 'OP114', siteId: 'S001'
  },
  {
    equipmentId: 'EQX1007', type: 'Excavator',
    lat: 11.0150, lng: 76.9650,
    fuel: 90.0, totalEngineHours: 30.0, totalIdleHours: 3.0,
    engineStatus: 'OFF', operatorId: null, siteId: null,
    // ANOMALY VECTOR: fuel drops while engine OFF → fuel theft
    _anomalyFuelTheft: true,
    _fuelTheftCountdown: 15  // triggers after 15 ticks (~45s)
  },
  {
    equipmentId: 'EQX1008', type: 'Crane',
    lat: 11.0220, lng: 76.9590,
    fuel: 50.0, totalEngineHours: 520.0, totalIdleHours: 80.0,
    engineStatus: 'OFF', operatorId: null, siteId: null
  }
];

// ── Physics Constants ───────────────────────────────────────────────
const TICK_HOURS = PUBLISH_INTERVAL_MS / 3_600_000;  // 3s in hours
const FUEL_BURN_RUNNING = 0.02;   // % per tick
const FUEL_BURN_IDLE    = 0.005;  // % per tick
const GPS_DRIFT         = 0.0001; // degrees per tick when moving
const RPM_RUNNING_MIN   = 1500;
const RPM_RUNNING_MAX   = 2200;
const RPM_IDLE_MIN      = 700;
const RPM_IDLE_MAX      = 800;

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ── Dynamic Equipment Discovery ──────────────────────────────────────
// Polls the equipment table for machines that aren't in our in-memory fleet
// yet (e.g. newly registered by a Dealer via the dashboard) and starts
// simulating them from a cold-start telemetry baseline (engine OFF, full fuel).
async function discoverNewEquipment() {
  try {
    const knownIds = new Set(fleet.map(m => m.equipmentId));
    const { rows } = await db.query('SELECT equipment_id, type FROM equipment');

    rows.forEach((row) => {
      if (knownIds.has(row.equipment_id)) return;

      fleet.push({
        equipmentId: row.equipment_id,
        type: row.type,
        lat: 11.0168 + (Math.random() - 0.5) * 0.02,
        lng: 76.9558 + (Math.random() - 0.5) * 0.02,
        fuel: 100.0,
        totalEngineHours: 0.0,
        totalIdleHours: 0.0,
        engineStatus: 'OFF',
        operatorId: null,
        siteId: null
      });
      console.log(`\x1b[36m[Simulator] Discovered new equipment ${row.equipment_id} (${row.type}) — now simulating.\x1b[0m`);
    });
  } catch (err) {
    console.error('[Simulator] Equipment discovery query failed:', err.message);
  }
}

// ── Tick function — runs every 3 seconds ────────────────────────────
let tickCount = 0;

function simulateTick() {
  tickCount++;

  fleet.forEach((machine) => {
    let rpm = 0;

    // ── Anomaly: Unauthorized Start ──
    if (machine._anomalyUnauthorizedStart && machine._anomalyCountdown !== undefined) {
      machine._anomalyCountdown--;
      if (machine._anomalyCountdown <= 0 && machine.engineStatus === 'OFF') {
        machine.engineStatus = 'RUNNING';
        console.log(`\x1b[31m[ANOMALY] ${machine.equipmentId} — UNAUTHORIZED START triggered!\x1b[0m`);
        delete machine._anomalyCountdown; // only fire once
      }
    }

    // ── Anomaly: High Idle — flip to IDLE every ~20 ticks ──
    if (machine._anomalyHighIdle && tickCount % 20 === 0) {
      machine.engineStatus = machine.engineStatus === 'RUNNING' ? 'IDLE' : 'RUNNING';
    }

    // ── Anomaly: Fuel Theft — drop fuel while OFF ──
    if (machine._anomalyFuelTheft && machine._fuelTheftCountdown !== undefined) {
      machine._fuelTheftCountdown--;
      if (machine._fuelTheftCountdown <= 0 && machine.engineStatus === 'OFF') {
        machine.fuel = Math.max(0, machine.fuel - 6.0); // 6% instant drop
        console.log(`\x1b[31m[ANOMALY] ${machine.equipmentId} — FUEL THEFT! Fuel dropped to ${machine.fuel.toFixed(1)}%\x1b[0m`);
        delete machine._fuelTheftCountdown; // only fire once
      }
    }

    // ── Anomaly: Geofence Breach — machine drifts ~1.1km outside its site radius ──
    if (machine._anomalyGeofenceBreach && machine._geofenceBreachCountdown !== undefined) {
      machine._geofenceBreachCountdown--;
      if (machine._geofenceBreachCountdown <= 0) {
        machine.lat += 0.010; // ~1.1km north — well outside any configured geofence radius
        console.log(`\x1b[31m[ANOMALY] ${machine.equipmentId} — GEOFENCE BREACH triggered! Machine left site boundary.\x1b[0m`);
        delete machine._geofenceBreachCountdown; // only fire once
      }
    }

    // ── Normal Physics ──
    if (machine.engineStatus === 'RUNNING') {
      machine.lat += (Math.random() - 0.5) * GPS_DRIFT;
      machine.lng += (Math.random() - 0.5) * GPS_DRIFT;
      machine.fuel = Math.max(0, machine.fuel - FUEL_BURN_RUNNING);
      machine.totalEngineHours += TICK_HOURS;
      rpm = randomBetween(RPM_RUNNING_MIN, RPM_RUNNING_MAX);
    } else if (machine.engineStatus === 'IDLE') {
      machine.fuel = Math.max(0, machine.fuel - FUEL_BURN_IDLE);
      machine.totalIdleHours += TICK_HOURS;
      rpm = randomBetween(RPM_IDLE_MIN, RPM_IDLE_MAX);
    }
    // OFF → no changes

    // ── Build payload ──
    const payload = {
      equipmentId: machine.equipmentId,
      timestamp: new Date().toISOString(),
      location: {
        lat: parseFloat(machine.lat.toFixed(8)),
        lng: parseFloat(machine.lng.toFixed(8))
      },
      metrics: {
        engineStatus: machine.engineStatus,
        fuelLevelPct: parseFloat(machine.fuel.toFixed(2)),
        totalEngineHours: parseFloat(machine.totalEngineHours.toFixed(4)),
        totalIdleHours: parseFloat(machine.totalIdleHours.toFixed(4)),
        rpm
      },
      operatorId: machine.operatorId,
      siteId: machine.siteId
    };

    const topic = `${TOPIC_PREFIX}/${machine.equipmentId}/telemetry`;
    client.publish(topic, JSON.stringify(payload));
  });

  // Print a compact summary every 10 ticks
  if (tickCount % 10 === 0) {
    console.log(`\n─── Tick #${tickCount} ───────────────────────────────`);
    fleet.forEach(m => {
      const status = m.engineStatus.padEnd(7);
      const fuel = m.fuel.toFixed(1).padStart(5) + '%';
      console.log(`  ${m.equipmentId}  ${status}  Fuel: ${fuel}  EngH: ${m.totalEngineHours.toFixed(1)}  IdleH: ${m.totalIdleHours.toFixed(1)}`);
    });
  }
}

// ── Connection ──────────────────────────────────────────────────────
const IGNITION_TOPIC_FILTER = `${TOPIC_PREFIX}/+/ignition`;
const RELOCATE_TOPIC_FILTER = `${TOPIC_PREFIX}/+/relocate`;

client.on('connect', () => {
  console.log('╔═══════════════════════════════════════════════════════╗');
  console.log('║   ZeroLatency CAT RMS — Simulator Engine Connected   ║');
  console.log('║   Publishing to HiveMQ every 3 seconds               ║');
  console.log('╚═══════════════════════════════════════════════════════╝');
  setInterval(simulateTick, PUBLISH_INTERVAL_MS);

  // Pick up any Dealer-created equipment immediately, then keep polling.
  discoverNewEquipment();
  setInterval(discoverNewEquipment, DISCOVERY_INTERVAL_MS);

  client.subscribe(IGNITION_TOPIC_FILTER, (err) => {
    if (err) console.error('[Simulator] Ignition subscribe error:', err);
    else console.log(`[Simulator] Listening for remote ignition commands on: ${IGNITION_TOPIC_FILTER}`);
  });

  client.subscribe(RELOCATE_TOPIC_FILTER, (err) => {
    if (err) console.error('[Simulator] Relocate subscribe error:', err);
    else console.log(`[Simulator] Listening for remote relocate commands on: ${RELOCATE_TOPIC_FILTER}`);
  });
});

// ── Remote Ignition Command Handler (MQTT Lock/Unlock Relay) ────────
// Simulates the onboard relay: UNLOCK energizes the ignition (engine → RUNNING),
// LOCK immediately kills it (engine → OFF), mirroring the physical handshake lifecycle.
client.on('message', (topic, message) => {
  const parts = topic.split('/'); // zerolatency/machines/{equipmentId}/{ignition|relocate}
  const equipmentId = parts[2];
  const command = parts[3];
  const machine = fleet.find(m => m.equipmentId === equipmentId);
  if (!machine) return;

  try {
    if (command === 'ignition') {
      const { action } = JSON.parse(message.toString());
      if (action === 'UNLOCK') {
        machine.engineStatus = 'RUNNING';
        console.log(`\x1b[32m[IGNITION] ${equipmentId} — UNLOCK received. Engine relay energized → RUNNING.\x1b[0m`);
      } else if (action === 'LOCK') {
        machine.engineStatus = 'OFF';
        console.log(`\x1b[31m[IGNITION] ${equipmentId} — LOCK received. Engine relay cut → OFF.\x1b[0m`);
      }
    } else if (command === 'relocate') {
      // Backend just checked this machine into a site — teleport it there so the
      // Operator's later machine↔site geofence check has a real chance of passing.
      const { lat, lng } = JSON.parse(message.toString());
      if (typeof lat === 'number' && typeof lng === 'number') {
        machine.lat = lat;
        machine.lng = lng;
        console.log(`\x1b[36m[RELOCATE] ${equipmentId} — moved to (${lat.toFixed(6)}, ${lng.toFixed(6)}).\x1b[0m`);
      }
    }
  } catch (err) {
    console.error('[Simulator] Command message parse error:', err.message);
  }
});

client.on('error', (err) => {
  console.error('[Simulator] MQTT Error:', err.message);
});
