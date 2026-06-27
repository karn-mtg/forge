import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { marked } from 'marked';
import { Sidebar } from '../components/Sidebar';
import { ToastStack } from '../components/ToastStack';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { CardSearchPanel } from '../components/CardSearchPanel';
import type { CardSearchPanelHandle } from '../components/CardSearchPanel';
import { CardDetailPanel } from '../components/CardDetailPanel';
import { DeckSettingsModal } from '../components/DeckSettingsModal';
import type { Deck, Card, DeckCardEntry, Arrangement } from '../types/electron';
import { useLibraryStore } from '../store/useLibraryStore';
import { useToastStore } from '../store/useToastStore';
import { manaCostToHtml } from '../components/ManaSymbol';
import { WidgetRegistry } from '../widgets/registry';
import type { WidgetData, WidgetDef, WidgetGroup } from '../widgets/registry';
import { CardDecoratorRegistry } from '../widgets/overlayRegistry';
import type { CardDecoratorDef, OverlayCardData } from '../widgets/overlayRegistry';
import { overlayWrapperCss } from '../widgets/overlayRegistry';
import { persistCustomWidgets, persistCustomDecorators } from '../App';
import { WidgetEditorModal } from '../components/WidgetEditorModal';
import { esc } from '../utils/escape';
import { useAIStore } from '../store/useAIStore';

// Shared marked options: GFM + soft line breaks
const MARKED_OPTS = { breaks: true, gfm: true };

// ─── Constants ────────────────────────────────────────────────────────────────

const FORMAT_LABELS: Record<string, string> = {
  commander: 'Commander', modern: 'Modern', standard: 'Standard',
  pioneer: 'Pioneer', legacy: 'Legacy', vintage: 'Vintage', pauper: 'Pauper',
};


const CATEGORY_ORDER = ['Commanders','Creatures','Instants','Sorceries','Enchantments','Artifacts','Planeswalkers','Lands','Other','Sideboard'];

const BASIC_LAND_NAMES = new Set([
  'Plains', 'Island', 'Swamp', 'Mountain', 'Forest', 'Wastes',
  'Snow-Covered Plains', 'Snow-Covered Island', 'Snow-Covered Swamp',
  'Snow-Covered Mountain', 'Snow-Covered Forest',
]);

function QtyInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const commit = () => {
    const n = parseInt(draft, 10);
    if (!isNaN(n) && n > 0 && n !== value) onChange(n);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        autoFocus
        type="number"
        min={1}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
        className="w-8 text-center text-label-md font-bold text-primary bg-surface-container border border-primary/40 rounded focus:outline-none"
        style={{ MozAppearance: 'textfield' } as React.CSSProperties}
      />
    );
  }

  return (
    <span
      className="text-label-md font-bold text-primary w-5 text-center cursor-text hover:text-primary/70 transition-colors"
      title="Click to edit quantity"
      onClick={() => { setDraft(String(value)); setEditing(true); }}
    >
      {value}
    </span>
  );
}

function getCategory(typeLine: string): string {
  const t = (typeLine || '').toLowerCase();
  if (t.includes('creature')) return 'Creatures';
  if (t.includes('instant')) return 'Instants';
  if (t.includes('sorcery')) return 'Sorceries';
  if (t.includes('enchantment')) return 'Enchantments';
  if (t.includes('artifact')) return 'Artifacts';
  if (t.includes('planeswalker')) return 'Planeswalkers';
  if (t.includes('land')) return 'Lands';
  return 'Other';
}

// esc() is imported from utils/escape — see import above

function pipHtml(manaCost: string) {
  return manaCostToHtml(manaCost || '', 11);
}

function getImageUrl(card: Card): string {
  const fd = card.full_data;
  if (!fd) return '';
  if (fd.image_uris) return fd.image_uris.normal || fd.image_uris.small || '';
  if (fd.card_faces?.[0]?.image_uris) return fd.card_faces[0].image_uris.normal || '';
  return '';
}

interface PreSelectConflict {
  groupEl: HTMLDivElement;
  groupName: string;
  groupColor: string;
  cards: { el: HTMLDivElement; oracleId: string; name: string; artUrl: string }[];
}
interface PreSelectConfirmData {
  newGroupEl: HTMLDivElement;
  freeCards: HTMLDivElement[];
  conflicts: PreSelectConflict[];
}

/** Raw canvas-group shape — oracle IDs resolved from DOM, qty from deckCards. */
interface RawCanvasGroup {
  name: string;
  color: string;
  oracleIds: string[];
}

/**
 * Read all `.group-container` elements from the canvas and return raw group info.
 * Call this just before building WidgetData to snapshot the current arrangement.
 */
function readCanvasGroups(cv: HTMLDivElement): RawCanvasGroup[] {
  const out: RawCanvasGroup[] = [];
  cv.querySelectorAll<HTMLDivElement>(':scope > .group-container').forEach(g => {
    const oracleIds: string[] = [];
    const seen = new Set<string>();
    g.querySelectorAll<HTMLElement>('[data-oracle-id]').forEach(el => {
      const oid = el.dataset.oracleId;
      if (oid && !seen.has(oid)) { seen.add(oid); oracleIds.push(oid); }
    });
    if (oracleIds.length > 0) {
      out.push({
        name: g.dataset.name || 'Group',
        color: g.dataset.color || '#f2ca83',
        oracleIds,
      });
    }
  });
  return out;
}

function buildWidgetDataFromState(
  deckCards: DeckCardEntry[],
  cardDetails: Record<string, Card>,
  rawGroups?: RawCanvasGroup[],
  cardStatuses?: Record<string, string>,
): WidgetData {
  const mapCard = (dc: DeckCardEntry) => {
    const det = cardDetails[dc.oracle_id];
    const ci = det?.color_identity;
    return {
      oracleId: dc.oracle_id,
      name: det?.name || dc.oracle_id,
      qty: dc.quantity || 1,
      board: dc.board,
      typeLine: det?.type_line || '',
      manaCost: det?.mana_cost || '',
      cmc: det?.cmc || 0,
      colorIdentity: Array.isArray(ci) ? ci
        : typeof ci === 'string' && ci ? ci.split('').filter(c => 'WUBRG'.includes(c))
        : [],
      edhrecRank: det?.full_data?.edhrec_rank as number | undefined,
    };
  };
  const mainCards = deckCards.filter(dc => dc.board !== 'sideboard').map(mapCard);
  const mainByOid = new Map(mainCards.map(c => [c.oracleId, c]));

  // Resolve canvas groups → WidgetGroup (only cards present in the main deck)
  const groups: WidgetGroup[] = (rawGroups ?? []).flatMap(rg => {
    const cards = rg.oracleIds.map(oid => mainByOid.get(oid)).filter(Boolean) as ReturnType<typeof mapCard>[];
    if (!cards.length) return [];
    return [{ name: rg.name, color: rg.color, cards, totalQty: cards.reduce((s, c) => s + c.qty, 0) }];
  });

  return {
    cards: mainCards,
    allCards: deckCards.map(mapCard),
    deckSize: mainCards.reduce((s, c) => s + c.qty, 0),
    groups,
    cardStatuses,
  };
}
// ─── Canvas helpers (imperative DOM) ─────────────────────────────────────────

interface CardData {
  oracleId: string;
  name: string;
  typeLine: string;
  manaCost: string;
  imageUrl: string;
  qty?: number;
  board?: string; // 'main' | 'commander' | 'partner' | 'sideboard'
  /** deck_cards.id — unique per instance, used to identify which DB row to remove. */
  entryId?: number;
}

// ── DOM badge helpers (imperative, used outside React render) ─────────────────

function updateCardElBoardBadge(cardEl: HTMLDivElement, board: string) {
  try { const d = JSON.parse(cardEl.dataset.cardJson || '{}'); d.board = board; cardEl.dataset.cardJson = JSON.stringify(d); } catch {}
  cardEl.querySelector('[data-board-badge]')?.remove();
  if (board === 'commander' || board === 'partner') {
    const badge = document.createElement('div');
    badge.setAttribute('data-board-badge', '1');
    badge.title = board === 'commander' ? 'Commander' : 'Partner';
    const bg = board === 'commander' ? '#f2ca83' : '#7eb8f7';
    badge.style.cssText = `position:absolute;top:6px;left:6px;z-index:30;width:20px;height:20px;border-radius:50%;background:${bg};color:#000;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,.6);border:1px solid rgba(0,0,0,.3)`;
    badge.innerHTML = `<span class="material-symbols-outlined" style="font-size:11px;line-height:1">shield</span>`;
    cardEl.appendChild(badge);
  }
}

function updateCardElQtyBadge(cardEl: HTMLDivElement, qty: number) {
  try { const d = JSON.parse(cardEl.dataset.cardJson || '{}'); d.qty = qty; cardEl.dataset.cardJson = JSON.stringify(d); } catch {}
  const existing = cardEl.querySelector<HTMLElement>('[data-qty-badge]');
  if (qty > 1) {
    if (existing) { existing.textContent = String(qty); }
    else {
      const badge = document.createElement('div');
      badge.setAttribute('data-qty-badge', '1');
      badge.style.cssText = 'position:absolute;top:6px;right:6px;z-index:30;width:18px;height:18px;border-radius:50%;background:#f2ca83;color:#000;font-size:9px;font-weight:900;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,.5);border:1px solid rgba(0,0,0,.3)';
      badge.textContent = String(qty);
      cardEl.appendChild(badge);
    }
  } else { existing?.remove(); }
}

/**
 * Build the base card element (layers + image only), then delegate badge
 * creation to the canonical updateCardElBoardBadge / updateCardElQtyBadge
 * helpers. This eliminates the duplicated inline badge HTML.
 */
function makeCardEl(data: CardData): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'card-stack w-40 h-[240px] canvas-item';
  el.dataset.baseZ = '20';
  el.dataset.oracleId = data.oracleId || '';
  if (data.entryId) el.dataset.entryId = String(data.entryId);
  el.dataset.cardJson = JSON.stringify(data);
  const imgUrl = data.imageUrl || '';

  el.innerHTML = `
    <div class="card-layer card-layer-1"></div>
    <div class="card-layer card-layer-2"></div>
    <div class="card-layer relative overflow-hidden shadow-2xl flex flex-col" style="background:#1a1d22;border-radius:0.75rem">
      ${imgUrl
        ? `<img src="${imgUrl}" loading="lazy" class="flex-1 w-full object-cover object-top"
               onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" />
           <div class="flex-1 items-center justify-center" style="display:none">
             <span class="material-symbols-outlined text-[48px] opacity-10">playing_cards</span>
           </div>`
        : `<div class="flex-1 flex items-center justify-center">
             <span class="material-symbols-outlined text-[48px] opacity-10">playing_cards</span>
           </div>`}
    </div>`;

  // Use the canonical badge helpers — single source of truth for badge appearance
  if (data.board === 'commander' || data.board === 'partner') {
    updateCardElBoardBadge(el, data.board);
  }
  if ((data.qty ?? 1) > 1) {
    updateCardElQtyBadge(el, data.qty!);
  }

  return el;
}

/**
 * Update the image shown on an already-placed card element.
 * Works whether the card was built with an image or just a placeholder.
 */
function setCardElImage(cardEl: HTMLDivElement, imageUrl: string): void {
  // Update serialised metadata so the canvas saves the new URL
  try {
    const d = JSON.parse(cardEl.dataset.cardJson || '{}');
    d.imageUrl = imageUrl;
    cardEl.dataset.cardJson = JSON.stringify(d);
  } catch {}
  // Update DOM: if <img> already exists just change its src;
  // if only a placeholder div exists, inject an <img> in front of it.
  const existingImg = cardEl.querySelector<HTMLImageElement>('img');
  if (existingImg) {
    existingImg.src = imageUrl;
    existingImg.style.display = '';
    const ph = existingImg.nextElementSibling as HTMLElement | null;
    if (ph) ph.style.display = 'none';
  } else {
    const layers = cardEl.querySelectorAll<HTMLDivElement>('.card-layer');
    const contentLayer = layers[2]; // third .card-layer = the visual layer
    if (contentLayer) {
      contentLayer.innerHTML =
        `<img src="${imageUrl}" loading="lazy" class="flex-1 w-full object-cover object-top"
              onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" />
         <div class="flex-1 items-center justify-center" style="display:none">
           <span class="material-symbols-outlined text-[48px] opacity-10">playing_cards</span>
         </div>`;
    }
  }
}

function makeGroupEl(name: string, color: string, layoutMode = 'grid', cardsPerRow = 5, maxStack = 5): HTMLDivElement {
  const g = document.createElement('div');
  g.className = 'absolute group-container canvas-item';
  g.dataset.baseZ = '10';
  g.dataset.name = name;
  g.dataset.color = color;
  g.dataset.layoutMode = layoutMode;
  g.dataset.cardsPerRow = String(cardsPerRow);
  g.dataset.maxStack = String(maxStack);
  g.style.borderColor = color + '55';
  g.innerHTML = `
    <div class="flex items-center justify-between mb-6">
      <div class="flex items-center gap-3">
        <div class="w-3 h-3 rounded-full flex-shrink-0" style="background:${color};box-shadow:0 0 8px ${color}55"></div>
        <h3 class="font-label-md text-label-md uppercase tracking-widest font-bold" style="color:${color}">
          ${esc(name)} <span class="opacity-50 font-normal ml-1">(0)</span>
        </h3>
      </div>
      <button data-group-menu-btn class="text-on-surface-variant hover:text-primary transition-colors ml-4 flex-shrink-0">
        <span class="material-symbols-outlined text-[18px]">more_vert</span>
      </button>
    </div>
    <div class="card-list flex flex-wrap gap-2.5 min-h-[60px]"></div>`;
  return g;
}

// Re-applies the current layoutMode / cardsPerRow / maxStack settings to a group's card-list.
// Must be called whenever cards are added/removed or settings change.
function relayoutGroup(groupEl: HTMLDivElement) {
  const cardList = groupEl.querySelector<HTMLDivElement>('.card-list');
  if (!cardList) return;
  const cards = Array.from(cardList.querySelectorAll<HTMLDivElement>(':scope > .card-stack'));

  // Sync count badge in header
  const countSpan = groupEl.querySelector<HTMLElement>('h3 span');
  if (countSpan) countSpan.textContent = `(${cards.length})`;

  const mode = (groupEl.dataset.layoutMode as 'grid' | 'stack-h' | 'stack-v') || 'grid';
  const cardsPerRow = Math.max(1, parseInt(groupEl.dataset.cardsPerRow || '5', 10));
  const maxStack   = Math.max(2, parseInt(groupEl.dataset.maxStack   || '5', 10));

  const CARD_W = 160, CARD_H = 240;

  if (mode === 'grid') {
    const GAP = 10;
    const maxW = cardsPerRow * (CARD_W + GAP) - GAP;
    cardList.style.cssText = `display:flex;flex-wrap:wrap;gap:${GAP}px;min-height:60px;max-width:${maxW}px;`;
    cards.forEach(c => {
      c.style.position = 'relative';
      c.style.left = '';
      c.style.top  = '';
      c.style.zIndex  = '';
      c.style.display = '';
    });
  } else if (mode === 'stack-h') {
    // Horizontal stacking: cards fan right within each stack.
    // Once a stack reaches maxStack cards, a new row opens below it.
    // All cards are always visible.
    const H_OFFSET = 30; // px each card peeks to the right within a stack
    const V_GAP    = 20; // px between rows of stacks
    const numChunks = cards.length > 0 ? Math.ceil(cards.length / maxStack) : 1;
    const chunkW    = (Math.min(maxStack, cards.length) - 1) * H_OFFSET + CARD_W;
    const totalW    = Math.max(chunkW, CARD_W);
    const totalH    = numChunks * CARD_H + (numChunks - 1) * V_GAP;
    cardList.style.cssText = `position:relative;width:${totalW}px;height:${Math.max(totalH, CARD_H)}px;min-height:${CARD_H}px;flex-shrink:0;`;
    cards.forEach((c, i) => {
      const chunkIdx  = Math.floor(i / maxStack);
      const posInChunk = i % maxStack;
      c.style.position = 'absolute';
      c.style.left     = (posInChunk * H_OFFSET) + 'px';
      c.style.top      = (chunkIdx * (CARD_H + V_GAP)) + 'px';
      c.style.zIndex   = String(posInChunk + 1);
      c.style.display  = '';
    });
  } else { // stack-v
    // Vertical stacking: cards fan downward within each stack.
    // Once a stack reaches maxStack cards, a new column opens to the right.
    // All cards are always visible.
    const V_OFFSET = 22; // px each card peeks downward within a stack
    const H_GAP    = 16; // px between columns of stacks
    const numChunks = cards.length > 0 ? Math.ceil(cards.length / maxStack) : 1;
    const chunkH    = (Math.min(maxStack, cards.length) - 1) * V_OFFSET + CARD_H;
    const totalH    = Math.max(chunkH, CARD_H);
    const totalW    = numChunks * CARD_W + (numChunks - 1) * H_GAP;
    cardList.style.cssText = `position:relative;width:${Math.max(totalW, CARD_W)}px;height:${totalH}px;min-height:${CARD_H}px;flex-shrink:0;`;
    cards.forEach((c, i) => {
      const chunkIdx   = Math.floor(i / maxStack);
      const posInChunk = i % maxStack;
      c.style.position = 'absolute';
      c.style.left     = (chunkIdx * (CARD_W + H_GAP)) + 'px';
      c.style.top      = (posInChunk * V_OFFSET) + 'px';
      c.style.zIndex   = String(posInChunk + 1);
      c.style.display  = '';
    });
  }
}

function makeStickerEl(text: string, initWidth?: number, initHeight?: number): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'sticker canvas-item';
  el.dataset.baseZ = '30';

  const startInEdit = !text.trim();
  el.style.width = (initWidth ?? 240) + 'px';
  if (initHeight) el.style.height = initHeight + 'px';

  el.innerHTML = `
    <div class="sticker-view markdown-note text-on-surface/80 text-[12px] leading-relaxed"
         style="min-height:3.5em;${startInEdit ? 'display:none' : ''}"></div>
    <textarea rows="4" placeholder="Type a note… Use # for headings, **bold**, _italic_, - lists"
      class="sticker-textarea w-full bg-transparent resize-none outline-none text-on-surface/80 placeholder:text-on-surface-variant/25 text-[12px] leading-relaxed"
      style="${startInEdit ? '' : 'display:none'}">${text ? esc(text) : ''}</textarea>
    <button class="sticker-close" title="Remove note" style="position:absolute;top:6px;right:6px;width:20px;height:20px;border-radius:50%;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:center;cursor:pointer;opacity:0;transition:opacity 0.15s;z-index:5;padding:0;flex-shrink:0">
      <span class="material-symbols-outlined" style="font-size:12px;color:rgba(255,255,255,0.5);line-height:1">close</span>
    </button>
    <div class="resize-handle-left"  title="Drag to resize"></div>
    <div class="resize-handle-right" title="Drag to resize"></div>
    <div class="resize-handle-br"    title="Drag to resize"></div>`;

  const viewEl   = el.querySelector<HTMLDivElement>('.sticker-view')!;
  const textarea = el.querySelector<HTMLTextAreaElement>('.sticker-textarea')!;
  const closeBtn = el.querySelector<HTMLButtonElement>('.sticker-close')!;

  const renderView = (src: string) => {
    // marked.parse is synchronous in v18 when async is not set
    viewEl.innerHTML = marked.parse(src, MARKED_OPTS) as string;
  };

  const enterEdit = () => {
    viewEl.style.display = 'none';
    textarea.style.display = '';
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  };

  const enterView = () => {
    if (!textarea.value.trim()) return; // stay in edit if empty
    renderView(textarea.value);
    textarea.style.display = 'none';
    viewEl.style.display = '';
  };

  // Render initial text if any
  if (text.trim()) renderView(text);

  // Click rendered markdown → enter edit mode
  viewEl.addEventListener('click', (e) => { e.stopPropagation(); enterEdit(); });
  // Blur textarea → commit to view
  textarea.addEventListener('blur', enterView);
  // Escape → commit; Shift+Enter is natural in textarea (newline)
  textarea.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); enterView(); }
  });

  // Show/hide close button on hover (don't show while in edit mode — close button handles it)
  el.addEventListener('mouseenter', () => { closeBtn.style.opacity = '1'; });
  el.addEventListener('mouseleave', () => { closeBtn.style.opacity = '0'; });

  return el;
}

/**
 * Re-computes and applies the zoom on `.widget-body` so all content (fonts,
 * bars, spacing) scales proportionally with the widget's current pixel width.
 *
 * The `.wbz` div holds padding and carries the designer's base width.
 * zoom = currentWidth / baseWidth, clamped to [0.45, 3].
 */
function setWidgetBodyZoom(el: HTMLDivElement, overrideWidth?: number): void {
  if (!el.classList.contains('canvas-widget')) return;
  const body = el.querySelector<HTMLDivElement>('.widget-body');
  const inner = body?.querySelector<HTMLDivElement>('.wbz');
  if (!body || !inner) return;
  const baseWidth = parseInt(el.dataset.baseWidth || '220', 10);
  const currentWidth = overrideWidth ?? el.offsetWidth ?? baseWidth;
  const scale = Math.max(0.45, Math.min(3, currentWidth / baseWidth));
  inner.style.width = baseWidth + 'px';
  inner.style.zoom = String(scale);
}

/**
 * Render widget HTML into its body, wrapped in the .wbz zoom container,
 * then apply the current width-based zoom.
 */
function renderWidgetBody(
  el: HTMLDivElement,
  defId: string,
  data: WidgetData,
  instanceParams?: Record<string, number | string | boolean>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  asyncData?: any,
): void {
  const body = el.querySelector<HTMLDivElement>('.widget-body');
  if (!body) return;
  const html = WidgetRegistry.render(defId, data, instanceParams, asyncData);
  body.innerHTML = `<div class="wbz">${html}</div>`;
  setWidgetBodyZoom(el);
}

/** Fire-and-forget: if the widget def has asyncWidgetData, fetch it then re-render. */
async function renderWidgetBodyAsync(
  el: HTMLDivElement,
  defId: string,
  data: WidgetData,
  instanceParams?: Record<string, number | string | boolean>,
): Promise<void> {
  const def = WidgetRegistry.get(defId);
  if (!def?.asyncWidgetData) return;
  const params = WidgetRegistry.resolveParams(def, instanceParams);
  try {
    const asyncData = await def.asyncWidgetData(data, params);
    if (!el.isConnected) return; // widget was removed from canvas
    renderWidgetBody(el, defId, data, instanceParams, asyncData);
  } catch { /* silent — widget stays on its sync render */ }
}

function makeWidgetEl(defId: string): HTMLDivElement {
  const def = WidgetRegistry.get(defId);
  const name = def?.name || defId;
  const icon = def?.icon || 'widgets';
  const width = def?.width || 220;
  const hasParams = (def?.params?.length ?? 0) > 0;
  const el = document.createElement('div');
  el.className = 'canvas-widget canvas-item';
  el.dataset.baseZ = '25';
  el.dataset.widgetDefId = defId;
  el.dataset.baseWidth = String(width);        // base (design) width for zoom calculation
  el.style.cssText = `position:absolute;z-index:25;cursor:grab;width:${width}px;`;
  el.innerHTML = `
    <div class="widget-header" style="border-radius:0.75rem 0.75rem 0 0;overflow:hidden;">
      <span class="material-symbols-outlined" style="font-size:13px;color:rgba(242,202,131,0.55);flex-shrink:0">${icon}</span>
      <span class="widget-name">${esc(name)}</span>
      ${hasParams ? `<button class="widget-params-btn" title="Configure parameters">
        <span class="material-symbols-outlined" style="font-size:12px">tune</span>
      </button>` : ''}
      <button class="widget-close-btn" title="Remove widget">
        <span class="material-symbols-outlined" style="font-size:13px">close</span>
      </button>
    </div>
    <div class="widget-body"></div>
    <div class="resize-handle-left"  title="Drag to resize"></div>
    <div class="resize-handle-right" title="Drag to resize"></div>`;
  return el;
}

