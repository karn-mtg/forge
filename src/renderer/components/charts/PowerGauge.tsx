import type { Deck } from '../../types/electron';

interface PowerGaugeProps {
  decks: Deck[];
}

export function PowerGauge({ decks }: PowerGaugeProps) {
  const powered = decks.filter(d => (d.power_level ?? 0) > 0);
  const avgPower = powered.length
    ? (powered.reduce((s, d) => s + (d.power_level ?? 5), 0) / powered.length)
    : null;

  const displayValue = avgPower !== null ? avgPower.toFixed(1) : '—';
  const barWidth = avgPower !== null ? Math.min(100, avgPower * 10) : 0;

  return (
    <div className="bg-primary-container border border-primary/20 rounded-2xl p-6 shadow-xl shadow-primary/5">
      <div className="flex justify-between items-start mb-4">
        <div>
          <h3 className="font-headline-md text-lg text-on-primary-fixed">Average Power</h3>
        </div>
        <span
          className="material-symbols-outlined text-on-primary-fixed text-2xl"
          style={{ fontVariationSettings: "'FILL' 1" }}
        >
          workspace_premium
        </span>
      </div>
      <div className="mt-2">
        <div className="flex justify-between items-end mb-2">
          <span className="text-3xl font-bold text-on-primary-fixed">{displayValue}</span>
          <span className="text-[10px] text-on-primary-fixed/60 uppercase font-bold tracking-widest">Level</span>
        </div>
        <div className="h-2 w-full bg-on-primary-fixed/10 rounded-full overflow-hidden relative">
          <div
            className="h-full bg-on-primary-fixed rounded-full shadow-[0_0_12px_rgba(255,255,255,0.4)] transition-all"
            style={{ width: `${barWidth}%` }}
          />
          <div className="absolute top-0 left-[70%] h-full w-[2px] bg-on-primary-fixed/30" />
        </div>
        <div className="flex justify-between mt-2 text-[9px] text-on-primary-fixed/40 uppercase font-bold tracking-tighter">
          <span>Casual</span>
          <span>Focused</span>
          <span>Optimized</span>
          <span>Competitive</span>
        </div>
      </div>
    </div>
  );
}
