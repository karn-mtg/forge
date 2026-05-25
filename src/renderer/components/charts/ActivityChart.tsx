import { useState, useEffect, useMemo } from 'react';
import type { ActivityLogEntry } from '../../types/electron';
import { useToastStore } from '../../store/useToastStore';

const DAY_ABBR = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

interface ActivityChartProps {
  initialDays?: number;
}

export function ActivityChart({ initialDays = 7 }: ActivityChartProps) {
  const [days, setDays] = useState(initialDays);
  const [log, setLog] = useState<ActivityLogEntry[]>([]);

  useEffect(() => {
    window.libraryAPI.getActivityLog({ days }).then(setLog).catch(err => {
      console.error('Activity log error:', err);
      useToastStore.getState().push({ type: 'error', title: 'Failed to load activity log', message: String(err) });
    });
  }, [days]);

  const { countByDay, dates, maxCount } = useMemo(() => {
    const countByDay: Record<string, number> = {};
    for (const row of log) countByDay[row.day] = row.count;

    const dates: string[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      dates.push(d.toISOString().slice(0, 10));
    }

    const maxCount = Math.max(1, ...dates.map(d => countByDay[d] || 0));
    return { countByDay, dates, maxCount };
  }, [log, days]);

  const todayStr = new Date().toISOString().slice(0, 10);

  return (
    <div className="md:col-span-6 lg:col-span-7 bg-surface border border-white/5 rounded-2xl p-6 shadow-xl">
      <div className="flex items-center justify-between mb-8">
        <h3 className="font-headline-md text-lg text-on-surface">Library Activity</h3>
        <div className="flex gap-2">
          <button
            onClick={() => setDays(7)}
            className={`text-[10px] px-2 py-1 rounded uppercase font-bold tracking-wider ${
              days === 7
                ? 'bg-white/5 text-on-surface-variant'
                : 'text-on-surface-variant/50 hover:bg-white/5'
            }`}
          >
            Week
          </button>
          <button
            onClick={() => setDays(30)}
            className={`text-[10px] px-2 py-1 rounded uppercase font-bold tracking-wider ${
              days === 30
                ? 'bg-white/5 text-on-surface-variant'
                : 'text-on-surface-variant/50 hover:bg-white/5'
            }`}
          >
            Month
          </button>
          <button
            onClick={() => setDays(90)}
            className={`text-[10px] px-2 py-1 rounded uppercase font-bold tracking-wider ${
              days === 90
                ? 'bg-white/5 text-on-surface-variant'
                : 'text-on-surface-variant/50 hover:bg-white/5'
            }`}
          >
            90d
          </button>
        </div>
      </div>

      <div className="flex items-end gap-3 h-48 px-2">
        {dates.map(date => {
          const count = countByDay[date] || 0;
          const pct = Math.max(5, Math.round((count / maxCount) * 100));
          const isToday = date === todayStr;
          const label = days <= 7
            ? DAY_ABBR[new Date(date + 'T12:00:00').getDay()]
            : new Date(date + 'T12:00:00').getDate();

          return (
            <div key={date} className="flex-1 group relative" title={`${date}: ${count} events`}>
              <div
                className={`${isToday ? 'bg-primary-container group-hover:bg-primary' : 'bg-primary/20 group-hover:bg-primary/40'} transition-all rounded-t-lg w-full`}
                style={{ height: `${pct}%` }}
              />
              <span
                className={`absolute -bottom-6 left-1/2 -translate-x-1/2 text-[10px] ${
                  isToday ? 'text-primary font-bold' : 'text-on-surface-variant/40'
                }`}
              >
                {label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
