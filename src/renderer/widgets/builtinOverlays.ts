import { CardDecoratorRegistry } from './overlayRegistry';
import type { OverlayCardData } from './overlayRegistry';

// ─── EDHREC Decorator ─────────────────────────────────────────────────────────

/**
 * Displays EDHREC Commander popularity on each card.
 *
 * • Sync layer  — renders the EDHREC rank (#142, top 1k, …) from Scryfall bulk
 *   data immediately. No internet required.
 * • Async layer — fetches the real inclusion percentage from the EDHREC JSON API
 *   and replaces the rank badge with "X%" when the request resolves.
 *   Falls back silently to the rank badge on network error or if the card has no
 *   EDHREC entry (e.g. non-Commander-legal cards).
 */
function edhrecBadgeHtml(card: OverlayCardData): string {
  const pct = card.edhrecPct;
  const rank = card.edhrecRank;

  if (typeof pct === 'number') {
    // Percentage available — show it
    const color = pct >= 50 ? '#f2ca83' : pct >= 20 ? '#86efac' : pct >= 5 ? '#7eb8f7' : 'rgba(255,255,255,0.4)';
    return (
      `<div style="background:rgba(0,0,0,0.82);backdrop-filter:blur(6px);` +
      `border:1px solid ${color}50;border-radius:10px;padding:2px 8px;` +
      `font-size:10px;font-weight:700;color:${color};white-space:nowrap;` +
      `font-family:-apple-system,sans-serif">` +
      `${pct.toFixed(1)}%</div>`
    );
  }

  if (rank == null) return ''; // no rank data at all

  // Rank available (offline)
  const rankStr = rank <= 100 ? `#${rank}` : rank <= 1000 ? 'top 1k' : rank <= 10000 ? 'top 10k' : `#${rank.toLocaleString()}`;
  const color = rank <= 100 ? '#f2ca83' : rank <= 1000 ? '#86efac' : rank <= 5000 ? '#7eb8f7' : 'rgba(255,255,255,0.35)';

  return (
    `<div style="background:rgba(0,0,0,0.82);backdrop-filter:blur(6px);` +
    `border:1px solid ${color}50;border-radius:10px;padding:2px 8px;` +
    `font-size:10px;font-weight:700;color:${color};white-space:nowrap;` +
    `font-family:-apple-system,sans-serif">` +
    `${rankStr}</div>`
  );
}

CardDecoratorRegistry.register({
  id: 'edhrec',
  name: 'EDHREC',
  description: 'Commander inclusion rate — rank offline, % with internet',
  icon: 'query_stats',
  readonly: true,
  anchor: 'bc',

  // Inline code string for sync rendering (reads card.edhrecRank / card.edhrecPct)
  code: `
const pct = card.edhrecPct;
const rank = card.edhrecRank;
if (typeof pct === 'number') {
  const color = pct >= 50 ? '#f2ca83' : pct >= 20 ? '#86efac' : pct >= 5 ? '#7eb8f7' : 'rgba(255,255,255,0.4)';
  return '<div style="background:rgba(0,0,0,0.82);backdrop-filter:blur(6px);border:1px solid '+color+'50;border-radius:10px;padding:2px 8px;font-size:10px;font-weight:700;color:'+color+';white-space:nowrap;font-family:-apple-system,sans-serif">'+pct.toFixed(1)+'%</div>';
}
if (rank == null) return '';
const rankStr = rank <= 100 ? '#'+rank : rank <= 1000 ? 'top 1k' : rank <= 10000 ? 'top 10k' : '#'+rank.toLocaleString();
const color = rank <= 100 ? '#f2ca83' : rank <= 1000 ? '#86efac' : rank <= 5000 ? '#7eb8f7' : 'rgba(255,255,255,0.35)';
return '<div style="background:rgba(0,0,0,0.82);backdrop-filter:blur(6px);border:1px solid '+color+'50;border-radius:10px;padding:2px 8px;font-size:10px;font-weight:700;color:'+color+';white-space:nowrap;font-family:-apple-system,sans-serif">'+rankStr+'</div>';
`.trim(),

  /**
   * Async enrichment: fires one `fetchEdhrecData` IPC call per unique card name,
   * then returns a map of oracleId → { edhrecPct } for the framework to merge and
   * re-render. Cards with no EDHREC entry silently keep their rank badge.
   */
  asyncLoad: async (cards: OverlayCardData[]): Promise<Map<string, Partial<OverlayCardData>>> => {
    const result = new Map<string, Partial<OverlayCardData>>();
    // Deduplicate by name to avoid redundant fetches for the same card
    const seen = new Set<string>();
    const tasks = cards
      .filter(c => c.name && !seen.has(c.name) && seen.add(c.name))
      .map(async c => {
        try {
          const res = await window.cardsAPI.fetchEdhrecData({ cardName: c.name });
          if (typeof res?.pct === 'number') {
            // Apply to all cards with this name (handles reprints)
            cards
              .filter(x => x.name === c.name)
              .forEach(x => result.set(x.oracleId, { edhrecPct: res.pct }));
          }
        } catch { /* silent fail */ }
      });
    await Promise.allSettled(tasks);
    return result;
  },
});

// ─── Export helper used by builtins auto-registration ─────────────────────────

/** No-op; importing this module registers all built-in overlays as a side-effect. */
export function registerBuiltinOverlays(): void { /* registration done above */ }