function makeDecoratorEl(defId: string): HTMLDivElement {
  const def = CardDecoratorRegistry.get(defId);
  const name = def?.name || defId;
  const icon = def?.icon || 'layers';
  const hasParams = (def?.params?.length ?? 0) > 0;
  const el = document.createElement('div');
  el.className = 'absolute canvas-decorator canvas-item';
  el.dataset.decoratorDefId = defId;
  el.dataset.baseZ = '25';
  el.style.cssText = 'position:absolute;z-index:25;cursor:grab;';
  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:6px;background:rgba(13,15,20,0.92);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,0.08);border-radius:20px;padding:5px 10px 5px 8px;box-shadow:0 2px 12px rgba(0,0,0,0.5);white-space:nowrap">
      <span class="material-symbols-outlined" style="font-size:14px;color:rgba(242,202,131,0.8);flex-shrink:0;font-variation-settings:'FILL' 1">${icon}</span>
      <span style="font-size:10px;font-weight:700;color:rgba(255,255,255,0.7);font-family:-apple-system,sans-serif;flex:1;min-width:0">${esc(name)}</span>
      ${hasParams ? `<button class="decorator-params-btn" title="Configure" style="width:18px;height:18px;border-radius:50%;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;padding:0"><span class="material-symbols-outlined" style="font-size:11px;color:rgba(255,255,255,0.4);line-height:1">tune</span></button>` : ''}
      <button class="decorator-close-btn" title="Remove overlay" style="width:18px;height:18px;border-radius:50%;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;padding:0"><span class="material-symbols-outlined" style="font-size:11px;color:rgba(255,255,255,0.4);line-height:1">close</span></button>
    </div>`;
  return el;
}

// ─── ToolbarTooltip ───────────────────────────────────────────────────────────

function ToolbarTooltip({
  label,
  shortcut,
  children,
}: {
  label: string;
  shortcut?: string;
  children: React.ReactNode;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div
      className="relative flex items-center"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      {children}
      {visible && (
        <div
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2.5 z-50 pointer-events-none flex flex-col items-center"
        >
          <div
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg shadow-2xl whitespace-nowrap"
            style={{
              background: 'rgba(20,22,27,0.96)',
              backdropFilter: 'blur(16px)',
              border: '1px solid rgba(255,255,255,0.09)',
            }}
          >
            <span className="text-[11px] font-medium text-on-surface/80 leading-none">{label}</span>
            {shortcut && (
              <kbd
                className="text-[9px] font-mono font-bold leading-none px-1.5 py-0.5 rounded"
                style={{
                  background: 'rgba(255,255,255,0.08)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  color: 'var(--color-primary, #a78bfa)',
                }}
              >
                {shortcut}
              </kbd>
            )}
          </div>
          {/* caret */}
          <div
            className="w-0 h-0"
            style={{
              borderLeft: '5px solid transparent',
              borderRight: '5px solid transparent',
              borderTop: '5px solid rgba(20,22,27,0.96)',
            }}
          />
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

type Tab = 'workshop' | 'list' | 'missing' | 'combos';

export function DeckView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const deckId = parseInt(id || '0', 10);
  const { loadLibrary, updateDeckCardCount } = useLibraryStore();
  const { toggle: toggleAI, isOpen: aiOpen } = useAIStore();

  // Deck state
  const [deck, setDeck] = useState<Deck | null>(null);
  const [deckCards, setDeckCards] = useState<DeckCardEntry[]>([]);
  const [cardDetails, setCardDetails] = useState<Record<string, Card>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [cardStatuses, setCardStatuses] = useState<Record<string, string>>({});
  const cardStatusesRef = useRef<Record<string, string>>({});

  // UI state
  const [tab, setTab] = useState<Tab>('workshop');
  const [searchOpen, setSearchOpen] = useState(false);
  const [detailOracleId, setDetailOracleId] = useState<string | null>(null);
  const [deckSettingsOpen, setDeckSettingsOpen] = useState(false);
  const [exportFlash, setExportFlash] = useState(false);
  const [exportError, setExportError] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  // Group modal state
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [groupColor, setGroupColor] = useState('#f2ca83');
  const [groupPreSelect, setGroupPreSelect] = useState<'none' | 'type' | 'oracle'>('none');
  const [groupPreSelectTypeTags, setGroupPreSelectTypeTags] = useState<string[]>([]);
  const [groupPreSelectTypeDraft, setGroupPreSelectTypeDraft] = useState('');
  const [groupPreSelectTypeOp, setGroupPreSelectTypeOp] = useState<'or' | 'and'>('or');
  const [groupPreSelectOracleTags, setGroupPreSelectOracleTags] = useState<string[]>([]);
  const [groupPreSelectOracleDraft, setGroupPreSelectOracleDraft] = useState('');
  const [groupPreSelectOracleOp, setGroupPreSelectOracleOp] = useState<'or' | 'and'>('or');

  // Group pre-select confirmation
  const [preSelectConfirm, setPreSelectConfirm] = useState<PreSelectConfirmData | null>(null);
  const [preSelectConfirmSel, setPreSelectConfirmSel] = useState<Set<HTMLDivElement>>(new Set());
  const [preSelectConfirmOpen, setPreSelectConfirmOpen] = useState<Set<number>>(new Set());

  // Group context menu
  const [groupMenu, setGroupMenu] = useState<{ top: number; left: number; groupEl: HTMLDivElement } | null>(null);

  // Card context menu (right-click on canvas cards)
  const [cardMenu, setCardMenu] = useState<{ top: number; left: number; cardEl: HTMLDivElement; oracleId: string } | null>(null);
  // Multi-select context menu
  const [multiMenu, setMultiMenu] = useState<{ top: number; left: number; selType: 'cards-only' | 'mixed' } | null>(null);

  // Selection HUD
  const [selCount, setSelCount] = useState<{ cards: number; groups: number } | null>(null);
  const [widgetPickerOpen, setWidgetPickerOpen] = useState(false);

  // Widget / overlay editor
  const [widgetEditorOpen, setWidgetEditorOpen] = useState(false);
  const [widgetEditorDef, setWidgetEditorDef] = useState<WidgetDef | CardDecoratorDef | null>(null); // null = new
  // Force re-render of the picker after save/delete
  const [widgetRegistryVersion, setWidgetRegistryVersion] = useState(0);
  const bumpWidgetVersion = () => setWidgetRegistryVersion(v => v + 1);

  // Widget param popover (gear button)
  const [widgetParamPopover, setWidgetParamPopover] = useState<{
    el: HTMLDivElement;
    defId: string;
    currentParams: Record<string, number | string | boolean>;
    top: number; left: number;
  } | null>(null);

  // Arrangements
  const [arrangements, setArrangements] = useState<Arrangement[]>([]);
  const [currentArrangementId, setCurrentArrangementId] = useState<number | null>(null);

  // Canvas refs
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const searchPanelRef = useRef<CardSearchPanelHandle>(null);

  // Canvas transform — all managed as refs so pan/zoom never triggers React re-renders
  const txRef = useRef(80), tyRef = useRef(60), scRef = useRef(1);
  // Fix #7: write zoom label directly to DOM instead of calling setState on every frame
  const zoomLabelRef = useRef<HTMLSpanElement>(null);

  // Drag / pan / rubber-band state (refs only - no re-render needed)
  const dragRef = useRef<{
    type: 'single' | 'multi';
    el?: HTMLDivElement;
    elType?: string;
    ox: number; oy: number;
    init?: Map<HTMLDivElement, { l: number; t: number }>;
    /** Set when elType === 'card-ghost': the group the card came from */
    sourceGroupEl?: HTMLDivElement;
  } | null>(null);
  /** Stores a select closure set on canvas-card mousedown; fired on first drag move,
   *  cleared on mouseup if no drag occurred (plain click → no selection). */
  const pendingSelectRef = useRef<(() => void) | null>(null);
  const panRef = useRef<{ ox: number; oy: number } | null>(null);
  const rbandRef = useRef<{ sx: number; sy: number } | null>(null);
  // Resize state — directional, separate from drag
  const resizeRef = useRef<{
    el: HTMLDivElement;
    /** 'left' = anchor right edge; 'right' = anchor left; 'bottom-right' = right+down */
    dir: 'left' | 'right' | 'bottom-right';
    startW: number;
    startH: number;
    startX: number;
    startY: number;
    /** canvas-space left value at drag start (needed for left-edge resize) */
    startLeft: number;
  } | null>(null);
  const spaceHeldRef = useRef(false);

  // Canvas interaction mode
  const canvasModeRef = useRef<'select' | 'hand'>('select');
  const [canvasMode, setCanvasMode] = useState<'select' | 'hand'>('select');

  // Always-fresh refs for quick-add shortcuts (used inside stable canvas effect)
  const handleAddStickerRef  = useRef<() => void>(() => {});
  const openGroupModalRef    = useRef<() => void>(() => {});
  const openWidgetPickerRef  = useRef<() => void>(() => {});
  const reconcileCanvasRef   = useRef<() => void>(() => {});
  const selRef = useRef<Set<HTMLDivElement>>(new Set());
  const selBoxRef = useRef<HTMLDivElement | null>(null);
  const pendingGroupFromSelRef = useRef<Set<HTMLDivElement> | null>(null);
  const spawnIdxRef = useRef(0);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout>>(null);
  const currentArrangementIdRef = useRef<number | null>(null);
  const arrangementsCacheRef = useRef<Arrangement[]>([]);

  // #23 – Undo / Redo history stacks (canvas JSON snapshots)
  const undoStackRef  = useRef<string[]>([]);
  const redoStackRef  = useRef<string[]>([]);
  const undoBytesRef          = useRef(0); // running total — avoids O(N) reduce on every push
  const decoratorDebounceRef  = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Always-current mirrors of React state for use inside stable callbacks/effects
  const deckCardsRef   = useRef<DeckCardEntry[]>([]);
  const cardDetailsRef = useRef<Record<string, Card>>({});
  useEffect(() => { deckCardsRef.current = deckCards; },   [deckCards]);
  useEffect(() => { cardDetailsRef.current = cardDetails; }, [cardDetails]);

  // oracleId → user-selected image URL (overrides the oracle-default image).
  // Persisted in canvas JSON via data-card-json.imageUrl; this ref holds the
  // in-memory version so spawnCardOnCanvas and reconcileCanvas can use it too.
  const preferredImagesRef = useRef<Record<string, string>>({});

  // ── Data loading ──────────────────────────────────────────────────────────

  const loadDeckData = useCallback(async () => {
    if (!deckId) return;
    try {
      const d = await window.libraryAPI.getDeck({ id: deckId });
      if (!d) return;
      setDeck(d);
      const cards = d.cards || [];
      setDeckCards(cards);
      deckCardsRef.current = cards; // sync ref immediately so canvas helpers see fresh data

      // Fetch card details and collection statuses in parallel — they don't depend on each other
      const oracleIds = [...new Set(cards.map(c => c.oracle_id).filter(Boolean))];
      const [detailsResult, statusesResult] = await Promise.allSettled([
        oracleIds.length ? window.cardsAPI.getCardsBatch({ oracleIds }) : Promise.resolve([]),
        window.libraryAPI.getDeckCardStatuses({ deckId }),
      ]);

      if (detailsResult.status === 'fulfilled') {
        const details = detailsResult.value as Card[];
        const map: Record<string, Card> = {};
        details.forEach(c => { map[c.oracle_id] = c; });
        setCardDetails(map);
        cardDetailsRef.current = map; // sync ref immediately

        // Patch canvas cards that were placed before card details loaded
        if (canvasRef.current) {
          canvasRef.current.querySelectorAll<HTMLDivElement>('.card-stack[data-oracle-id]').forEach(cardEl => {
            try {
              const d = JSON.parse(cardEl.dataset.cardJson || '{}');
              if (!d.imageUrl && d.oracleId) {
                const imageUrl = preferredImagesRef.current[d.oracleId] || getImageUrl(map[d.oracleId]);
                if (imageUrl) setCardElImage(cardEl, imageUrl);
              }
            } catch {}
          });
        }
      }

      if (statusesResult.status === 'fulfilled') {
        const statuses = statusesResult.value as Record<string, string>;
        cardStatusesRef.current = statuses;
        setCardStatuses(statuses);
      }

      // Race condition fix: if arrangements already loaded before deck data arrived,
      // the earlier reconcileCanvas() saw an empty deckCardsRef and skipped.
      // Now that fresh data is in the refs, populate the canvas.
      if (currentArrangementIdRef.current) {
        reconcileCanvasRef.current();
      }
    } catch (err) {
      console.error('Failed to load deck:', err);
      useToastStore.getState().push({ type: 'error', title: 'Failed to load deck', message: String(err) });
    } finally {
      setIsLoading(false);
    }
  }, [deckId]);

  useEffect(() => {
    loadLibrary();
    loadDeckData();
  }, [loadDeckData, loadLibrary]);

  // ── Canvas init ───────────────────────────────────────────────────────────

  const applyT = useCallback(() => {
    if (!canvasRef.current) return;
    canvasRef.current.style.transform = `translate3d(${txRef.current}px,${tyRef.current}px,0) scale(${scRef.current})`;
    // Fix #7: direct DOM write — no React re-render on every pan/zoom frame
    if (zoomLabelRef.current) {
      zoomLabelRef.current.textContent = Math.round(scRef.current * 100) + '%';
    }
  }, []);

  const s2c = useCallback((sx: number, sy: number) => {
    const r = viewportRef.current!.getBoundingClientRect();
    return { x: (sx - r.left - txRef.current) / scRef.current, y: (sy - r.top - tyRef.current) / scRef.current };
  }, []);

  const zoomAt = useCallback((cx: number, cy: number, f: number) => {
    const ns = Math.min(2.5, Math.max(0.2, scRef.current * f));
    const ratio = ns / scRef.current;
    txRef.current = cx - (cx - txRef.current) * ratio;
    tyRef.current = cy - (cy - tyRef.current) * ratio;
    scRef.current = ns;
    applyT();
  }, [applyT]);

  const scheduleAutoSave = useCallback(() => {
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(async () => {
      const arrId = currentArrangementIdRef.current;
      if (!arrId || !canvasRef.current) return;
      try {
        const state = serializeCanvas();
        await window.libraryAPI.saveArrangementCanvas({ id: arrId, canvasJson: JSON.stringify(state) });
      } catch (err) {
        console.error('Auto-save failed:', err);
        useToastStore.getState().push({ type: 'warning', title: 'Auto-save failed', message: 'Your canvas changes may not have been saved.' });
      }
    }, 1500);
  }, []);

  const refreshAllWidgets = useCallback((data: WidgetData) => {
    if (!canvasRef.current) return;
    canvasRef.current.querySelectorAll<HTMLDivElement>('.canvas-widget').forEach(el => {
      const defId = el.dataset.widgetDefId || '';
      const instanceParams = el.dataset.widgetParams
        ? JSON.parse(el.dataset.widgetParams) as Record<string, number | string | boolean>
        : undefined;
      renderWidgetBody(el, defId, data, instanceParams);
      renderWidgetBodyAsync(el, defId, data, instanceParams);
      // Note: widget-embedded badges are refreshed by refreshAllWidgetDecorators()
      // which is called in the same useEffect that calls refreshAllWidgets().
    });
  }, []);
  const serializeCanvas = useCallback(() => {
    const cv = canvasRef.current!;
    const state: { tx: number; ty: number; sc: number; groups: unknown[]; freeCards: unknown[]; stickers: unknown[]; widgets: unknown[]; decorators: unknown[] } = {
      tx: txRef.current, ty: tyRef.current, sc: scRef.current,
      groups: [], freeCards: [], stickers: [], widgets: [], decorators: [],
    };

    cv.querySelectorAll<HTMLDivElement>(':scope > .group-container').forEach(g => {
      const cards: unknown[] = [];
      g.querySelectorAll<HTMLDivElement>('.card-stack').forEach(c => {
        if (c.dataset.cardJson) { try { cards.push(JSON.parse(c.dataset.cardJson)); } catch {} }
      });
      state.groups.push({
        left: parseFloat(g.style.left) || 0, top: parseFloat(g.style.top) || 0,
        name: g.dataset.name || '', color: g.dataset.color || '#f2ca83', cards,
        layoutMode: g.dataset.layoutMode || 'grid',
        cardsPerRow: parseInt(g.dataset.cardsPerRow || '5', 10),
        maxStack: parseInt(g.dataset.maxStack || '5', 10),
      });
    });
    cv.querySelectorAll<HTMLDivElement>(':scope > .card-stack').forEach(c => {
      if (!c.dataset.cardJson) return;
      try { const d = JSON.parse(c.dataset.cardJson); state.freeCards.push({ ...d, left: parseFloat(c.style.left) || 0, top: parseFloat(c.style.top) || 0 }); } catch {}
    });
    cv.querySelectorAll<HTMLDivElement>(':scope > .sticker').forEach(s => {
      state.stickers.push({
        left: parseFloat(s.style.left) || 0,
        top: parseFloat(s.style.top) || 0,
        text: s.querySelector('textarea')?.value || '',
        width: s.offsetWidth || 220,
        height: s.style.height ? (parseFloat(s.style.height) || undefined) : undefined,
      });
    });
    cv.querySelectorAll<HTMLDivElement>(':scope > .canvas-widget').forEach(w => {
      state.widgets.push({
        defId: w.dataset.widgetDefId || '',
        left: parseFloat(w.style.left) || 0,
        top: parseFloat(w.style.top) || 0,
        width: w.offsetWidth || 220,
        params: w.dataset.widgetParams ? JSON.parse(w.dataset.widgetParams) : undefined,
      });
    });
    cv.querySelectorAll<HTMLDivElement>(':scope > .canvas-decorator').forEach(d => {
      state.decorators.push({
        defId: d.dataset.decoratorDefId || '',
        left: parseFloat(d.style.left) || 0,
        top: parseFloat(d.style.top) || 0,
        params: d.dataset.decoratorParams ? JSON.parse(d.dataset.decoratorParams) : undefined,
      });
    });
    return state;
  }, []);

  // Push a snapshot to undo stack before a canvas mutation.
  // Capped at 50 entries AND ~2 MB total to avoid unbounded memory growth on
  // large canvases where each snapshot can be several KB.
  const UNDO_MAX_ENTRIES = 50;
  const UNDO_MAX_BYTES   = 2 * 1024 * 1024; // 2 MB
  const pushUndoSnapshot = useCallback(() => {
    if (!canvasRef.current) return;
    const snap = JSON.stringify(serializeCanvas());
    undoStackRef.current.push(snap);
    undoBytesRef.current += snap.length;
    // Trim by entry count
    if (undoStackRef.current.length > UNDO_MAX_ENTRIES) {
      undoBytesRef.current -= undoStackRef.current.shift()!.length;
    }
    // Trim by total byte size (incrementally tracked — no reduce)
    while (undoBytesRef.current > UNDO_MAX_BYTES && undoStackRef.current.length > 1) {
      undoBytesRef.current -= undoStackRef.current.shift()!.length;
    }
    redoStackRef.current = [];
  }, [serializeCanvas]);

  function hitTestRect(el: HTMLDivElement, x1: number, y1: number, x2: number, y2: number) {
    const l = parseFloat(el.style.left), t = parseFloat(el.style.top);
    return l < x2 && (l + el.offsetWidth) > x1 && t < y2 && (t + el.offsetHeight) > y1;
  }

  function hitTest(me: MouseEvent, el: HTMLElement) {
    const r = el.getBoundingClientRect();
    return me.clientX > r.left && me.clientX < r.right && me.clientY > r.top && me.clientY < r.bottom;
  }

  const clearSel = useCallback(() => {
    selRef.current.forEach(el => el.classList.remove('selected'));
    selRef.current.clear();
    setSelCount(null);
  }, []);

  const selectEl = useCallback((el: HTMLDivElement) => {
    el.classList.add('selected');
    selRef.current.add(el);
  }, []);

  // Sync selection count to React state — call after any batch of selectEl/clearSel ops.
  const syncSelCount = useCallback(() => {
    const sel = Array.from(selRef.current);
    if (sel.length === 0) { setSelCount(null); return; }

    const getQty = (el: HTMLDivElement) => {
      try { return Math.max(1, Number(JSON.parse(el.dataset.cardJson || '{}').qty) || 1); }
      catch { return 1; }
    };

    // Free selected cards
    let cards = 0;
    sel.filter(el => el.classList.contains('card-stack'))
       .forEach(el => { cards += getQty(el); });

    // Cards inside selected groups (respect per-card qty)
    const selectedGroups = sel.filter(el => el.classList.contains('group-container'));
    selectedGroups.forEach(g => {
      g.querySelectorAll<HTMLDivElement>('.card-list > .card-stack')
       .forEach(el => { cards += getQty(el); });
    });

    setSelCount({ cards, groups: selectedGroups.length });
  }, []);

  // Switch between select / hand mode (updates both ref for event handlers and state for UI)
  const switchMode = useCallback((mode: 'select' | 'hand') => {
    canvasModeRef.current = mode;
    setCanvasMode(mode);
    if (viewportRef.current) {
      viewportRef.current.style.cursor = mode === 'hand' ? 'grab' : '';
    }
  }, []);

  // Make card clickable (open detail on click without drag)
  const makeCardClickable = useCallback((el: HTMLDivElement) => {
    let pressX = 0, pressY = 0;
    el.addEventListener('mousedown', (e: MouseEvent) => { pressX = e.clientX; pressY = e.clientY; }, { capture: false });
    el.addEventListener('mouseup', (e: MouseEvent) => {
      if (Math.hypot(e.clientX - pressX, e.clientY - pressY) < 8 && el.dataset.oracleId) {
        setDetailOracleId(el.dataset.oracleId);
      }
    }, { capture: false });
  }, []);

  /**
   * Attach left / right (and optional bottom-right) resize handle listeners.
   * Uses resizeRef (stable) so no deps needed beyond the ref itself.
   */
  const attachResizeHandlers = useCallback((el: HTMLDivElement, kind: 'widget' | 'sticker') => {
    const onDown = (dir: 'left' | 'right' | 'bottom-right') => (e: MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      resizeRef.current = {
        el, dir,
        startW: el.offsetWidth,
        startH: el.offsetHeight,
        startX: e.clientX,
        startY: e.clientY,
        startLeft: parseFloat(el.style.left) || 0,
      };
    };
    el.querySelector<HTMLDivElement>('.resize-handle-left')?.addEventListener('mousedown', onDown('left'));
    el.querySelector<HTMLDivElement>('.resize-handle-right')?.addEventListener('mousedown', onDown('right'));
    if (kind === 'sticker') {
      el.querySelector<HTMLDivElement>('.resize-handle-br')?.addEventListener('mousedown', onDown('bottom-right'));
    }
  }, []);

  // Attach right-click context menu to any canvas item (card, group, or sticker).
  // Shows the right menu based on the current multi-selection composition.
  const attachContextMenu = useCallback((el: HTMLDivElement) => {
    el.addEventListener('contextmenu', (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      // If this element is not already in the selection, select it alone
      if (!selRef.current.has(el)) {
        clearSel();
        selectEl(el);
        syncSelCount();
      }
      const sel = Array.from(selRef.current);
      const wvr = viewportRef.current!.getBoundingClientRect();
      const pos = { top: e.clientY - wvr.top, left: e.clientX - wvr.left };
      if (sel.length === 1 && sel[0].classList.contains('card-stack') && sel[0].dataset.oracleId) {
        // Single card → full card context menu
        setMultiMenu(null);
        setCardMenu({ ...pos, cardEl: sel[0] as HTMLDivElement, oracleId: sel[0].dataset.oracleId! });
      } else if (sel.length > 1) {
        // Multi-select → determine menu variant
        setCardMenu(null);
        const hasNonCard = sel.some(s => !s.classList.contains('card-stack'));
        setMultiMenu({ ...pos, selType: hasNonCard ? 'mixed' : 'cards-only' });
      }
    });
  }, [clearSel, selectEl, syncSelCount]);

  // Make element draggable on canvas.
  // Cards that are currently inside a group use a threshold + ghost approach so
  // a plain click never ejects the card. All other elements (canvas cards, groups,
  // stickers, widgets) use the existing immediate-drag path.
  const makeItemDraggable = useCallback((el: HTMLDivElement, elType: string) => {
    el.dataset.elType = elType;
    el.style.cursor = 'grab';
    el.addEventListener('mousedown', (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('button, a, input, textarea, .sticker-view, .resize-handle-left, .resize-handle-right, .resize-handle-br')) return;

      // ── Card inside a group: threshold + ghost drag ───────────────────────
      // Only cards use this path; groups/stickers/widgets still drag immediately.
      const parentGroup = elType === 'card'
        ? el.closest<HTMLDivElement>('.group-container')
        : null;

      if (parentGroup) {
        // stopPropagation prevents the bubble reaching the group's own drag listener
        // (which would start moving the group immediately). makeCardClickable is also
        // on this same element so it still fires — stopPropagation only blocks parents.
        e.stopPropagation();
        const startX = e.clientX, startY = e.clientY;

        function onGroupMove(me: MouseEvent) {
          if (Math.hypot(me.clientX - startX, me.clientY - startY) <= 8) return;
          document.removeEventListener('mousemove', onGroupMove);
          document.removeEventListener('mouseup', onGroupUp);

          // Snapshot the card's screen rect BEFORE any DOM change
          const cr  = el.getBoundingClientRect();
          const wvr = viewportRef.current!.getBoundingClientRect();
          const left = (cr.left - wvr.left - txRef.current) / scRef.current;
          const top  = (cr.top  - wvr.top  - tyRef.current) / scRef.current;

          // Insert an invisible slot placeholder that holds the card's exact DOM
          // position. This is the source of truth for "same-group" detection and
          // for restoring the card's position if dropped back.
          const slot = document.createElement('div');
          slot.dataset.ghostSlot = 'true';
          slot.style.cssText =
            `width:${el.offsetWidth}px;height:${el.offsetHeight}px;` +
            `flex-shrink:0;pointer-events:none;opacity:0;`;
          el.parentElement!.insertBefore(slot, el);

          // Drag started — select this card (it's now a canvas item)
          clearSel();
          selectEl(el);
          syncSelCount();

          // Detach card from group and promote to canvas as the draggable ghost.
          // The card itself becomes the ghost (no clone) so all listeners are intact.
          el.remove();
          el.querySelectorAll<HTMLElement>('.card-layer-1,.card-layer-2')
            .forEach(l => l.style.display = 'none');
          el.classList.add('canvas-item');
          el.dataset.baseZ = '500';

          // Place at rest state first (no lift) so the transition has a starting point
          el.style.cssText =
            `position:absolute;left:${left}px;top:${top}px;z-index:500;cursor:grabbing;` +
            `transform:scale(1);opacity:1;will-change:transform;` +
            `transition:transform 0.18s cubic-bezier(0.2,0,0,1),opacity 0.18s ease;`;
          canvasRef.current!.appendChild(el);
          canvasRef.current!.classList.add('dragging-active');

          // Double-rAF: first frame commits the initial paint, second frame triggers
          // the lift so the browser actually runs the CSS transition.
          requestAnimationFrame(() => requestAnimationFrame(() => {
            el.classList.add('card-lifting');
            el.style.transform = 'scale(1.06) rotate(2deg)';
            el.style.opacity   = '0.92';
          }));

          // Store the slot reference on the element so mouseUp can find it
          (el as any)._ghostSlot = slot;

          const cp = s2c(me.clientX, me.clientY);
          dragRef.current = {
            type: 'single',
            el,
            elType: 'card-ghost',
            ox: cp.x - left,
            oy: cp.y - top,
            sourceGroupEl: parentGroup!,
          };
        }

        function onGroupUp() {
          document.removeEventListener('mousemove', onGroupMove);
          document.removeEventListener('mouseup', onGroupUp);
          // Threshold not reached → plain click → card stays in group unchanged.
        }

        document.addEventListener('mousemove', onGroupMove);
        document.addEventListener('mouseup', onGroupUp);
        return; // ← skip the immediate-drag path below
      }

      // ── Canvas element: immediate drag ────────────────────────────────────
      e.stopPropagation(); e.preventDefault();
      el.style.cursor = 'grabbing';

      if (selRef.current.has(el) && selRef.current.size > 1) {
        const cp = s2c(e.clientX, e.clientY);
        const init = new Map<HTMLDivElement, { l: number; t: number }>();
        selRef.current.forEach(s => {
          const l = parseFloat(s.style.left) || s.offsetLeft;
          const t = parseFloat(s.style.top) || s.offsetTop;
          s.style.left = l + 'px'; s.style.top = t + 'px'; s.style.zIndex = '500';
          if (s.classList.contains('card-stack')) s.style.willChange = 'transform';
          init.set(s, { l, t });
        });
        canvasRef.current?.classList.add('dragging-active');
        dragRef.current = { type: 'multi', ox: cp.x, oy: cp.y, init };
      } else {
        const left = parseFloat(el.style.left) || el.offsetLeft;
        const top = parseFloat(el.style.top) || el.offsetTop;
        el.style.left = left + 'px'; el.style.top = top + 'px';
        const cp = s2c(e.clientX, e.clientY);
        dragRef.current = { type: 'single', el, elType, ox: cp.x - left, oy: cp.y - top };

        if (e.shiftKey) {
          // Shift+click: add to selection immediately (enables multi-drag on next mousedown)
          selectEl(el); syncSelCount();
        } else {
          // Plain click: clear selection now but defer selecting this card until
          // the user actually drags. A click without movement never selects.
          clearSel();
          pendingSelectRef.current = () => { selectEl(el); syncSelCount(); };
        }

        el.style.zIndex = '500';
        if (elType === 'card') {
          el.style.willChange = 'transform';
          canvasRef.current?.classList.add('dragging-active');
          el.style.transition = 'transform 0.18s cubic-bezier(0.2,0,0,1), opacity 0.18s ease';
          requestAnimationFrame(() => requestAnimationFrame(() => {
            el.classList.add('card-lifting');
            el.style.transform = 'scale(1.06) rotate(2deg)';
            el.style.opacity   = '0.92';
          }));
        }
      }
    });

    // Double-click on a canvas card selects it (group cards are skipped).
    el.addEventListener('dblclick', () => {
      if (el.closest('.group-container')) return; // card is inside a group — not a canvas item
      clearSel();
      selectEl(el);
      syncSelCount();
    });
  }, [s2c, clearSel, selectEl, syncSelCount]);

  // ejectCard must be declared BEFORE dropIntoGroup — dropIntoGroup lists it as a dep.
  const ejectCard = useCallback((cardEl: HTMLDivElement, e: MouseEvent) => {
    const parentGroup = cardEl.closest<HTMLDivElement>('.group-container');
    const cr = cardEl.getBoundingClientRect();
    const wvr = viewportRef.current!.getBoundingClientRect();
    const left = (cr.left - wvr.left - txRef.current) / scRef.current;
    const top = (cr.top - wvr.top - tyRef.current) / scRef.current;
    cardEl.remove();
    if (parentGroup) relayoutGroup(parentGroup);
    cardEl.querySelectorAll<HTMLElement>('.card-layer-1,.card-layer-2').forEach(l => l.style.display = 'none');
    cardEl.style.cssText = `position:absolute;left:${left}px;top:${top}px;z-index:20;`;
    cardEl.dataset.baseZ = '20';
    cardEl.classList.add('canvas-item');
    canvasRef.current!.appendChild(cardEl);
    makeItemDraggable(cardEl, 'card');
    clearSel(); selectEl(cardEl); syncSelCount();
    const cp = s2c(e.clientX, e.clientY);
    dragRef.current = { type: 'single', el: cardEl, elType: 'card', ox: cp.x - left, oy: cp.y - top };
    cardEl.style.zIndex = '500';
    cardEl.style.willChange = 'transform';
    cardEl.classList.add('card-lifting');
    canvasRef.current?.classList.add('dragging-active');
    cardEl.style.transform = 'scale(1.06) rotate(2deg)';
    e.stopPropagation(); e.preventDefault();
  }, [s2c, makeItemDraggable, clearSel, selectEl, syncSelCount]);

  const dropIntoGroup = useCallback((cardEl: HTMLDivElement, groupEl: HTMLDivElement) => {
    cardEl.style.cssText = ''; cardEl.style.cursor = 'grab';
    cardEl.classList.remove('canvas-item', 'selected');
    selRef.current.delete(cardEl);
    syncSelCount();
    cardEl.querySelectorAll<HTMLElement>('.card-layer-1,.card-layer-2').forEach(l => l.style.display = '');
    canvasRef.current!.removeChild(cardEl);
    groupEl.querySelector('.card-list')!.appendChild(cardEl);
    relayoutGroup(groupEl);
    // Drag-out is handled by makeItemDraggable (already on the card from canvas spawn).
    // makeCardClickable handles click → open detail panel.
    makeCardClickable(cardEl);
  }, [ejectCard, makeCardClickable, syncSelCount]);

  const spawnCardOnCanvas = useCallback((card: Card, qty = 1, board = 'main', entryId?: number) => {
    const r = viewportRef.current!.getBoundingClientRect();
    const cp = s2c(r.left + r.width / 2, r.top + r.height / 2);
    const offset = spawnIdxRef.current * 28;
    spawnIdxRef.current = (spawnIdxRef.current + 1) % 9;
    const data: CardData = {
      oracleId: card.oracle_id || '',
      name: card.name || '',
      typeLine: card.type_line || '',
      manaCost: card.mana_cost || '',
      imageUrl: preferredImagesRef.current[card.oracle_id] || getImageUrl(card),
      qty,
      board,
      entryId,
    };
    const el = makeCardEl(data);
    el.style.cssText = `position:absolute;left:${cp.x - 80 + offset}px;top:${cp.y - 120 + offset}px;z-index:20;cursor:grab;`;
    el.querySelectorAll<HTMLElement>('.card-layer-1,.card-layer-2').forEach(l => l.style.display = 'none');
    canvasRef.current!.appendChild(el);
    makeItemDraggable(el, 'card');
    clearSel(); selectEl(el); syncSelCount();
    makeCardClickable(el);
    attachContextMenu(el);
    scheduleAutoSave();
  }, [s2c, makeItemDraggable, clearSel, selectEl, syncSelCount, makeCardClickable, attachContextMenu, scheduleAutoSave]);

  // ── Card badge / overlay helpers (declared early so spawnWidgetOnCanvas can depend on them) ──

  /** Build OverlayCardData for a given oracleId from current card refs. */
  const buildOverlayCardData = useCallback((oracleId: string): OverlayCardData => {
    const det = cardDetailsRef.current[oracleId];
    const ci = det?.color_identity;
    return {
      oracleId,
      name: det?.name || oracleId,
      typeLine: det?.type_line || '',
      manaCost: det?.mana_cost || '',
      cmc: det?.cmc || 0,
      colorIdentity: Array.isArray(ci) ? (ci as string[])
        : typeof ci === 'string' && ci ? (ci as string).split('').filter((c: string) => 'WUBRG'.includes(c))
        : [],
      edhrecRank: det?.full_data?.edhrec_rank,
      collectionStatus: cardStatusesRef.current[oracleId],
    };
  }, []);

  /**
   * Apply (or remove) card badges controlled by a widget that has `def.decorator`.
   * Reads `show_badges` from the widget's current params; removes all existing
   * badges for this widget's defId first, then re-renders if enabled.
   */
  const applyWidgetDecorators = useCallback((widgetEl: HTMLDivElement) => {
    const defId = widgetEl.dataset.widgetDefId;
    if (!defId) return;
    const def = WidgetRegistry.get(defId);
    if (!def?.decorator) return;

    const cv = canvasRef.current;
    if (!cv) return;

    const instanceParams = widgetEl.dataset.widgetParams
      ? JSON.parse(widgetEl.dataset.widgetParams) as Record<string, number | string | boolean>
      : {};
    const resolved = WidgetRegistry.resolveParams(def, instanceParams);

    // Clean up previous badges from this widget
    cv.querySelectorAll(`[data-widget-badge="${CSS.escape(defId)}"]`).forEach(b => b.remove());

    if (!resolved['show_badges']) return;

    const cardEls = Array.from(cv.querySelectorAll<HTMLDivElement>('[data-oracle-id]'));
    const cardDataList: OverlayCardData[] = cardEls.map(el => buildOverlayCardData(el.dataset.oracleId!));

    // Sync render — immediate from local DB data
    cardEls.forEach((el, i) => {
      try {
        // eslint-disable-next-line no-new-func
        const fn = new Function('card', 'params', def.decorator!.code) as (c: OverlayCardData, p: Record<string, number | string | boolean>) => string;
        const html = fn(cardDataList[i], resolved as Record<string, number | string | boolean>);
        if (!html) return;
        const badge = document.createElement('div');
        badge.setAttribute('data-widget-badge', defId);
        badge.style.cssText = overlayWrapperCss(def.decorator!.anchor);
        badge.innerHTML = html;
        el.appendChild(badge);
      } catch { /* ignore render errors */ }
    });

    // Async enrichment (e.g. EDHREC % from network)
    if (def.decorator.asyncLoad) {
      def.decorator.asyncLoad(cardDataList).then((enriched: Map<string, Partial<OverlayCardData>>) => {
        enriched.forEach((partial, oracleId) => {
          const cardEl = cv.querySelector<HTMLDivElement>(`[data-oracle-id="${CSS.escape(oracleId)}"]`);
          if (!cardEl) return;
          cardEl.querySelector(`[data-widget-badge="${CSS.escape(defId)}"]`)?.remove();
          const enrichedCard = { ...buildOverlayCardData(oracleId), ...partial };
          try {
            // eslint-disable-next-line no-new-func
            const fn = new Function('card', 'params', def.decorator!.code) as (c: OverlayCardData, p: Record<string, number | string | boolean>) => string;
            const html = fn(enrichedCard, resolved as Record<string, number | string | boolean>);
            if (!html) return;
            const badge = document.createElement('div');
            badge.setAttribute('data-widget-badge', defId);
            badge.style.cssText = overlayWrapperCss(def.decorator!.anchor);
            badge.innerHTML = html;
            cardEl.appendChild(badge);
          } catch { /* ignore */ }
        });
      }).catch(() => {});
    }
  }, [buildOverlayCardData]);

  /** Re-apply badges for every widget-with-decorator on the canvas. */
  const refreshAllWidgetDecorators = useCallback(() => {
    if (!canvasRef.current) return;
    canvasRef.current.querySelectorAll<HTMLDivElement>(':scope > .canvas-widget').forEach(w => {
      applyWidgetDecorators(w);
    });
  }, [applyWidgetDecorators]);

  const spawnWidgetOnCanvas = useCallback((defId: string) => {
    const def = WidgetRegistry.get(defId);
    // Build default instance params from the def's param definitions
    const defaultParams: Record<string, number | string | boolean> | undefined =
      def?.params?.length
        ? Object.fromEntries(def.params.map(p => [p.key, p.default]))
        : undefined;

    const r = viewportRef.current!.getBoundingClientRect();
    const cp = s2c(r.left + r.width / 2, r.top + r.height / 2);
    const el = makeWidgetEl(defId);
    el.style.left = (cp.x - 110) + 'px';
    el.style.top  = (cp.y - 60) + 'px';
    if (defaultParams) el.dataset.widgetParams = JSON.stringify(defaultParams);
    canvasRef.current!.appendChild(el);
    makeItemDraggable(el, 'widget');
    const rawGrps = readCanvasGroups(canvasRef.current!);
    const data = buildWidgetDataFromState(deckCardsRef.current, cardDetailsRef.current, rawGrps, cardStatusesRef.current);
    renderWidgetBody(el, defId, data, defaultParams);
    renderWidgetBodyAsync(el, defId, data, defaultParams);
    applyWidgetDecorators(el);
    el.querySelector<HTMLButtonElement>('.widget-close-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      // Remove any card badges owned by this widget before removing the panel
      canvasRef.current?.querySelectorAll(`[data-widget-badge="${CSS.escape(defId)}"]`).forEach(b => b.remove());
      el.remove();
      scheduleAutoSave();
    });
    el.querySelector<HTMLButtonElement>('.widget-params-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const currentParams = el.dataset.widgetParams
        ? JSON.parse(el.dataset.widgetParams) as Record<string, number | string | boolean>
        : {};
      const rect = el.getBoundingClientRect();
      const wvr = viewportRef.current!.getBoundingClientRect();
      setWidgetParamPopover({ el, defId, currentParams, top: rect.bottom - wvr.top + 4, left: rect.left - wvr.left });
    });
    attachResizeHandlers(el, 'widget');
    scheduleAutoSave();
  }, [s2c, makeItemDraggable, attachResizeHandlers, scheduleAutoSave, applyWidgetDecorators]);

  // ── Standalone decorator pill helpers ────────────────────────────────────────

  /** Apply (or refresh) overlays for one decorator pill onto all canvas cards. */
  const applyDecoratorOverlays = useCallback((decoratorEl: HTMLDivElement) => {
    const defId = decoratorEl.dataset.decoratorDefId;
    if (!defId) return;
    const def = CardDecoratorRegistry.get(defId);
    if (!def) return;
    const cv = canvasRef.current;
    if (!cv) return;

    const instanceParams = decoratorEl.dataset.decoratorParams
      ? JSON.parse(decoratorEl.dataset.decoratorParams) as Record<string, number | string | boolean>
      : undefined;

    const cardEls = Array.from(cv.querySelectorAll<HTMLDivElement>('[data-oracle-id]'));
    const cardDataList: OverlayCardData[] = cardEls.map(el => buildOverlayCardData(el.dataset.oracleId!));

    // Sync render — immediate rank/data from local DB
    cardEls.forEach((el, i) => {
      el.querySelector(`[data-decorator-overlay="${CSS.escape(defId)}"]`)?.remove();
      const html = CardDecoratorRegistry.render(defId, cardDataList[i], instanceParams);
      if (!html) return;
      const overlayEl = document.createElement('div');
      overlayEl.setAttribute('data-decorator-overlay', defId);
      overlayEl.style.cssText = overlayWrapperCss(def.anchor);
      overlayEl.innerHTML = html;
      el.appendChild(overlayEl);
    });

    // Async enrichment (e.g. EDHREC % from network)
    if (def.asyncLoad) {
      def.asyncLoad(cardDataList).then(enriched => {
        enriched.forEach((partial, oracleId) => {
          const cardEl = cv.querySelector<HTMLDivElement>(`[data-oracle-id="${CSS.escape(oracleId)}"]`);
          if (!cardEl) return;
          cardEl.querySelector(`[data-decorator-overlay="${CSS.escape(defId)}"]`)?.remove();
          const enrichedCard = { ...buildOverlayCardData(oracleId), ...partial };
          const html = CardDecoratorRegistry.render(defId, enrichedCard, instanceParams);
          if (!html) return;
          const overlayEl = document.createElement('div');
          overlayEl.setAttribute('data-decorator-overlay', defId);
          overlayEl.style.cssText = overlayWrapperCss(def.anchor);
          overlayEl.innerHTML = html;
          cardEl.appendChild(overlayEl);
        });
      }).catch(() => {});
    }
  }, [buildOverlayCardData]);

  /** Remove all overlay elements placed by a given decorator. */
  const removeDecoratorOverlays = useCallback((defId: string) => {
    if (!canvasRef.current) return;
    canvasRef.current.querySelectorAll(`[data-decorator-overlay="${CSS.escape(defId)}"]`).forEach(el => el.remove());
  }, []);

  /** Re-apply all active decorator pills (called when card data changes). */
  const refreshAllDecoratorOverlays = useCallback(() => {
    if (!canvasRef.current) return;
    canvasRef.current.querySelectorAll<HTMLDivElement>(':scope > .canvas-decorator').forEach(d => {
      applyDecoratorOverlays(d);
    });
  }, [applyDecoratorOverlays]);

  /** Bind close / params buttons on a decorator pill element. */
  const attachDecoratorHandlers = useCallback((el: HTMLDivElement) => {
    el.querySelector<HTMLButtonElement>('.decorator-close-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = el.dataset.decoratorDefId || '';
      removeDecoratorOverlays(id);
      el.remove();
      scheduleAutoSave();
    });
    // Params button: reserved for future popover; no-op for now
  }, [removeDecoratorOverlays, scheduleAutoSave]);

  /** Place a new decorator pill at the top-center of the viewport. */
  const spawnDecoratorOnCanvas = useCallback((defId: string) => {
    if (!CardDecoratorRegistry.get(defId)) return;
    const r = viewportRef.current!.getBoundingClientRect();
    const cp = s2c(r.left + r.width / 2, r.top + 50);
    const el = makeDecoratorEl(defId);
    el.style.left = (cp.x - 70) + 'px';
    el.style.top  = cp.y + 'px';
    canvasRef.current!.appendChild(el);
    makeItemDraggable(el, 'decorator');
    applyDecoratorOverlays(el);
    attachDecoratorHandlers(el);
    scheduleAutoSave();
  }, [s2c, makeItemDraggable, applyDecoratorOverlays, attachDecoratorHandlers, scheduleAutoSave]);

  // Restore canvas from JSON state
  const restoreCanvas = useCallback((state: {
    tx?: number; ty?: number; sc?: number;
    groups?: { left: number; top: number; name: string; color: string; cards: CardData[]; layoutMode?: string; cardsPerRow?: number; maxStack?: number }[];
    freeCards?: (CardData & { left: number; top: number })[];
    stickers?: { left: number; top: number; text: string; width?: number; height?: number }[];
    widgets?: { defId: string; left: number; top: number; width?: number; params?: Record<string, number | string | boolean> }[];
    decorators?: { defId: string; left: number; top: number; params?: Record<string, number | string | boolean> }[];
  }) => {
    const cv = canvasRef.current!;
    Array.from(cv.children).forEach(el => { if ((el as HTMLElement).id !== 'sel-box') el.remove(); });
    txRef.current = state.tx ?? 80; tyRef.current = state.ty ?? 60; scRef.current = state.sc ?? 1;
    applyT();

    // Only render cards still present in the deck (filter ghost cards from old saves).
    // Prefer matching by entryId (unique per instance) when available; fall back to
    // oracle_id for legacy saves that predate the entryId field.
    const deckIds      = new Set(deckCardsRef.current.map(dc => dc.oracle_id));
    const deckEntryIds = new Set(deckCardsRef.current.map(dc => dc.id));
    const hasIds  = deckIds.size > 0; // false only during initial load race — allow all then

    for (const g of state.groups || []) {
      const el = makeGroupEl(g.name, g.color, g.layoutMode || 'grid', g.cardsPerRow ?? 5, g.maxStack ?? 5);
      el.style.cssText = `left:${g.left}px;top:${g.top}px;z-index:10;border-color:${g.color}55;`;
      const cardList = el.querySelector('.card-list')!;
      for (const c of g.cards || []) {
        // entryId present → check specific instance; else fall back to oracle_id membership
        if (hasIds && c.entryId ? !deckEntryIds.has(c.entryId) : !deckIds.has(c.oracleId)) continue; // skip removed cards
        const cardEl = makeCardEl(c);
        cardEl.style.cssText = ''; cardEl.style.cursor = 'grab';
        cardEl.classList.remove('canvas-item');
        cardEl.querySelectorAll<HTMLElement>('.card-layer-1,.card-layer-2').forEach(l => l.style.display = '');
        cardList.appendChild(cardEl);
        makeItemDraggable(cardEl, 'card'); // threshold + ghost mechanic, same as live-dragged cards
        makeCardClickable(cardEl);
        attachContextMenu(cardEl);
      }
      relayoutGroup(el);
      cv.appendChild(el);
      makeItemDraggable(el, 'group');
      attachContextMenu(el);
      // Group menu button
      el.querySelector<HTMLButtonElement>('[data-group-menu-btn]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const wvr = viewportRef.current!.getBoundingClientRect();
        setGroupMenu({ top: r.top - wvr.top, left: r.right - wvr.left + 6, groupEl: el });
      });
    }

    for (const c of state.freeCards || []) {
      if (hasIds && (c.entryId ? !deckEntryIds.has(c.entryId) : !deckIds.has(c.oracleId))) continue; // skip removed cards
      const el = makeCardEl(c);
      el.style.cssText = `position:absolute;left:${c.left}px;top:${c.top}px;z-index:20;cursor:grab;`;
      el.querySelectorAll<HTMLElement>('.card-layer-1,.card-layer-2').forEach(l => l.style.display = 'none');
      cv.appendChild(el);
      makeItemDraggable(el, 'card');
      makeCardClickable(el);
      attachContextMenu(el);
    }

    for (const s of state.stickers || []) {
      const el = makeStickerEl(s.text || '', s.width, s.height);
      el.style.left = s.left + 'px'; el.style.top = s.top + 'px';
      cv.appendChild(el);
      makeItemDraggable(el, 'sticker');
      attachContextMenu(el);
      el.querySelector<HTMLButtonElement>('.sticker-close')?.addEventListener('click', () => { el.remove(); scheduleAutoSave(); });
      attachResizeHandlers(el, 'sticker');
    }
    const restoreWidgetGroups = readCanvasGroups(cv);
    for (const w of state.widgets || []) {
      if (!WidgetRegistry.get(w.defId)) continue;
      const el = makeWidgetEl(w.defId);
      el.style.left = w.left + 'px';
      el.style.top = w.top + 'px';
      if (w.width) el.style.width = w.width + 'px';
      if (w.params) el.dataset.widgetParams = JSON.stringify(w.params);
      cv.appendChild(el);
      makeItemDraggable(el, 'widget');
      const data = buildWidgetDataFromState(deckCardsRef.current, cardDetailsRef.current, restoreWidgetGroups, cardStatusesRef.current);
      renderWidgetBody(el, w.defId, data, w.params);
      renderWidgetBodyAsync(el, w.defId, data, w.params);
      applyWidgetDecorators(el);
      el.querySelector<HTMLButtonElement>('.widget-close-btn')?.addEventListener('click', (evnt) => {
        evnt.stopPropagation();
        const wDefId = el.dataset.widgetDefId || '';
        canvasRef.current?.querySelectorAll(`[data-widget-badge="${CSS.escape(wDefId)}"]`).forEach(b => b.remove());
        el.remove();
        scheduleAutoSave();
      });
      el.querySelector<HTMLButtonElement>('.widget-params-btn')?.addEventListener('click', (evnt) => {
        evnt.stopPropagation();
        const defId = el.dataset.widgetDefId || '';
        const currentParams = el.dataset.widgetParams
          ? JSON.parse(el.dataset.widgetParams) as Record<string, number | string | boolean>
          : {};
        const r = el.getBoundingClientRect();
        const wvr = viewportRef.current!.getBoundingClientRect();
        setWidgetParamPopover({ el, defId, currentParams, top: r.bottom - wvr.top + 4, left: r.left - wvr.left });
      });
      attachResizeHandlers(el, 'widget');
    }
    for (const d of state.decorators || []) {
      if (!CardDecoratorRegistry.get(d.defId)) continue;
      const el = makeDecoratorEl(d.defId);
      el.style.left = d.left + 'px';
      el.style.top  = d.top  + 'px';
      if (d.params) el.dataset.decoratorParams = JSON.stringify(d.params);
      cv.appendChild(el);
      makeItemDraggable(el, 'decorator');
      applyDecoratorOverlays(el);
      attachDecoratorHandlers(el);
    }
  }, [applyT, ejectCard, makeItemDraggable, makeCardClickable, attachContextMenu, attachResizeHandlers, scheduleAutoSave, applyDecoratorOverlays, attachDecoratorHandlers, applyWidgetDecorators]);

  // Eject a card from its group onto the free canvas without starting a drag.
  // Used when deleting a group — cards survive, just become free items.
  const placeCardFree = useCallback((cardEl: HTMLDivElement) => {
    const parentGroup = cardEl.closest<HTMLDivElement>('.group-container');
    const cr  = cardEl.getBoundingClientRect();
    const wvr = viewportRef.current!.getBoundingClientRect();
    const left = (cr.left - wvr.left - txRef.current) / scRef.current;
    const top  = (cr.top  - wvr.top  - tyRef.current) / scRef.current;
    cardEl.remove();
    if (parentGroup) relayoutGroup(parentGroup);
    cardEl.querySelectorAll<HTMLElement>('.card-layer-1,.card-layer-2').forEach(l => l.style.display = 'none');
    cardEl.style.cssText = `position:absolute;left:${left}px;top:${top}px;z-index:20;cursor:grab;`;
    cardEl.dataset.baseZ = '20';
    cardEl.classList.add('canvas-item');
    canvasRef.current!.appendChild(cardEl);
    makeItemDraggable(cardEl, 'card');
    makeCardClickable(cardEl);
  }, [makeItemDraggable, makeCardClickable]);

  // Reconcile canvas with deckCards: spawn any deck card missing from the canvas.
  // Called whenever the arrangement switches so every arrangement always shows
  // the full deck. Newly added cards naturally land on the current arrangement
  // via spawnCardOnCanvas; other arrangements pick them up on next switch.
  const reconcileCanvas = useCallback(() => {
    if (!canvasRef.current) return;
    const cv  = canvasRef.current;
    const dc  = deckCardsRef.current;
    const det = cardDetailsRef.current;
    if (!dc.length) return; // still loading

    // Entry IDs already visible on this canvas (free cards + cards inside groups).
    // Keyed by entryId so two copies of the same card each get their own slot.
    const onCanvas = new Set<number>(
      Array.from(cv.querySelectorAll<HTMLElement>('[data-entry-id]'))
        .map(el => Number(el.dataset.entryId))
        .filter(Boolean)
    );

    // Find bottom of existing canvas content to stack below it
    let maxY = 60;
    cv.querySelectorAll<HTMLElement>('.canvas-item').forEach(el => {
      const t = parseFloat(el.style.top) || 0;
      if (t > maxY) maxY = t;
    });
    const startY = maxY > 60 ? maxY + 280 : 60;
    let col = 0;

    for (const entry of dc) {
      if (onCanvas.has(entry.id)) continue;
      const detail = det[entry.oracle_id];
      const data: CardData = {
        oracleId: entry.oracle_id,
        name:     detail?.name      || entry.oracle_id,
        typeLine: detail?.type_line || '',
        manaCost: detail?.mana_cost || '',
        imageUrl: preferredImagesRef.current[entry.oracle_id] || (detail ? getImageUrl(detail) : ''),
        qty:      entry.quantity || 1,
        board:    entry.board,
        entryId:  entry.id,
      };
      const el = makeCardEl(data);
      el.style.cssText = `position:absolute;left:${80 + col * 176}px;top:${startY}px;z-index:20;cursor:grab;`;
      el.querySelectorAll<HTMLElement>('.card-layer-1,.card-layer-2').forEach(l => l.style.display = 'none');
      cv.appendChild(el);
      makeItemDraggable(el, 'card');
      makeCardClickable(el);
      attachContextMenu(el);
      col = (col + 1) % 5;
    }

    if (col > 0) scheduleAutoSave(); // only save if we added something
  }, [makeCardEl, makeItemDraggable, makeCardClickable, attachContextMenu, scheduleAutoSave]);

  // ── Arrangements ──────────────────────────────────────────────────────────

  const switchArrangement = useCallback(async (arrangementId: number, saveFirst: boolean) => {
    if (saveFirst && currentArrangementIdRef.current && canvasRef.current) {
      try {
        const state = serializeCanvas();
        await window.libraryAPI.saveArrangementCanvas({ id: currentArrangementIdRef.current, canvasJson: JSON.stringify(state) });
        const cur = arrangementsCacheRef.current.find(a => a.id === currentArrangementIdRef.current);
        if (cur) cur.canvas_json = JSON.stringify(state);
      } catch (err) {
        console.error('Failed to save arrangement before switching:', err);
      }
    }
    currentArrangementIdRef.current = arrangementId;
    setCurrentArrangementId(arrangementId);

    const arr = arrangementsCacheRef.current.find(a => a.id === arrangementId);
    if (arr?.canvas_json) {
      try { restoreCanvas(JSON.parse(arr.canvas_json)); } catch {
        Array.from(canvasRef.current!.children).forEach(el => { if ((el as HTMLElement).id !== 'sel-box') el.remove(); });
        txRef.current = 80; tyRef.current = 60; scRef.current = 1; applyT();
      }
    } else {
      if (canvasRef.current) {
        Array.from(canvasRef.current.children).forEach(el => { if ((el as HTMLElement).id !== 'sel-box') el.remove(); });
      }
      txRef.current = 80; tyRef.current = 60; scRef.current = 1; applyT();
    }
    // Bring canvas in sync with the deck — any card added while on another
    // arrangement will be spawned here; any removed card won't appear.
    reconcileCanvas();
  }, [serializeCanvas, restoreCanvas, applyT, reconcileCanvas]);

  const loadArrangements = useCallback(async () => {
    if (!deckId) return;
    try {
      let arrs = await window.libraryAPI.getArrangements({ deckId });
      if (!arrs.length) {
        const result = await window.libraryAPI.createArrangement({ deckId, name: 'Default' });
        const newArr: Arrangement = { id: result.id, name: 'Default', canvas_json: null };
        // Migrate old canvas_states if present
        try {
          const old = await window.libraryAPI.loadCanvas({ deckId });
          if (old?.stateJson) {
            await window.libraryAPI.saveArrangementCanvas({ id: result.id, canvasJson: old.stateJson });
            newArr.canvas_json = old.stateJson;
          }
        } catch {}
        arrs = [newArr];
      }
      arrangementsCacheRef.current = arrs;
      setArrangements([...arrs]);
      await switchArrangement(arrs[0].id, false);
    } catch (err) {
      console.error('Load arrangements failed:', err);
      useToastStore.getState().push({ type: 'error', title: 'Failed to load canvas arrangements', message: String(err) });
    }
  }, [deckId, switchArrangement]);

  // ── Canvas event setup ────────────────────────────────────────────────────

  // K opens card search panel from any tab (no modifier, consistent with V/H/G/N)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.code === 'KeyK' && !(e.ctrlKey || e.metaKey || e.altKey) && !(e.target as HTMLElement).matches('input,textarea')) {
        e.preventDefault();
        setSearchOpen(true);
        setDetailOracleId(null);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  // Fix #9: separate canvas DOM setup (stable deps) from data-fetching (loadArrangements).
  // This prevents a loadArrangements identity change from tearing down all event listeners.
  useEffect(() => {
    if (!viewportRef.current || !canvasRef.current) return;
    loadArrangements();
  }, [loadArrangements]);

  // Always-fresh remove function for use inside the stable keydown effect.
  // Assigned on every render so the closure always captures current state.
  // Takes deck_cards.id values (not oracle_ids) so two copies of the same card
  // are treated as independent instances — deleting one never removes the other.
  const removeCardsFromDeckRef = useRef<(entryIds: number[]) => void>(() => {});
  removeCardsFromDeckRef.current = (entryIds: number[]) => {
    if (!entryIds.length) return;
    const idSet = new Set(entryIds);
    entryIds.forEach(id => {
      window.libraryAPI.removeCardFromDeck({ id }).catch(() => {});
    });
    setDeckCards(prev => prev.filter(dc => !idSet.has(dc.id)));
    setDeck(prev => prev ? { ...prev, cards: (prev.cards ?? []).filter(dc => !idSet.has(dc.id)) } : prev);
    updateDeckCardCount(deckId, -entryIds.length);
  };

  useEffect(() => {
    if (!viewportRef.current || !canvasRef.current) return;

    const cv = canvasRef.current;
    const wv = viewportRef.current;

    // Create selection box
    const selBox = document.createElement('div');
    selBox.id = 'sel-box';
    cv.appendChild(selBox);
    selBoxRef.current = selBox;
    cv.ondragstart = () => false;

    applyT();

    // Wheel zoom
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = wv.getBoundingClientRect();
      zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.12 : 0.88);
    };
    wv.addEventListener('wheel', onWheel, { passive: false });

    // Background mouse down (pan / rubber-band)
    const onBgMouseDown = (e: MouseEvent) => {
      if (e.target !== wv && e.target !== cv && e.target !== selBox) return;
      e.preventDefault();
      if (spaceHeldRef.current || canvasModeRef.current === 'hand') {
        panRef.current = { ox: e.clientX - txRef.current, oy: e.clientY - tyRef.current };
        wv.style.cursor = 'grabbing';
      } else {
        const cp = s2c(e.clientX, e.clientY);
        rbandRef.current = { sx: cp.x, sy: cp.y };
        selBox.style.cssText = `display:block;left:${cp.x}px;top:${cp.y}px;width:0;height:0;`;
        if (!e.shiftKey) clearSel();
      }
    };
    wv.addEventListener('mousedown', onBgMouseDown);

    // Document mouse move — rAF-throttled so DOM mutations happen at most once per frame.
    // Group BoundingClientRects are cached on the first card-drag move and cleared on mouseup,
    // avoiding repeated forced-layout calls on every raw mouse event.
    let moveRafId: number | null = null;
    let latestMoveEvent: MouseEvent | null = null;
    let cachedGroupRects: Array<{ el: HTMLDivElement; rect: DOMRect }> = [];

    const processMove = (e: MouseEvent) => {
      // ── Resize (directional, canvas-space aware) ──────────────────────────
      if (resizeRef.current) {
        const { el, dir, startW, startH, startX, startY, startLeft } = resizeRef.current;
        const dx = (e.clientX - startX) / scRef.current;
        const dy = (e.clientY - startY) / scRef.current;
        const MIN_W = 140, MIN_H = 80;

        if (dir === 'right' || dir === 'bottom-right') {
          // Anchor left edge, grow right
          const newW = Math.max(MIN_W, startW + dx);
          el.style.width = newW + 'px';
          if (dir === 'bottom-right') {
            el.style.height = Math.max(MIN_H, startH + dy) + 'px';
          }
          setWidgetBodyZoom(el, newW);
        } else {
          // dir === 'left': anchor right edge, grow left
          const newW = Math.max(MIN_W, startW - dx);
          el.style.width = newW + 'px';
          el.style.left = (startLeft + startW - newW) + 'px';
          setWidgetBodyZoom(el, newW);
        }
        return;
      }
      if (panRef.current) {
        txRef.current = e.clientX - panRef.current.ox;
        tyRef.current = e.clientY - panRef.current.oy;
        applyT(); return;
      }
      if (rbandRef.current) {
        const cp = s2c(e.clientX, e.clientY);
        const x1 = Math.min(cp.x, rbandRef.current.sx), y1 = Math.min(cp.y, rbandRef.current.sy);
        const x2 = Math.max(cp.x, rbandRef.current.sx), y2 = Math.max(cp.y, rbandRef.current.sy);
        selBox.style.left = x1 + 'px'; selBox.style.top = y1 + 'px';
        selBox.style.width = (x2 - x1) + 'px'; selBox.style.height = (y2 - y1) + 'px';
        return;
      }
      if (!dragRef.current) return;
      // Fire deferred selection on the first move of a plain-click drag
      if (pendingSelectRef.current) {
        pendingSelectRef.current();
        pendingSelectRef.current = null;
      }
      const cp = s2c(e.clientX, e.clientY);
      if (dragRef.current.type === 'multi') {
        const dx = cp.x - dragRef.current.ox, dy = cp.y - dragRef.current.oy;
        dragRef.current.init!.forEach((p, el) => { el.style.left = (p.l + dx) + 'px'; el.style.top = (p.t + dy) + 'px'; });
      } else {
        const { el, elType } = dragRef.current;
        el!.style.left = (cp.x - dragRef.current.ox) + 'px';
        el!.style.top = (cp.y - dragRef.current.oy) + 'px';
        if (elType === 'card' || elType === 'card-ghost') {
          // Build rect cache once per drag; avoids getBoundingClientRect on every event
          if (!cachedGroupRects.length) {
            cachedGroupRects = Array.from(cv.querySelectorAll<HTMLDivElement>('.group-container'))
              .map(g => ({ el: g, rect: g.getBoundingClientRect() }));
          }
          cachedGroupRects.forEach(({ el: g, rect: r }) => {
            const over = e.clientX > r.left && e.clientX < r.right && e.clientY > r.top && e.clientY < r.bottom;
            g.classList.toggle('group-drop-highlight', over);
          });
        }
      }
    };

    const onMouseMove = (e: MouseEvent) => {
      latestMoveEvent = e;
      if (moveRafId !== null) return;
      moveRafId = requestAnimationFrame(() => {
        moveRafId = null;
        if (latestMoveEvent) {
          processMove(latestMoveEvent);
          latestMoveEvent = null;
        }
      });
    };
    document.addEventListener('mousemove', onMouseMove);

    // Document mouse up
    const onMouseUp = (e: MouseEvent) => {
      // Plain click (no drag) — discard any pending selection so clicking never selects
      pendingSelectRef.current = null;
      cachedGroupRects = [];
      if (resizeRef.current) { resizeRef.current = null; scheduleAutoSave(); return; }
      if (panRef.current) { panRef.current = null; wv.style.cursor = (canvasModeRef.current === 'hand' || spaceHeldRef.current) ? 'grab' : ''; return; }
      if (rbandRef.current) {
        const cp = s2c(e.clientX, e.clientY);
        const x1 = Math.min(cp.x, rbandRef.current.sx), y1 = Math.min(cp.y, rbandRef.current.sy);
        const x2 = Math.max(cp.x, rbandRef.current.sx), y2 = Math.max(cp.y, rbandRef.current.sy);
        if (x2 - x1 > 4 || y2 - y1 > 4)
          cv.querySelectorAll<HTMLDivElement>('.canvas-item').forEach(el => {
            if (hitTestRect(el, x1, y1, x2, y2)) selectEl(el);
          });
        syncSelCount();
        rbandRef.current = null; selBox.style.display = 'none'; return;
      }
      if (!dragRef.current) return;
      pushUndoSnapshot(); // snapshot before any mutation so Ctrl+Z can restore pre-drag state
      cv.classList.remove('dragging-active');
      const { type } = dragRef.current;
      if (type === 'multi') {
        dragRef.current.init!.forEach((_, el) => { el.style.zIndex = el.dataset.baseZ || '10'; el.style.willChange = ''; });
      } else {
        const { el, elType, sourceGroupEl } = dragRef.current;
        el!.style.zIndex = el!.dataset.baseZ || '10';
        if (elType === 'card') {
          el!.style.transition = ''; el!.style.filter = ''; el!.style.transform = ''; el!.style.opacity = '';
          el!.style.willChange = ''; el!.classList.remove('card-lifting');
          let dropped = false;
          cv.querySelectorAll<HTMLDivElement>('.group-container').forEach(g => {
            g.classList.remove('group-drop-highlight');
            if (!dropped && hitTest(e, g)) { dropIntoGroup(el!, g); dropped = true; }
          });
        } else if (elType === 'card-ghost') {
          el!.style.transition = ''; el!.style.filter = ''; el!.style.transform = '';
          el!.style.willChange = ''; el!.classList.remove('card-lifting');
          cv.querySelectorAll<HTMLDivElement>('.group-container').forEach(g => g.classList.remove('group-drop-highlight'));

          // The slot placeholder left behind in the source group is the authoritative
          // source of truth for same-group detection and position restoration.
          const slot = (el as any)._ghostSlot as HTMLDivElement | undefined;

          // Two-point hit-test: mouse cursor OR ghost centre
          const ghostR  = el!.getBoundingClientRect();
          const ghostCx = (ghostR.left + ghostR.right)  / 2;
          const ghostCy = (ghostR.top  + ghostR.bottom) / 2;
          function ghostHitTest(g: HTMLDivElement) {
            const r = g.getBoundingClientRect();
            const mouseIn = e.clientX > r.left && e.clientX < r.right && e.clientY > r.top && e.clientY < r.bottom;
            const ghostIn = ghostCx   > r.left && ghostCx   < r.right && ghostCy   > r.top && ghostCy   < r.bottom;
            return mouseIn || ghostIn;
          }

          let dropped = false;
          cv.querySelectorAll<HTMLDivElement>('.group-container').forEach(g => {
            if (dropped || !ghostHitTest(g)) return;
            dropped = true;

            if (slot && g.contains(slot)) {
              // ── Same group: restore card at the slot's exact DOM position ──
              el!.style.cssText = ''; el!.style.cursor = 'grab';
              el!.classList.remove('canvas-item');
              el!.querySelectorAll<HTMLElement>('.card-layer-1,.card-layer-2')
                .forEach(l => l.style.display = '');
              slot.parentElement!.insertBefore(el!, slot);
              slot.remove();
              relayoutGroup(g);
            } else {
              // ── Different group ───────────────────────────────────────────
              slot?.remove();
              if (sourceGroupEl) relayoutGroup(sourceGroupEl);
              dropIntoGroup(el!, g);
            }
          });

          if (!dropped) {
            // ── Canvas drop: card stays on canvas at ghost's final position ──
            slot?.remove();
            if (sourceGroupEl) relayoutGroup(sourceGroupEl);
            el!.style.transition = '';
            el!.style.opacity    = '';
            el!.style.filter     = '';
            el!.style.transform  = '';
            el!.style.willChange = '';
            el!.style.cursor     = 'grab';
            el!.style.zIndex     = '20';
            el!.dataset.baseZ    = '20';
          }
        }
      }
      dragRef.current = null;
      scheduleAutoSave();
    };
    document.addEventListener('mouseup', onMouseUp);

    // Keyboard
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target as HTMLElement).matches('input,textarea')) {
        e.preventDefault(); spaceHeldRef.current = true; wv.style.cursor = 'grab';
      }
      if (e.code === 'Escape') clearSel();
      // Mode shortcuts (H = hand/pan, V = select/rubber-band)
      if (e.code === 'KeyH' && !(e.target as HTMLElement).matches('input,textarea') && !e.ctrlKey && !e.metaKey) {
        canvasModeRef.current = 'hand'; setCanvasMode('hand'); wv.style.cursor = 'grab';
      }
      if (e.code === 'KeyV' && !(e.target as HTMLElement).matches('input,textarea') && !e.ctrlKey && !e.metaKey) {
        canvasModeRef.current = 'select'; setCanvasMode('select'); wv.style.cursor = '';
      }
      // Quick-add shortcuts (N = note, G = group)
      if (e.code === 'KeyN' && !(e.target as HTMLElement).matches('input,textarea') && !e.ctrlKey && !e.metaKey) {
        e.preventDefault(); handleAddStickerRef.current();
      }
      if (e.code === 'KeyG' && !(e.target as HTMLElement).matches('input,textarea') && !e.ctrlKey && !e.metaKey) {
        e.preventDefault(); openGroupModalRef.current();
      }
      if (e.code === 'KeyW' && !(e.target as HTMLElement).matches('input,textarea') && !e.ctrlKey && !e.metaKey) {
        e.preventDefault(); openWidgetPickerRef.current();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
        e.preventDefault();
        cv.querySelectorAll<HTMLDivElement>('.canvas-item').forEach(el => selectEl(el));
        syncSelCount();
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && !(e.target as HTMLElement).matches('input,textarea')) {
        if (selRef.current.size > 0) {
          e.preventDefault();
          pushUndoSnapshot();
          const removedEntryIds: number[] = [];
          selRef.current.forEach(el => {
            if (el.classList.contains('card-stack')) {
              // Commander cards are protected — skip deletion
              const entryId = Number(el.dataset.entryId);
              const isCommander = entryId && deckCardsRef.current.find(dc => dc.id === entryId)?.board === 'commander';
              if (isCommander) return;
              // Individual card → remove from deck too
              if (entryId) removedEntryIds.push(entryId);
              el.remove();
            } else if (el.classList.contains('group-container')) {
              // Group → eject cards to free canvas (preserve them in deck), then remove group
              el.querySelectorAll<HTMLDivElement>('.card-stack').forEach(cardEl => {
                const cr  = cardEl.getBoundingClientRect();
                const wvr = cv.getBoundingClientRect();
                const left = (cr.left - wvr.left - txRef.current) / scRef.current;
                const top  = (cr.top  - wvr.top  - tyRef.current) / scRef.current;
                cardEl.remove();
                cardEl.querySelectorAll<HTMLElement>('.card-layer-1,.card-layer-2').forEach(l => l.style.display = 'none');
                cardEl.style.cssText = `position:absolute;left:${left}px;top:${top}px;z-index:20;cursor:grab;`;
                cardEl.dataset.baseZ = '20';
                cardEl.classList.add('canvas-item');
                cv.appendChild(cardEl);
              });
              el.remove();
            } else {
              // Sticker or anything else → just remove
              el.remove();
            }
          });
          selRef.current.clear();
          if (removedEntryIds.length) removeCardsFromDeckRef.current(removedEntryIds);
          scheduleAutoSave();
        }
      }
      // #23 – Undo / Redo
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey && !(e.target as HTMLElement).matches('input,textarea')) {
        e.preventDefault();
        const snap = undoStackRef.current.pop();
        if (snap && canvasRef.current) {
          redoStackRef.current.push(JSON.stringify(serializeCanvas()));
          try { restoreCanvas(JSON.parse(snap)); } catch {}
          scheduleAutoSave();
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && e.shiftKey && !(e.target as HTMLElement).matches('input,textarea')) {
        e.preventDefault();
        const snap = redoStackRef.current.pop();
        if (snap && canvasRef.current) {
          undoStackRef.current.push(JSON.stringify(serializeCanvas()));
          try { restoreCanvas(JSON.parse(snap)); } catch {}
          scheduleAutoSave();
        }
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') { spaceHeldRef.current = false; wv.style.cursor = canvasModeRef.current === 'hand' ? 'grab' : ''; }
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);

    return () => {
      if (moveRafId !== null) cancelAnimationFrame(moveRafId);
      wv.removeEventListener('wheel', onWheel);
      wv.removeEventListener('mousedown', onBgMouseDown);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
    };
  }, [applyT, zoomAt, s2c, clearSel, selectEl, syncSelCount, dropIntoGroup, scheduleAutoSave, pushUndoSnapshot, serializeCanvas, restoreCanvas]);

  // ── AI event listeners ────────────────────────────────────────────────────

  useEffect(() => {
    const onAICreateGroup = (e: Event) => {
      const { name, color, oracleIds, layoutMode } = (e as CustomEvent).detail;
      if (!viewportRef.current || !canvasRef.current) return;
      const g = makeGroupEl(name || 'AI Group', color || '#f2ca83', layoutMode ?? 'grid');
      const r = viewportRef.current.getBoundingClientRect();
      const cp = s2c(r.left + r.width / 2, r.top + r.height / 2);
      g.style.left = (cp.x - 100) + 'px';
      g.style.top  = (cp.y - 60) + 'px';
      canvasRef.current.appendChild(g);
      for (const oid of (oracleIds || [])) {
        const cardEl = canvasRef.current.querySelector<HTMLDivElement>(`[data-oracle-id="${CSS.escape(oid)}"]`);
        if (cardEl) dropIntoGroup(cardEl, g);
      }
      pushUndoSnapshot();
      scheduleAutoSave();
    };

    const onAISetFilters = (e: Event) => {
      setSearchOpen(true);
    };

    const onAIAddSticker = (e: Event) => {
      const { text, width } = (e as CustomEvent).detail;
      if (!viewportRef.current || !canvasRef.current) return;
      const el = makeStickerEl(text ?? '');
      if (width) el.style.width = `${width}px`;
      const r = viewportRef.current.getBoundingClientRect();
      const cp = s2c(r.left + r.width / 2, r.top + r.height / 2);
      el.style.cssText += `;left:${cp.x}px;top:${cp.y}px;`;
      canvasRef.current.appendChild(el);
      scheduleAutoSave();
    };

    const onAIApplySwap = async (e: Event) => {
      const { cutOracleId, addOracleId, deckId: swapDeckId } = (e as CustomEvent).detail;
      const cutEntry = deckCardsRef.current.find(c => c.oracle_id === cutOracleId);
      if (cutEntry) {
        await window.libraryAPI.removeCardFromDeck({ id: cutEntry.id });
        setDeckCards(prev => prev.filter(c => c.id !== cutEntry.id));
      }
      const added = await window.libraryAPI.addCardToDeck({ deckId: swapDeckId ?? deckId, oracleId: addOracleId, board: 'main' });
      if (added) {
        const card = await window.cardsAPI.getCard({ oracleId: addOracleId });
        if (card) spawnCardOnCanvas(card, 1, 'main', added.id);
      }
    };

    const onAIRemoveCards = (e: Event) => {
      const { oracleIds } = (e as CustomEvent).detail;
      const entries = deckCardsRef.current.filter(c => (oracleIds as string[]).includes(c.oracle_id));
      removeCardsFromDeckRef.current(entries.map(c => c.id));
    };

    window.addEventListener('ai:create-group',      onAICreateGroup as EventListener);
    window.addEventListener('ai:set-search-filters', onAISetFilters as EventListener);
    window.addEventListener('ai:add-sticker',        onAIAddSticker as EventListener);
    window.addEventListener('ai:apply-swap',         onAIApplySwap  as EventListener);
    window.addEventListener('ai:remove-cards',       onAIRemoveCards as EventListener);

    return () => {
      window.removeEventListener('ai:create-group',      onAICreateGroup as EventListener);
      window.removeEventListener('ai:set-search-filters', onAISetFilters as EventListener);
      window.removeEventListener('ai:add-sticker',        onAIAddSticker as EventListener);
      window.removeEventListener('ai:apply-swap',         onAIApplySwap  as EventListener);
      window.removeEventListener('ai:remove-cards',       onAIRemoveCards as EventListener);
    };
  }, [deckId, dropIntoGroup, pushUndoSnapshot, scheduleAutoSave, s2c, spawnCardOnCanvas]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  // When the user selects a different printing in the detail panel, update every
  // canvas element for that card and remember the choice for future spawns.
  const handlePrintingChange = useCallback((scryfallId: string, imageUrl: string) => {
    if (!detailOracleId || !imageUrl) return;
    preferredImagesRef.current[detailOracleId] = imageUrl;
    if (canvasRef.current) {
      canvasRef.current.querySelectorAll<HTMLDivElement>('.card-stack[data-oracle-id]').forEach(cardEl => {
        if (cardEl.dataset.oracleId === detailOracleId) setCardElImage(cardEl, imageUrl);
      });
    }
    scheduleAutoSave();
  }, [detailOracleId, scheduleAutoSave]);

  // Fix #3: optimistic card mutations — update local state immediately, no full reload
  const handleAddCard = async (card: Card) => {
    if (!deckId) return;
    // Singleton enforcement for Commander
    if (deck?.format === 'commander' && !BASIC_LAND_NAMES.has(card.name || '')) {
      const existing = deckCards.find(dc => dc.oracle_id === card.oracle_id);
      if (existing) {
        useToastStore.getState().push({
          type: 'warning',
          title: 'Singleton format',
          message: `${card.name} is already in your deck. Commander allows only 1 copy.`,
        });
        return;
      }
    }
    try {
      const scryfallId = card.full_data?.id || undefined;
      const result = await window.libraryAPI.addCardToDeck({ deckId, oracleId: card.oracle_id, board: 'main', scryfallId });
      try { await window.libraryAPI.logActivity({ event: 'card_added', deckId, oracleId: card.oracle_id }); } catch {}
      const newEntry: DeckCardEntry = { id: result.id, oracle_id: card.oracle_id, board: 'main', quantity: 1, scryfall_id: scryfallId };
      setDeckCards(prev => [...prev, newEntry]);
      setCardDetails(prev => ({ ...prev, [card.oracle_id]: card }));
      setDeck(prev => prev ? { ...prev, cards: [...(prev.cards ?? []), newEntry] } : prev);
      updateDeckCardCount(deckId, 1);
      spawnCardOnCanvas(card, 1, 'main', result.id); // pass entryId so the canvas element is traceable
    } catch (err) {
      console.error('addCardToDeck failed:', err);
      useToastStore.getState().push({ type: 'error', title: 'Failed to add card', message: String(err) });
    }
  };

  // Alias: detail panel uses the same add path so both callers get error-toast handling
  const handleAddFromDetail = handleAddCard;

  // Add all search results to the deck and spawn each on the canvas
  const handleAddAll = async (cards: Card[]): Promise<void> => {
    if (!deckId) return;
    const newEntries: DeckCardEntry[] = [];
    const newDetails: Record<string, Card> = {};
    const addedCards: Card[] = [];
    for (const card of cards) {
      try {
        const result = await window.libraryAPI.addCardToDeck({ deckId, oracleId: card.oracle_id, board: 'main' });
        try { await window.libraryAPI.logActivity({ event: 'card_added', deckId, oracleId: card.oracle_id }); } catch {}
        newEntries.push({ id: result.id, oracle_id: card.oracle_id, board: 'main', quantity: 1 });
        newDetails[card.oracle_id] = card;
        addedCards.push(card);
      } catch { /* skip individual failures */ }
    }
    if (!newEntries.length) return;
    // Update React state — these are async so refs won't reflect them yet
    setDeckCards(prev => [...prev, ...newEntries]);
    setCardDetails(prev => ({ ...prev, ...newDetails }));
    setDeck(prev => prev ? { ...prev, cards: [...(prev.cards ?? []), ...newEntries] } : prev);
    updateDeckCardCount(deckId, newEntries.length);
    // Spawn each card on the canvas immediately (same as single-add).
    // We cannot use reconcileCanvas() here because deckCardsRef is only
    // updated after the next React render, so the new entries would be invisible to it.
    for (let i = 0; i < addedCards.length; i++) {
      spawnCardOnCanvas(addedCards[i], 1, 'main', newEntries[i].id);
    }
  };

  const handleSaveDeckSettings = async (updates: Partial<Deck>) => {
    await window.libraryAPI.updateDeck({ id: deckId, ...updates });
    // Optimistic: merge updates into local deck state
    setDeck(prev => prev ? { ...prev, ...updates } : prev);
  };

  const handleExport = async () => {
    if (!deck?.cards?.length) {
      setExportError(true);
      setTimeout(() => setExportError(false), 3000);
      return;
    }
    const oracleIds = [...new Set(deck.cards.map(c => c.oracle_id).filter(Boolean))];
    const detailMap: Record<string, Card> = {};
    if (oracleIds.length) {
      try { (await window.cardsAPI.getCardsBatch({ oracleIds })).forEach(c => { detailMap[c.oracle_id] = c; }); } catch {}
    }
    let lines = [`// ${deck.name} — ${FORMAT_LABELS[deck.format] || deck.format}`, ''];
    const commanders = deck.cards.filter(c => c.board === 'commander');
    const main = deck.cards.filter(c => c.board !== 'commander');
    if (commanders.length) {
      lines.push('// Commander');
      commanders.forEach(c => lines.push(`1 ${detailMap[c.oracle_id]?.name || c.oracle_id}`));
      lines.push('');
    }
    const exportGroups: Record<string, DeckCardEntry[]> = {};
    for (const c of main) {
      const cat = c.board === 'sideboard' ? 'Sideboard' : getCategory(detailMap[c.oracle_id]?.type_line || '');
      if (!exportGroups[cat]) exportGroups[cat] = [];
      exportGroups[cat].push(c);
    }
    for (const cat of CATEGORY_ORDER) {
      if (!exportGroups[cat]?.length) continue;
      lines.push(`// ${cat}`);
      exportGroups[cat].forEach(c => lines.push(`${c.quantity || 1} ${detailMap[c.oracle_id]?.name || c.oracle_id}`));
      lines.push('');
    }
    await navigator.clipboard.writeText(lines.join('\n'));
    setExportFlash(true);
    setTimeout(() => setExportFlash(false), 2000);
  };

  const handleAddGroup = () => {
    const r = viewportRef.current!.getBoundingClientRect();
    const cp = s2c(r.left + r.width / 2, r.top + r.height / 2);
    const g = makeGroupEl(groupName.trim() || 'New Group', groupColor);
    g.style.cssText = `left:${cp.x - 210}px;top:${cp.y - 80}px;z-index:10;border-color:${groupColor}55;`;
    canvasRef.current!.appendChild(g);
    makeItemDraggable(g, 'group');
    attachContextMenu(g);
    g.querySelector<HTMLButtonElement>('[data-group-menu-btn]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const btnR = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const wvR = viewportRef.current!.getBoundingClientRect();
      setGroupMenu({ top: btnR.top - wvR.top, left: btnR.right - wvR.left + 6, groupEl: g });
    });

    const pending = pendingGroupFromSelRef.current;
    if (pending && pending.size > 0) {
      pending.forEach(cardEl => {
        if (canvasRef.current!.contains(cardEl)) dropIntoGroup(cardEl, g);
      });
      pendingGroupFromSelRef.current = null;
      clearSel();
      setGroupModalOpen(false);
      scheduleAutoSave();
      return;
    }

    const hasTags = groupPreSelect === 'type' ? groupPreSelectTypeTags.length > 0
                  : groupPreSelect === 'oracle' ? groupPreSelectOracleTags.length > 0
                  : false;

    if (groupPreSelect !== 'none' && hasTags && canvasRef.current) {
      const matchCard = (oid: string): boolean => {
        const det = cardDetails[oid];
        if (!det) return false;
        if (groupPreSelect === 'type') {
          const tl = (det.type_line || '').toLowerCase();
          const res = groupPreSelectTypeTags.map(t => tl.includes(t.toLowerCase()));
          return groupPreSelectTypeOp === 'or' ? res.some(Boolean) : res.every(Boolean);
        }
        const fd = (det.full_data || {}) as Record<string, any>;
        const oracle = fd.oracle_text || fd.card_faces?.[0]?.oracle_text || '';
        const res = groupPreSelectOracleTags.map(t => { try { return new RegExp(t, 'i').test(oracle); } catch { return false; } });
        return groupPreSelectOracleOp === 'or' ? res.some(Boolean) : res.every(Boolean);
      };

      const freeMatches: HTMLDivElement[] = [];
      const conflictMap = new Map<HTMLDivElement, HTMLDivElement[]>();

      for (const cardEl of Array.from(canvasRef.current.querySelectorAll<HTMLDivElement>('.card-stack[data-oracle-id]'))) {
        const oid = cardEl.dataset.oracleId!;
        if (!matchCard(oid)) continue;
        const parentGroup = cardEl.closest<HTMLDivElement>('.group-container');
        if (!parentGroup) {
          freeMatches.push(cardEl);
        } else {
          if (!conflictMap.has(parentGroup)) conflictMap.set(parentGroup, []);
          conflictMap.get(parentGroup)!.push(cardEl);
        }
      }

      if (conflictMap.size > 0) {
        const conflicts: PreSelectConflict[] = Array.from(conflictMap.entries()).map(([groupEl, cards]) => ({
          groupEl,
          groupName: groupEl.dataset.name || 'Group',
          groupColor: groupEl.dataset.color || '#888',
          cards: cards.map(el => {
            const oid = el.dataset.oracleId!;
            const det = cardDetails[oid];
            const fd = (det?.full_data || {}) as Record<string, any>;
            return { el, oracleId: oid, name: det?.name || oid, artUrl: fd.image_uris?.art_crop || fd.card_faces?.[0]?.image_uris?.art_crop || '' };
          }),
        }));
        const allConflictEls = new Set(conflicts.flatMap(c => c.cards.map(card => card.el)));
        setPreSelectConfirm({ newGroupEl: g, freeCards: freeMatches, conflicts });
        setPreSelectConfirmSel(allConflictEls);
        setPreSelectConfirmOpen(new Set([0]));
        setGroupModalOpen(false);
        return;
      }

      for (const cardEl of freeMatches) dropIntoGroup(cardEl, g);
    }

    setGroupModalOpen(false);
    scheduleAutoSave();
  };

  const handleConfirmPreSelect = () => {
    if (!preSelectConfirm) return;
    const { newGroupEl: g, freeCards, conflicts } = preSelectConfirm;
    pushUndoSnapshot();
    for (const cardEl of freeCards) dropIntoGroup(cardEl, g);
    for (const conflict of conflicts) {
      for (const card of conflict.cards) {
        if (preSelectConfirmSel.has(card.el)) dropIntoGroup(card.el, g);
      }
    }
    setPreSelectConfirm(null);
    scheduleAutoSave();
  };

  const handleCancelPreSelect = () => {
    if (!preSelectConfirm) return;
    preSelectConfirm.newGroupEl.remove();
    setPreSelectConfirm(null);
  };

  // Auto-layout: grid up free-floating cards near existing content.
  // Groups and stickers are never touched.
  const handleAutoLayout = useCallback(() => {
    if (!canvasRef.current) return;
    const cv = canvasRef.current;

    const freeCards = Array.from(cv.querySelectorAll<HTMLDivElement>(':scope > .card-stack'));
    if (!freeCards.length) return;

    pushUndoSnapshot();
    clearSel();

    // Find the bounding box of all anchored items (groups + stickers) so we can
    // place the card grid right next to them.
    let anchorRight = -Infinity, anchorTop = Infinity;
    let hasAnchors = false;
    cv.querySelectorAll<HTMLDivElement>(':scope > .group-container, :scope > .sticker').forEach(el => {
      const l = parseFloat(el.style.left) || 0;
      const t = parseFloat(el.style.top) || 0;
      const r = l + el.offsetWidth;
      if (r > anchorRight) anchorRight = r;
      if (t < anchorTop)  anchorTop  = t;
      hasAnchors = true;
    });

    // If no anchored items exist, start from the canvas origin
    const startX = hasAnchors ? anchorRight + 48 : 80;
    const startY = hasAnchors ? anchorTop        : 60;

    const CARD_W = 160, CARD_H = 240, GAP_X = 16, GAP_Y = 20;
    const COLS = Math.min(freeCards.length, 5);

    freeCards.forEach((el, i) => {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      el.style.left      = (startX + col * (CARD_W + GAP_X)) + 'px';
      el.style.top       = (startY + row * (CARD_H + GAP_Y)) + 'px';
      el.style.zIndex    = el.dataset.baseZ || '20';
      el.style.filter    = '';
      el.style.transform = '';
    });

    scheduleAutoSave();
  }, [clearSel, pushUndoSnapshot, scheduleAutoSave]);


  const handleAddSticker = () => {
    const r = viewportRef.current!.getBoundingClientRect();
    const cp = s2c(r.left + r.width / 2, r.top + r.height / 2);
    const el = makeStickerEl('');
    el.style.left = (cp.x - 90) + 'px'; el.style.top = (cp.y - 60) + 'px';
    canvasRef.current!.appendChild(el);
    makeItemDraggable(el, 'sticker');
    attachContextMenu(el);
    el.querySelector<HTMLButtonElement>('.sticker-close')?.addEventListener('click', () => { el.remove(); scheduleAutoSave(); });
    attachResizeHandlers(el, 'sticker');
    el.querySelector('textarea')?.focus();
    scheduleAutoSave();
  };

  // Keep always-fresh refs so the stable canvas effect can call current handlers
  handleAddStickerRef.current  = handleAddSticker;
  openGroupModalRef.current    = () => { setGroupModalOpen(true); setGroupName(''); setGroupPreSelect('none'); setGroupPreSelectTypeTags([]); setGroupPreSelectTypeDraft(''); setGroupPreSelectOracleTags([]); setGroupPreSelectOracleDraft(''); };
  openWidgetPickerRef.current  = () => setWidgetPickerOpen(true);
  reconcileCanvasRef.current   = reconcileCanvas;

  // ── Multi-select context-menu handlers ───────────────────────────────────

  // "Group Cards" from multi-selection: snapshot the selected cards, open the
  // group modal. handleAddGroup will drop them in once the group is created.
  const handleGroupFromSelection = () => {
    const cardEls = Array.from(selRef.current).filter(el => el.classList.contains('card-stack'));
    if (!cardEls.length) { setMultiMenu(null); return; }
    pendingGroupFromSelRef.current = new Set(cardEls);
    setMultiMenu(null);
    setGroupModalOpen(true);
    setGroupName('');
    setGroupPreSelect('none');
    setGroupPreSelectTypeTags([]);
    setGroupPreSelectTypeDraft('');
    setGroupPreSelectOracleTags([]);
    setGroupPreSelectOracleDraft('');
  };

  // "Delete / Remove from Deck" from multi-selection: removes all selected
  // canvas items. Cards (free or inside groups) are removed from the deck;
  // groups and stickers are simply deleted.
  const handleMultiDelete = () => {
    pushUndoSnapshot();
    const removedEntryIds: number[] = [];
    selRef.current.forEach(el => {
      if (el.classList.contains('card-stack')) {
        // Commander cards are protected — skip deletion
        const entryId = Number(el.dataset.entryId);
        const isCommander = entryId && deckCardsRef.current.find(dc => dc.id === entryId)?.board === 'commander';
        if (isCommander) return;
        if (entryId) removedEntryIds.push(entryId);
        el.remove();
      } else if (el.classList.contains('group-container')) {
        el.querySelectorAll<HTMLDivElement>('.card-stack').forEach(cardEl => {
          const entryId = Number(cardEl.dataset.entryId);
          const isCommander = entryId && deckCardsRef.current.find(dc => dc.id === entryId)?.board === 'commander';
          if (!isCommander && entryId) removedEntryIds.push(entryId);
        });
        el.remove();
      } else {
        // sticker or other
        el.remove();
      }
    });
    selRef.current.clear();
    if (removedEntryIds.length) removeCardsFromDeckRef.current(removedEntryIds);
    setMultiMenu(null);
    scheduleAutoSave();
  };

  // ── Card context-menu handlers ────────────────────────────────────────────

  const handleCardMenuBoard = async (targetBoard: string) => {
    if (!cardMenu) return;
    const { cardEl, oracleId } = cardMenu;
    setCardMenu(null);
    const entryId = Number(cardEl.dataset.entryId);
    const entry = entryId
      ? deckCardsRef.current.find(dc => dc.id === entryId)
      : deckCardsRef.current.find(dc => dc.oracle_id === oracleId);
    if (!entry) return;
    // Toggle: clicking the already-active board reverts to 'main'
    const newBoard = (entry.board === targetBoard ? 'main' : targetBoard) as DeckCardEntry['board'];
    await window.libraryAPI.updateCardBoard({ id: entry.id, board: newBoard });
    setDeckCards(prev => prev.map(dc => dc.id === entry.id ? { ...dc, board: newBoard } : dc));
    setDeck(prev => prev ? { ...prev, cards: (prev.cards ?? []).map(dc => dc.id === entry.id ? { ...dc, board: newBoard } : dc) } : prev);
    updateCardElBoardBadge(cardEl, newBoard);
    scheduleAutoSave();
  };

  const handleCardMenuQty = async (delta: number) => {
    if (!cardMenu) return;
    const { cardEl, oracleId } = cardMenu;
    setCardMenu(null);
    const entryId = Number(cardEl.dataset.entryId);
    const entry = entryId
      ? deckCardsRef.current.find(dc => dc.id === entryId)
      : deckCardsRef.current.find(dc => dc.oracle_id === oracleId);
    if (!entry) return;
    const newQty = (entry.quantity || 1) + delta;
    if (newQty < 1) {
      handleRemoveCard(entry.id, oracleId, cardEl);
    } else {
      await window.libraryAPI.updateCardQuantity({ id: entry.id, quantity: newQty });
      setDeckCards(prev => prev.map(dc => dc.id === entry.id ? { ...dc, quantity: newQty } : dc));
      updateCardElQtyBadge(cardEl, newQty);
    }
    scheduleAutoSave();
  };

  // Group context menu actions
  const handleGroupRename = () => {
    if (!groupMenu) return;
    setGroupMenu(null);
    const g = groupMenu.groupEl;
    const h3 = g.querySelector<HTMLElement>('h3')!;
    const badge = h3.querySelector('span');
    const name = (h3.firstChild?.textContent || h3.textContent || '').trim().replace(/\s*\(.*\)\s*$/, '');
    const input = document.createElement('input');
    input.value = name;
    input.className = 'bg-transparent border-b border-primary/60 outline-none font-bold uppercase tracking-widest text-[11px] w-28';
    input.style.color = h3.style.color;
    h3.textContent = '';
    h3.appendChild(input);
    if (badge) h3.appendChild(badge);
    input.focus(); input.select();
    const commit = () => {
      const newName = input.value.trim() || name;
      input.replaceWith(document.createTextNode(newName + ' '));
      if (badge) h3.appendChild(badge);
      g.dataset.name = newName;
      scheduleAutoSave();
    };
    input.addEventListener('blur', commit, { once: true });
    input.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { input.value = name; input.blur(); }
    });
  };

  const handleGroupChangeColor = (color: string) => {
    if (!groupMenu) return;
    const g = groupMenu.groupEl;
    const h3 = g.querySelector<HTMLElement>('h3')!;
    const dot = g.querySelector<HTMLElement>('.w-3.h-3.rounded-full');
    h3.style.color = color;
    g.style.borderColor = color + '55';
    if (dot) { dot.style.background = color; dot.style.boxShadow = `0 0 8px ${color}55`; }
    g.dataset.color = color;
    setGroupMenu(m => m ? { ...m } : null); // refresh to update swatch highlights
    scheduleAutoSave();
  };

  const handleGroupDelete = () => {
    if (!groupMenu) return;
    const g = groupMenu.groupEl;
    // Eject all cards to free canvas items — they stay in the deck
    g.querySelectorAll<HTMLDivElement>('.card-stack').forEach(cardEl => placeCardFree(cardEl));
    g.remove();
    setGroupMenu(null);
    scheduleAutoSave();
  };

  const handleGroupDisplayMode = (mode: 'grid' | 'stack-h' | 'stack-v') => {
    if (!groupMenu) return;
    groupMenu.groupEl.dataset.layoutMode = mode;
    relayoutGroup(groupMenu.groupEl);
    setGroupMenu(m => m ? { ...m } : null); // re-render menu to show right sub-control
    scheduleAutoSave();
  };

  const handleGroupCardsPerRow = (n: number) => {
    if (!groupMenu) return;
    groupMenu.groupEl.dataset.cardsPerRow = String(Math.max(1, Math.min(10, n)));
    relayoutGroup(groupMenu.groupEl);
    setGroupMenu(m => m ? { ...m } : null);
    scheduleAutoSave();
  };

  const handleGroupMaxStack = (n: number) => {
    if (!groupMenu) return;
    groupMenu.groupEl.dataset.maxStack = String(Math.max(2, Math.min(20, n)));
    relayoutGroup(groupMenu.groupEl);
    setGroupMenu(m => m ? { ...m } : null);
    scheduleAutoSave();
  };

  // Arrangement handlers
  const handleNewArrangement = async () => {
    if (currentArrangementIdRef.current) {
      try {
        const state = serializeCanvas();
        await window.libraryAPI.saveArrangementCanvas({ id: currentArrangementIdRef.current, canvasJson: JSON.stringify(state) });
        const cur = arrangementsCacheRef.current.find(a => a.id === currentArrangementIdRef.current);
        if (cur) cur.canvas_json = JSON.stringify(state);
      } catch {}
    }
    const name = `Arrangement ${arrangementsCacheRef.current.length + 1}`;
    const result = await window.libraryAPI.createArrangement({ deckId, name });
    const newArr: Arrangement = { id: result.id, name, canvas_json: null };
    arrangementsCacheRef.current.push(newArr);
    setArrangements([...arrangementsCacheRef.current]);
    await switchArrangement(result.id, false);
  };

  const handleDeleteArrangement = async (arrId: number) => {
    if (arrangementsCacheRef.current.length <= 1) return;
    await window.libraryAPI.deleteArrangement({ id: arrId });
    const idx = arrangementsCacheRef.current.findIndex(a => a.id === arrId);
    arrangementsCacheRef.current.splice(idx, 1);
    setArrangements([...arrangementsCacheRef.current]);
    if (currentArrangementIdRef.current === arrId) {
      currentArrangementIdRef.current = null;
      await switchArrangement(arrangementsCacheRef.current[0].id, false);
    }
  };

  const handleRenameArrangement = async (arrId: number, newName: string) => {
    const arr = arrangementsCacheRef.current.find(a => a.id === arrId);
    if (!arr) return;
    arr.name = newName;
    setArrangements([...arrangementsCacheRef.current]);
    try { await window.libraryAPI.renameArrangement({ id: arrId, name: newName }); } catch {}
  };

  // Fix #3: tab switch no longer triggers a full reload — state is kept current by optimistic updates
  const handleTabChange = (newTab: Tab) => {
    setTab(newTab);
  };

  // Fix #3: Remove card — optimistic state update, no reload.
  // targetEl: the specific canvas element to remove (preferred). Falls back to
  // querying by data-entry-id so the exact instance is always targeted.
  const handleRemoveCard = async (deckCardId: number, oracleId: string, targetEl?: HTMLElement) => {
    await window.libraryAPI.removeCardFromDeck({ id: deckCardId });
    try { await window.libraryAPI.logActivity({ event: 'card_removed', deckId, oracleId }); } catch {}
    setDeckCards(prev => prev.filter(dc => dc.id !== deckCardId));
    setDeck(prev => prev ? { ...prev, cards: (prev.cards ?? []).filter(dc => dc.id !== deckCardId) } : prev);
    updateDeckCardCount(deckId, -1);
    if (canvasRef.current) {
      // Use the provided element, or find the one carrying this exact entryId
      const cardEl = targetEl
        || canvasRef.current.querySelector<HTMLDivElement>(`[data-entry-id="${deckCardId}"]`);
      if (cardEl) {
        const group = cardEl.closest<HTMLDivElement>('.group-container');
        cardEl.remove();
        if (group) relayoutGroup(group); // update count badge + layout immediately
      }
      scheduleAutoSave();
    }
  };

  // Fix #3: Update quantity — optimistic state update, no reload
  const handleUpdateQty = async (deckCardId: number, newQty: number, oracleId: string) => {
    if (newQty < 1) { handleRemoveCard(deckCardId, oracleId); return; }
    await window.libraryAPI.updateCardQuantity({ id: deckCardId, quantity: newQty });
    setDeckCards(prev => prev.map(dc => dc.id === deckCardId ? { ...dc, quantity: newQty } : dc));
  };

  const handleToggleProxy = async (deckCardId: number, currentIsProxy: number | undefined) => {
    const newVal = !currentIsProxy;
    await window.libraryAPI.updateCardProxy({ id: deckCardId, isProxy: newVal });
    setDeckCards(prev => prev.map(dc => dc.id === deckCardId ? { ...dc, is_proxy: newVal ? 1 : 0 } : dc));
    try {
      const statuses = await window.libraryAPI.getDeckCardStatuses({ deckId });
      cardStatusesRef.current = statuses;
      setCardStatuses(statuses);
    } catch { /* non-critical */ }
  };

  const handleExportMissing = (includeProxies: boolean) => {
    const lines: string[] = [];
    for (const dc of deckCards) {
      const st = cardStatuses[dc.oracle_id];
      if (st === 'missing' || (includeProxies && st === 'proxy')) {
        const name = cardDetails[dc.oracle_id]?.name || dc.oracle_id;
        lines.push(`${dc.quantity || 1} ${name}`);
      }
    }
    if (!lines.length) { useToastStore.getState().push({ type: 'info', title: 'Nothing to export', message: 'No missing cards found' }); return; }
    navigator.clipboard.writeText(lines.join('\n'));
    useToastStore.getState().push({ type: 'success', title: 'Copied', message: `${lines.length} missing card${lines.length !== 1 ? 's' : ''} copied to clipboard` });
  };

  const handleAddMissingToWishlist = async () => {
    const missing = deckCards.filter(dc => cardStatuses[dc.oracle_id] === 'missing');
    if (!missing.length) { useToastStore.getState().push({ type: 'info', title: 'Nothing to add', message: 'No missing cards found' }); return; }
    let added = 0;
    for (const dc of missing) {
      try { await window.libraryAPI.addToWishlist({ oracleId: dc.oracle_id, scryfallId: dc.scryfall_id, quantity: dc.quantity || 1 }); added++; } catch { /* continue */ }
    }
    useToastStore.getState().push({ type: 'success', title: 'Wishlist updated', message: `Added ${added} card${added !== 1 ? 's' : ''} to wishlist` });
  };

  // Fix #3: Toggle board — optimistic state update, no reload
  const handleToggleBoard = async (deckCardId: number, current: string, targetA: string, targetB: string) => {
    const newBoard = (current === targetA ? targetB : targetA) as DeckCardEntry['board'];
    await window.libraryAPI.updateCardBoard({ id: deckCardId, board: newBoard });
    setDeckCards(prev => prev.map(dc => dc.id === deckCardId ? { ...dc, board: newBoard } : dc));
  };

  // ── Mana curve ────────────────────────────────────────────────────────────
  // Sync board badges whenever deck state changes (ensures commander/partner
  // shields always reflect the DB, even when the saved canvas JSON had a stale
  // board value due to the async load race or a missed auto-save).
  // Also removes ghost cards: if the canvas loaded before deckCards arrived
  // (race condition), removed cards slip through and must be evicted here.
  // Additionally handles the case where handleRemoveCard removes a card that
  // is inside a group — the group needs a relayout after the element is gone.
  useEffect(() => {
    if (!canvasRef.current || !deckCards.length) return;
    const boardMap = new Map<string, string>();
    deckCards.forEach(entry => boardMap.set(entry.oracle_id, entry.board || 'main'));
    const groupsToRelayout = new Set<HTMLDivElement>();
    canvasRef.current.querySelectorAll<HTMLDivElement>('[data-oracle-id]').forEach(el => {
      const oid = el.dataset.oracleId;
      if (!oid) return;
      if (!boardMap.has(oid)) {
        // Ghost card — not in deck. Remove it and collect parent group for relayout.
        const group = el.closest<HTMLDivElement>('.group-container');
        el.remove();
        if (group) groupsToRelayout.add(group);
      } else {
        updateCardElBoardBadge(el, boardMap.get(oid)!);
      }
    });
    groupsToRelayout.forEach(g => relayoutGroup(g));
  }, [deckCards]);
  // Refresh all canvas widgets whenever deck data or collection statuses change
  useEffect(() => {
    if (!canvasRef.current || !deckCards.length) return;
    const rawGrps = readCanvasGroups(canvasRef.current);
    const data = buildWidgetDataFromState(deckCards, cardDetails, rawGrps, cardStatuses);
    refreshAllWidgets(data);
  }, [deckCards, cardDetails, cardStatuses, refreshAllWidgets]);
  // Refresh all decorator overlays (standalone pills + widget-embedded badges) whenever deck card data changes.
  // Debounced to avoid sweeping the entire DOM on every card add during bulk operations.
  useEffect(() => {
    if (!canvasRef.current || !deckCards.length) return;
    if (decoratorDebounceRef.current) clearTimeout(decoratorDebounceRef.current);
    decoratorDebounceRef.current = setTimeout(() => {
      decoratorDebounceRef.current = null;
      refreshAllDecoratorOverlays();
      refreshAllWidgetDecorators();
    }, 300);
    return () => {
      if (decoratorDebounceRef.current) clearTimeout(decoratorDebounceRef.current);
    };
  }, [deckCards, cardDetails, refreshAllDecoratorOverlays, refreshAllWidgetDecorators]);
  const totalCards = deckCards.reduce((s, c) => s + (c.quantity || 1), 0);

  // ── Deck price & ownership stats ──────────────────────────────────────────
  const deckTotalPrice = (() => {
    let total = 0;
    for (const dc of deckCards) {
      const usd = parseFloat((cardDetails[dc.oracle_id]?.full_data as any)?.prices?.usd || '0');
      if (usd > 0) total += usd * (dc.quantity || 1);
    }
    return total;
  })();

  const ownershipStats = (() => {
    const main = deckCards.filter(dc => dc.board !== 'sideboard');
    let owned = 0;
    for (const dc of main) {
      const st = cardStatuses[dc.oracle_id];
      if (st && st !== 'missing') owned++;
    }
    return { owned, total: main.length, pct: main.length > 0 ? Math.round((owned / main.length) * 100) : 0 };
  })();

  // ── Combo detection ───────────────────────────────────────────────────────
  type ComboResult = { id: string; cards: string[]; results: string[]; description: string; identity: string };
  const [combos, setCombos] = useState<ComboResult[]>([]);
  const [combosStatus, setCombosStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');

  const missingCards = (() => {
    return deckCards
      .filter(dc => cardStatuses[dc.oracle_id] === 'missing')
      .map(dc => {
        const detail = cardDetails[dc.oracle_id];
        const usd = parseFloat((detail?.full_data as any)?.prices?.usd || '0') || 0;
        return { dc, detail, usd, totalUsd: usd * (dc.quantity || 1) };
      })
      .sort((a, b) => b.usd - a.usd);
  })();

  // ── Commander color-identity violations ───────────────────────────────────
  const commanderColorIdentity = useMemo(() => {
    const ci = deck?.color_identity;
    if (!ci) return null;
    const arr: string[] = Array.isArray(ci) ? ci : (() => { try { return JSON.parse(ci as string); } catch { return []; } })();
    return new Set(arr);
  }, [deck?.color_identity]);

  const violatingOracleIds = useMemo(() => {
    if (deck?.format !== 'commander' || !commanderColorIdentity) return new Set<string>();
    const violations = new Set<string>();
    for (const dc of deckCards) {
      if (dc.board === 'commander' || dc.board === 'partner') continue;
      const ci = cardDetails[dc.oracle_id]?.color_identity;
      if (!ci) continue;
      const cardColors: string[] = Array.isArray(ci) ? (ci as string[])
        : (() => { try { return JSON.parse(ci as string) as string[]; } catch { return []; } })();
      if (cardColors.some(c => !commanderColorIdentity.has(c))) violations.add(dc.oracle_id);
    }
    return violations;
  }, [deck?.format, commanderColorIdentity, deckCards, cardDetails]);

  const singletonViolations = useMemo(() => {
    if (deck?.format !== 'commander') return new Set<string>();
    const violations = new Set<string>();
    for (const dc of deckCards) {
      const name = cardDetails[dc.oracle_id]?.name || '';
      if (BASIC_LAND_NAMES.has(name)) continue;
      if ((dc.quantity || 1) > 1) violations.add(dc.oracle_id);
    }
    return violations;
  }, [deck?.format, deckCards, cardDetails]);

  // ── Push/clear color-identity violation badges on canvas cards ────────────
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    // Remove old badges
    cv.querySelectorAll('[data-ci-violation]').forEach(el => el.remove());
    // Add new badges
    violatingOracleIds.forEach(oid => {
      cv.querySelectorAll<HTMLDivElement>(`[data-oracle-id="${CSS.escape(oid)}"]`).forEach(cardEl => {
        const badge = document.createElement('div');
        badge.setAttribute('data-ci-violation', '1');
        badge.style.cssText = 'position:absolute;inset:0;border-radius:0.75rem;border:2px solid rgba(248,113,113,0.7);pointer-events:none;z-index:31;';
        const label = document.createElement('div');
        label.style.cssText = 'position:absolute;bottom:4px;left:50%;transform:translateX(-50%);background:rgba(220,38,38,0.85);color:#fff;font-size:8px;font-weight:900;padding:1px 5px;border-radius:3px;white-space:nowrap;letter-spacing:.04em;';
        label.textContent = 'COLOR';
        badge.appendChild(label);
        cardEl.appendChild(badge);
      });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [violatingOracleIds]);

  // ── List view data ────────────────────────────────────────────────────────

  const listGroups: Record<string, DeckCardEntry[]> = {};
  for (const dc of deckCards) {
    const cat = dc.board === 'commander' ? 'Commanders'
              : dc.board === 'sideboard'  ? 'Sideboard'
              : getCategory(cardDetails[dc.oracle_id]?.type_line || '');
    if (!listGroups[cat]) listGroups[cat] = [];
    listGroups[cat].push(dc);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen overflow-hidden text-on-surface select-none antialiased bg-background">

      <Sidebar />

      {/* Main area */}
      <main className="ml-[280px] h-screen relative flex flex-col flex-1 overflow-hidden">

        {/* Deck subheader */}
        <div className="flex items-center justify-between px-margin-desktop border-b border-white/5 bg-surface/40 backdrop-blur-md h-14 flex-shrink-0">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-primary text-[20px]">style</span>
              <h2 className="font-headline-md text-base font-bold text-on-surface">
                {isLoading ? 'Loading…' : deck?.name || 'Unknown Deck'}
              </h2>
              {deck?.format && (
                <span className="px-2 py-0.5 rounded-md bg-primary/10 border border-primary/20 text-[9px] font-bold uppercase tracking-wider text-primary">
                  {FORMAT_LABELS[deck.format] || deck.format}
                </span>
              )}
              <button
                onClick={() => setDeckSettingsOpen(true)}
                className="w-7 h-7 rounded-md flex items-center justify-center text-on-surface-variant/50 hover:bg-white/5 hover:text-on-surface-variant transition-all no-drag"
              >
                <span className="material-symbols-outlined text-[16px]">settings</span>
              </button>
              <button
                onClick={() => setImportOpen(true)}
                title="Import decklist"
                className="w-7 h-7 rounded-md flex items-center justify-center text-on-surface-variant/50 hover:bg-white/5 hover:text-on-surface-variant transition-all no-drag"
              >
                <span className="material-symbols-outlined text-[16px]">file_upload</span>
              </button>
              <div className="relative">
                <button
                  onClick={handleExport}
                  title="Export to clipboard"
                  className="w-7 h-7 rounded-md flex items-center justify-center text-on-surface-variant/50 hover:bg-white/5 hover:text-on-surface-variant transition-all no-drag"
                >
                  <span className="material-symbols-outlined text-[16px]">{exportFlash ? 'check' : 'file_download'}</span>
                </button>
                {exportError && (
                  <div className="absolute top-9 left-1/2 -translate-x-1/2 z-50 whitespace-nowrap px-3 py-1.5 rounded-lg bg-surface-container shadow-xl border border-white/10 text-[11px] text-on-surface-variant">
                    No cards to export
                  </div>
                )}
              </div>
              <button
                onClick={toggleAI}
                title="Karn AI"
                className="flex items-center gap-1 px-2.5 py-1 rounded-md transition-all no-drag text-[12px] font-semibold"
                style={aiOpen
                  ? { background: 'rgba(242,202,131,0.15)', color: '#f2ca83', border: '1px solid rgba(242,202,131,0.2)' }
                  : { color: 'rgba(242,202,131,0.5)', border: '1px solid rgba(242,202,131,0.1)' }
                }
              >
                <span className="material-symbols-outlined text-[14px]" style={{ fontVariationSettings: "'FILL' 1" }}>auto_awesome</span>
                Karn
              </button>
            </div>
          </div>

          {/* Deck stats chips */}
          {!isLoading && deckCards.length > 0 && (
            <div className="flex items-center gap-3 mr-4">
              {deckTotalPrice > 0 && (
                <span className="text-[11px] font-bold tabular-nums text-on-surface-variant/60" title="Estimated deck value (USD, non-foil)">
                  ${deckTotalPrice.toFixed(2)}
                </span>
              )}
              {ownershipStats.total > 0 && (
                <button
                  className="text-[11px] font-bold tabular-nums hover:opacity-75 transition-opacity"
                  title={`${ownershipStats.owned} of ${ownershipStats.total} cards owned — click to see missing`}
                  style={{ color: ownershipStats.pct >= 80 ? '#4ade80' : ownershipStats.pct >= 50 ? '#f2ca83' : 'rgba(255,255,255,0.35)' }}
                  onClick={() => missingCards.length > 0 && handleTabChange('missing')}
                >
                  {ownershipStats.pct}% owned
                </button>
              )}
            </div>
          )}

          {/* Workshop / List / Missing tab toggle */}
          <div className="bg-surface-container-highest rounded-lg p-0.5 flex items-center">
            <button
              onClick={() => handleTabChange('workshop')}
              className={`px-3 py-1 rounded-md font-bold text-label-md flex items-center gap-1.5 transition-all ${tab === 'workshop' ? 'bg-surface-container-high text-primary' : 'text-on-surface-variant hover:text-on-surface font-medium'}`}
            >
              <span className="material-symbols-outlined text-[16px]">account_tree</span>Workshop
            </button>
            <button
              onClick={() => handleTabChange('list')}
              className={`px-3 py-1 rounded-md font-medium text-label-md flex items-center gap-1.5 transition-all ${tab === 'list' ? 'bg-surface-container-high text-primary font-bold' : 'text-on-surface-variant hover:text-on-surface'}`}
            >
              <span className="material-symbols-outlined text-[16px]">list</span>List
            </button>
            {missingCards.length > 0 && (
              <button
                onClick={() => handleTabChange('missing')}
                className={`px-3 py-1 rounded-md font-medium text-label-md flex items-center gap-1.5 transition-all ${tab === 'missing' ? 'bg-surface-container-high text-red-400 font-bold' : 'text-on-surface-variant hover:text-on-surface'}`}
              >
                <span className="material-symbols-outlined text-[16px]">shopping_cart</span>
                Missing
                <span
                  className="text-[9px] font-black px-1.5 rounded-full"
                  style={{ background: tab === 'missing' ? 'rgba(248,113,113,0.2)' : 'rgba(255,255,255,0.08)', color: tab === 'missing' ? '#f87171' : 'rgba(255,255,255,0.35)' }}
                >
                  {missingCards.length}
                </span>
              </button>
            )}
            <button
              onClick={() => handleTabChange('combos')}
              className={`px-3 py-1 rounded-md font-medium text-label-md flex items-center gap-1.5 transition-all ${tab === 'combos' ? 'bg-surface-container-high text-primary font-bold' : 'text-on-surface-variant hover:text-on-surface'}`}
            >
              <span className="material-symbols-outlined text-[16px]">auto_fix_high</span>
              Combos
            </button>
          </div>
        </div>

        {/* Commander format validation banner */}
        {deck?.format === 'commander' && !isLoading && (() => {
          const commanders = deckCards.filter(c => c.board === 'commander');
          const warnings: string[] = [];
          if (commanders.length !== 1) warnings.push(`${commanders.length === 0 ? 'No' : commanders.length} commander${commanders.length !== 1 ? 's' : ''} — needs exactly 1`);
          if (totalCards !== 100) warnings.push(`${totalCards}/100 cards`);
          if (violatingOracleIds.size > 0) warnings.push(`${violatingOracleIds.size} card${violatingOracleIds.size !== 1 ? 's' : ''} violate color identity`);
          if (singletonViolations.size > 0) warnings.push(`${singletonViolations.size} card${singletonViolations.size !== 1 ? 's' : ''} exceed singleton limit`);
          if (!warnings.length) return null;
          return (
            <div className="flex items-center gap-2 px-margin-desktop py-2 bg-orange-500/5 border-b border-orange-500/20 flex-shrink-0">
              <span className="material-symbols-outlined text-orange-400/80 text-[16px] flex-shrink-0">warning</span>
              <span className="text-[11px] text-orange-400/80">{warnings.join(' · ')}</span>
            </div>
          );
        })()}

        {/* Arrangement bar (workshop only) */}
        {tab === 'workshop' && (
          <div className="flex items-center gap-1 px-margin-desktop border-b border-white/5 bg-surface/20 h-9 flex-shrink-0">
            <span className="material-symbols-outlined text-[13px] text-on-surface-variant/25 mr-1 flex-shrink-0">layers</span>
            <div className="flex items-center gap-0.5 flex-1 min-w-0 overflow-x-auto">
              {arrangements.map(arr => (
                <ArrangementTab
                  key={arr.id}
                  arr={arr}
                  isActive={arr.id === currentArrangementId}
                  canDelete={arrangements.length > 1}
                  onSwitch={() => switchArrangement(arr.id, true)}
                  onRename={name => handleRenameArrangement(arr.id, name)}
                  onDelete={() => handleDeleteArrangement(arr.id)}
                />
              ))}
            </div>
            <button
              onClick={handleNewArrangement}
              className="flex-shrink-0 w-6 h-6 rounded-md flex items-center justify-center text-on-surface-variant/35 hover:text-on-surface-variant hover:bg-white/5 transition-all ml-1"
              title="New Arrangement"
            >
              <span className="material-symbols-outlined text-[16px]">add</span>
            </button>
          </div>
        )}

        {/* ── Canvas + list view wrapper (panels are positioned inside this) ── */}
        <div className="flex-1 relative min-h-0 overflow-hidden">

        {/* Workshop view — always mounted so canvas DOM survives tab switches */}
        <div
          ref={viewportRef}
          className="absolute inset-0 overflow-hidden bg-[#0D0D0D] canvas-grid"
          style={{ display: tab === 'workshop' ? undefined : 'none' }}
        >
            {/* Canvas */}
            <div ref={canvasRef} id="canvas" />

            {/* Toolbar (bottom-right) */}
            <div className="absolute bottom-6 right-6 z-30 glass-panel rounded-xl shadow-2xl flex items-center px-2 py-1.5 gap-0.5 select-none">

              {/* Mode toggle: Select / Hand */}
              <ToolbarTooltip label="Select" shortcut="V">
                <button
                  onClick={() => switchMode('select')}
                  className={`w-7 h-7 rounded-md flex items-center justify-center transition-all ${canvasMode === 'select' ? 'bg-primary/20 text-primary' : 'text-on-surface-variant hover:bg-white/5 hover:text-primary'}`}
                >
                  <span className="material-symbols-outlined text-[18px]">arrow_selector_tool</span>
                </button>
              </ToolbarTooltip>
              <ToolbarTooltip label="Hand / Pan" shortcut="H">
                <button
                  onClick={() => switchMode('hand')}
                  className={`w-7 h-7 rounded-md flex items-center justify-center transition-all ${canvasMode === 'hand' ? 'bg-primary/20 text-primary' : 'text-on-surface-variant hover:bg-white/5 hover:text-primary'}`}
                >
                  <span className="material-symbols-outlined text-[18px]">pan_tool</span>
                </button>
              </ToolbarTooltip>

              <div className="w-px h-5 bg-white/10 mx-1" />

              <ToolbarTooltip label="Add Card" shortcut="K">
                <button
                  onClick={() => { setSearchOpen(true); setDetailOracleId(null); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-on-surface-variant hover:bg-white/5 hover:text-primary transition-all text-label-md font-bold"
                >
                  <span className="material-symbols-outlined text-[16px]">playing_cards</span>Card
                </button>
              </ToolbarTooltip>
              <ToolbarTooltip label="Add Group" shortcut="G">
                <button
                  onClick={() => { setGroupModalOpen(true); setGroupName(''); setGroupPreSelect('none'); setGroupPreSelectTypeTags([]); setGroupPreSelectTypeDraft(''); setGroupPreSelectOracleTags([]); setGroupPreSelectOracleDraft(''); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-on-surface-variant hover:bg-white/5 hover:text-primary transition-all text-label-md font-bold"
                >
                  <span className="material-symbols-outlined text-[16px]">folder_open</span>Group
                </button>
              </ToolbarTooltip>
              <ToolbarTooltip label="Add Note" shortcut="N">
                <button
                  onClick={handleAddSticker}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-on-surface-variant hover:bg-white/5 hover:text-primary transition-all text-label-md font-bold"
                >
                  <span className="material-symbols-outlined text-[16px]">sticky_note_2</span>Note
                </button>
              </ToolbarTooltip>
              <ToolbarTooltip label="Add Widget" shortcut="W">
                <button
                  onClick={() => setWidgetPickerOpen(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-on-surface-variant hover:bg-white/5 hover:text-primary transition-all text-label-md font-bold"
                >
                  <span className="material-symbols-outlined text-[16px]">widgets</span>Widget
                </button>
              </ToolbarTooltip>

              <div className="w-px h-5 bg-white/10 mx-1" />

              {/* #22 – Auto-layout button */}
              <ToolbarTooltip label="Auto-arrange free cards">
                <button
                  onClick={handleAutoLayout}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-on-surface-variant hover:bg-white/5 hover:text-primary transition-all text-label-md font-bold"
                >
                  <span className="material-symbols-outlined text-[16px]">auto_awesome_mosaic</span>Auto
                </button>
              </ToolbarTooltip>

              <div className="w-px h-5 bg-white/10 mx-1" />

              <ToolbarTooltip label="Zoom out" shortcut="Scroll ↓">
                <button onClick={() => { const r = viewportRef.current!.getBoundingClientRect(); zoomAt(r.width/2, r.height/2, 1/1.2); }}
                  className="w-7 h-7 rounded-md flex items-center justify-center text-on-surface-variant hover:bg-white/5 hover:text-primary transition-all">
                  <span className="material-symbols-outlined text-[18px]">remove</span>
                </button>
              </ToolbarTooltip>
              <span ref={zoomLabelRef} className="text-[11px] font-bold text-on-surface-variant/60 w-10 text-center tabular-nums">100%</span>
              <ToolbarTooltip label="Zoom in" shortcut="Scroll ↑">
                <button onClick={() => { const r = viewportRef.current!.getBoundingClientRect(); zoomAt(r.width/2, r.height/2, 1.2); }}
                  className="w-7 h-7 rounded-md flex items-center justify-center text-on-surface-variant hover:bg-white/5 hover:text-primary transition-all">
                  <span className="material-symbols-outlined text-[18px]">add</span>
                </button>
              </ToolbarTooltip>
              <ToolbarTooltip label="Reset view">
                <button onClick={() => { txRef.current = 80; tyRef.current = 60; scRef.current = 1; applyT(); }}
                  className="w-7 h-7 rounded-md flex items-center justify-center text-on-surface-variant hover:bg-white/5 hover:text-primary transition-all ml-0.5">
                  <span className="material-symbols-outlined text-[18px]">center_focus_strong</span>
                </button>
              </ToolbarTooltip>

              <div className="w-px h-5 bg-white/10 mx-1" />

              {/* Keyboard hints */}
              <div className="flex flex-col items-start gap-0.5 pr-1">
                <span className="text-[8px] text-on-surface-variant/25 font-medium leading-tight whitespace-nowrap">Undo <span className="font-mono text-on-surface-variant/35">Ctrl Z</span></span>
                <span className="text-[8px] text-on-surface-variant/25 font-medium leading-tight whitespace-nowrap">Redo <span className="font-mono text-on-surface-variant/35">Ctrl ⇧Z</span></span>
                <span className="text-[8px] text-on-surface-variant/25 font-medium leading-tight whitespace-nowrap">Widget <span className="font-mono text-on-surface-variant/35">W</span></span>
              </div>
            </div>

            {/* Empty state */}
            {deckCards.length === 0 && !isLoading && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 opacity-20 pointer-events-none" style={{ zIndex: 5 }}>
                <span className="material-symbols-outlined text-[80px] text-on-surface-variant">playing_cards</span>
                <p className="font-headline-md text-xl text-on-surface-variant">No cards yet</p>
                <p className="text-body-md text-on-surface-variant/60">Use the toolbar to add cards</p>
              </div>
            )}

            {/* Selection HUD (bottom-left) */}
            {selCount && (selCount.cards + selCount.groups) > 1 && (
              <div
                className="absolute bottom-6 left-6 z-30 flex items-center gap-3 px-3 py-2 rounded-xl select-none"
                style={{ background: 'rgba(20,22,27,0.92)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 4px 24px rgba(0,0,0,0.5)' }}
              >
                {/* Counts */}
                <div className="flex items-center gap-2.5">
                  {selCount.cards > 0 && (
                    <div className="flex items-center gap-1">
                      <span className="material-symbols-outlined text-[13px] text-primary/70">playing_cards</span>
                      <span className="text-[12px] font-bold text-on-surface tabular-nums">{selCount.cards}</span>
                      <span className="text-[10px] text-on-surface-variant/50">{selCount.cards === 1 ? 'card' : 'cards'}</span>
                    </div>
                  )}
                  {selCount.cards > 0 && selCount.groups > 0 && (
                    <div className="w-px h-3 bg-white/10" />
                  )}
                  {selCount.groups > 0 && (
                    <div className="flex items-center gap-1">
                      <span className="material-symbols-outlined text-[13px] text-primary/70">folder_open</span>
                      <span className="text-[12px] font-bold text-on-surface tabular-nums">{selCount.groups}</span>
                      <span className="text-[10px] text-on-surface-variant/50">{selCount.groups === 1 ? 'group' : 'groups'}</span>
                    </div>
                  )}
                </div>

              </div>
            )}

            {/* Group context menu */}
            {groupMenu && (() => {
              const grpMode = (groupMenu.groupEl.dataset.layoutMode as 'grid' | 'stack-h' | 'stack-v') || 'grid';
              const grpCPR = parseInt(groupMenu.groupEl.dataset.cardsPerRow || '5', 10);
              const grpMax = parseInt(groupMenu.groupEl.dataset.maxStack   || '5', 10);
              return (
                <div
                  className="absolute z-[600] glass-panel rounded-xl shadow-2xl py-1.5 min-w-[210px]"
                  style={{ top: groupMenu.top, left: groupMenu.left, border: '1px solid rgba(255,255,255,0.07)' }}
                >
                  <button onClick={handleGroupRename} className="w-full flex items-center gap-2.5 px-3 py-2 text-on-surface-variant hover:bg-white/5 hover:text-on-surface transition-all text-label-md">
                    <span className="material-symbols-outlined text-[16px]">edit</span>Rename
                  </button>

                  {/* Color */}
                  <div className="px-3 py-2 border-t border-white/5">
                    <p className="text-[9px] text-on-surface-variant/40 uppercase tracking-widest mb-2 font-bold">Color</p>
                    <div className="flex gap-1.5">
                      {['#f2ca83','#bcd0ff','#86efac','#c4c6cd','#d4aa7d','#c084fc'].map(c => (
                        <button key={c} onClick={() => handleGroupChangeColor(c)}
                          className="w-5 h-5 rounded-full hover:scale-110 transition-all"
                          style={{ background: c, outline: groupMenu.groupEl.dataset.color === c ? '2px solid rgba(255,255,255,0.7)' : 'none', outlineOffset: 2 }}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Display mode */}
                  <div className="px-3 py-2 border-t border-white/5">
                    <p className="text-[9px] text-on-surface-variant/40 uppercase tracking-widest mb-2 font-bold">Display</p>
                    <div className="flex gap-1 mb-2.5">
                      {([
                        { id: 'grid',    icon: 'grid_view',   label: 'Grid'    },
                        { id: 'stack-h', icon: 'view_column', label: 'H Stack' },
                        { id: 'stack-v', icon: 'view_agenda', label: 'V Stack' },
                      ] as const).map(({ id, icon, label }) => (
                        <button
                          key={id}
                          onClick={() => handleGroupDisplayMode(id)}
                          title={label}
                          className={`flex-1 flex flex-col items-center gap-0.5 py-1.5 rounded-lg text-[9px] font-bold transition-all ${grpMode === id ? 'bg-primary/20 text-primary border border-primary/20' : 'text-on-surface-variant/60 hover:bg-white/5 border border-transparent'}`}
                        >
                          <span className="material-symbols-outlined text-[15px]">{icon}</span>
                          {label}
                        </button>
                      ))}
                    </div>

                    {grpMode === 'grid' && (
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-on-surface-variant/50 flex-1">Cards / row</span>
                        <button onClick={() => handleGroupCardsPerRow(grpCPR - 1)}
                          className="w-6 h-6 rounded flex items-center justify-center text-on-surface-variant/60 hover:bg-white/10 hover:text-on-surface transition-all text-base leading-none">−</button>
                        <span className="w-5 text-center font-bold text-primary text-[12px] tabular-nums">{grpCPR}</span>
                        <button onClick={() => handleGroupCardsPerRow(grpCPR + 1)}
                          className="w-6 h-6 rounded flex items-center justify-center text-on-surface-variant/60 hover:bg-white/10 hover:text-on-surface transition-all text-base leading-none">+</button>
                      </div>
                    )}
                    {(grpMode === 'stack-h' || grpMode === 'stack-v') && (
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-on-surface-variant/50 flex-1">Per stack</span>
                        <button onClick={() => handleGroupMaxStack(grpMax - 1)}
                          className="w-6 h-6 rounded flex items-center justify-center text-on-surface-variant/60 hover:bg-white/10 hover:text-on-surface transition-all text-base leading-none">−</button>
                        <span className="w-5 text-center font-bold text-primary text-[12px] tabular-nums">{grpMax}</span>
                        <button onClick={() => handleGroupMaxStack(grpMax + 1)}
                          className="w-6 h-6 rounded flex items-center justify-center text-on-surface-variant/60 hover:bg-white/10 hover:text-on-surface transition-all text-base leading-none">+</button>
                      </div>
                    )}
                  </div>

                  <div className="border-t border-white/5 mt-1" />
                  <button onClick={handleGroupDelete} className="w-full flex items-center gap-2.5 px-3 py-2 text-red-400/70 hover:bg-red-500/10 hover:text-red-400 transition-all text-label-md mt-1">
                    <span className="material-symbols-outlined text-[16px]">delete_outline</span>Delete Group
                  </button>
                </div>
              );
            })()}

            {/* Card right-click context menu */}
            {cardMenu && (() => {
              // Look up by entryId first (unique per instance) so two copies of the
              // same card are treated independently. Fall back to oracle_id for legacy
              // canvas elements saved before entryId was introduced.
              const menuEntryId = Number(cardMenu.cardEl.dataset.entryId);
              const entry = menuEntryId
                ? deckCardsRef.current.find(dc => dc.id === menuEntryId)
                : deckCardsRef.current.find(dc => dc.oracle_id === cardMenu.oracleId);
              const board = entry?.board ?? 'main';
              const qty   = entry?.quantity ?? 1;
              const isCommander = board === 'commander';
              return (
                <div
                  className="absolute z-[601] glass-panel rounded-xl shadow-2xl py-1.5 min-w-[188px]"
                  style={{ top: cardMenu.top, left: cardMenu.left, border: '1px solid rgba(255,255,255,0.07)' }}
                >
                  {/* Role */}
                  <div className="px-3 pt-1 pb-1">
                    <p className="text-[9px] text-on-surface-variant/35 uppercase tracking-widest font-bold mb-1">Role</p>
                    <button
                      onClick={() => handleCardMenuBoard('commander')}
                      className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-label-md transition-all ${board === 'commander' ? 'bg-[#f2ca83]/15 text-[#f2ca83]' : 'text-on-surface-variant hover:bg-white/5 hover:text-on-surface'}`}
                    >
                      <span className="material-symbols-outlined text-[15px]" style={{ color: board === 'commander' ? '#f2ca83' : undefined }}>shield</span>
                      {board === 'commander' ? 'Remove Commander' : 'Set as Commander'}
                    </button>
                    <button
                      onClick={() => handleCardMenuBoard('partner')}
                      className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-label-md transition-all ${board === 'partner' ? 'bg-[#7eb8f7]/15 text-[#7eb8f7]' : 'text-on-surface-variant hover:bg-white/5 hover:text-on-surface'}`}
                    >
                      <span className="material-symbols-outlined text-[15px]" style={{ color: board === 'partner' ? '#7eb8f7' : undefined }}>shield</span>
                      {board === 'partner' ? 'Remove Partner' : 'Set as Partner'}
                    </button>
                  </div>

                  {/* Proxy */}
                  <div className="border-t border-white/5 mt-1 px-3 pt-2 pb-1">
                    <button
                      onClick={() => { if (entry) { setCardMenu(null); handleToggleProxy(entry.id, entry.is_proxy); } }}
                      className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-label-md transition-all ${entry?.is_proxy ? 'bg-teal-500/10 text-teal-300' : 'text-on-surface-variant hover:bg-white/5 hover:text-on-surface'}`}
                    >
                      <span className="material-symbols-outlined text-[15px]" style={{ fontVariationSettings: entry?.is_proxy ? "'FILL' 1" : "'FILL' 0" }}>content_copy</span>
                      {entry?.is_proxy ? 'Remove proxy mark' : 'Mark as proxy'}
                    </button>
                  </div>

                  {/* Copies */}
                  <div className="border-t border-white/5 mt-1 px-3 pt-2 pb-2">
                    <p className="text-[9px] text-on-surface-variant/35 uppercase tracking-widest font-bold mb-2">Copies</p>
                    <div className="flex items-center gap-2">
                      <button onClick={() => handleCardMenuQty(-1)}
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-on-surface-variant hover:bg-white/10 hover:text-on-surface transition-all text-lg leading-none">−</button>
                      <span className="flex-1 text-center font-bold text-primary tabular-nums text-sm">{qty}</span>
                      <button onClick={() => handleCardMenuQty(1)}
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-on-surface-variant hover:bg-white/10 hover:text-on-surface transition-all text-lg leading-none">+</button>
                    </div>
                  </div>

                  {/* Remove */}
                  <div className="border-t border-white/5">
                    {isCommander ? (
                      <div className="flex items-center gap-2.5 px-3 py-2 text-on-surface-variant/30 text-label-md mt-0.5 cursor-not-allowed select-none">
                        <span className="material-symbols-outlined text-[16px]">shield</span>
                        <span>Commander is protected</span>
                      </div>
                    ) : (
                      <button
                        onClick={() => { if (entry) { setCardMenu(null); handleRemoveCard(entry.id, cardMenu.oracleId, cardMenu.cardEl); } }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-red-400/70 hover:bg-red-500/10 hover:text-red-400 transition-all text-label-md mt-0.5"
                      >
                        <span className="material-symbols-outlined text-[16px]">delete_outline</span>Remove from Deck
                      </button>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* Widget param popover */}
            {widgetParamPopover && (() => {
              const def = WidgetRegistry.get(widgetParamPopover.defId);
              const paramDefs = def?.params ?? [];
              if (!paramDefs.length) return null;
              const resolved = WidgetRegistry.resolveParams(def!, widgetParamPopover.currentParams);
              const updateParam = (key: string, val: number | string | boolean) => {
                const next = { ...widgetParamPopover.currentParams, [key]: val };
                widgetParamPopover.el.dataset.widgetParams = JSON.stringify(next);
                // Re-render the widget body live
                const rawGrps = canvasRef.current ? readCanvasGroups(canvasRef.current) : [];
                const data = buildWidgetDataFromState(deckCardsRef.current, cardDetailsRef.current, rawGrps, cardStatusesRef.current);
                renderWidgetBody(widgetParamPopover.el, widgetParamPopover.defId, data, next);
                renderWidgetBodyAsync(widgetParamPopover.el, widgetParamPopover.defId, data, next);
                // Re-apply card badges — handles show_badges toggle and badge_mode changes instantly
                applyWidgetDecorators(widgetParamPopover.el);
                setWidgetParamPopover(p => p ? { ...p, currentParams: next } : null);
                scheduleAutoSave();
              };
              return (
                <>
                  {/* Backdrop to close on outside click */}
                  <div className="absolute inset-0 z-[590]" onClick={() => setWidgetParamPopover(null)} />
                  <div
                    className="absolute z-[600] glass-panel rounded-xl shadow-2xl py-3 min-w-[200px]"
                    style={{ top: widgetParamPopover.top, left: widgetParamPopover.left, border: '1px solid rgba(255,255,255,0.07)' }}
                  >
                    <p className="text-[9px] font-bold uppercase tracking-widest text-on-surface-variant/40 px-3 mb-2">Parameters</p>
                    <div className="px-3 space-y-3">
                      {paramDefs.map(p => {
                        const val = resolved[p.key];
                        if (p.type === 'boolean') {
                          return (
                            <div key={p.key} className="flex items-center justify-between gap-3">
                              <span className="text-[11px] text-on-surface/70">{p.label}</span>
                              <button
                                onClick={() => updateParam(p.key, !val)}
                                className={`relative w-8 h-4 rounded-full transition-all flex-shrink-0 ${val ? 'bg-primary/60' : 'bg-white/10'}`}
                              >
                                <span
                                  className="absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all shadow"
                                  style={{ left: val ? '17px' : '2px' }}
                                />
                              </button>
                            </div>
                          );
                        }
                        if (p.type === 'number') {
                          return (
                            <div key={p.key} className="flex items-center justify-between gap-3">
                              <span className="text-[11px] text-on-surface/70">{p.label}</span>
                              <div className="flex items-center gap-1.5">
                                <button
                                  onClick={() => { const n = Math.max(p.min ?? -Infinity, (val as number) - (p.step ?? 1)); updateParam(p.key, n); }}
                                  className="w-5 h-5 rounded flex items-center justify-center text-on-surface-variant/60 hover:bg-white/10 hover:text-on-surface transition-all text-sm leading-none"
                                >−</button>
                                <span className="text-[12px] font-bold text-primary w-8 text-center tabular-nums">{val}</span>
                                <button
                                  onClick={() => { const n = Math.min(p.max ?? Infinity, (val as number) + (p.step ?? 1)); updateParam(p.key, n); }}
                                  className="w-5 h-5 rounded flex items-center justify-center text-on-surface-variant/60 hover:bg-white/10 hover:text-on-surface transition-all text-sm leading-none"
                                >+</button>
                              </div>
                            </div>
                          );
                        }
                        if (p.type === 'select' && p.options) {
                          return (
                            <div key={p.key} className="flex flex-col gap-1">
                              <span className="text-[11px] text-on-surface/70">{p.label}</span>
                              <div className="flex gap-1 flex-wrap">
                                {p.options.map(opt => (
                                  <button
                                    key={opt.value}
                                    onClick={() => updateParam(p.key, opt.value)}
                                    className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all ${val === opt.value ? 'bg-primary/20 text-primary border border-primary/20' : 'text-on-surface-variant/60 hover:bg-white/5 border border-transparent'}`}
                                  >
                                    {opt.label}
                                  </button>
                                ))}
                              </div>
                            </div>
                          );
                        }
                        if (p.type === 'text') {
                          return (
                            <div key={p.key} className="flex flex-col gap-1">
                              <span className="text-[11px] text-on-surface/70">{p.label}</span>
                              <input
                                value={val as string}
                                onChange={e => updateParam(p.key, e.target.value)}
                                className="w-full bg-surface-container/60 border border-white/5 rounded px-2 py-1 text-[11px] text-on-surface focus:outline-none focus:border-primary/40"
                              />
                            </div>
                          );
                        }
                        return null;
                      })}
                    </div>
                  </div>
                </>
              );
            })()}

            {/* Multi-select context menu */}
            {multiMenu && (
              <div
                className="absolute z-[601] glass-panel rounded-xl shadow-2xl py-1.5 min-w-[188px]"
                style={{ top: multiMenu.top, left: multiMenu.left, border: '1px solid rgba(255,255,255,0.07)' }}
              >
                {multiMenu.selType === 'cards-only' ? (
                  <>
                    <button
                      onClick={handleGroupFromSelection}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-on-surface-variant hover:bg-white/5 hover:text-on-surface transition-all text-label-md"
                    >
                      <span className="material-symbols-outlined text-[16px]">folder_open</span>Group Cards
                    </button>
                    <div className="border-t border-white/5">
                      <button
                        onClick={handleMultiDelete}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-red-400/70 hover:bg-red-500/10 hover:text-red-400 transition-all text-label-md mt-0.5"
                      >
                        <span className="material-symbols-outlined text-[16px]">delete_outline</span>Delete from Deck
                      </button>
                    </div>
                  </>
                ) : (
                  <button
                    onClick={handleMultiDelete}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-red-400/70 hover:bg-red-500/10 hover:text-red-400 transition-all text-label-md"
                  >
                    <span className="material-symbols-outlined text-[16px]">delete_outline</span>Remove from Deck
                  </button>
                )}
              </div>
            )}
          </div>

        {/* List view — always mounted, hidden when on workshop tab */}
        <div
          className="absolute inset-0 overflow-y-auto bg-background"
          style={{ display: tab === 'list' ? undefined : 'none' }}
        >
            <div className="max-w-4xl mx-auto px-8 py-6">
              {deckCards.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 gap-3 text-center">
                  <span className="material-symbols-outlined text-[48px] text-on-surface-variant/15">style</span>
                  <p className="text-on-surface-variant/40">No cards yet — switch to Workshop and add cards</p>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="font-headline-md text-lg text-on-surface">Deck List</h2>
                    <span className="text-label-sm text-on-surface-variant/40">{totalCards} cards</span>
                  </div>

                  {/* Mana base analysis */}
                  {deck?.format === 'commander' && (() => {
                    const COLORS = ['W','U','B','R','G'] as const;
                    const COLOR_META: Record<string, { name: string; bg: string; text: string }> = {
                      W: { name: 'White', bg: '#f0d870', text: '#1a1200' },
                      U: { name: 'Blue',  bg: '#4a7cc9', text: '#fff'   },
                      B: { name: 'Black', bg: '#5a5a5a', text: '#fff'   },
                      R: { name: 'Red',   bg: '#c0392b', text: '#fff'   },
                      G: { name: 'Green', bg: '#27ae60', text: '#fff'   },
                    };
                    // Count pips per color across non-land spells
                    const pipCount: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
                    let totalNonLandSpells = 0;
                    for (const dc of deckCards) {
                      const detail = cardDetails[dc.oracle_id];
                      if (!detail) continue;
                      const tl = (detail.type_line || '').toLowerCase();
                      if (/^land/.test(tl)) continue;
                      totalNonLandSpells += dc.quantity || 1;
                      const mc = detail.mana_cost || '';
                      const matches = mc.matchAll(/\{([WUBRG])\}/g);
                      for (const m of matches) {
                        const c = m[1];
                        if (c in pipCount) pipCount[c] += (dc.quantity || 1);
                      }
                    }
                    const totalPips = Object.values(pipCount).reduce((s, v) => s + v, 0);
                    if (totalPips === 0) return null;

                    // Recommended sources: Frank Karsten formula scaled to 99-card (Commander)
                    // Base: need ~14 sources per color that appears on ≥12 cards; ~13 for ≥8; etc.
                    const recSources = (pips: number): number => {
                      if (pips === 0) return 0;
                      const fraction = pips / Math.max(totalPips, 1);
                      const targetLands = 37; // standard commander land count
                      return Math.round(fraction * targetLands);
                    };

                    // Count land sources per color (basic + any land with matching color identity)
                    const landSources: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
                    const landCards = deckCards.filter(dc => {
                      const tl = (cardDetails[dc.oracle_id]?.type_line || '').toLowerCase();
                      return /^land/.test(tl);
                    });
                    const totalLands = landCards.reduce((s, dc) => s + (dc.quantity || 1), 0);
                    for (const dc of landCards) {
                      const ci = cardDetails[dc.oracle_id]?.color_identity;
                      if (!ci) continue;
                      const colors: string[] = Array.isArray(ci) ? (ci as string[])
                        : (() => { try { return JSON.parse(ci as string) as string[]; } catch { return []; } })();
                      for (const c of colors) {
                        if (c in landSources) landSources[c] += dc.quantity || 1;
                      }
                    }

                    const activeColors = COLORS.filter(c => pipCount[c] > 0);
                    if (!activeColors.length) return null;

                    return (
                      <div className="mb-6 p-4 rounded-xl border border-white/5 bg-surface/40">
                        <div className="flex items-center justify-between mb-3">
                          <h3 className="text-[11px] font-bold uppercase tracking-widest text-on-surface-variant/40">Mana Base Analysis</h3>
                          <span className="text-[10px] text-on-surface-variant/30">{totalLands} lands</span>
                        </div>
                        <div className="grid gap-2">
                          {activeColors.map(c => {
                            const meta = COLOR_META[c];
                            const pips = pipCount[c];
                            const rec  = recSources(pips);
                            const have = landSources[c];
                            const delta = have - rec;
                            const status = delta >= 0 ? 'ok' : delta >= -2 ? 'low' : 'critical';
                            return (
                              <div key={c} className="flex items-center gap-3">
                                <div
                                  className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-black flex-shrink-0"
                                  style={{ background: meta.bg, color: meta.text }}
                                >
                                  {c}
                                </div>
                                <div className="flex-1">
                                  <div className="flex items-center justify-between mb-0.5">
                                    <span className="text-[10px] text-on-surface/60">{pips} pip{pips !== 1 ? 's' : ''}</span>
                                    <span
                                      className="text-[10px] font-bold"
                                      style={{ color: status === 'ok' ? '#4ade80' : status === 'low' ? '#fbbf24' : '#f87171' }}
                                    >
                                      {have} / {rec} sources
                                      {delta < 0 ? ` (${delta})` : ''}
                                    </span>
                                  </div>
                                  <div className="h-1 rounded-full overflow-hidden bg-white/5">
                                    <div
                                      className="h-full rounded-full transition-all"
                                      style={{
                                        width:      `${Math.min(100, rec > 0 ? (have / rec) * 100 : 0)}%`,
                                        background: status === 'ok' ? '#4ade80' : status === 'low' ? '#fbbf24' : '#f87171',
                                      }}
                                    />
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        {totalLands < 33 && (
                          <p className="text-[10px] text-orange-400/70 mt-3 flex items-center gap-1">
                            <span className="material-symbols-outlined text-[12px]">warning</span>
                            Only {totalLands} lands — Commander decks typically need 36–38
                          </p>
                        )}
                      </div>
                    );
                  })()}

                  {/* Export toolbar — only shown when deck is mounted and statuses loaded */}
                  {deck?.recipient_id && Object.keys(cardStatuses).length > 0 && (() => {
                    const counts = { missing: 0, proxy: 0, inCollection: 0, inRecipient: 0 };
                    for (const dc of deckCards) {
                      const st = cardStatuses[dc.oracle_id];
                      if (st === 'missing') counts.missing += dc.quantity || 1;
                      else if (st === 'proxy') counts.proxy += dc.quantity || 1;
                      else if (st === 'in-collection') counts.inCollection += dc.quantity || 1;
                      else if (st === 'in-recipient' || st === 'in-recipient-diff') counts.inRecipient += dc.quantity || 1;
                    }
                    return (
                      <div className="flex flex-wrap items-center gap-2 mb-5 p-3 rounded-xl bg-surface border border-white/5">
                        <div className="flex items-center gap-3 flex-1 min-w-0 flex-wrap gap-y-1">
                          {counts.inRecipient > 0 && <span className="flex items-center gap-1.5 text-[11px]"><span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" /><span className="text-green-400">{counts.inRecipient} assembled</span></span>}
                          {counts.inCollection > 0 && <span className="flex items-center gap-1.5 text-[11px]"><span className="w-2 h-2 rounded-full bg-yellow-500 flex-shrink-0" /><span className="text-yellow-400">{counts.inCollection} in collection</span></span>}
                          {counts.proxy > 0 && <span className="flex items-center gap-1.5 text-[11px]"><span className="w-2 h-2 rounded-full bg-teal-300 flex-shrink-0" /><span className="text-teal-300">{counts.proxy} proxied</span></span>}
                          {counts.missing > 0 && <span className="flex items-center gap-1.5 text-[11px]"><span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" /><span className="text-red-400">{counts.missing} missing</span></span>}
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <button onClick={() => handleExportMissing(false)} title="Copy missing cards list"
                            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-surface-container border border-white/5 text-on-surface-variant hover:text-on-surface hover:bg-white/5 transition-all text-[11px] font-bold">
                            <span className="material-symbols-outlined text-[13px]">content_copy</span>Missing
                          </button>
                          <button onClick={() => handleExportMissing(true)} title="Copy missing + proxy cards list"
                            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-surface-container border border-white/5 text-on-surface-variant hover:text-on-surface hover:bg-white/5 transition-all text-[11px] font-bold">
                            <span className="material-symbols-outlined text-[13px]">content_copy</span>Missing + Proxies
                          </button>
                          <button onClick={handleAddMissingToWishlist} title="Add missing cards to wishlist"
                            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-all text-[11px] font-bold">
                            <span className="material-symbols-outlined text-[13px]">bookmark_add</span>Wishlist
                          </button>
                        </div>
                      </div>
                    );
                  })()}
                  {CATEGORY_ORDER.map(cat => {
                    const items = listGroups[cat];
                    if (!items?.length) return null;
                    return (
                      <div key={cat} className="mb-8">
                        <div className="flex items-center gap-3 mb-3 pb-2 border-b border-white/5">
                          <h3 className="font-label-sm text-[10px] font-bold text-on-surface-variant/50 uppercase tracking-widest">{cat}</h3>
                          <span className="text-[10px] text-on-surface-variant/30">{items.reduce((s, c) => s + (c.quantity || 1), 0)}</span>
                        </div>
                        <div className="space-y-0.5">
                          {items.map(dc => {
                            const detail = cardDetails[dc.oracle_id];
                            const name = detail?.name || dc.oracle_id;
                            const cardLegality = deck?.format ? ((detail?.full_data as any)?.legalities?.[deck.format] || 'not_legal') : null;
                            const isBannedHere = cardLegality === 'banned';
                            const statusDot: Record<string, { color: string; title: string }> = {
                              'in-recipient':      { color: '#22c55e', title: 'In recipient (same print)' },
                              'in-recipient-diff': { color: '#86efac', title: 'In recipient (different print)' },
                              'proxy':             { color: '#6ee7b7', title: 'Proxy' },
                              'in-collection':     { color: '#eab308', title: 'In collection, not in recipient' },
                              'missing':           { color: '#ef4444', title: 'Not in collection' },
                            };
                            const st = cardStatuses[dc.oracle_id];
                            const dot = st ? statusDot[st] : null;
                            const isProxy = !!dc.is_proxy;
                            return (
                              <div key={dc.id} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/[0.03] group">
                                {/* Status dot */}
                                {dot ? (
                                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: dot.color, boxShadow: `0 0 5px ${dot.color}55` }} title={dot.title} />
                                ) : (
                                  <div className="w-2 h-2 flex-shrink-0" />
                                )}
                                {/* Qty controls */}
                                <div className="flex items-center gap-1 flex-shrink-0">
                                  <button onClick={() => handleUpdateQty(dc.id, (dc.quantity || 1) - 1, dc.oracle_id)}
                                    className="w-5 h-5 rounded text-on-surface-variant/40 hover:text-on-surface hover:bg-white/10 flex items-center justify-center transition-all text-sm leading-none">−</button>
                                  <QtyInput
                                    value={dc.quantity || 1}
                                    onChange={v => handleUpdateQty(dc.id, v, dc.oracle_id)}
                                  />
                                  <button onClick={() => handleUpdateQty(dc.id, (dc.quantity || 1) + 1, dc.oracle_id)}
                                    className="w-5 h-5 rounded text-on-surface-variant/40 hover:text-on-surface hover:bg-white/10 flex items-center justify-center transition-all text-sm leading-none">+</button>
                                </div>
                                {/* #17: hover tooltip shows card image */}
                              <span className="relative flex-1 group/name">
                                <span
                                  className="text-body-md text-on-surface font-medium truncate cursor-pointer hover:text-primary transition-colors"
                                  onClick={() => setDetailOracleId(dc.oracle_id)}
                                >
                                  {name}
                                </span>
                                {isBannedHere && (
                                  <span className="text-[8px] font-black px-1.5 py-0.5 rounded ml-1.5 uppercase tracking-wide flex-shrink-0" style={{ background: 'rgba(239,68,68,0.15)', color: '#f87171', border: '1px solid rgba(239,68,68,0.25)' }} title={`Banned in ${deck?.format}`}>BANNED</span>
                                )}
                                {detail && getImageUrl(detail) && (
                                  <div className="absolute left-0 bottom-full mb-2 z-50 pointer-events-none opacity-0 group-hover/name:opacity-100 transition-opacity duration-150 delay-300">
                                    <img
                                      src={getImageUrl(detail)}
                                      alt={name}
                                      className="w-[120px] rounded-lg shadow-2xl border border-white/10"
                                    />
                                  </div>
                                )}
                              </span>
                                <span className="text-[10px] text-on-surface-variant/35 truncate w-40 hidden md:block">{detail?.type_line || ''}</span>
                                <div className="flex gap-0.5 items-center justify-end flex-shrink-0" dangerouslySetInnerHTML={{ __html: pipHtml(detail?.mana_cost || '') }} />
                                {/* Commander toggle */}
                                <button
                                  onClick={() => handleToggleBoard(dc.id, dc.board, 'commander', 'main')}
                                  title={dc.board === 'commander' ? 'Remove Commander' : 'Set as Commander'}
                                  className={`opacity-0 group-hover:opacity-100 w-6 h-6 rounded flex items-center justify-center transition-all flex-shrink-0 ${dc.board === 'commander' ? 'text-primary' : 'text-on-surface-variant/30 hover:text-primary'} hover:bg-primary/10`}
                                >
                                  <span className="material-symbols-outlined text-[14px]">crown</span>
                                </button>
                                {/* Sideboard toggle */}
                                <button
                                  onClick={() => handleToggleBoard(dc.id, dc.board, 'sideboard', 'main')}
                                  title={dc.board === 'sideboard' ? 'Move to Main' : 'Move to Sideboard'}
                                  className={`opacity-0 group-hover:opacity-100 w-6 h-6 rounded flex items-center justify-center transition-all flex-shrink-0 ${dc.board === 'sideboard' ? 'text-blue-400' : 'text-on-surface-variant/30 hover:text-blue-400'} hover:bg-blue-500/10`}
                                >
                                  <span className="material-symbols-outlined text-[14px]">move_down</span>
                                </button>
                                {/* Proxy toggle */}
                                <button
                                  onClick={() => handleToggleProxy(dc.id, dc.is_proxy)}
                                  title={isProxy ? 'Remove proxy mark' : 'Mark as proxy'}
                                  className={`w-6 h-6 rounded flex items-center justify-center transition-all flex-shrink-0 ${isProxy ? 'text-teal-300' : 'opacity-0 group-hover:opacity-100 text-on-surface-variant/30 hover:text-teal-300'} hover:bg-teal-500/10`}
                                >
                                  <span className="material-symbols-outlined text-[14px]" style={{ fontVariationSettings: isProxy ? "'FILL' 1" : "'FILL' 0" }}>content_copy</span>
                                </button>
                                {/* Remove */}
                                <button onClick={() => handleRemoveCard(dc.id, dc.oracle_id)}
                                  className="opacity-0 group-hover:opacity-100 w-6 h-6 rounded flex items-center justify-center text-on-surface-variant/40 hover:text-red-400 hover:bg-red-500/10 transition-all flex-shrink-0">
                                  <span className="material-symbols-outlined text-[14px]">close</span>
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          </div>

          {/* Card search panel — absolute within canvas area, below header/arrangement bar */}
          {/* Missing cards panel */}
          {tab === 'missing' && (
            <div className="absolute inset-0 overflow-y-auto bg-background">
              <div className="max-w-3xl mx-auto px-8 py-6">
                {/* Header */}
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h2 className="font-headline-md text-lg text-on-surface font-bold">Missing Cards</h2>
                    <p className="text-[11px] text-on-surface-variant/45 mt-0.5">
                      {missingCards.length} card{missingCards.length !== 1 ? 's' : ''} not in your collection
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="text-xl font-black tabular-nums" style={{ color: '#f87171' }}>
                      ${missingCards.reduce((s, c) => s + c.totalUsd, 0).toFixed(2)}
                    </div>
                    <div className="text-[10px] text-on-surface-variant/35 mt-0.5">estimated cost to complete</div>
                  </div>
                </div>

                {/* Action bar */}
                <div className="flex items-center gap-2 mb-5">
                  <button
                    onClick={() => handleExportMissing(false)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-container border border-white/5 text-on-surface-variant hover:text-on-surface hover:bg-white/5 transition-all text-[11px] font-bold"
                  >
                    <span className="material-symbols-outlined text-[13px]">content_copy</span>Copy List
                  </button>
                  <button
                    onClick={handleAddMissingToWishlist}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-all text-[11px] font-bold"
                  >
                    <span className="material-symbols-outlined text-[13px]">bookmark_add</span>Add All to Wishlist
                  </button>
                </div>

                {/* Card table */}
                <div className="rounded-xl border border-white/5 overflow-hidden">
                  <div className="grid text-[9px] font-bold uppercase tracking-widest text-on-surface-variant/30 px-4 py-2 border-b border-white/5" style={{ gridTemplateColumns: '1fr 140px 80px 72px' }}>
                    <span>Card</span><span>Type</span><span className="text-right">Price</span><span className="text-right">Action</span>
                  </div>
                  {missingCards.map(({ dc, detail, usd }) => {
                    const name = detail?.name || dc.oracle_id;
                    const artUrl = (() => {
                      const fd = (detail?.full_data || {}) as Record<string, any>;
                      return fd.image_uris?.art_crop || fd.card_faces?.[0]?.image_uris?.art_crop || '';
                    })();
                    return (
                      <div
                        key={dc.id}
                        className="grid items-center px-4 py-2.5 border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors group"
                        style={{ gridTemplateColumns: '1fr 140px 80px 72px' }}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          {artUrl && (
                            <div className="w-10 h-7 rounded overflow-hidden flex-shrink-0">
                              <img src={artUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
                            </div>
                          )}
                          <button
                            className="text-[12px] font-semibold text-on-surface truncate hover:text-primary transition-colors text-left"
                            onClick={() => setDetailOracleId(dc.oracle_id)}
                          >
                            {dc.quantity && dc.quantity > 1 ? `${dc.quantity}× ` : ''}{name}
                          </button>
                        </div>
                        <span className="text-[10px] text-on-surface-variant/35 truncate">{detail?.type_line || ''}</span>
                        <span className="text-[12px] font-bold tabular-nums text-right" style={{ color: usd > 20 ? '#f87171' : usd > 5 ? '#f2ca83' : 'rgba(255,255,255,0.5)' }}>
                          {usd > 0 ? `$${usd.toFixed(2)}` : '—'}
                        </span>
                        <div className="flex justify-end">
                          <button
                            onClick={() => window.libraryAPI.addToWishlist?.({ oracleId: dc.oracle_id, quantity: dc.quantity || 1 }).catch(() => {})}
                            className="opacity-0 group-hover:opacity-100 flex items-center gap-1 px-2 py-1 rounded-md text-[9px] font-bold transition-all"
                            style={{ background: 'rgba(242,202,131,0.08)', border: '1px solid rgba(242,202,131,0.15)', color: 'rgba(242,202,131,0.6)' }}
                            title="Add to wishlist"
                          >
                            <span className="material-symbols-outlined text-[11px]">bookmark_add</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

              </div>
            </div>
          )}

          {/* ── Combos panel ── */}
          {tab === 'combos' && (
            <div className="absolute inset-0 overflow-y-auto bg-background">
              <div className="max-w-3xl mx-auto px-8 py-6">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h2 className="font-headline-md text-lg text-on-surface font-bold">Combo Detection</h2>
                    <p className="text-[11px] text-on-surface-variant/45 mt-0.5">Powered by Commander Spellbook</p>
                  </div>
                  <button
                    onClick={async () => {
                      setCombosStatus('loading');
                      try {
                        const names = deckCards
                          .filter(dc => dc.board !== 'sideboard')
                          .map(dc => cardDetails[dc.oracle_id]?.name)
                          .filter((n): n is string => !!n);
                        const results = await window.cardsAPI.fetchSpellbookCombos({ cardNames: names });
                        setCombos(results || []);
                        setCombosStatus('done');
                      } catch { setCombosStatus('error'); }
                    }}
                    disabled={combosStatus === 'loading'}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl text-[12px] font-bold transition-all disabled:opacity-40"
                    style={{ background: 'rgba(192,132,252,0.12)', border: '1px solid rgba(192,132,252,0.25)', color: '#c084fc' }}
                  >
                    {combosStatus === 'loading' ? (
                      <><span className="material-symbols-outlined text-[15px] animate-spin">sync</span>Scanning…</>
                    ) : (
                      <><span className="material-symbols-outlined text-[15px]">auto_fix_high</span>Find Combos</>
                    )}
                  </button>
                </div>

                {combosStatus === 'idle' && (
                  <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
                    <span className="material-symbols-outlined text-[56px] text-on-surface-variant/10">auto_fix_high</span>
                    <p className="text-[13px] text-on-surface-variant/30">Click "Find Combos" to detect combos in your deck</p>
                  </div>
                )}

                {combosStatus === 'done' && combos.length === 0 && (
                  <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
                    <span className="material-symbols-outlined text-[56px] text-on-surface-variant/10">search_off</span>
                    <p className="text-[13px] text-on-surface-variant/30">No combos found in this deck</p>
                  </div>
                )}

                {combosStatus === 'error' && (
                  <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
                    <p className="text-[13px] text-red-400/70">Failed to fetch combos — check your connection</p>
                  </div>
                )}

                {combosStatus === 'done' && combos.length > 0 && (
                  <div className="space-y-3">
                    <p className="text-[11px] text-on-surface-variant/40 mb-4">{combos.length} combo{combos.length !== 1 ? 's' : ''} found</p>
                    {combos.map(combo => (
                      <div key={combo.id} className="rounded-xl overflow-hidden" style={{ background: 'rgba(192,132,252,0.05)', border: '1px solid rgba(192,132,252,0.15)' }}>
                        <div className="px-4 py-2 flex items-center gap-2 flex-wrap" style={{ background: 'rgba(192,132,252,0.08)' }}>
                          {combo.cards.map((c, i) => (
                            <span key={i}>
                              <button
                                onClick={() => setDetailOracleId(deckCards.find(dc => cardDetails[dc.oracle_id]?.name === c)?.oracle_id ?? null)}
                                className="text-[11px] font-bold text-purple-300 hover:text-purple-200 transition-colors"
                              >{c}</button>
                              {i < combo.cards.length - 1 && <span className="text-[10px] text-on-surface-variant/30 mx-1">+</span>}
                            </span>
                          ))}
                        </div>
                        <div className="px-4 py-2.5">
                          {combo.results.length > 0 && (
                            <div className="flex flex-wrap gap-1 mb-1.5">
                              {combo.results.map((r, i) => (
                                <span key={i} className="text-[9px] px-2 py-0.5 rounded-full font-bold" style={{ background: 'rgba(192,132,252,0.12)', color: '#c084fc', border: '1px solid rgba(192,132,252,0.2)' }}>{r}</span>
                              ))}
                            </div>
                          )}
                          {combo.description && (
                            <p className="text-[11px] text-on-surface/55 leading-snug">{combo.description.slice(0, 200)}{combo.description.length > 200 ? '…' : ''}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          <CardSearchPanel
            ref={searchPanelRef}
            isOpen={searchOpen && !detailOracleId}
            onClose={() => setSearchOpen(false)}
            title="Add Card"
            onSelectCard={handleAddCard}
            onAddAll={handleAddAll}
          />

          {/* Card detail panel — absolute within canvas area */}
          <CardDetailPanel
            oracleId={detailOracleId}
            deckId={deckId}
            addBoard="main"
            deckFormat={deck?.format}
            initialImageUrl={detailOracleId ? preferredImagesRef.current[detailOracleId] : undefined}
            onClose={() => setDetailOracleId(null)}
            onAddToDeck={handleAddFromDetail}
            onCoverChange={(url) => setDeck(prev => prev ? { ...prev, cover_image_url: url } : prev)}
            onPrintingChange={handlePrintingChange}
            onFindSimilar={(query) => {
              setDetailOracleId(null);
              setSearchOpen(true);
              setTimeout(() => searchPanelRef.current?.setFilters({ query }), 50);
            }}
          />

        </div>{/* end canvas+list wrapper */}
      </main>

      {/* Deck settings modal */}
      <DeckSettingsModal
        deck={deck}
        isOpen={deckSettingsOpen}
        onClose={() => setDeckSettingsOpen(false)}
        onSave={handleSaveDeckSettings}
      />

      {/* Add Group modal */}
      {groupModalOpen && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}
          onClick={e => { if (e.target === e.currentTarget) { pendingGroupFromSelRef.current = null; setGroupModalOpen(false); } }}
        >
          <div className="glass-panel rounded-2xl p-6 w-96 shadow-2xl border border-white/5">
            <h3 className="font-headline-md text-base text-on-surface font-bold mb-4">New Group</h3>

            {/* Color + Name row */}
            <label className="text-label-md text-on-surface-variant/60 block mb-1.5">Name</label>
            <div className="flex items-center gap-2 mb-4">
              <label
                className="w-8 h-8 rounded-full flex-shrink-0 cursor-pointer relative overflow-hidden border-2 transition-all hover:scale-105"
                style={{ borderColor: groupColor + '88', background: groupColor }}
                title="Pick color"
              >
                <input
                  type="color"
                  value={groupColor}
                  onChange={e => setGroupColor(e.target.value)}
                  className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                />
              </label>
              <input
                type="text"
                value={groupName}
                onChange={e => setGroupName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleAddGroup(); if (e.key === 'Escape') { pendingGroupFromSelRef.current = null; setGroupModalOpen(false); } }}
                placeholder="New Group"
                autoFocus
                className="flex-1 bg-surface-container/60 border border-white/5 rounded-lg px-3 py-2 text-body-md text-on-surface focus:outline-none focus:border-primary/50 placeholder:text-on-surface-variant/30"
              />
            </div>

            {/* Pre Select By */}
            <label className="text-label-md text-on-surface-variant/60 block mb-2">Pre Select By</label>
            <div className="flex gap-1.5 mb-3">
              {(['none', 'type', 'oracle'] as const).map(opt => (
                <button
                  key={opt}
                  onClick={() => setGroupPreSelect(opt)}
                  className="px-2.5 py-1 rounded-md text-[10px] font-bold transition-all border"
                  style={{
                    background:  groupPreSelect === opt ? 'rgba(242,202,131,0.12)' : 'rgba(255,255,255,0.04)',
                    borderColor: groupPreSelect === opt ? 'rgba(242,202,131,0.35)' : 'rgba(255,255,255,0.07)',
                    color:       groupPreSelect === opt ? '#f2ca83'                 : 'rgba(255,255,255,0.4)',
                  }}
                >
                  {opt === 'none' ? 'None' : opt === 'type' ? 'Card Type' : 'Oracle Text'}
                </button>
              ))}
            </div>

            {groupPreSelect === 'type' && (
              <div className="mb-4 space-y-2">
                <div
                  className="flex flex-wrap gap-1.5 min-h-[38px] bg-surface-container/60 border border-white/5 rounded-lg px-2 py-1.5 focus-within:border-primary/50 cursor-text"
                  onClick={e => (e.currentTarget.querySelector('input') as HTMLInputElement)?.focus()}
                >
                  {groupPreSelectTypeTags.map(tag => (
                    <span key={tag} className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold flex-shrink-0" style={{ background: 'rgba(242,202,131,0.15)', border: '1px solid rgba(242,202,131,0.3)', color: '#f2ca83' }}>
                      {tag}
                      <button onClick={() => setGroupPreSelectTypeTags(prev => prev.filter(t => t !== tag))} className="opacity-60 hover:opacity-100 transition-opacity leading-none">✕</button>
                    </span>
                  ))}
                  <input
                    type="text"
                    value={groupPreSelectTypeDraft}
                    onChange={e => setGroupPreSelectTypeDraft(e.target.value)}
                    onKeyDown={e => {
                      if ((e.key === 'Enter' || e.key === ',') && groupPreSelectTypeDraft.trim()) {
                        e.preventDefault();
                        const val = groupPreSelectTypeDraft.trim().replace(/,$/, '');
                        if (val && !groupPreSelectTypeTags.includes(val)) setGroupPreSelectTypeTags(prev => [...prev, val]);
                        setGroupPreSelectTypeDraft('');
                      } else if (e.key === 'Backspace' && !groupPreSelectTypeDraft && groupPreSelectTypeTags.length) {
                        setGroupPreSelectTypeTags(prev => prev.slice(0, -1));
                      }
                    }}
                    placeholder={groupPreSelectTypeTags.length ? '' : 'Creature, Human, Snow…'}
                    className="flex-1 min-w-[80px] bg-transparent text-[11px] text-on-surface focus:outline-none placeholder:text-on-surface-variant/30"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-[9px] text-on-surface-variant/30">Types, subtypes or supertypes. Enter or , to add.</p>
                  <div className="flex bg-surface-container/40 rounded-lg p-0.5 gap-0.5">
                    {(['or', 'and'] as const).map(op => (
                      <button key={op} onClick={() => setGroupPreSelectTypeOp(op)} className="px-2.5 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider transition-all" style={{ background: groupPreSelectTypeOp === op ? 'rgba(242,202,131,0.15)' : 'transparent', color: groupPreSelectTypeOp === op ? '#f2ca83' : 'rgba(255,255,255,0.3)' }}>{op}</button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {groupPreSelect === 'oracle' && (
              <div className="mb-4 space-y-2">
                <div
                  className="flex flex-wrap gap-1.5 min-h-[38px] bg-surface-container/60 border border-white/5 rounded-lg px-2 py-1.5 focus-within:border-primary/50 cursor-text"
                  onClick={e => (e.currentTarget.querySelector('input') as HTMLInputElement)?.focus()}
                >
                  {groupPreSelectOracleTags.map(tag => (
                    <span key={tag} className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold font-mono flex-shrink-0" style={{ background: 'rgba(167,139,250,0.15)', border: '1px solid rgba(167,139,250,0.3)', color: '#a78bfa' }}>
                      {tag}
                      <button onClick={() => setGroupPreSelectOracleTags(prev => prev.filter(t => t !== tag))} className="opacity-60 hover:opacity-100 transition-opacity leading-none">✕</button>
                    </span>
                  ))}
                  <input
                    type="text"
                    value={groupPreSelectOracleDraft}
                    onChange={e => setGroupPreSelectOracleDraft(e.target.value)}
                    onKeyDown={e => {
                      if ((e.key === 'Enter' || e.key === ',') && groupPreSelectOracleDraft.trim()) {
                        e.preventDefault();
                        const val = groupPreSelectOracleDraft.trim().replace(/,$/, '');
                        if (val && !groupPreSelectOracleTags.includes(val)) setGroupPreSelectOracleTags(prev => [...prev, val]);
                        setGroupPreSelectOracleDraft('');
                      } else if (e.key === 'Backspace' && !groupPreSelectOracleDraft && groupPreSelectOracleTags.length) {
                        setGroupPreSelectOracleTags(prev => prev.slice(0, -1));
                      }
                    }}
                    placeholder={groupPreSelectOracleTags.length ? '' : 'draw a card, scry, enters.*tapped…'}
                    className="flex-1 min-w-[80px] bg-transparent text-[11px] font-mono text-on-surface focus:outline-none placeholder:text-on-surface-variant/30"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-[9px] text-on-surface-variant/30">Regex supported. Matched against oracle text. Enter or , to add.</p>
                  <div className="flex bg-surface-container/40 rounded-lg p-0.5 gap-0.5">
                    {(['or', 'and'] as const).map(op => (
                      <button key={op} onClick={() => setGroupPreSelectOracleOp(op)} className="px-2.5 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider transition-all" style={{ background: groupPreSelectOracleOp === op ? 'rgba(242,202,131,0.15)' : 'transparent', color: groupPreSelectOracleOp === op ? '#f2ca83' : 'rgba(255,255,255,0.3)' }}>{op}</button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div className="flex gap-3 mt-2">
              <button onClick={() => { pendingGroupFromSelRef.current = null; setGroupModalOpen(false); }} className="flex-1 py-2 rounded-lg border border-white/5 text-on-surface-variant text-label-md font-bold hover:bg-white/5 transition-all">Cancel</button>
              <button onClick={handleAddGroup} className="flex-1 py-2 rounded-lg bg-primary/10 border border-primary/20 text-primary text-label-md font-bold hover:bg-primary/20 transition-all">Create</button>
            </div>
          </div>
        </div>
      )}

      {/* Pre-select confirmation modal */}
      {preSelectConfirm && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
        >
          <div className="glass-panel rounded-2xl shadow-2xl border border-white/5 w-[480px] max-h-[70vh] flex flex-col">
            {/* Header */}
            <div className="px-6 pt-5 pb-4 border-b border-white/5 flex-shrink-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="material-symbols-outlined text-[16px]" style={{ color: '#f2ca83' }}>warning</span>
                <h3 className="font-headline-md text-base text-on-surface font-bold">Cards Already in Groups</h3>
              </div>
              <p className="text-[11px] text-on-surface-variant/50">
                {preSelectConfirm.conflicts.reduce((s, c) => s + c.cards.length, 0)} cards across {preSelectConfirm.conflicts.length} group{preSelectConfirm.conflicts.length !== 1 ? 's' : ''} match your pre-select rule.
                {preSelectConfirm.freeCards.length > 0 && (
                  <span className="text-on-surface-variant/35"> {preSelectConfirm.freeCards.length} free card{preSelectConfirm.freeCards.length !== 1 ? 's' : ''} will move automatically.</span>
                )}
              </p>
            </div>

            {/* Accordions */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
              {preSelectConfirm.conflicts.map((conflict, ci) => {
                const isOpen = preSelectConfirmOpen.has(ci);
                const selectedCount = conflict.cards.filter(card => preSelectConfirmSel.has(card.el)).length;
                const allSelected = selectedCount === conflict.cards.length;
                const noneSelected = selectedCount === 0;

                const toggleGroupAll = () => {
                  setPreSelectConfirmSel(prev => {
                    const next = new Set(prev);
                    if (allSelected) {
                      conflict.cards.forEach(card => next.delete(card.el));
                    } else {
                      conflict.cards.forEach(card => next.add(card.el));
                    }
                    return next;
                  });
                };

                const toggleAccordion = () => {
                  setPreSelectConfirmOpen(prev => {
                    const next = new Set(prev);
                    next.has(ci) ? next.delete(ci) : next.add(ci);
                    return next;
                  });
                };

                return (
                  <div key={ci} className="rounded-xl border overflow-hidden" style={{ borderColor: conflict.groupColor + '33', background: 'rgba(255,255,255,0.02)' }}>
                    {/* Accordion header */}
                    <div className="flex items-center gap-2.5 px-3 py-2.5">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        ref={el => { if (el) el.indeterminate = !allSelected && !noneSelected; }}
                        onChange={toggleGroupAll}
                        className="flex-shrink-0 accent-primary w-3.5 h-3.5 cursor-pointer"
                      />
                      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: conflict.groupColor, boxShadow: `0 0 6px ${conflict.groupColor}66` }} />
                      <button onClick={toggleAccordion} className="flex-1 flex items-center justify-between text-left min-w-0">
                        <span className="text-[12px] font-bold text-on-surface truncate">{conflict.groupName}</span>
                        <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: conflict.groupColor + '22', color: conflict.groupColor }}>
                            {selectedCount}/{conflict.cards.length} selected
                          </span>
                          <span className="material-symbols-outlined text-[14px] text-on-surface-variant/40 transition-transform" style={{ transform: isOpen ? 'rotate(180deg)' : 'none' }}>expand_more</span>
                        </div>
                      </button>
                    </div>

                    {/* Accordion body */}
                    {isOpen && (
                      <div className="px-3 pb-3 border-t border-white/5 pt-2 grid grid-cols-1 gap-1">
                        {conflict.cards.map((card, ki) => {
                          const checked = preSelectConfirmSel.has(card.el);
                          return (
                            <label key={ki} className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg cursor-pointer transition-all hover:bg-white/5">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => {
                                  setPreSelectConfirmSel(prev => {
                                    const next = new Set(prev);
                                    checked ? next.delete(card.el) : next.add(card.el);
                                    return next;
                                  });
                                }}
                                className="flex-shrink-0 accent-primary w-3.5 h-3.5 cursor-pointer"
                              />
                              {card.artUrl ? (
                                <img src={card.artUrl} alt="" className="w-10 h-7 rounded object-cover flex-shrink-0" loading="lazy" />
                              ) : (
                                <div className="w-10 h-7 rounded flex items-center justify-center flex-shrink-0 bg-white/5">
                                  <span className="material-symbols-outlined text-[14px] text-white/20">playing_cards</span>
                                </div>
                              )}
                              <span className="text-[11px] text-on-surface/80 truncate">{card.name}</span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-white/5 flex-shrink-0 flex gap-3">
              <button onClick={handleCancelPreSelect} className="flex-1 py-2 rounded-lg border border-white/5 text-on-surface-variant text-label-md font-bold hover:bg-white/5 transition-all">Cancel</button>
              <button
                onClick={handleConfirmPreSelect}
                className="flex-1 py-2 rounded-lg bg-primary/10 border border-primary/20 text-primary text-label-md font-bold hover:bg-primary/20 transition-all"
              >
                {(() => {
                  const n = preSelectConfirm.conflicts.reduce((s, c) => s + c.cards.filter(card => preSelectConfirmSel.has(card.el)).length, 0) + preSelectConfirm.freeCards.length;
                  return `Move ${n} Card${n !== 1 ? 's' : ''}`;
                })()}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Widget picker modal */}
      {widgetPickerOpen && (
        <div
          className="fixed inset-0 z-[700] flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(5px)' }}
          onClick={e => { if (e.target === e.currentTarget) setWidgetPickerOpen(false); }}
        >
          <div className="glass-panel rounded-2xl shadow-2xl border border-white/5 w-[560px] max-h-[76vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/5 flex-shrink-0">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[18px]">widgets</span>
                <h3 className="font-headline-md text-[15px] font-bold text-on-surface">Widgets</h3>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { setWidgetEditorDef(null); setWidgetEditorOpen(true); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/20 text-primary text-[11px] font-bold hover:bg-primary/20 transition-all"
                >
                  <span className="material-symbols-outlined text-[14px]">add</span>New Widget
                </button>
                <button
                  onClick={() => setWidgetPickerOpen(false)}
                  className="w-7 h-7 rounded-md flex items-center justify-center text-on-surface-variant hover:bg-white/10 transition-all"
                >
                  <span className="material-symbols-outlined text-[18px]">close</span>
                </button>
              </div>
            </div>

            {/* Widget grid — key on version so it re-renders after save/delete */}
            <div key={widgetRegistryVersion} className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

              {/* Built-ins section */}
              {WidgetRegistry.getAll().some(d => d.readonly) && (
                <div>
                  <p className="text-[9px] font-bold uppercase tracking-widest text-on-surface-variant/30 mb-2.5 px-0.5">Built-in</p>
                  <div className="grid grid-cols-2 gap-2.5">
                    {WidgetRegistry.getAll().filter(d => d.readonly).map(def => (
                      <button
                        key={def.id}
                        onClick={() => { spawnWidgetOnCanvas(def.id); setWidgetPickerOpen(false); }}
                        className="flex items-start gap-3 p-3 rounded-xl border border-white/5 bg-surface-container/40 hover:bg-white/5 hover:border-primary/20 transition-all text-left group"
                      >
                        <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 bg-primary/10 group-hover:bg-primary/20 transition-all mt-0.5">
                          <span className="material-symbols-outlined text-primary text-[16px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                            {def.icon}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[11px] font-bold text-on-surface leading-tight mb-0.5">{def.name}</p>
                          <p className="text-[10px] text-on-surface-variant/45 leading-snug">{def.description}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Custom widgets section */}
              {WidgetRegistry.getAll().some(d => !d.readonly) && (
                <div>
                  <p className="text-[9px] font-bold uppercase tracking-widest text-on-surface-variant/30 mb-2.5 px-0.5">My Widgets</p>
                  <div className="grid grid-cols-2 gap-2.5">
                    {WidgetRegistry.getAll().filter(d => !d.readonly).map(def => (
                      <div
                        key={def.id}
                        className="flex items-start gap-3 p-3 rounded-xl border border-white/5 bg-surface-container/40 hover:border-primary/20 transition-all group relative"
                      >
                        {/* Click area → spawn */}
                        <button
                          className="flex items-start gap-3 flex-1 text-left min-w-0"
                          onClick={() => { spawnWidgetOnCanvas(def.id); setWidgetPickerOpen(false); }}
                        >
                          <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 bg-primary/10 group-hover:bg-primary/20 transition-all mt-0.5">
                            <span className="material-symbols-outlined text-primary text-[16px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                              {def.icon}
                            </span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[11px] font-bold text-on-surface leading-tight mb-0.5">{def.name}</p>
                            <p className="text-[10px] text-on-surface-variant/45 leading-snug">{def.description}</p>
                          </div>
                        </button>
                        {/* Edit / Delete hover actions */}
                        <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 -mt-0.5 -mr-0.5">
                          <button
                            title="Edit widget"
                            onClick={() => { setWidgetEditorDef(def); setWidgetEditorOpen(true); }}
                            className="w-6 h-6 rounded flex items-center justify-center text-on-surface-variant/40 hover:text-primary hover:bg-primary/10 transition-all"
                          >
                            <span className="material-symbols-outlined text-[13px]">edit</span>
                          </button>
                          <button
                            title="Delete widget"
                            onClick={async () => {
                              WidgetRegistry.unregister(def.id);
                              await persistCustomWidgets();
                              bumpWidgetVersion();
                            }}
                            className="w-6 h-6 rounded flex items-center justify-center text-on-surface-variant/40 hover:text-red-400 hover:bg-red-500/10 transition-all"
                          >
                            <span className="material-symbols-outlined text-[13px]">delete_outline</span>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Card Overlays section */}
              {CardDecoratorRegistry.getAll().length > 0 && (
                <div>
                  <p className="text-[9px] font-bold uppercase tracking-widest text-on-surface-variant/30 mb-2.5 px-0.5">Card Overlays</p>
                  <div className="grid grid-cols-2 gap-2.5">
                    {CardDecoratorRegistry.getAll().filter(d => d.readonly).map(def => (
                      <button
                        key={def.id}
                        onClick={() => { spawnDecoratorOnCanvas(def.id); setWidgetPickerOpen(false); }}
                        className="flex items-start gap-3 p-3 rounded-xl border border-white/5 bg-surface-container/40 hover:bg-white/5 hover:border-primary/20 transition-all text-left group"
                      >
                        <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 bg-primary/10 group-hover:bg-primary/20 transition-all mt-0.5">
                          <span className="material-symbols-outlined text-primary text-[16px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                            {def.icon}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[11px] font-bold text-on-surface leading-tight mb-0.5">{def.name}</p>
                          <p className="text-[10px] text-on-surface-variant/45 leading-snug">{def.description}</p>
                        </div>
                      </button>
                    ))}
                    {CardDecoratorRegistry.getAll().filter(d => !d.readonly).map(def => (
                      <div
                        key={def.id}
                        className="flex items-start gap-3 p-3 rounded-xl border border-white/5 bg-surface-container/40 hover:border-primary/20 transition-all group relative"
                      >
                        <button
                          className="flex items-start gap-3 flex-1 text-left min-w-0"
                          onClick={() => { spawnDecoratorOnCanvas(def.id); setWidgetPickerOpen(false); }}
                        >
                          <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 bg-primary/10 group-hover:bg-primary/20 transition-all mt-0.5">
                            <span className="material-symbols-outlined text-primary text-[16px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                              {def.icon}
                            </span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[11px] font-bold text-on-surface leading-tight mb-0.5">{def.name}</p>
                            <p className="text-[10px] text-on-surface-variant/45 leading-snug">{def.description}</p>
                          </div>
                        </button>
                        <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0">
                          <button
                            title="Edit overlay"
                            onClick={() => { setWidgetEditorDef(def); setWidgetEditorOpen(true); }}
                            className="w-6 h-6 rounded flex items-center justify-center text-on-surface-variant/40 hover:text-primary hover:bg-primary/10 transition-all"
                          >
                            <span className="material-symbols-outlined text-[13px]">edit</span>
                          </button>
                          <button
                            title="Delete overlay"
                            onClick={async () => {
                              CardDecoratorRegistry.unregister(def.id);
                              await persistCustomDecorators();
                              bumpWidgetVersion();
                            }}
                            className="w-6 h-6 rounded flex items-center justify-center text-on-surface-variant/40 hover:text-red-400 hover:bg-red-500/10 transition-all"
                          >
                            <span className="material-symbols-outlined text-[13px]">delete_outline</span>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {WidgetRegistry.getAll().length === 0 && CardDecoratorRegistry.getAll().length === 0 && (
                <div className="flex flex-col items-center justify-center h-32 gap-2 text-on-surface-variant/30">
                  <span className="material-symbols-outlined text-[36px]">widgets</span>
                  <p className="text-[12px]">No widgets yet</p>
                </div>
              )}
            </div>

            {/* Footer hint */}
            <div className="px-5 py-3 border-t border-white/5 flex-shrink-0">
              <p className="text-[10px] text-on-surface-variant/30">
                Click a widget or overlay to place it on the canvas · Updates live as you edit the deck
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Widget / overlay editor modal */}
      {widgetEditorOpen && (
        <WidgetEditorModal
          def={widgetEditorDef}
          previewData={buildWidgetDataFromState(deckCardsRef.current, cardDetailsRef.current)}
          onClose={() => setWidgetEditorOpen(false)}
          onSave={async (saved) => {
            WidgetRegistry.register({ ...saved, readonly: false });
            await persistCustomWidgets();
            bumpWidgetVersion();
            setWidgetEditorOpen(false);
          }}
          onSaveOverlay={async (saved) => {
            CardDecoratorRegistry.register({ ...saved, readonly: false });
            await persistCustomDecorators();
            bumpWidgetVersion();
            setWidgetEditorOpen(false);
          }}
        />
      )}

      {/* Close group menu on outside click */}
      {groupMenu && (
        <div className="fixed inset-0 z-[599]" onClick={() => setGroupMenu(null)} />
      )}

      {/* Close card context menu on outside click */}
      {cardMenu && (
        <div className="fixed inset-0 z-[600]" onClick={() => setCardMenu(null)} />
      )}

      {/* Close multi-select menu on outside click */}
      {multiMenu && (
        <div className="fixed inset-0 z-[600]" onClick={() => setMultiMenu(null)} />
      )}

      <ToastStack />
      <ConfirmDialog />

      {/* Deck import modal */}
      {importOpen && (
        <ImportDeckModal
          deckId={deckId}
          onClose={() => setImportOpen(false)}
          onImported={async (count) => {
            setImportOpen(false);
            if (count > 0) {
              await loadDeckData();   // refs are written synchronously inside
              reconcileCanvas();      // spawn any newly-imported cards on the canvas
            }
          }}
        />
      )}
    </div>
  );
}

// ─── Import Deck Modal ────────────────────────────────────────────────────────

interface ImportResult { name: string; status: 'ok' | 'notfound' | 'error'; qty: number }

function parseDecklist(text: string): { qty: number; name: string }[] {
  return text.split('\n').flatMap(line => {
    const t = line.trim();
    if (!t || t.startsWith('//') || t.startsWith('#')) return [];
    const m = t.match(/^(\d+)[xX]?\s+(.+)$/);
    if (!m) return [];
    return [{ qty: parseInt(m[1], 10), name: m[2].trim() }];
  });
}

function ImportDeckModal({ deckId, onClose, onImported }: {
  deckId: number;
  onClose: () => void;
  onImported: (count: number) => void;
}) {
  const [text, setText] = useState('');
  const [board, setBoard] = useState<'main' | 'sideboard'>('main');
  const [phase, setPhase] = useState<'idle' | 'importing' | 'done'>('idle');
  const [results, setResults] = useState<ImportResult[]>([]);
  const [progress, setProgress] = useState(0);
  const [total, setTotal] = useState(0);

  const handleImport = async () => {
    const parsed = parseDecklist(text);
    if (!parsed.length) return;
    setTotal(parsed.length);
    setProgress(0);
    setResults([]);
    setPhase('importing');

    const out: ImportResult[] = [];
    for (const { qty, name } of parsed) {
      try {
        const res = await window.cardsAPI.search({ q: name, searchIn: 'name', pageSize: 1 });
        const card = res?.cards?.[0];
        if (!card) {
          out.push({ name, qty, status: 'notfound' });
        } else {
          for (let i = 0; i < qty; i++) {
            await window.libraryAPI.addCardToDeck({ deckId, oracleId: card.oracle_id, board });
          }
          out.push({ name, qty, status: 'ok' });
        }
      } catch {
        out.push({ name, qty, status: 'error' });
      }
      setProgress(p => p + 1);
      setResults([...out]);
    }
    setPhase('done');
  };

  const added = results.filter(r => r.status === 'ok').reduce((s, r) => s + r.qty, 0);

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="glass-panel rounded-2xl shadow-2xl border border-white/5 w-[520px] max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 flex-shrink-0">
          <h3 className="font-headline-md text-base font-bold text-on-surface flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-[20px]">file_upload</span>
            Import Decklist
          </h3>
          <button onClick={onClose} className="w-7 h-7 rounded-md flex items-center justify-center text-on-surface-variant hover:bg-white/10 transition-all">
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {phase === 'idle' && (
            <>
              <p className="text-body-md text-on-surface-variant/60 text-[12px]">
                Paste a decklist in MTGO / Moxfield format. Each line: <code className="text-primary/80">4 Lightning Bolt</code>
              </p>
              <textarea
                value={text}
                onChange={e => setText(e.target.value)}
                rows={12}
                placeholder={"// Commander\n1 Atraxa, Praetors' Voice\n\n// Creatures\n4 Birds of Paradise\n2 Llanowar Elves"}
                autoFocus
                className="w-full bg-surface-container/60 border border-white/5 rounded-xl px-4 py-3 text-body-md text-on-surface font-mono text-[12px] resize-none focus:outline-none focus:border-primary/40 placeholder:text-on-surface-variant/25"
              />
              <div className="flex items-center gap-3">
                <span className="text-label-sm text-on-surface-variant/50 text-[11px]">Target board:</span>
                {(['main', 'sideboard'] as const).map(b => (
                  <button key={b} onClick={() => setBoard(b)}
                    className={`px-3 py-1 rounded-md text-[11px] font-bold transition-all capitalize ${board === b ? 'bg-primary/20 text-primary border border-primary/30' : 'text-on-surface-variant/50 hover:bg-white/5 border border-transparent'}`}>
                    {b === 'main' ? 'Main Deck' : 'Sideboard'}
                  </button>
                ))}
              </div>
            </>
          )}

          {phase === 'importing' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-[12px] text-on-surface-variant/60">
                <span>Importing cards…</span>
                <span className="tabular-nums">{progress} / {total}</span>
              </div>
              <div className="w-full h-1.5 bg-surface-container rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-300"
                  style={{ width: `${total ? (progress / total) * 100 : 0}%` }}
                />
              </div>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {results.map((r, i) => (
                  <div key={i} className="flex items-center gap-2 text-[12px]">
                    <span className={`material-symbols-outlined text-[14px] flex-shrink-0 ${r.status === 'ok' ? 'text-green-400' : 'text-red-400/70'}`}>
                      {r.status === 'ok' ? 'check_circle' : 'error'}
                    </span>
                    <span className={`flex-1 truncate ${r.status === 'ok' ? 'text-on-surface' : 'text-on-surface-variant/50'}`}>{r.qty}× {r.name}</span>
                    {r.status === 'notfound' && <span className="text-[10px] text-orange-400/70">not found</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {phase === 'done' && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 py-2">
                <span className="material-symbols-outlined text-green-400 text-[28px]">check_circle</span>
                <div>
                  <p className="font-bold text-on-surface">{added} card{added !== 1 ? 's' : ''} added</p>
                  {results.filter(r => r.status !== 'ok').length > 0 && (
                    <p className="text-[12px] text-orange-400/70">{results.filter(r => r.status !== 'ok').length} card(s) not found</p>
                  )}
                </div>
              </div>
              <div className="space-y-1 max-h-56 overflow-y-auto">
                {results.map((r, i) => (
                  <div key={i} className="flex items-center gap-2 text-[12px]">
                    <span className={`material-symbols-outlined text-[14px] flex-shrink-0 ${r.status === 'ok' ? 'text-green-400' : 'text-orange-400/70'}`}>
                      {r.status === 'ok' ? 'check_circle' : 'help'}
                    </span>
                    <span className={`flex-1 truncate ${r.status === 'ok' ? 'text-on-surface' : 'text-on-surface-variant/50'}`}>{r.qty}× {r.name}</span>
                    {r.status !== 'ok' && <span className="text-[10px] text-orange-400/70">not found</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/5 flex-shrink-0 flex gap-3">
          {phase === 'idle' && (
            <>
              <button onClick={onClose} className="flex-1 py-2 rounded-lg border border-white/5 text-on-surface-variant font-bold text-label-md hover:bg-white/5 transition-all">
                Cancel
              </button>
              <button
                onClick={handleImport}
                disabled={!parseDecklist(text).length}
                className="flex-1 py-2 rounded-lg bg-primary/10 border border-primary/20 text-primary font-bold text-label-md hover:bg-primary/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Import {parseDecklist(text).length > 0 ? `(${parseDecklist(text).length} lines)` : ''}
              </button>
            </>
          )}
          {phase === 'importing' && (
            <div className="flex-1 py-2 text-center text-on-surface-variant/40 text-[12px]">Importing…</div>
          )}
          {phase === 'done' && (
            <button onClick={() => onImported(added)} className="flex-1 py-2 rounded-lg bg-primary/10 border border-primary/20 text-primary font-bold text-label-md hover:bg-primary/20 transition-all">
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Arrangement Tab component ────────────────────────────────────────────────

function ArrangementTab({
  arr, isActive, canDelete, onSwitch, onRename, onDelete,
}: {
  arr: Arrangement;
  isActive: boolean;
  canDelete: boolean;
  onSwitch: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editVal, setEditVal] = useState(arr.name);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const startEdit = () => {
    setCtxMenu(null);
    setEditVal(arr.name);
    setEditing(true);
    setTimeout(() => { inputRef.current?.focus(); inputRef.current?.select(); }, 10);
  };

  const commit = () => {
    setEditing(false);
    const name = editVal.trim() || arr.name;
    onRename(name);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY });
  };

  return (
    <>
      <div
        onClick={editing ? undefined : onSwitch}
        onContextMenu={handleContextMenu}
        className={`arrangement-tab flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] cursor-pointer transition-all select-none flex-shrink-0 ${
          isActive
            ? 'bg-surface-container-high text-primary font-bold'
            : 'text-on-surface-variant/60 hover:bg-white/5 hover:text-on-surface-variant font-medium'
        }`}
      >
        {editing ? (
          <input
            ref={inputRef}
            value={editVal}
            onChange={e => setEditVal(e.target.value)}
            onBlur={commit}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); commit(); }
              if (e.key === 'Escape') { setEditing(false); setEditVal(arr.name); }
            }}
            className="bg-transparent border-b border-primary/60 outline-none text-[11px] font-bold text-primary w-20 max-w-[120px]"
            onClick={e => e.stopPropagation()}
          />
        ) : (
          <span onDoubleClick={e => { e.stopPropagation(); startEdit(); }}>
            {arr.name}
          </span>
        )}
      </div>

      {/* Context menu */}
      {ctxMenu && (
        <>
          <div
            className="fixed inset-0 z-[800]"
            onClick={() => setCtxMenu(null)}
            onContextMenu={e => { e.preventDefault(); setCtxMenu(null); }}
          />
          <div
            className="fixed z-[801] glass-panel rounded-xl shadow-2xl py-1.5 min-w-[170px]"
            style={{ top: ctxMenu.y, left: ctxMenu.x, border: '1px solid rgba(255,255,255,0.07)' }}
          >
            <button
              onClick={startEdit}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-on-surface-variant hover:bg-white/5 hover:text-on-surface transition-all text-label-md"
            >
              <span className="material-symbols-outlined text-[16px]">edit</span>
              Rename
            </button>
            <div className="border-t border-white/5 my-1" />
            <button
              onClick={canDelete ? () => { setCtxMenu(null); onDelete(); } : undefined}
              disabled={!canDelete}
              className={`w-full flex items-center gap-2.5 px-3 py-2 transition-all text-label-md ${
                canDelete
                  ? 'text-red-400/70 hover:bg-red-500/10 hover:text-red-400 cursor-pointer'
                  : 'text-on-surface-variant/25 cursor-not-allowed'
              }`}
            >
              <span className="material-symbols-outlined text-[16px]">delete_outline</span>
              Delete
              {!canDelete && (
                <span className="ml-auto text-[9px] text-on-surface-variant/20 font-normal">only one</span>
              )}
            </button>
          </div>
        </>
      )}
    </>
  );
}
