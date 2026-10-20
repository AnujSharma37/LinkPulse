import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Bucket } from '../api';

export function ClicksChart({ data }: { data: { date: string; clicks: number; human_clicks: number }[] }) {
  const rows = data.map((d) => ({ ...d, label: new Date(d.date + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) }));
  const total = data.reduce((s, d) => s + d.clicks, 0);
  return (
    <div style={{ width: '100%', height: 240 }} role="img" aria-label={`Clicks per day chart, ${total} clicks in total over ${data.length} days`}>
      <ResponsiveContainer>
        <AreaChart data={rows} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
          <defs>
            <linearGradient id="clicksFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis dataKey="label" tick={{ fill: 'var(--faint)', fontSize: 12 }} tickLine={false} axisLine={false} minTickGap={24} />
          <YAxis allowDecimals={false} tick={{ fill: 'var(--faint)', fontSize: 12 }} tickLine={false} axisLine={false} />
          <Tooltip
            contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text)' }}
            labelStyle={{ color: 'var(--muted)' }}
            formatter={(v, n) => [v as number, n === 'clicks' ? 'All clicks' : 'Human clicks']}
          />
          <Area isAnimationActive={false} type="monotone" dataKey="clicks" stroke="var(--chart-1)" strokeWidth={2.2} fill="url(#clicksFill)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

const COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'var(--chart-6)'];
export function Bars({ data, empty = 'No clicks in this period yet.', capitalize = false }: { data: Bucket[]; empty?: string; capitalize?: boolean }) {
  const max = Math.max(1, ...data.map((d) => d.clicks));
  const total = data.reduce((s, d) => s + d.clicks, 0);
  if (!data.length) return <p className="muted small">{empty}</p>;
  return (
    <div className="bars">
      {data.map((d, i) => (
        <div key={d.label} className="bar-row">
          <span className="truncate" style={{ textTransform: capitalize ? 'capitalize' : undefined }}>{d.label}</span>
          <span className="muted mono">{d.clicks.toLocaleString()} · {Math.round((d.clicks / total) * 100)}%</span>
          <div className="bar-track"><div className="bar-fill" style={{ width: `${(d.clicks / max) * 100}%`, background: COLORS[i % COLORS.length] }} /></div>
        </div>
      ))}
    </div>
  );
}
