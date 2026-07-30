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
 '{"engineStatus":"RUNNING","fuelLevelPct":85.0,"totalEngineHours":60.0,"totalIdleHours":50.0,"rpm":1800,"lastUpdated":null}'::jsonb),

('EQX1002', 'Crane',      'AVAILABLE', 11.02000000, 76.96000000, NULL,   NULL,    NULL,         NULL,
 '{"engineStatus":"OFF","fuelLevelPct":95.0,"totalEngineHours":45.0,"totalIdleHours":2.1,"rpm":0,"lastUpdated":null}'::jsonb),

('EQX1003', 'Bulldozer',  'RESERVED',  11.01200000, 76.95000000, 'S002', 'OP203', '2026-07-30', '2026-08-15',
 '{"engineStatus":"OFF","fuelLevelPct":60.0,"totalEngineHours":0.0,"totalIdleHours":0.0,"rpm":0,"lastUpdated":null}'::jsonb),

('EQX1004', 'Excavator',  'RENTED',    11.02500000, 76.94500000, 'S004', 'OP106', '2026-07-25', '2026-08-04',
 '{"engineStatus":"RUNNING","fuelLevelPct":72.3,"totalEngineHours":50.0,"totalIdleHours":5.0,"rpm":1950,"lastUpdated":null}'::jsonb),

('EQX1005', 'Bulldozer',  'RENTED',    11.00800000, 76.97200000, 'S006', 'OP301', '2026-07-16', '2026-08-04',
 '{"engineStatus":"RUNNING","fuelLevelPct":41.0,"totalEngineHours":70.0,"totalIdleHours":20.0,"rpm":1650,"lastUpdated":null}'::jsonb),

('EQX1006', 'Grader',     'RENTED',    11.03100000, 76.93800000, 'S001', 'OP114', '2026-07-10', '2026-08-02',
 '{"engineStatus":"IDLE","fuelLevelPct":58.5,"totalEngineHours":110.0,"totalIdleHours":42.0,"rpm":720,"lastUpdated":null}'::jsonb),

('EQX1007', 'Excavator',  'AVAILABLE', 11.01500000, 76.96500000, NULL,   NULL,    NULL,         NULL,
 '{"engineStatus":"OFF","fuelLevelPct":90.0,"totalEngineHours":30.0,"totalIdleHours":3.0,"rpm":0,"lastUpdated":null}'::jsonb),

('EQX1008', 'Crane',      'UNDER_MAINTENANCE', 11.02200000, 76.95900000, NULL, NULL, NULL, NULL,
 '{"engineStatus":"OFF","fuelLevelPct":50.0,"totalEngineHours":520.0,"totalIdleHours":80.0,"rpm":0,"lastUpdated":null}'::jsonb);

-- 7. Contract shift hours (used for predictive pacing calculations)
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS daily_shift_hours NUMERIC(4, 2) DEFAULT 8.0;

-- 8. Sites Table — required for the Operator Handshake geofence verification
CREATE TABLE IF NOT EXISTS sites (
    site_id                 VARCHAR(50) PRIMARY KEY,
    name                    VARCHAR(128) NOT NULL,
    center_latitude         NUMERIC(10, 8) NOT NULL,
    center_longitude        NUMERIC(11, 8) NOT NULL,
    geofence_radius_meters  NUMERIC(10, 2) DEFAULT 500.0
);

INSERT INTO sites (site_id, name, center_latitude, center_longitude, geofence_radius_meters) VALUES
('S001', 'Coimbatore North Yard',           11.03100000, 76.93800000, 500.0),
('S002', 'Coimbatore West Site',            11.01200000, 76.95000000, 500.0),
('S003', 'Coimbatore Central Depot',        11.01680000, 76.95580000, 400.0),
('S004', 'Coimbatore East Highway Project', 11.02500000, 76.94500000, 600.0),
('S005', 'Coimbatore South Warehouse',      11.00000000, 76.96000000, 500.0),
('S006', 'Coimbatore Riverside Project',    11.00800000, 76.97200000, 500.0)
ON CONFLICT (site_id) DO NOTHING;

-- 9. Application Users — Login-based RBAC (Dealer / Manager / Operator)
CREATE TABLE IF NOT EXISTS app_users (
    user_id                 SERIAL PRIMARY KEY,
    username                VARCHAR(50) UNIQUE NOT NULL,
    password_hash           VARCHAR(100) NOT NULL,
    role                    VARCHAR(20) NOT NULL,     -- DEALER, MANAGER, OPERATOR
    display_name            VARCHAR(100) NOT NULL,
    assigned_equipment_ids  TEXT[],                   -- MANAGER only: machines they've checked in & manage. NULL = unrestricted (DEALER/OPERATOR).
    created_at              TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Demo accounts — password for every account is: password123
-- (bcrypt hash below is for that shared demo password; each user should have a unique password in a real deployment)
INSERT INTO app_users (username, password_hash, role, display_name, assigned_equipment_ids) VALUES
('dealer1', '$2b$10$yBcFn34sJ.a3ixW432Gb0O89ZfoxO/utnMbMMh2l82PRDCqGCrAbG', 'DEALER',   'HQ Fleet Admin',       NULL),
('manager1','$2b$10$yBcFn34sJ.a3ixW432Gb0O89ZfoxO/utnMbMMh2l82PRDCqGCrAbG', 'MANAGER',  'Site Manager - North', ARRAY['EQX1001','EQX1002']),
('manager2','$2b$10$yBcFn34sJ.a3ixW432Gb0O89ZfoxO/utnMbMMh2l82PRDCqGCrAbG', 'MANAGER',  'Site Manager - South', ARRAY['EQX1003','EQX1004']),
('OP101',   '$2b$10$yBcFn34sJ.a3ixW432Gb0O89ZfoxO/utnMbMMh2l82PRDCqGCrAbG', 'OPERATOR', 'Operator OP101',       NULL),
('OP203',   '$2b$10$yBcFn34sJ.a3ixW432Gb0O89ZfoxO/utnMbMMh2l82PRDCqGCrAbG', 'OPERATOR', 'Operator OP203',       NULL)
ON CONFLICT (username) DO NOTHING;
