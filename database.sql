-- ============================================================
-- ZeroLatency CAT RMS — PostgreSQL Schema
-- ============================================================

-- 1. Main Equipment Table
CREATE TABLE IF NOT EXISTS equipment (
    equipment_id   VARCHAR(50) PRIMARY KEY,
    type           VARCHAR(50)  NOT NULL,
    status         VARCHAR(30)  NOT NULL DEFAULT 'AVAILABLE',

    -- Live GPS
    current_latitude  NUMERIC(10, 8),
    current_longitude NUMERIC(11, 8),

    -- Rental metadata
    current_site_id    VARCHAR(50),
    current_operator_id VARCHAR(50),
    check_in_date      DATE,
    check_out_date     DATE,

    -- Real-time metrics (JSONB for flexible telemetry)
    telemetry JSONB NOT NULL DEFAULT '{
      "engineStatus": "OFF",
      "fuelLevelPct": 100.0,
      "totalEngineHours": 0.0,
      "totalIdleHours": 0.0,
      "rpm": 0,
      "lastUpdated": null
    }'::jsonb,

    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Anomaly Flags Table
CREATE TABLE IF NOT EXISTS anomaly_flags (
    id             SERIAL PRIMARY KEY,
    equipment_id   VARCHAR(50) REFERENCES equipment(equipment_id),
    anomaly_type   VARCHAR(100) NOT NULL,
    severity       VARCHAR(20)  NOT NULL DEFAULT 'HIGH',
    description    TEXT,
    detected_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    resolved       BOOLEAN DEFAULT FALSE
);

-- 3. Rental History / Audit Log
CREATE TABLE IF NOT EXISTS rental_history (
    id             SERIAL PRIMARY KEY,
    equipment_id   VARCHAR(50) REFERENCES equipment(equipment_id),
    event_type     VARCHAR(30)  NOT NULL,   -- CHECKOUT, CHECKIN, OVERRIDE
    site_id        VARCHAR(50),
    operator_id    VARCHAR(50),
    entry_method   VARCHAR(20),             -- QR, RFID_SIM, MANUAL
    notes          TEXT,
    created_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. Index for fast JSONB queries
CREATE INDEX IF NOT EXISTS idx_equipment_telemetry_status ON equipment ((telemetry->>'engineStatus'));
CREATE INDEX IF NOT EXISTS idx_anomaly_equipment ON anomaly_flags (equipment_id, resolved);

-- 5. Automated Trigger — Machine State Sync
CREATE OR REPLACE FUNCTION sync_equipment_status()
RETURNS TRIGGER AS $$
BEGIN
  -- Rule A: Machine starts while RESERVED → promote to RENTED
  IF OLD.status = 'RESERVED' AND (NEW.telemetry->>'engineStatus') IN ('RUNNING', 'IDLE') THEN
      NEW.status := 'RENTED';
  END IF;

  -- Rule B: Machine starts while AVAILABLE → flag unauthorized use
  IF OLD.status = 'AVAILABLE' AND (NEW.telemetry->>'engineStatus') IN ('RUNNING', 'IDLE') THEN
      NEW.status := 'UNAUTHORIZED_USE';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_telemetry_status
BEFORE UPDATE ON equipment
FOR EACH ROW
EXECUTE FUNCTION sync_equipment_status();

-- 6. Insert Initial Fleet (8 machines for a realistic demo)
INSERT INTO equipment (equipment_id, type, status, current_latitude, current_longitude, current_site_id, current_operator_id, check_in_date, check_out_date, telemetry)
VALUES
('EQX1001', 'Excavator',  'RENTED',    11.01680000, 76.95580000, 'S003', 'OP101', '2026-07-20', '2026-08-05',
 '{"engineStatus":"RUNNING","fuelLevelPct":85.0,"totalEngineHours":120.5,"totalIdleHours":14.2,"rpm":1800,"lastUpdated":null}'::jsonb),

('EQX1002', 'Crane',      'AVAILABLE', 11.02000000, 76.96000000, NULL,   NULL,    NULL,         NULL,
 '{"engineStatus":"OFF","fuelLevelPct":95.0,"totalEngineHours":45.0,"totalIdleHours":2.1,"rpm":0,"lastUpdated":null}'::jsonb),

('EQX1003', 'Bulldozer',  'RESERVED',  11.01200000, 76.95000000, 'S002', 'OP203', '2026-07-30', '2026-08-15',
 '{"engineStatus":"IDLE","fuelLevelPct":60.0,"totalEngineHours":210.0,"totalIdleHours":35.0,"rpm":750,"lastUpdated":null}'::jsonb),

('EQX1004', 'Excavator',  'RENTED',    11.02500000, 76.94500000, 'S004', 'OP106', '2026-07-25', '2026-08-04',
 '{"engineStatus":"RUNNING","fuelLevelPct":72.3,"totalEngineHours":88.0,"totalIdleHours":6.5,"rpm":1950,"lastUpdated":null}'::jsonb),

('EQX1005', 'Bulldozer',  'RENTED',    11.00800000, 76.97200000, 'S006', 'OP301', '2026-07-01', '2026-07-31',
 '{"engineStatus":"RUNNING","fuelLevelPct":41.0,"totalEngineHours":310.0,"totalIdleHours":55.0,"rpm":1650,"lastUpdated":null}'::jsonb),

('EQX1006', 'Grader',     'RENTED',    11.03100000, 76.93800000, 'S001', 'OP114', '2026-07-10', '2026-08-02',
 '{"engineStatus":"IDLE","fuelLevelPct":58.5,"totalEngineHours":156.0,"totalIdleHours":42.0,"rpm":720,"lastUpdated":null}'::jsonb),

('EQX1007', 'Excavator',  'AVAILABLE', 11.01500000, 76.96500000, NULL,   NULL,    NULL,         NULL,
 '{"engineStatus":"OFF","fuelLevelPct":90.0,"totalEngineHours":30.0,"totalIdleHours":3.0,"rpm":0,"lastUpdated":null}'::jsonb),

('EQX1008', 'Crane',      'UNDER_MAINTENANCE', 11.02200000, 76.95900000, NULL, NULL, NULL, NULL,
 '{"engineStatus":"OFF","fuelLevelPct":50.0,"totalEngineHours":520.0,"totalIdleHours":80.0,"rpm":0,"lastUpdated":null}'::jsonb);
