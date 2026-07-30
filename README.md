# ZeroLatency CAT RMS 

Smart Asset Rental Tracking System with real-time telemetry, anomaly detection, and predictive demand forecasting. Built specifically for the Caterpillar hackathon.

## Prerequisites
To run this project on any system, you will need:
1. **[Node.js](https://nodejs.org/en/download/)** (v18 or higher)
2. **[Docker Desktop](https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe)** (Recommended) OR a local PostgreSQL installation.

---

## How to Run Locally

### 1. Start the Database
The project relies on a PostgreSQL database with JSONB support and custom triggers.

**Using Docker (Recommended):**
Open a terminal in the root folder and run:
```bash
docker-compose up -d
```
*(This automatically creates the database and runs the `database.sql` script to load the schema and mock data).*

> ⚠️ **If you already had this project running before the QR Handshake / Contract Pacing update:** your Postgres volume already exists, so `database.sql` (which now adds the `sites` table, `daily_shift_hours` column, and the `app_users` login table) won't re-run automatically. Reset it once with:
> ```bash
> docker-compose down -v
> docker-compose up -d
> ```

### 2. Setup the Backend API
The backend acts as an MQTT consumer and REST API server.
```bash
cd backend
npm install
```

Since the `.env` file is ignored by Git for security, you need to create one. Simply copy the template:
```bash
cp .env.example .env
```
*(If you are on Windows Command Prompt, use `copy .env.example .env`)*. 

This `.env` also holds `JWT_SECRET`, used to sign the login session tokens — the template ships with a placeholder value that's fine for local demo use, but should be replaced with a long random string in any real deployment.

Then start the server:
```bash
npm start
```
*(The server will start on `http://localhost:5000` and connect to the HiveMQ broker).*

### 3. Start the IoT Edge Simulator
Open a **new terminal tab/window**, and navigate to the simulator folder. This script mimics physical machine telemetry (fuel burn, GPS drift, RPM), injects anomalies for the demo, and polls the database every 10s so any equipment the Dealer registers at runtime gets picked up and simulated automatically.
```bash
cd simulator
npm install
npm start
```
*(It connects directly to the same Postgres instance as the backend; the defaults in `simulator/.env.example` already match `docker-compose.yml`, so no `.env` file is required unless you've changed the DB credentials.)*

### 4. Start the Fleet Dashboard (React UI)
Open a **third terminal tab/window**, and navigate to the frontend folder.
```bash
cd frontend
npm install
npm run dev
```
Open your browser to `http://localhost:5173` to view the live dashboard!

---

## Login-Based RBAC — Demo Accounts
There is no client-side role switcher — every role is determined by a real login (`bcrypt`-hashed passwords + JWT sessions). All demo accounts share the password `password123`:

| Username    | Role     | Scope                                  |
|-------------|----------|-----------------------------------------|
| `dealer1`   | DEALER   | Full fleet — create equipment, checkout/checkin, forecasting |
| `manager1`  | MANAGER  | Only `EQX1001` / `EQX1002` (plus anything they check in themselves) |
| `manager2`  | MANAGER  | Only `EQX1003` / `EQX1004` |
| `OP101` / `OP203` | OPERATOR | QR scan + GPS handshake only |

A Manager's machine list isn't a manual site filter — it's tied to their account (`assigned_equipment_ids` in the DB) and grows automatically every time they check in a new machine via QR.

## Hackathon Demo Flow
When presenting to the judges, we recommend this sequence:
1. **Log in as `dealer1`:** Point out the live telemetry (fuel bars dropping, engine dots pulsing), the color-coded **Live Fleet Map**, the KPI row, and the new **Fleet Activity Charts** (status distribution, engine vs idle hours, fuel levels per machine).
2. **Register a new machine + download its QR:** Click **"🏗️ Add Equipment"**, create a machine — its QR label pops up immediately with a **Download** button. This is the physical label that would ship with the machine.
3. **Log out, log in as `manager1`:** Show the dashboard is scoped to only their 2 assigned machines — no site dropdown, no way to see anyone else's fleet. Click **"📦 Check In Machine"**, upload/scan the QR you just downloaded (or type the ID manually), pick a site + contract dates, and confirm — the machine now shows up in `manager1`'s fleet as `RENTED`.
4. **Trigger the QR Operator Handshake:** Log out, log in as `OP101`. Scan/enter Equipment ID `EQX1001` (or the machine just checked in), then click **"✅ Simulate Near Machine"**. Watch both spatial checks (proximity + geofence) pass live, the ignition banner turn green, and the shift timer start — the operator identity comes from the login session, not a typed field. Click **"❌ Simulate Far Away"** first to show the failure/locked state for contrast.
5. **Highlight the Anomalies:** Wait a few seconds for the simulator to trigger built-in anomalies — watch them populate the red Alerts panel and light up the map with red-ringed markers:
   - `EQX1002` — Unauthorized engine start → instant **CRITICAL** alert + automatic MQTT `LOCK` (watch the simulator terminal log the engine being forced back `OFF` within seconds).
   - `EQX1004` — Wanders outside its site geofence (~60s in) → **HIGH** `GEOFENCE_BREACH` alert.
   - `EQX1007` — Fuel drops while the engine is `OFF` → **CRITICAL** `FUEL_THEFT_SUSPECTED` alert.
   - `EQX1001` / `EQX1005` — Chronic idle ratio → **MEDIUM** `HIGH_IDLE_RATIO` alert.
6. **Show Predictive Contract Pacing:** Log back in as `dealer1` (or `manager1`/`manager2` for their own machines) and scroll to the **Contract Pacing & Predictive Overrun** panel. `EQX1005` will show as `LAGGING` with a projected overrun — click **"+3 Days"** to demonstrate the one-click extension workflow live.
7. **Show Predictive Analytics:** As `dealer1`, scroll to the AI Forecast panel to show data-driven relocation recommendations (Dealer-only).
