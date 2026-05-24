/**
 * ManaSymbol — renders a single MTG mana/symbol icon using mana-font.
 *
 * Accepts Scryfall-style symbol strings like "W", "U", "2", "W/U", "T", etc.
 * (the content of {…} braces — no braces needed here).
 *
 * Usage:
 *   <ManaSymbol sym="W" />
 *   <ManaSymbol sym="3" size="1.1em" />
 *   <ManaSymbol sym="W/U" shadow />
 */

/** Convert a Scryfall symbol string to the mana-font CSS modifier (no "ms-" prefix). */
export function scryfallToMsClass(sym: string): string {
  const s = sym.trim().toLowerCase();

  // Tap / untap
  if (s === 't' || s === 'tap') return 'tap';
  if (s === 'q' || s === 'untap') return 'untap';

  // Energy
  if (s === 'e') return 'e';

  // Snow
  if (s === 's') return 's';

  // Phyrexian (e.g. "P" or "W/P" → "wp")
  // Hybrid (e.g. "W/U" → "wu", "2/W" → "2w")
  if (s.includes('/')) {
    return s.replace(/\//g, '');
  }

  // Generic number, X, Y, Z, C, W, U, B, R, G …
  return s;
}

/** Full CSS class string for a symbol: "ms ms-{modifier} ms-cost". */
export function manaSymbolClass(sym: string, cost = true, shadow = false): string {
  const mod = scryfallToMsClass(sym);
  return ['ms', `ms-${mod}`, cost && 'ms-cost', shadow && 'ms-shadow']
    .filter(Boolean)
    .join(' ');
}

interface ManaSymbolProps {
  /** Scryfall symbol without braces: "W", "2", "W/U", "T", etc. */
  sym: string;
  /** Render with the circular cost badge background (default true). */
  cost?: boolean;
  /** Add drop shadow (default false). */
  shadow?: boolean;
  /** Font-size passed as inline style (default "1em"). */
  size?: string | number;
  className?: string;
}

export function ManaSymbol({ sym, cost = true, shadow = false, size, className }: ManaSymbolProps) {
  return (
    <i
      className={[manaSymbolClass(sym, cost, shadow), className].filter(Boolean).join(' ')}
      style={size !== undefined ? { fontSize: size } : undefined}
      aria-label={sym}
    />
  );
}

/**
 * ManaCost — renders a full mana cost string like "{3}{W}{U}" as a row of icons.
 * Pass the raw Scryfall `mana_cost` string.
 */
export function ManaCost({
  manaCost,
  size = '1em',
  shadow = false,
  className = '',
}: {
  manaCost?: string;
  size?: string | number;
  shadow?: boolean;
  className?: string;
}) {
  if (!manaCost) return null;
  const symbols = [...manaCost.matchAll(/\{([^}]+)\}/g)].map(m => m[1]);
  return (
    <span className={`inline-flex items-center gap-[2px] ${className}`}>
      {symbols.map((sym, i) => (
        <ManaSymbol key={i} sym={sym} cost shadow={shadow} size={size} />
      ))}
    </span>
  );
}

/**
 * Turn a Scryfall mana_cost string into an HTML string of mana-font <i> tags.
 * Use in dangerouslySetInnerHTML contexts (e.g. oracle text, card list rows).
 */
export function manaCostToHtml(manaCost: string, sizePx = 13): string {
  return manaCost.replace(/\{([^}]+)\}/g, (_, sym) => {
    const cls = manaSymbolClass(sym, true, false);
    return `<i class="${cls}" style="font-size:${sizePx}px;vertical-align:middle;margin:0 1px" aria-label="${sym}"></i>`;
  });
}
