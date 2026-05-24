export interface WidgetCard {
  oracleId: string;
  name: string;
  qty: number;
  board: string;
  typeLine: string;
  manaCost: string;
  cmc: number;
  colorIdentity: string[];
}

/** A named group from the canvas arrangement (populated from .group-container DOM elements). */
export interface WidgetGroup {
  name: string;
  color: string;
  /** Resolved cards in this group (from deck cards that appear in this group on canvas). */
  cards: WidgetCard[];
  /** Sum of qty across all cards in the group. */
  totalQty: number;
}

export interface WidgetData {
  /** Main deck + commanders (excludes sideboard) */
  cards: WidgetCard[];
  /** All cards including sideboard */
  allCards: WidgetCard[];
  /** Total cards in the deck (sum of quantities, excl. sideboard) */
  deckSize: number;
  /**
   * Canvas arrangement groups (non-empty when the workshop has at least one group container).
   * Widgets should fall back to card-type grouping when this is empty.
   */
  groups: WidgetGroup[];
}

/** One configurable parameter on a widget (instance-overridable). */
export interface WidgetParam {
  key: string;
  label: string;
  type: 'number' | 'text' | 'boolean' | 'select';
  default: number | string | boolean;
  /** For number params */
  min?: number;
  max?: number;
  step?: number;
  /** For select params */
  options?: { value: string; label: string }[];
}

/** Resolved param map passed into widget code as second argument. */
export type WidgetParams = Record<string, number | string | boolean>;

export interface WidgetDef {
  id: string;
  name: string;
  description: string;
  icon: string;          // material-symbols-outlined name
  readonly: boolean;     // true = built-in (cannot be deleted/edited)
  width?: number;        // default pixel width (default 220)
  /** Configurable parameters; users can override per-instance via the gear popover. */
  params?: WidgetParam[];
  code: string;          // JS function body: receives (data: WidgetData, params: WidgetParams), must return HTML string
}

class WidgetRegistryClass {
  private defs = new Map<string, WidgetDef>();

  register(def: WidgetDef): void {
    this.defs.set(def.id, def);
  }

  unregister(id: string): void {
    const def = this.defs.get(id);
    if (def?.readonly) throw new Error(`Widget "${id}" is built-in and cannot be removed`);
    this.defs.delete(id);
  }

  get(id: string): WidgetDef | undefined {
    return this.defs.get(id);
  }

  getAll(): WidgetDef[] {
    return Array.from(this.defs.values());
  }

  /** Returns only user-created (non-readonly) widgets, serialisable for persistence. */
  getCustom(): WidgetDef[] {
    return Array.from(this.defs.values()).filter(d => !d.readonly);
  }

  /** Build resolved params by merging instance overrides onto definition defaults. */
  resolveParams(def: WidgetDef, instanceParams?: WidgetParams): WidgetParams {
    const result: WidgetParams = {};
    for (const p of def.params ?? []) {
      const v = instanceParams?.[p.key];
      result[p.key] = v !== undefined ? v : p.default;
    }
    return result;
  }

  /** Execute widget code and return rendered HTML string.
   *  @param instanceParams - per-instance overrides (from dataset.widgetParams) */
  render(id: string, data: WidgetData, instanceParams?: WidgetParams): string {
    const def = this.defs.get(id);
    if (!def) return `<p style="color:rgba(255,255,255,0.25);font-size:11px;padding:8px;text-align:center">Widget "${id}" not found</p>`;
    try {
      const params = this.resolveParams(def, instanceParams);
      // eslint-disable-next-line no-new-func
      const fn = new Function('data', 'params', def.code) as (d: WidgetData, p: WidgetParams) => string;
      const html = fn(data, params);
      return typeof html === 'string' ? html : '';
    } catch (err) {
      return `<p style="color:#f87171;font-size:11px;padding:8px">&#9888; ${String(err)}</p>`;
    }
  }

  /** Run code string directly (for live preview — no registry entry needed).
   *  @param paramDefs - param definitions (from the editor) used to apply defaults */
  renderCode(code: string, data: WidgetData, instanceParams?: WidgetParams, paramDefs?: WidgetParam[]): string {
    try {
      const params: WidgetParams = {};
      for (const p of paramDefs ?? []) {
        const v = instanceParams?.[p.key];
        params[p.key] = v !== undefined ? v : p.default;
      }
      // eslint-disable-next-line no-new-func
      const fn = new Function('data', 'params', code) as (d: WidgetData, p: WidgetParams) => string;
      const html = fn(data, params);
      return typeof html === 'string' ? html : '';
    } catch (err) {
      return `<p style="color:#f87171;font-size:11px;padding:8px">&#9888; ${String(err)}</p>`;
    }
  }
}

export const WidgetRegistry = new WidgetRegistryClass();
