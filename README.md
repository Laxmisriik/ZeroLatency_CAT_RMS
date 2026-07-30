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

Then start the server:
```bash
npm start
```
*(The server will start on `http://localhost:5000` and connect to the HiveMQ broker).*

### 3. Start the IoT Edge Simulator
Open a **new terminal tab/window**, and navigate to the simulator folder. This script mimics physical machine telemetry (fuel burn, GPS drift, RPM) and injects anomalies for the demo.
```bash
cd simulator
npm install
npm start
```

### 4. Start the Fleet Dashboard (React UI)
Open a **third terminal tab/window**, and navigate to the frontend folder.
```bash
cd frontend
npm install
npm run dev
```
Open your browser to `http://localhost:5173` to view the live dashboard!

---

## Hackathon Demo Flow
When presenting to the judges, we recommend this sequence:
1. **Show the Dashboard:** Point out the live telemetry (fuel bars dropping, engine dots pulsing).
2. **Show Predictive Analytics:** Scroll down to the AI Forecast panel to show data-driven relocation recommendations.
3. **Trigger the Digital Handshake:** Click "Checkout" on an Available machine, enter a dummy Operator ID, and watch the database seamlessly transition it to "RESERVED".
4. **Highlight the Anomalies:** Wait a few seconds for the simulator to trigger built-in anomalies (e.g., *Fuel Theft* or *Unauthorized Start*). Watch them instantly populate the red Alerts panel.
