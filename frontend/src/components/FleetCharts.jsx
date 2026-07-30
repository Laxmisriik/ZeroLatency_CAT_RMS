import {
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid
} from 'recharts';

const STATUS_COLORS = {
  AVAILABLE: '#1E7B34',
  RENTED: '#1A56DB',
  RESERVED: '#B25E00',
  UNDER_MAINTENANCE: '#6B4FBB',
  UNAUTHORIZED_USE: '#C5221F',
  UNASSIGNED: '#8A8F98',
};

const tooltipStyle = {
  background: '#FFFFFF',
  border: '1px solid #E3E3E3',
  borderRadius: 6,
  fontSize: 12,
  color: '#1C1C1C',
  boxShadow: '0 4px 12px rgba(16,24,40,0.08)',
};

const axisTick = { fill: '#5F6368', fontSize: 11 };
const gridStroke = '#EDEDED';

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
                <Cell key={i} fill={STATUS_COLORS[entry.name] || '#8A6D00'} />
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
            <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
            <XAxis dataKey="id" tick={axisTick} />
            <YAxis tick={axisTick} />
            <Tooltip contentStyle={tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="engine" name="Engine Hrs" fill="#1E7B34" radius={[4, 4, 0, 0]} />
            <Bar dataKey="idle" name="Idle Hrs" fill="#B25E00" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="chart-card">
        <h3>Fuel Level by Machine</h3>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={fuelData}>
            <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
            <XAxis dataKey="id" tick={axisTick} />
            <YAxis tick={axisTick} domain={[0, 100]} />
            <Tooltip contentStyle={tooltipStyle} />
            <Bar dataKey="fuel" name="Fuel %" radius={[4, 4, 0, 0]}>
              {fuelData.map((entry, i) => (
                <Cell key={i} fill={entry.fuel > 50 ? '#1E7B34' : entry.fuel > 20 ? '#B25E00' : '#C5221F'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
