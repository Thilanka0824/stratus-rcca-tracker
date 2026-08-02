import { useMemo } from 'react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, LabelList,
} from 'recharts';
import { paretoRootCauses, failuresByTeam, AXIS, GRID, TIP } from '../lib/helpers';

export default function AnalyticsView({ failures }) {
  const pareto = useMemo(() => paretoRootCauses(failures), [failures]);
  const teams = useMemo(() => failuresByTeam(failures), [failures]);
  const uncategorized = failures.filter((f) => !f.root_cause).length;

  return (
    <section>
      <div className="panel">
        <h3>Root-cause Pareto</h3>
        <p className="caption">
          Occurrence-weighted: a failure seen 9 times counts 9. The cumulative line answers
          "which two causes explain most of our failures?" — that's where corrective effort goes
          first. {uncategorized > 0 && `${uncategorized} failure(s) not yet root-caused are excluded.`}
        </p>
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart data={pareto} margin={{ top: 8, right: 12, left: -12, bottom: 40 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis
              dataKey="cause"
              tick={{ ...AXIS }}
              interval={0}
              angle={-22}
              textAnchor="end"
              height={70}
            />
            <YAxis yAxisId="count" tick={AXIS} allowDecimals={false} />
            <YAxis
              yAxisId="cum"
              orientation="right"
              tick={AXIS}
              domain={[0, 100]}
              tickFormatter={(v) => `${v}%`}
            />
            <Tooltip {...TIP} />
            <Bar yAxisId="count" dataKey="count" name="Occurrences" fill="#6e8cb8" radius={[3, 3, 0, 0]} />
            <Line
              yAxisId="cum"
              dataKey="cumulative"
              name="Cumulative %"
              stroke="#d9a441"
              strokeWidth={2}
              dot={{ r: 3, fill: '#d9a441' }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="panel">
        <h3>Open + closed failures by owning team</h3>
        <p className="caption">
          Where the follow-up work lands. A tall bar isn't blame — it's a coordination signal
          for standups and escalation.
        </p>
        <ResponsiveContainer width="100%" height={Math.max(180, teams.length * 42)}>
          <BarChart data={teams} layout="vertical" margin={{ top: 4, right: 40, left: 40, bottom: 4 }}>
            <CartesianGrid stroke={GRID} horizontal={false} />
            <XAxis type="number" tick={AXIS} allowDecimals={false} />
            <YAxis type="category" dataKey="team" tick={{ ...AXIS, fill: '#e8ecf4' }} width={140} />
            <Tooltip {...TIP} cursor={{ fill: 'rgba(110,140,184,0.08)' }} />
            <Bar dataKey="count" name="Failures" fill="#4caf7d" radius={[0, 3, 3, 0]}>
              <LabelList dataKey="count" position="right" style={{ ...AXIS, fill: '#e8ecf4' }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
