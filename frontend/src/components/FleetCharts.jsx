import {
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid
} from 'recharts';

const STATUS_COLORS = {
  AVAILABLE: '#4CAF50',
  RENTED: '#2196F3',
  RESERVED: '#FF9800',
  UNDER_MAINTENANCE: '#9C27B0',
  UNAUTHORIZED_USE: '#E53935',
  UNASSIGNED: '#616161',
};

const tooltipStyle = {
  background: '#1A1A1A',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 8,
  fontSize: 12,
};

export default function FleetCharts({ equipment }) {
  const statusCounts = {};
  equipment.forEach(eq => { statusCounts[eq.status] = (statusCounts[eq.status] || 0) + 1; });
  const statusData = Object.entries(statusCounts).map(([name, value]) => ({ name, value }));

  const hoursData = equipment.map(eq => ({
    id: eq.equipment_id,
    engine: Number(eq.telemetry?.totalEngineHours || 0),
    idle: Number(eq.telemetry?.totalIdleHours || 0),
  }));

  const fuelData = equipment.map(eq => ({
    id: eq.equipment_id,
    fuel: Number(eq.telemetry?.fuelLevelPct || 0),
  }));

  return (
    <div className="charts-grid">
      <div className="chart-card">
        <h3>Fleet Status Distribution</h3>
        <ResponsiveContainer width="100%" height={220}>
          <PieChart>
            <Pie data={statusData} dataKey="value" nameKey="name" innerRadius={48} outerRadius={78} paddingAngle={3}>
              {statusData.map((entry, i) => (
                <Cell key={i} fill={STATUS_COLORS[entry.name] || '#FFC20E'} />
              ))}
            </Pie>
            <Tooltip contentStyle={tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
          </PieChart>
        </ResponsiveContainer>
      </div>

      <div className="chart-card">
        <h3>Engine vs Idle Hours by Machine</h3>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={hoursData}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
            <XAxis dataKey="id" tick={{ fill: '#A0A0A0', fontSize: 11 }} />
            <YAxis tick={{ fill: '#A0A0A0', fontSize: 11 }} />
            <Tooltip contentStyle={tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="engine" name="Engine Hrs" fill="#4CAF50" radius={[4, 4, 0, 0]} />
            <Bar dataKey="idle" name="Idle Hrs" fill="#FF9800" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="chart-card">
        <h3>Fuel Level by Machine</h3>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={fuelData}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
            <XAxis dataKey="id" tick={{ fill: '#A0A0A0', fontSize: 11 }} />
            <YAxis tick={{ fill: '#A0A0A0', fontSize: 11 }} domain={[0, 100]} />
            <Tooltip contentStyle={tooltipStyle} />
            <Bar dataKey="fuel" name="Fuel %" radius={[4, 4, 0, 0]}>
              {fuelData.map((entry, i) => (
                <Cell key={i} fill={entry.fuel > 50 ? '#4CAF50' : entry.fuel > 20 ? '#FF9800' : '#E53935'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
