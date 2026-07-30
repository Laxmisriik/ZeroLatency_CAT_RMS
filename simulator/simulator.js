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

const mqtt = require('mqtt');

// ── MQTT Configuration ──────────────────────────────────────────────
const MQTT_BROKER = 'mqtt://broker.hivemq.com:1883';
const TOPIC_PREFIX = 'zerolatency/machines';
const PUBLISH_INTERVAL_MS = 3000;

const client = mqtt.connect(MQTT_BROKER);

// ── Fleet State (mirrors the 8 machines in database.sql) ────────────
const fleet = [
  {
    equipmentId: 'EQX1001', type: 'Excavator',
    lat: 11.0168, lng: 76.9558,
    fuel: 85.0, totalEngineHours: 120.5, totalIdleHours: 14.2,
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
    fuel: 60.0, totalEngineHours: 210.0, totalIdleHours: 35.0,
    engineStatus: 'IDLE', operatorId: 'OP203', siteId: 'S002'
  },
  {
    equipmentId: 'EQX1004', type: 'Excavator',
    lat: 11.0250, lng: 76.9450,
    fuel: 72.3, totalEngineHours: 88.0, totalIdleHours: 6.5,
    engineStatus: 'RUNNING', operatorId: 'OP106', siteId: 'S004'
  },
  {
    equipmentId: 'EQX1005', type: 'Bulldozer',
    lat: 11.0080, lng: 76.9720,
    fuel: 41.0, totalEngineHours: 310.0, totalIdleHours: 55.0,
    engineStatus: 'RUNNING', operatorId: 'OP301', siteId: 'S006',
    // ANOMALY VECTOR: high idle ratio — will flip to IDLE frequently
    _anomalyHighIdle: true
  },
  {
    equipmentId: 'EQX1006', type: 'Grader',
    lat: 11.0310, lng: 76.9380,
    fuel: 58.5, totalEngineHours: 156.0, totalIdleHours: 42.0,
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
client.on('connect', () => {
  console.log('╔═══════════════════════════════════════════════════════╗');
  console.log('║   ZeroLatency CAT RMS — Simulator Engine Connected   ║');
  console.log('║   Publishing to HiveMQ every 3 seconds               ║');
  console.log('╚═══════════════════════════════════════════════════════╝');
  setInterval(simulateTick, PUBLISH_INTERVAL_MS);
});

client.on('error', (err) => {
  console.error('[Simulator] MQTT Error:', err.message);
});
