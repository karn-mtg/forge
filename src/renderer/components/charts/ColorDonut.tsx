import { useMemo } from 'react';
import type { Deck } from '../../types/electron';
import { ManaSymbol } from '../ManaSymbol';

interface ColorDonutProps {
  decks: Deck[];
}

const COLOR_CONFIG = [
  { key: 'U', stroke: '#2c5b9e', label: 'Blue' },
  { key: 'B', stroke: '#2b2b2b', label: 'Black' },
  { key: 'R', stroke: '#e53935', label: 'Red' },
  { key: 'G', stroke: '#2e7d32', label: 'Green' },
  { key: 'W', stroke: '#fdd835', label: 'White' },
];

const C = 99.9; // circumference for r=15.9

export function ColorDonut({ decks }: ColorDonutProps) {
  const segments = useMemo(() => {
    const colorCount: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
    let total = 0;

    for (const deck of decks) {
      const ci = deck.color_identity || '';
      for (const c of ci.toUpperCase().split('')) {
        if (colorCount[c] !== undefined) { colorCount[c]++; total++; }
      }
    }

    const pct: Record<string, number> = {};
    for (const c of Object.keys(colorCount)) {
      pct[c] = total > 0 ? Math.round(colorCount[c] / total * 100) : 0;
    }

    let offset = 0;
    return COLOR_CONFIG.map(({ key, stroke, label }) => {
      const p = pct[key] || 0;
      const dash = (p / 100) * C;
      const seg = { key, stroke, label, p, dash, offset };
      offset += dash;
      return seg;
    });
  }, [decks]);

  return (
    <div className="bg-surface border border-white/5 rounded-2xl p-6 flex-1 shadow-xl">
      <h3 className="font-headline-md text-lg text-on-surface mb-6">Color Distribution</h3>
      <div className="flex items-center gap-8">
        <div className="relative w-28 h-28 flex-shrink-0">
          <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
            {segments.map(({ key, stroke, dash, offset: off }) => (
              <circle
                key={key}
                cx="18"
                cy="18"
                r="15.9"
                fill="transparent"
                stroke={stroke}
                strokeWidth="4"
                strokeDasharray={`${dash.toFixed(1)}, ${C}`}
                strokeDashoffset={`-${off.toFixed(1)}`}
              />
            ))}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-sm font-bold">{decks.length}</span>
            <span className="text-[8px] opacity-40 uppercase">Decks</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-2 flex-1">
          {segments.map(({ key, label, p }) => (
            <div key={key} className="flex items-center gap-2">
              <ManaSymbol sym={key} cost shadow size="1rem" />
              <span className="text-[11px] text-on-surface-variant">
                {label} ({p}%)
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
