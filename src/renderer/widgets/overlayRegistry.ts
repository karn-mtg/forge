import type { WidgetParam, WidgetParams } from './registry';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Per-card data passed to decorator render functions. */
export interface OverlayCardData {
  oracleId: string;
  name: string;
  typeLine: string;
  manaCost: string;
  cmc: number;
  colorIdentity: string[];
  /** EDHREC rank from Scryfall bulk data (lower = more popular in Commander). Available offline. */
  edhrecRank?: number;
  /** EDHREC % inclusion fetched async from edhrec.com. null = fetch in progress / failed. */
  edhrecPct?: number | null;
}

export type OverlayAnchor = 'tl' | 'tr' | 'bl' | 'br' | 'bc' | 'tc';

export interface CardDecoratorDef {
  id: string;
  name: string;
  description: string;
  icon: string;           // material-symbols-outlined name
  readonly?: boolean;     // true = built-in (cannot be deleted/edited)
  anchor: OverlayAnchor;  // where on the card the overlay is positioned
  /** JS function body: (card: OverlayCardData, params: WidgetParams) => string (HTML) */
  code: string;
  /** Configurable per-instance parameters (same structure as widget params). */
  params?: WidgetParam[];
  /**
   * Optional async enrichment for built-in decorators (e.g. EDHREC API fetch).
   * Receives the list of cards to render; returns a map of oracleId → partial
   * enrichment data to merge into OverlayCardData before re-rendering.
   * Custom (user-code) decorators cannot use this — it is only available to
   * built-ins that supply a real function reference.
   */
  asyncLoad?: (cards: OverlayCardData[]) => Promise<Map<string, Partial<OverlayCardData>>>;
}

// ─── Registry ─────────────────────────────────────────────────────────────────

class CardDecoratorRegistryClass {
  private defs = new Map<string, CardDecoratorDef>();

  register(def: CardDecoratorDef): void {
    this.defs.set(def.id, def);
  }

  unregister(id: string): void {
    const def = this.defs.get(id);
    if (def?.readonly) throw new Error(`Decorator "${id}" is built-in and cannot be removed`);
    this.defs.delete(id);
  }

  get(id: string): CardDecoratorDef | undefined {
    return this.defs.get(id);
  }

  getAll(): CardDecoratorDef[] {
    return Array.from(this.defs.values());
  }

  /** Returns only user-created (non-readonly) decorators, serialisable for persistence. */
  getCustom(): CardDecoratorDef[] {
    return Array.from(this.defs.values()).filter(d => !d.readonly);
  }

  /** Build resolved params by merging instance overrides onto definition defaults. */
  resolveParams(def: CardDecoratorDef, instanceParams?: WidgetParams): WidgetParams {
    const result: WidgetParams = {};
    for (const p of def.params ?? []) {
      const v = instanceParams?.[p.key];
      result[p.key] = v !== undefined ? v : p.default;
    }
    return result;
  }

  /**
   * Execute decorator code and return the overlay HTML string.
   * Returns '' if code produces no output or throws.
   */
  render(id: string, card: OverlayCardData, instanceParams?: WidgetParams): string {
    const def = this.defs.get(id);
    if (!def) return '';
    return this.renderCode(def.code, card, instanceParams, def.params);
  }

  /** Run code string directly (for live preview in the editor). */
  renderCode(code: string, card: OverlayCardData, instanceParams?: WidgetParams, paramDefs?: WidgetParam[]): string {
    try {
      const params: WidgetParams = {};
      for (const p of paramDefs ?? []) {
        const v = instanceParams?.[p.key];
        params[p.key] = v !== undefined ? v : p.default;
      }
      // eslint-disable-next-line no-new-func
      const fn = new Function('card', 'params', code) as (c: OverlayCardData, p: WidgetParams) => string;
      const html = fn(card, params);
      return typeof html === 'string' ? html : '';
    } catch {
      return '';
    }
  }
}

export const CardDecoratorRegistry = new CardDecoratorRegistryClass();

// ─── Anchor CSS helper ────────────────────────────────────────────────────────

const ANCHOR_CSS: Record<OverlayAnchor, string> = {
  tl: 'top:6px;left:6px;',
  tr: 'top:6px;right:6px;',
  bl: 'bottom:8px;left:6px;',
  br: 'bottom:8px;right:6px;',
  bc: 'bottom:8px;left:50%;transform:translateX(-50%);',
  tc: 'top:6px;left:50%;transform:translateX(-50%);',
};

/** Returns the full inline CSS for a decorator overlay wrapper div. */
export function overlayWrapperCss(anchor: OverlayAnchor): string {
  return `position:absolute;z-index:35;pointer-events:none;${ANCHOR_CSS[anchor] ?? ANCHOR_CSS.bc}`;
}
