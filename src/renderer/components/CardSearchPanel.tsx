import { useState, useEffect, useRef, useCallback, useImperativeHandle, forwardRef } from 'react';
import { createPortal } from 'react-dom';
import type { Card } from '../types/electron';

// ─── Mana pip renderer ────────────────────────────────────────────────────────

const MANA_HEX: Record<string, string> = {
  W: '#f0d870', U: '#4a7cc9', B: '#3a3a3a', R: '#c0392b', G: '#27ae60', C: '#aaa',
};

function PipRow({ manaCost }: { manaCost?: string }) {
  if (!manaCost) return null;
  const pips: { sym: string; bg: string }[] = [];
  for (const m of manaCost.matchAll(/\{([^}]+)\}/g)) {
    const sym = m[1].toUpperCase();
    pips.push({ sym, bg: MANA_HEX[sym] || '#444' });
  }
  return (
    <div className="flex gap-0.5 items-center flex-shrink-0">
      {pips.map((p, i) => (
        <span key={i} style={{
          width: 10, height: 10, borderRadius: '50%', background: p.bg,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 7, color: '#ccc', flexShrink: 0,
        }}>
          {MANA_HEX[p.sym] ? '' : p.sym}
        </span>
      ))}
    </div>
  );
}

// ─── Filter definitions ───────────────────────────────────────────────────────

const COLOR_FILTERS = [
  { color: 'W', bg: '#f0d870', title: 'White'    },
  { color: 'U', bg: '#4a7cc9', title: 'Blue'     },
  { color: 'B', bg: '#5a5a5a', title: 'Black'    },
  { color: 'R', bg: '#c0392b', title: 'Red'      },
  { color: 'G', bg: '#27ae60', title: 'Green'    },
  { color: 'C', bg: '#aaa',    title: 'Colorless', label: 'C' },
];

const TYPE_FILTERS = [
  'Creature', 'Instant', 'Sorcery', 'Enchantment', 'Artifact', 'Planeswalker', 'Land',
];

const RARITY_FILTERS = [
  { value: 'common',   label: 'C', color: '#9ca3af', title: 'Common'   },
  { value: 'uncommon', label: 'U', color: '#60a5fa', title: 'Uncommon' },
  { value: 'rare',     label: 'R', color: '#f2ca83', title: 'Rare'     },
  { value: 'mythic',   label: 'M', color: '#f87171', title: 'Mythic'   },
];

const FORMAT_FILTERS = [
  { value: 'standard',  label: 'Std'  },
  { value: 'pioneer',   label: 'Pio'  },
  { value: 'modern',    label: 'Mod'  },
  { value: 'legacy',    label: 'Leg'  },
  { value: 'vintage',   label: 'Vin'  },
  { value: 'commander', label: 'EDH'  },
  { value: 'pauper',    label: 'Ppr'  },
  { value: 'explorer',  label: 'Exp'  },
];

const KEYWORD_CHIPS = [
  'Flying', 'First Strike', 'Double Strike', 'Deathtouch', 'Lifelink',
  'Trample', 'Vigilance', 'Haste', 'Flash', 'Reach', 'Hexproof',
  'Indestructible', 'Menace', 'Defender', 'Shroud', 'Ward',
  'Convoke', 'Prowess', 'Cipher', 'Cascade',
];

const LAYOUT_OPTIONS = [
  { value: 'normal',    label: 'Normal'    },
  { value: 'transform', label: 'Transform' },
  { value: 'modal_dfc', label: 'Modal DFC' },
  { value: 'adventure', label: 'Adventure' },
  { value: 'saga',      label: 'Saga'      },
  { value: 'class',     label: 'Class'     },
  { value: 'split',     label: 'Split'     },
  { value: 'mutate',    label: 'Mutate'    },
];

const PRODUCED_MANA_FILTERS = [
  { color: 'W', bg: '#f0d870', title: 'White'     },
  { color: 'U', bg: '#4a7cc9', title: 'Blue'      },
  { color: 'B', bg: '#5a5a5a', title: 'Black'     },
  { color: 'R', bg: '#c0392b', title: 'Red'       },
  { color: 'G', bg: '#27ae60', title: 'Green'     },
  { color: 'C', bg: '#aaa',    title: 'Colorless', label: 'C' },
];

type SearchIn = 'all' | 'name' | 'oracle';
type ColorCountOp = 'exactly' | 'at-most' | 'at-least';
type PanelMode = 'search' | 'ask';

// ─── Card image helpers ───────────────────────────────────────────────────────

function getArtUrl(card: Card): string {
  const fd = (card.full_data || {}) as Record<string, any>;
  return fd.image_uris?.art_crop || fd.card_faces?.[0]?.image_uris?.art_crop || '';
}

function getPreviewUrl(card: Card): string {
  const fd = (card.full_data || {}) as Record<string, any>;
  return fd.image_uris?.normal || fd.card_faces?.[0]?.image_uris?.normal || '';
}

function getRarityColor(card: Card): string {
  const r = ((card.full_data || {}) as any)?.rarity as string | undefined;
  return r === 'mythic' ? '#f87171' : r === 'rare' ? '#f2ca83' : r === 'uncommon' ? '#60a5fa' : '#6b7280';
}

// ─── Exposed filter state / handle ───────────────────────────────────────────

export interface CardFilterState {
  query: string;
  searchIn: SearchIn;
  colors: string[];
  types: string[];
  rarities: string[];
  cmcMin: string;
  cmcMax: string;
  powerMin: string;
  powerMax: string;
  toughMin: string;
  toughMax: string;
  setCode: string;
  legality: string;
  gameChanger: boolean;
  priceMax: string;
}

export interface CardSearchPanelHandle {
  setFilters(state: Partial<CardFilterState>): void;
  getFilters(): CardFilterState;
  clearFilters(): void;
  selectAll(): void;
  clearSelection(): void;
  getSelectedCards(): Card[];
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function FilterLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[8px] text-on-surface-variant/30 uppercase tracking-widest font-bold mb-1">
      {children}
    </p>
  );
}

function StatInput({ placeholder, value, onChange }: {
  placeholder: string; value: string; onChange: (v: string) => void;
}) {
  return (
    <input
      type="text"
      inputMode="numeric"
      placeholder={placeholder}
      value={value}
      onChange={e => onChange(e.target.value.replace(/[^0-9]/g, ''))}
      className="w-12 bg-surface-container/60 border border-white/5 rounded-md px-1.5 py-1 text-[11px] text-on-surface focus:outline-none focus:border-primary/50 placeholder:text-on-surface-variant/20 text-center"
    />
  );
}

function CardRow({
  card, isSelected, multiSelect, onSelect, onQuickAdd, onHoverEnter, onHoverLeave,
}: {
  card: Card;
  isSelected: boolean;
  multiSelect: boolean;
  onSelect: () => void;
  onQuickAdd: () => void;
  onHoverEnter: (y: number) => void;
  onHoverLeave: () => void;
}) {
  const artUrl    = getArtUrl(card);
  const rarityCol = getRarityColor(card);

  return (
    <div
      onMouseEnter={e => {
        const rect = e.currentTarget.getBoundingClientRect();
        onHoverEnter(rect.top + rect.height / 2);
      }}
      onMouseLeave={onHoverLeave}
      onClick={() => multiSelect ? onSelect() : onSelect()}
      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg cursor-pointer transition-all flex-shrink-0 group"
      style={{
        background:   isSelected ? 'rgba(242,202,131,0.07)' : 'transparent',
        border:       isSelected ? '1px solid rgba(242,202,131,0.18)' : '1px solid transparent',
        marginBottom: 2,
      }}
    >
      {multiSelect && (
        <div
          className="flex-shrink-0 transition-all"
          style={{
            width: 15, height: 15, borderRadius: 4,
            border: `2px solid ${isSelected ? '#f2ca83' : 'rgba(255,255,255,0.18)'}`,
            background: isSelected ? '#f2ca83' : 'transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          {isSelected && (
            <span className="material-symbols-outlined" style={{ fontSize: 10, color: '#1a1200', fontVariationSettings: "'FILL' 1" }}>check</span>
          )}
        </div>
      )}

      <div className="rounded overflow-hidden flex-shrink-0" style={{ width: 44, height: 32, position: 'relative', background: 'rgba(255,255,255,0.04)' }}>
        {artUrl ? (
          <img src={artUrl} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: rarityCol + '1a' }}>
            <span className="material-symbols-outlined text-[14px]" style={{ color: rarityCol + '60' }}>playing_cards</span>
          </div>
        )}
        <div style={{ position: 'absolute', bottom: 2, right: 2, width: 5, height: 5, borderRadius: '50%', background: rarityCol, boxShadow: '0 0 3px rgba(0,0,0,0.7)' }} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-bold truncate transition-colors" style={{ color: isSelected ? '#f2ca83' : 'rgba(255,255,255,0.85)' }}>
            {card.name}
          </span>
          <PipRow manaCost={card.mana_cost} />
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <p className="text-[9px] text-on-surface-variant/35 truncate flex-1">{card.type_line || ''}</p>
          {card.power != null && card.toughness != null && (
            <span className="text-[9px] font-bold text-on-surface-variant/40 flex-shrink-0 tabular-nums">{card.power}/{card.toughness}</span>
          )}
          {card.loyalty != null && (
            <span className="text-[9px] font-bold text-blue-400/40 flex-shrink-0">◆{card.loyalty}</span>
          )}
        </div>
      </div>

      {multiSelect ? (
        <button
          onClick={e => { e.stopPropagation(); onQuickAdd(); }}
          className="w-6 h-6 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all flex-shrink-0 hover:bg-white/10"
          title="Quick add (skip selection)"
          style={{ color: 'rgba(242,202,131,0.55)' }}
        >
          <span className="material-symbols-outlined text-[15px]">add</span>
        </button>
      ) : (
        <span className="material-symbols-outlined opacity-0 group-hover:opacity-100 transition-all flex-shrink-0" style={{ fontSize: 15, color: 'rgba(242,202,131,0.4)' }}>
          add_circle
        </span>
      )}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

interface CardSearchPanelProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  onSelectCard: (card: Card) => void;
  onAddAll?: (cards: Card[]) => Promise<void>;
  extraControls?: React.ReactNode;
  onFiltersChanged?: (state: CardFilterState) => void;
}

export const CardSearchPanel = forwardRef<CardSearchPanelHandle, CardSearchPanelProps>(
  function CardSearchPanel(
    { isOpen, onClose, title = 'Add Card', onSelectCard, onAddAll, extraControls, onFiltersChanged },
    ref,
  ) {

  // ── Mode ──────────────────────────────────────────────────────────────────
  const [mode, setMode] = useState<PanelMode>('search');

  // ── Core search state ────────────────────────────────────────────────────
  const [query,        setQuery]        = useState('');
  const [results,      setResults]      = useState<Card[]>([]);
  const [searchStatus, setSearchStatus] = useState<'idle' | 'loading' | 'results' | 'empty' | 'no-db'>('idle');
  const [searchIn,     setSearchIn]     = useState<SearchIn>('all');

  // ── Filter state ─────────────────────────────────────────────────────────
  const [activeColors,   setActiveColors]   = useState<Set<string>>(new Set());
  const [activeTypes,    setActiveTypes]    = useState<Set<string>>(new Set());
  const [activeRarities, setActiveRarities] = useState<Set<string>>(new Set());
  const [cmcMin,         setCmcMin]         = useState('');
  const [cmcMax,         setCmcMax]         = useState('');
  const [powerMin,       setPowerMin]       = useState('');
  const [powerMax,       setPowerMax]       = useState('');
  const [toughMin,       setToughMin]       = useState('');
  const [toughMax,       setToughMax]       = useState('');
  const [setCode,        setSetCode]        = useState('');
  const [legality,       setLegality]       = useState('');
  const [gameChanger,    setGameChanger]    = useState(false);
  const [priceMax,       setPriceMax]       = useState('');

  // ── Advanced filter state ─────────────────────────────────────────────────
  const [showAdvanced,       setShowAdvanced]       = useState(false);
  const [activeKeywords,     setActiveKeywords]     = useState<Set<string>>(new Set());
  const [customKeyword,      setCustomKeyword]      = useState('');
  const [loyaltyMin,         setLoyaltyMin]         = useState('');
  const [loyaltyMax,         setLoyaltyMax]         = useState('');
  const [colorCount,         setColorCount]         = useState('');
  const [colorCountOp,       setColorCountOp]       = useState<ColorCountOp>('exactly');
  const [activeLayouts,      setActiveLayouts]      = useState<Set<string>>(new Set());
  const [reserved,           setReserved]           = useState(false);
  const [edhrecRankMax,      setEdhrecRankMax]      = useState('');
  const [activeProducedMana, setActiveProducedMana] = useState<Set<string>>(new Set());

  // ── Ask tab state ─────────────────────────────────────────────────────────
  const [askPrompt, setAskPrompt] = useState('');
  const [askCards,  setAskCards]  = useState<Card[]>([]);
  const [askStatus, setAskStatus] = useState<'idle' | 'loading' | 'results' | 'error'>('idle');
  const [askError,  setAskError]  = useState('');

  // ── Selection & preview state ─────────────────────────────────────────────
  const [selectedOracleIds, setSelectedOracleIds] = useState<Set<string>>(new Set());
  const [hoverCard,         setHoverCard]         = useState<Card | null>(null);
  const [hoverY,            setHoverY]            = useState(0);

  // ── Add state ────────────────────────────────────────────────────────────
  const [addingAll,  setAddingAll]  = useState(false);
  const [addAllDone, setAddAllDone] = useState(false);

  // ── Filter presets ────────────────────────────────────────────────────────
  const PRESET_KEY = 'kf_search_presets';
  const [presets, setPresets] = useState<{ name: string; filters: CardFilterState }[]>(() => {
    try { return JSON.parse(localStorage.getItem(PRESET_KEY) || '[]'); } catch { return []; }
  });
  const savePreset = useCallback((name: string, filters: CardFilterState) => {
    setPresets(prev => {
      const next = [...prev.filter(p => p.name !== name), { name, filters }];
      try { localStorage.setItem(PRESET_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);
  const deletePreset = useCallback((name: string) => {
    setPresets(prev => {
      const next = prev.filter(p => p.name !== name);
      try { localStorage.setItem(PRESET_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  // ── Misc UI ───────────────────────────────────────────────────────────────
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(null);
  const [savePresetDraft, setSavePresetDraft] = useState('');

  const showCreatureStats     = activeTypes.has('Creature');
  const showPlaneswalkerStats = activeTypes.has('Planeswalker');
  const multiSelect = !!onAddAll;

  const curResults = mode === 'ask' ? askCards : results;
  const isAllSelected = curResults.length > 0 && curResults.every(c => selectedOracleIds.has(c.oracle_id));

  const activeFilterCount =
    activeColors.size + activeTypes.size + activeRarities.size +
    (searchIn !== 'all' ? 1 : 0) +
    (cmcMin !== '' ? 1 : 0) + (cmcMax !== '' ? 1 : 0) +
    (powerMin !== '' ? 1 : 0) + (powerMax !== '' ? 1 : 0) +
    (toughMin !== '' ? 1 : 0) + (toughMax !== '' ? 1 : 0) +
    (setCode !== '' ? 1 : 0) + (legality !== '' ? 1 : 0) +
    (gameChanger ? 1 : 0) + (priceMax !== '' ? 1 : 0);

  const advancedFilterCount =
    activeKeywords.size + activeLayouts.size + activeProducedMana.size +
    (loyaltyMin !== '' ? 1 : 0) + (loyaltyMax !== '' ? 1 : 0) +
    (colorCount !== '' ? 1 : 0) +
    (reserved ? 1 : 0) + (edhrecRankMax !== '' ? 1 : 0);

  // ── Helpers ───────────────────────────────────────────────────────────────

  const buildFilterState = useCallback((): CardFilterState => ({
    query, searchIn,
    colors:   Array.from(activeColors),
    types:    Array.from(activeTypes),
    rarities: Array.from(activeRarities),
    cmcMin, cmcMax, powerMin, powerMax, toughMin, toughMax,
    setCode, legality, gameChanger, priceMax,
  }), [query, searchIn, activeColors, activeTypes, activeRarities,
       cmcMin, cmcMax, powerMin, powerMax, toughMin, toughMax,
       setCode, legality, gameChanger, priceMax]);

  useEffect(() => {
    if (onFiltersChanged) onFiltersChanged(buildFilterState());
  }, [buildFilterState, onFiltersChanged]);

  // ── Selection ─────────────────────────────────────────────────────────────

  const toggleSelect = useCallback((oracleId: string) => {
    setSelectedOracleIds(prev => {
      const next = new Set(prev);
      next.has(oracleId) ? next.delete(oracleId) : next.add(oracleId);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedOracleIds(prev => {
      const allSelected = curResults.length > 0 && curResults.every(c => prev.has(c.oracle_id));
      if (allSelected) return new Set();
      return new Set(curResults.map(c => c.oracle_id));
    });
  }, [curResults]);

  useEffect(() => { setSelectedOracleIds(new Set()); setAddAllDone(false); }, [results]);
  useEffect(() => { setSelectedOracleIds(new Set()); }, [askCards]);

  // ── Imperative handle ─────────────────────────────────────────────────────

  useImperativeHandle(ref, () => ({
    setFilters(state) {
      const overrides: Parameters<typeof doSearch>[0] = {};
      if (state.query !== undefined)      { setQuery(state.query);                                overrides.q      = state.query.trim(); }
      if (state.searchIn !== undefined)   { setSearchIn(state.searchIn);                          overrides.mode   = state.searchIn; }
      if (state.colors !== undefined)     { const s = new Set(state.colors);  setActiveColors(s); overrides.colors = s; }
      if (state.types !== undefined)      { const s = new Set(state.types);   setActiveTypes(s);  overrides.types  = s; }
      if (state.rarities !== undefined)   { const s = new Set(state.rarities); setActiveRarities(s); overrides.rarities = s; }
      if (state.cmcMin !== undefined)     { setCmcMin(state.cmcMin);     overrides.cMin = state.cmcMin; }
      if (state.cmcMax !== undefined)     { setCmcMax(state.cmcMax);     overrides.cMax = state.cmcMax; }
      if (state.powerMin !== undefined)   { setPowerMin(state.powerMin); overrides.pMin = state.powerMin; }
      if (state.powerMax !== undefined)   { setPowerMax(state.powerMax); overrides.pMax = state.powerMax; }
      if (state.toughMin !== undefined)   { setToughMin(state.toughMin); overrides.tMin = state.toughMin; }
      if (state.toughMax !== undefined)   { setToughMax(state.toughMax); overrides.tMax = state.toughMax; }
      if (state.setCode !== undefined)    { setSetCode(state.setCode);   overrides.set  = state.setCode; }
      if (state.legality !== undefined)   { setLegality(state.legality); overrides.legal = state.legality; }
      if (state.gameChanger !== undefined){ setGameChanger(state.gameChanger); overrides.gc = state.gameChanger; }
      schedule(overrides);
    },
    getFilters: buildFilterState,
    clearFilters() {
      clearAll();
    },
    selectAll() {
      setSelectedOracleIds(new Set(results.map(c => c.oracle_id)));
    },
    clearSelection() {
      setSelectedOracleIds(new Set());
    },
    getSelectedCards() {
      return results.filter(c => selectedOracleIds.has(c.oracle_id));
    },
  }));

  // ── Reset on panel open/close ─────────────────────────────────────────────

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
      window.cardsAPI.getStatus().then(s => {
        if (!s?.cardCount) setSearchStatus('no-db');
      }).catch(() => {});
    } else {
      setQuery(''); setResults([]); setSearchStatus('idle');
      setActiveColors(new Set()); setSearchIn('all');
      setActiveTypes(new Set()); setActiveRarities(new Set());
      setCmcMin(''); setCmcMax('');
      setPowerMin(''); setPowerMax('');
      setToughMin(''); setToughMax('');
      setSetCode(''); setLegality(''); setGameChanger(false); setPriceMax('');
      setAddingAll(false); setAddAllDone(false);
      setSelectedOracleIds(new Set()); setHoverCard(null);
      setActiveKeywords(new Set()); setCustomKeyword('');
      setLoyaltyMin(''); setLoyaltyMax('');
      setColorCount(''); setColorCountOp('exactly');
      setActiveLayouts(new Set()); setReserved(false);
      setEdhrecRankMax(''); setActiveProducedMana(new Set());
      setAskPrompt(''); setAskCards([]); setAskStatus('idle'); setAskError('');
    }
  }, [isOpen]);

  // ── Search ────────────────────────────────────────────────────────────────

  const doSearch = useCallback(async (overrides: Partial<{
    q: string; colors: Set<string>; mode: SearchIn;
    types: Set<string>; rarities: Set<string>;
    cMin: string; cMax: string;
    pMin: string; pMax: string;
    tMin: string; tMax: string;
    set: string; legal: string; gc: boolean; price: string;
  }> = {}) => {
    const q        = overrides.q        ?? query.trim();
    const colors   = overrides.colors   ?? activeColors;
    const sMode    = overrides.mode     ?? searchIn;
    const types    = overrides.types    ?? activeTypes;
    const rarities = overrides.rarities ?? activeRarities;
    const cMin     = overrides.cMin     ?? cmcMin;
    const cMax     = overrides.cMax     ?? cmcMax;
    const pMin     = overrides.pMin     ?? powerMin;
    const pMax     = overrides.pMax     ?? powerMax;
    const tMin     = overrides.tMin     ?? toughMin;
    const tMax     = overrides.tMax     ?? toughMax;
    const set      = overrides.set      ?? setCode;
    const legal    = overrides.legal    ?? legality;
    const gc       = overrides.gc       ?? gameChanger;
    const price    = overrides.price    ?? priceMax;

    const hasAny = q || colors.size || types.size || rarities.size ||
      cMin || cMax || pMin || pMax || tMin || tMax || set || legal || gc || price ||
      activeKeywords.size || loyaltyMin || loyaltyMax || colorCount ||
      activeLayouts.size || reserved || edhrecRankMax || activeProducedMana.size;

    if (!hasAny) { setSearchStatus('idle'); return; }
    setSearchStatus('loading');
    try {
      const res = await window.cardsAPI.search({
        q, pageSize: 60, searchIn: sMode,
        colors:       Array.from(colors),
        types:        Array.from(types),
        rarities:     Array.from(rarities),
        cmcMin:       cMin !== '' ? Number(cMin) : null,
        cmcMax:       cMax !== '' ? Number(cMax) : null,
        powerMin:     pMin !== '' ? Number(pMin) : null,
        powerMax:     pMax !== '' ? Number(pMax) : null,
        toughnessMin: tMin !== '' ? Number(tMin) : null,
        toughnessMax: tMax !== '' ? Number(tMax) : null,
        setCode: set, legality: legal, gameChanger: gc,
        maxPriceUsd:  price !== '' ? Number(price) : null,
        keywords:     Array.from(activeKeywords),
        loyaltyMin:   loyaltyMin !== '' ? Number(loyaltyMin) : null,
        loyaltyMax:   loyaltyMax !== '' ? Number(loyaltyMax) : null,
        colorCount:   colorCount !== '' ? Number(colorCount) : null,
        colorCountOp,
        layouts:      Array.from(activeLayouts),
        reserved,
        edhrecRankMax: edhrecRankMax !== '' ? Number(edhrecRankMax) : null,
        producedMana:  Array.from(activeProducedMana),
      });
      const cards = res?.cards || [];
      setResults(cards);
      setSearchStatus(cards.length ? 'results' : 'empty');
    } catch {
      setSearchStatus('no-db');
    }
  }, [query, activeColors, searchIn, activeTypes, activeRarities,
      cmcMin, cmcMax, powerMin, powerMax, toughMin, toughMax,
      setCode, legality, gameChanger, priceMax,
      activeKeywords, loyaltyMin, loyaltyMax, colorCount, colorCountOp,
      activeLayouts, reserved, edhrecRankMax, activeProducedMana]);

  const schedule = useCallback((overrides: Parameters<typeof doSearch>[0] = {}) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => doSearch(overrides), 180);
  }, [doSearch]);

  // ── Event handlers ────────────────────────────────────────────────────────

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value;
    setQuery(q);
    schedule({ q: q.trim() });
  };

  const toggleColor = (color: string) => {
    setActiveColors(prev => {
      const next = new Set(prev);
      next.has(color) ? next.delete(color) : next.add(color);
      schedule({ colors: next });
      return next;
    });
  };

  const toggleType = (type: string) => {
    setActiveTypes(prev => {
      const next = new Set(prev);
      next.has(type) ? next.delete(type) : next.add(type);
      if (!next.has('Creature')) {
        setPowerMin(''); setPowerMax(''); setToughMin(''); setToughMax('');
        schedule({ types: next, pMin: '', pMax: '', tMin: '', tMax: '' });
      } else {
        schedule({ types: next });
      }
      return next;
    });
  };

  const toggleRarity = (r: string) => {
    setActiveRarities(prev => {
      const next = new Set(prev);
      next.has(r) ? next.delete(r) : next.add(r);
      schedule({ rarities: next });
      return next;
    });
  };

  const handleSearchInChange = (m: SearchIn) => {
    setSearchIn(m);
    schedule({ mode: m });
  };

  const handleLegality = (fmt: string) => {
    const next = legality === fmt ? '' : fmt;
    setLegality(next);
    schedule({ legal: next });
  };

  const handleSetCode = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value.slice(0, 6).toLowerCase().replace(/[^a-z0-9]/g, '');
    setSetCode(v);
    schedule({ set: v });
  };

  const handleGameChanger = () => {
    const next = !gameChanger;
    setGameChanger(next);
    schedule({ gc: next });
  };

  const clearAll = () => {
    setSearchIn('all'); setActiveColors(new Set()); setActiveTypes(new Set()); setActiveRarities(new Set());
    setCmcMin(''); setCmcMax(''); setPowerMin(''); setPowerMax('');
    setToughMin(''); setToughMax(''); setSetCode(''); setLegality(''); setGameChanger(false); setPriceMax('');
    setActiveKeywords(new Set()); setCustomKeyword('');
    setLoyaltyMin(''); setLoyaltyMax('');
    setColorCount(''); setColorCountOp('exactly');
    setActiveLayouts(new Set()); setReserved(false);
    setEdhrecRankMax(''); setActiveProducedMana(new Set());
    schedule({ mode: 'all', colors: new Set(), types: new Set(), rarities: new Set(),
               cMin: '', cMax: '', pMin: '', pMax: '', tMin: '', tMax: '', set: '', legal: '', gc: false, price: '' });
  };

  const handleAddSelected = async () => {
    if (!onAddAll || !selectedOracleIds.size) return;
    const toAdd = curResults.filter(c => selectedOracleIds.has(c.oracle_id));
    setAddingAll(true);
    try {
      await onAddAll(toAdd);
      setAddAllDone(true);
      setSelectedOracleIds(new Set());
    } finally {
      setAddingAll(false);
    }
  };

  // ── Natural language search ───────────────────────────────────────────────

  const doAskQuery = useCallback(async () => {
    if (!askPrompt.trim() || askStatus === 'loading') return;
    setAskStatus('loading');
    setAskCards([]);
    setAskError('');

    try {
      const p = askPrompt.toLowerCase();

      const COLOR_MAP: Record<string, string> = {
        white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G', colorless: 'C',
      };
      const colors = Object.entries(COLOR_MAP)
        .filter(([kw]) => p.includes(kw))
        .map(([, c]) => c);

      const TYPE_KW = ['Creature', 'Instant', 'Sorcery', 'Enchantment', 'Artifact', 'Planeswalker', 'Land'];
      const types = TYPE_KW.filter(t => p.includes(t.toLowerCase()));

      const ROLE_MAP: [string, string][] = [
        ['ramp', 'ramp'], ['mana rock', 'ramp'], ['mana dork', 'ramp'],
        ['draw', 'draw'], ['card draw', 'draw'], ['card advantage', 'draw'],
        ['removal', 'removal'], ['destroy', 'removal'], ['exile target', 'removal'],
        ['board wipe', 'board_wipe'], ['wrath', 'board_wipe'], ['sweeper', 'board_wipe'],
        ['tutor', 'tutor'],
        ['counterspell', 'counterspell'], ['counter spell', 'counterspell'],
        ['graveyard', 'graveyard'], ['reanimator', 'graveyard'], ['recursion', 'graveyard'],
        ['token', 'token'],
        ['win con', 'win_condition'], ['win condition', 'win_condition'], ['finisher', 'win_condition'],
      ];
      const roles = [...new Set(ROLE_MAP.filter(([kw]) => p.includes(kw)).map(([, r]) => r))];

      const priceMatch = p.match(/under \$?(\d+(?:\.\d+)?)/);
      const maxPriceUsd: number | null = priceMatch?.[1]
        ? parseFloat(priceMatch[1])
        : p.includes('budget') ? 5
        : null;

      const cmcMatch = p.match(/(?:cmc|mana value|costs?)\s*(\d+)/);
      const cmcMax: number | null = cmcMatch ? parseInt(cmcMatch[1]) : null;

      const [textRes, roleRes] = await Promise.all([
        window.cardsAPI.search({
          q: askPrompt.trim(),
          pageSize: 60,
          colors,
          types,
          ...(maxPriceUsd != null ? { maxPriceUsd } : {}),
          ...(cmcMax != null ? { cmcMax } : {}),
        }),
        roles.length > 0
          ? window.cardsAPI.searchByRole({ roles, pageSize: 60 })
          : Promise.resolve({ cards: [] as Card[] }),
      ]);

      const seen = new Set<string>();
      const merged: Card[] = [];
      for (const c of [...(textRes?.cards ?? []), ...(roleRes?.cards ?? [])]) {
        if (!seen.has(c.oracle_id)) { seen.add(c.oracle_id); merged.push(c); }
      }

      const filtered = colors.length > 0
        ? merged.filter(c => {
            const ci: string[] = Array.isArray(c.color_identity)
              ? c.color_identity
              : (c.color_identity ? JSON.parse(c.color_identity as unknown as string) : []);
            return colors.some(col => ci.includes(col));
          })
        : merged;

      setAskCards(filtered.slice(0, 60));
      setAskStatus('results');
      if (!filtered.length) setAskError('No cards found. Try different keywords.');
    } catch {
      setAskError('Search failed. Make sure the card database is loaded.');
      setAskStatus('error');
    }
  }, [askPrompt, askStatus]);

  if (!isOpen) return null;

  // ── Floating card preview ─────────────────────────────────────────────────

  const floatingPreview = hoverCard ? (() => {
    const url = getPreviewUrl(hoverCard);
    if (!url) return null;
    const top = Math.max(16, Math.min(hoverY - 167, window.innerHeight - 350));
    return createPortal(
      <div className="fixed pointer-events-none z-[9999]" style={{ right: 476, top }}>
        <div className="rounded-xl overflow-hidden" style={{ width: 220, boxShadow: '0 24px 64px rgba(0,0,0,0.85), 0 0 0 1px rgba(255,255,255,0.07)' }}>
          <img src={url} alt={hoverCard.name} className="w-full block" loading="lazy" />
        </div>
      </div>,
      document.body,
    );
  })() : null;

  const hasResults = (mode === 'search' && searchStatus === 'results') || (mode === 'ask' && askCards.length > 0);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      {floatingPreview}

      <div
        className="absolute top-0 right-0 h-full w-[460px] z-[100] flex flex-col no-drag"
        style={{
          background: 'rgba(16,18,23,0.98)',
          backdropFilter: 'blur(40px)',
          borderLeft: '1px solid rgba(255,255,255,0.07)',
          boxShadow: '-8px 0 40px rgba(0,0,0,0.5)',
        }}
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 flex-shrink-0">
          <h3 className="font-headline-md text-sm font-bold text-on-surface">{title}</h3>
          <div className="flex items-center gap-2">
            {mode === 'search' && activeFilterCount > 0 && (
              <>
                {savePresetDraft !== null && (
                  <div className="flex items-center gap-1">
                    {savePresetDraft === '' ? (
                      <button
                        onClick={() => setSavePresetDraft('Preset ' + (presets.length + 1))}
                        className="text-[9px] font-bold uppercase tracking-wider text-on-surface-variant/35 hover:text-primary transition-colors flex items-center gap-1"
                        title="Save current filters as preset"
                      >
                        <span className="material-symbols-outlined text-[12px]">bookmark_add</span>
                      </button>
                    ) : (
                      <div className="flex items-center gap-1">
                        <input
                          autoFocus
                          type="text"
                          value={savePresetDraft}
                          onChange={e => setSavePresetDraft(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter' && savePresetDraft.trim()) {
                              savePreset(savePresetDraft.trim(), buildFilterState());
                              setSavePresetDraft('');
                            }
                            if (e.key === 'Escape') setSavePresetDraft('');
                          }}
                          className="w-20 text-[9px] px-1.5 py-0.5 rounded bg-surface-container border border-primary/40 focus:outline-none text-on-surface"
                          placeholder="Name"
                        />
                        <button
                          onClick={() => { savePreset(savePresetDraft.trim(), buildFilterState()); setSavePresetDraft(''); }}
                          disabled={!savePresetDraft.trim()}
                          className="text-[9px] font-bold text-primary disabled:opacity-40"
                        >Save</button>
                        <button onClick={() => setSavePresetDraft('')} className="text-[9px] text-on-surface-variant/35">✕</button>
                      </div>
                    )}
                  </div>
                )}
                <button
                  onClick={clearAll}
                  className="text-[9px] font-bold uppercase tracking-wider text-on-surface-variant/35 hover:text-on-surface-variant transition-colors flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-[12px]">filter_alt_off</span>
                  Clear
                </button>
              </>
            )}
            <button onClick={onClose} className="w-7 h-7 rounded-md flex items-center justify-center text-on-surface-variant hover:bg-white/10 transition-all">
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>
        </div>

        {/* ── Tabs ── */}
        <div className="flex gap-0 border-b border-white/5 flex-shrink-0">
          {(['search', 'ask'] as PanelMode[]).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className="flex-1 py-2 text-[9px] font-bold uppercase tracking-wider transition-all relative"
              style={{ color: mode === m ? '#f2ca83' : 'rgba(255,255,255,0.28)' }}
            >
              {m === 'search' ? 'Filter' : 'Natural Language'}
              {mode === m && (
                <div className="absolute bottom-0 left-0 right-0 h-[2px] rounded-t-full" style={{ background: '#f2ca83' }} />
              )}
            </button>
          ))}
        </div>

        {/* ── Filter tab ── */}
        {mode === 'search' && (
          <div className="px-3 py-2.5 border-b border-white/5 flex-shrink-0 space-y-2">

            {/* Search input + search-in toggle */}
            <div className="space-y-1.5">
              <div className="relative">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/35 text-[17px]">search</span>
                <input
                  ref={inputRef}
                  type="text"
                  placeholder={
                    searchIn === 'oracle' ? 'Search oracle text…' :
                    searchIn === 'name'   ? 'Search card names…'  :
                    'Search cards…'
                  }
                  autoComplete="off"
                  value={query}
                  onChange={handleInput}
                  onKeyDown={e => { if (e.key === 'Escape') { onClose(); e.stopPropagation(); } }}
                  className="w-full bg-surface-container/60 border border-white/5 rounded-lg py-2 pl-9 pr-3 text-body-md focus:outline-none focus:border-primary/50 placeholder:text-on-surface-variant/25"
                />
              </div>

              <div className="flex gap-0.5 bg-surface-container/30 rounded-lg p-0.5">
                {(['all', 'name', 'oracle'] as SearchIn[]).map(m => (
                  <button
                    key={m}
                    onClick={() => handleSearchInChange(m)}
                    className="flex-1 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wider transition-all capitalize"
                    style={{
                      background: searchIn === m ? 'rgba(242,202,131,0.14)' : 'transparent',
                      color:      searchIn === m ? '#f2ca83'                 : 'rgba(255,255,255,0.3)',
                    }}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            {/* Saved presets */}
            {presets.length > 0 && (
              <div className="flex gap-1.5 flex-wrap">
                {presets.map(preset => (
                  <div key={preset.name} className="flex items-center gap-0.5 group">
                    <button
                      onClick={() => {
                        const s = preset.filters;
                        if (s.query !== undefined) setQuery(s.query);
                        if (s.searchIn !== undefined) setSearchIn(s.searchIn);
                        if (s.colors !== undefined) setActiveColors(new Set(s.colors));
                        if (s.types !== undefined) setActiveTypes(new Set(s.types));
                        if (s.rarities !== undefined) setActiveRarities(new Set(s.rarities));
                        if (s.cmcMin !== undefined) setCmcMin(s.cmcMin);
                        if (s.cmcMax !== undefined) setCmcMax(s.cmcMax);
                        if (s.powerMin !== undefined) setPowerMin(s.powerMin);
                        if (s.powerMax !== undefined) setPowerMax(s.powerMax);
                        if (s.toughMin !== undefined) setToughMin(s.toughMin);
                        if (s.toughMax !== undefined) setToughMax(s.toughMax);
                        if (s.setCode !== undefined) setSetCode(s.setCode);
                        if (s.legality !== undefined) setLegality(s.legality);
                        if (s.gameChanger !== undefined) setGameChanger(s.gameChanger);
                        if (s.priceMax !== undefined) setPriceMax(s.priceMax);
                      }}
                      className="text-[9px] font-bold px-2 py-0.5 rounded-l-full transition-all"
                      style={{ background: 'rgba(242,202,131,0.08)', border: '1px solid rgba(242,202,131,0.15)', borderRight: 'none', color: 'rgba(242,202,131,0.6)' }}
                    >
                      <span className="material-symbols-outlined text-[9px] mr-0.5 align-middle">bookmark</span>
                      {preset.name}
                    </button>
                    <button
                      onClick={() => deletePreset(preset.name)}
                      className="px-1 py-0.5 rounded-r-full text-[8px] opacity-0 group-hover:opacity-100 transition-all"
                      style={{ background: 'rgba(242,202,131,0.08)', border: '1px solid rgba(242,202,131,0.15)', borderLeft: '1px solid rgba(242,202,131,0.08)', color: 'rgba(242,202,131,0.4)' }}
                      title="Delete preset"
                    >✕</button>
                  </div>
                ))}
              </div>
            )}

            {/* Color identity */}
            <div>
              <FilterLabel>Color Identity</FilterLabel>
              <div className="flex gap-1.5 items-center">
                {COLOR_FILTERS.map(({ color, bg, title: t, label }) => (
                  <button
                    key={color}
                    onClick={() => toggleColor(color)}
                    title={t}
                    className="w-7 h-7 rounded-full border-2 hover:scale-110 transition-all flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0"
                    style={{
                      background:  bg,
                      borderColor: activeColors.has(color) ? 'white' : 'transparent',
                      opacity:     activeColors.size > 0 && !activeColors.has(color) ? 0.4 : 1,
                      boxShadow:   activeColors.has(color) ? `0 0 8px ${bg}88` : 'none',
                    }}
                  >
                    {label || ''}
                  </button>
                ))}
                {activeColors.size > 0 && (
                  <button
                    onClick={() => { setActiveColors(new Set()); schedule({ colors: new Set() }); }}
                    className="text-on-surface-variant/30 hover:text-on-surface-variant transition-colors ml-1"
                    title="Clear colors"
                  >
                    <span className="material-symbols-outlined text-[14px]">close</span>
                  </button>
                )}
              </div>
            </div>

            {/* Type + Rarity */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <FilterLabel>Type</FilterLabel>
                <div className="flex flex-wrap gap-1">
                  {TYPE_FILTERS.map(t => (
                    <button
                      key={t}
                      onClick={() => toggleType(t)}
                      className="px-1.5 py-0.5 rounded text-[9px] font-bold transition-all border"
                      style={{
                        background:  activeTypes.has(t) ? 'rgba(242,202,131,0.15)' : 'rgba(255,255,255,0.04)',
                        borderColor: activeTypes.has(t) ? 'rgba(242,202,131,0.4)'  : 'rgba(255,255,255,0.07)',
                        color:       activeTypes.has(t) ? '#f2ca83'                 : 'rgba(255,255,255,0.4)',
                      }}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <FilterLabel>Rarity</FilterLabel>
                <div className="flex gap-1.5 items-center">
                  {RARITY_FILTERS.map(({ value, label, color, title: t }) => (
                    <button
                      key={value}
                      onClick={() => toggleRarity(value)}
                      title={t}
                      className="w-6 h-6 rounded-full border-2 flex items-center justify-center text-[9px] font-black transition-all hover:scale-110"
                      style={{
                        background:  activeRarities.has(value) ? color + '33' : 'rgba(255,255,255,0.05)',
                        borderColor: activeRarities.has(value) ? color        : 'rgba(255,255,255,0.1)',
                        color:       activeRarities.has(value) ? color        : 'rgba(255,255,255,0.3)',
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* CMC + Set code + Price */}
            <div className="grid grid-cols-3 gap-2">
              <div>
                <FilterLabel>Mana Value</FilterLabel>
                <div className="flex items-center gap-1">
                  <StatInput placeholder="Min" value={cmcMin} onChange={v => { setCmcMin(v); schedule({ cMin: v }); }} />
                  <span className="text-on-surface-variant/25 text-[10px]">–</span>
                  <StatInput placeholder="Max" value={cmcMax} onChange={v => { setCmcMax(v); schedule({ cMax: v }); }} />
                </div>
              </div>

              <div>
                <FilterLabel>Set Code</FilterLabel>
                <input
                  type="text"
                  value={setCode}
                  onChange={handleSetCode}
                  placeholder="mkm…"
                  maxLength={6}
                  className="w-full bg-surface-container/60 border border-white/5 rounded-md px-2 py-1 text-[11px] text-on-surface focus:outline-none focus:border-primary/50 placeholder:text-on-surface-variant/20 font-mono tracking-widest uppercase"
                />
                <div className="flex gap-1 mt-1.5 flex-wrap">
                  {[
                    { code: 'dft', label: 'Aetherdrift' },
                    { code: 'tdm', label: 'Tarkir: Dragonstorm' },
                    { code: 'fdn', label: 'Foundations' },
                    { code: 'dsk', label: 'Duskmourn' },
                    { code: 'blb', label: 'Bloomburrow' },
                    { code: 'otj', label: 'Outlaws of Thunder Junction' },
                    { code: 'mkm', label: 'Murders at Karlov Manor' },
                  ].map(s => (
                    <button
                      key={s.code}
                      onClick={() => { const val = setCode === s.code ? '' : s.code; setSetCode(val); schedule({ set: val }); }}
                      className="text-[8px] font-bold px-1.5 py-0.5 rounded transition-all"
                      style={{
                        background:  setCode === s.code ? 'rgba(242,202,131,0.18)' : 'rgba(255,255,255,0.04)',
                        border:      `1px solid ${setCode === s.code ? 'rgba(242,202,131,0.3)' : 'rgba(255,255,255,0.07)'}`,
                        color:       setCode === s.code ? '#f2ca83' : 'rgba(255,255,255,0.3)',
                      }}
                      title={s.label}
                    >
                      {s.code.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <FilterLabel>Max Price $</FilterLabel>
                <div className="relative">
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-on-surface-variant/30 text-[10px]">$</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={priceMax}
                    onChange={e => { const v = e.target.value.replace(/[^0-9.]/g, ''); setPriceMax(v); schedule({ price: v }); }}
                    placeholder="any"
                    className="w-full bg-surface-container/60 border border-white/5 rounded-md pl-5 pr-2 py-1 text-[11px] text-on-surface focus:outline-none focus:border-primary/50 placeholder:text-on-surface-variant/20"
                    style={{ borderColor: priceMax ? 'rgba(242,202,131,0.3)' : undefined }}
                  />
                </div>
              </div>
            </div>

            {/* Creature stats */}
            {showCreatureStats && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <FilterLabel>Power</FilterLabel>
                  <div className="flex items-center gap-1.5">
                    <StatInput placeholder="Min" value={powerMin} onChange={v => { setPowerMin(v); schedule({ pMin: v }); }} />
                    <span className="text-on-surface-variant/25 text-[11px]">–</span>
                    <StatInput placeholder="Max" value={powerMax} onChange={v => { setPowerMax(v); schedule({ pMax: v }); }} />
                  </div>
                </div>
                <div>
                  <FilterLabel>Toughness</FilterLabel>
                  <div className="flex items-center gap-1.5">
                    <StatInput placeholder="Min" value={toughMin} onChange={v => { setToughMin(v); schedule({ tMin: v }); }} />
                    <span className="text-on-surface-variant/25 text-[11px]">–</span>
                    <StatInput placeholder="Max" value={toughMax} onChange={v => { setToughMax(v); schedule({ tMax: v }); }} />
                  </div>
                </div>
              </div>
            )}

            {/* Legal In + Game Changer */}
            <div className="grid grid-cols-[1fr_auto] gap-3 items-start">
              <div>
                <FilterLabel>Legal In</FilterLabel>
                <div className="flex flex-wrap gap-1">
                  {FORMAT_FILTERS.map(({ value, label }) => (
                    <button
                      key={value}
                      onClick={() => handleLegality(value)}
                      className="px-2 py-0.5 rounded text-[9px] font-bold transition-all border"
                      style={{
                        background:  legality === value ? 'rgba(96,165,250,0.15)' : 'rgba(255,255,255,0.04)',
                        borderColor: legality === value ? 'rgba(96,165,250,0.4)'  : 'rgba(255,255,255,0.07)',
                        color:       legality === value ? '#60a5fa'                : 'rgba(255,255,255,0.4)',
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <FilterLabel>Featured</FilterLabel>
                <button
                  onClick={handleGameChanger}
                  title="Game Changer only"
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border transition-all"
                  style={{
                    background:  gameChanger ? 'rgba(251,191,36,0.1)' : 'rgba(255,255,255,0.03)',
                    borderColor: gameChanger ? 'rgba(251,191,36,0.35)' : 'rgba(255,255,255,0.07)',
                  }}
                >
                  <span
                    className="material-symbols-outlined text-[14px] transition-colors"
                    style={{ color: gameChanger ? '#fbbf24' : 'rgba(255,255,255,0.2)', fontVariationSettings: gameChanger ? "'FILL' 1" : "'FILL' 0" }}
                  >
                    star
                  </span>
                  <span className="text-[9px] font-bold transition-colors" style={{ color: gameChanger ? '#fbbf24' : 'rgba(255,255,255,0.35)' }}>
                    Game Changer
                  </span>
                </button>
              </div>
            </div>

            {/* Advanced Filters accordion */}
            <div>
              <button
                onClick={() => setShowAdvanced(v => !v)}
                className="flex items-center gap-1 transition-colors"
                style={{ color: advancedFilterCount > 0 ? 'rgba(242,202,131,0.5)' : 'rgba(255,255,255,0.22)' }}
              >
                <span className="material-symbols-outlined text-[12px]">{showAdvanced ? 'expand_less' : 'expand_more'}</span>
                <span className="text-[8px] font-bold uppercase tracking-widest">Advanced</span>
                {advancedFilterCount > 0 && (
                  <span className="ml-1 px-1.5 py-0.5 rounded-full text-[8px] font-bold" style={{ background: 'rgba(242,202,131,0.12)', color: '#f2ca83', border: '1px solid rgba(242,202,131,0.2)' }}>
                    {advancedFilterCount}
                  </span>
                )}
              </button>

              {showAdvanced && (
                <div className="mt-2 space-y-2">
                  {/* Keywords */}
                  <div>
                    <FilterLabel>Keywords (must have all)</FilterLabel>
                    <div className="flex flex-wrap gap-1 mb-1">
                      {KEYWORD_CHIPS.map(kw => {
                        const active = activeKeywords.has(kw);
                        return (
                          <button
                            key={kw}
                            onClick={() => {
                              setActiveKeywords(prev => {
                                const next = new Set(prev);
                                next.has(kw) ? next.delete(kw) : next.add(kw);
                                return next;
                              });
                              schedule({});
                            }}
                            className="px-1.5 py-0.5 rounded text-[9px] font-bold transition-all border"
                            style={{
                              background:  active ? 'rgba(167,139,250,0.15)' : 'rgba(255,255,255,0.04)',
                              borderColor: active ? 'rgba(167,139,250,0.4)'  : 'rgba(255,255,255,0.07)',
                              color:       active ? '#a78bfa'                 : 'rgba(255,255,255,0.4)',
                            }}
                          >
                            {kw}
                          </button>
                        );
                      })}
                    </div>
                    <div className="flex gap-1 items-center">
                      <input
                        type="text"
                        placeholder="Custom keyword…"
                        value={customKeyword}
                        onChange={e => setCustomKeyword(e.target.value)}
                        onKeyDown={e => {
                          if ((e.key === 'Enter' || e.key === ',') && customKeyword.trim()) {
                            e.preventDefault();
                            const kw = customKeyword.trim();
                            setActiveKeywords(prev => new Set([...prev, kw]));
                            setCustomKeyword('');
                            schedule({});
                          }
                        }}
                        className="flex-1 bg-surface-container/60 border border-white/5 rounded-md px-2 py-0.5 text-[10px] text-on-surface focus:outline-none focus:border-primary/50 placeholder:text-on-surface-variant/20"
                      />
                      {activeKeywords.size > 0 && (
                        <button onClick={() => { setActiveKeywords(new Set()); schedule({}); }} className="text-on-surface-variant/25 hover:text-on-surface-variant/60 transition-colors text-[10px]">✕</button>
                      )}
                    </div>
                  </div>

                  {/* Loyalty (planeswalker conditional) */}
                  {showPlaneswalkerStats && (
                    <div>
                      <FilterLabel>Loyalty</FilterLabel>
                      <div className="flex items-center gap-1">
                        <StatInput placeholder="Min" value={loyaltyMin} onChange={v => { setLoyaltyMin(v); schedule({}); }} />
                        <span className="text-on-surface-variant/25 text-[10px]">–</span>
                        <StatInput placeholder="Max" value={loyaltyMax} onChange={v => { setLoyaltyMax(v); schedule({}); }} />
                      </div>
                    </div>
                  )}

                  {/* Color count */}
                  <div>
                    <FilterLabel>Color Identity Count</FilterLabel>
                    <div className="flex items-center gap-1.5">
                      <div className="flex bg-surface-container/30 rounded-lg p-0.5 gap-0.5">
                        {(['exactly', 'at-most', 'at-least'] as ColorCountOp[]).map(op => (
                          <button
                            key={op}
                            onClick={() => { setColorCountOp(op); schedule({}); }}
                            className="px-2 py-0.5 rounded-md text-[9px] font-bold transition-all"
                            style={{
                              background: colorCountOp === op ? 'rgba(242,202,131,0.14)' : 'transparent',
                              color:      colorCountOp === op ? '#f2ca83'                 : 'rgba(255,255,255,0.3)',
                            }}
                          >
                            {op === 'exactly' ? '=' : op === 'at-most' ? '≤' : '≥'}
                          </button>
                        ))}
                      </div>
                      <input
                        type="text"
                        inputMode="numeric"
                        placeholder="N"
                        value={colorCount}
                        onChange={e => { const v = e.target.value.replace(/[^0-9]/g, ''); setColorCount(v); schedule({}); }}
                        className="w-10 bg-surface-container/60 border border-white/5 rounded-md px-1.5 py-1 text-[11px] text-on-surface focus:outline-none focus:border-primary/50 placeholder:text-on-surface-variant/20 text-center"
                      />
                      {colorCount && (
                        <button onClick={() => { setColorCount(''); schedule({}); }} className="text-on-surface-variant/25 hover:text-on-surface-variant/60 text-[10px]">✕</button>
                      )}
                    </div>
                  </div>

                  {/* Layout */}
                  <div>
                    <FilterLabel>Layout</FilterLabel>
                    <div className="flex flex-wrap gap-1">
                      {LAYOUT_OPTIONS.map(({ value, label }) => {
                        const active = activeLayouts.has(value);
                        return (
                          <button
                            key={value}
                            onClick={() => { setActiveLayouts(prev => { const next = new Set(prev); next.has(value) ? next.delete(value) : next.add(value); return next; }); schedule({}); }}
                            className="px-1.5 py-0.5 rounded text-[9px] font-bold transition-all border"
                            style={{
                              background:  active ? 'rgba(125,211,252,0.15)' : 'rgba(255,255,255,0.04)',
                              borderColor: active ? 'rgba(125,211,252,0.4)'  : 'rgba(255,255,255,0.07)',
                              color:       active ? '#7dd3fc'                 : 'rgba(255,255,255,0.4)',
                            }}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Reserved list + EDHREC rank */}
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0">
                      <FilterLabel>Reserved List</FilterLabel>
                      <button
                        onClick={() => { setReserved(v => !v); schedule({}); }}
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border transition-all"
                        style={{
                          background:  reserved ? 'rgba(251,191,36,0.1)' : 'rgba(255,255,255,0.03)',
                          borderColor: reserved ? 'rgba(251,191,36,0.35)' : 'rgba(255,255,255,0.07)',
                        }}
                      >
                        <span className="material-symbols-outlined text-[13px] transition-colors" style={{ color: reserved ? '#fbbf24' : 'rgba(255,255,255,0.2)', fontVariationSettings: reserved ? "'FILL' 1" : "'FILL' 0" }}>lock</span>
                        <span className="text-[9px] font-bold transition-colors" style={{ color: reserved ? '#fbbf24' : 'rgba(255,255,255,0.35)' }}>Reserved</span>
                      </button>
                    </div>

                    <div className="flex-1">
                      <FilterLabel>EDHREC Rank ≤</FilterLabel>
                      <input
                        type="text"
                        inputMode="numeric"
                        placeholder="e.g. 1000"
                        value={edhrecRankMax}
                        onChange={e => { const v = e.target.value.replace(/[^0-9]/g, ''); setEdhrecRankMax(v); schedule({}); }}
                        className="w-full bg-surface-container/60 border border-white/5 rounded-md px-2 py-1 text-[11px] text-on-surface focus:outline-none focus:border-primary/50 placeholder:text-on-surface-variant/20"
                      />
                    </div>
                  </div>

                  {/* Produced mana */}
                  <div>
                    <FilterLabel>Produces Mana</FilterLabel>
                    <div className="flex gap-1.5 items-center">
                      {PRODUCED_MANA_FILTERS.map(({ color, bg, title: t, label }) => (
                        <button
                          key={color}
                          onClick={() => { setActiveProducedMana(prev => { const next = new Set(prev); next.has(color) ? next.delete(color) : next.add(color); return next; }); schedule({}); }}
                          title={t}
                          className="w-6 h-6 rounded-full border-2 hover:scale-110 transition-all flex items-center justify-center text-[8px] font-bold text-white flex-shrink-0"
                          style={{
                            background:  bg,
                            borderColor: activeProducedMana.has(color) ? 'white' : 'transparent',
                            opacity:     activeProducedMana.size > 0 && !activeProducedMana.has(color) ? 0.4 : 1,
                            boxShadow:   activeProducedMana.has(color) ? `0 0 7px ${bg}88` : 'none',
                          }}
                        >
                          {label || ''}
                        </button>
                      ))}
                      {activeProducedMana.size > 0 && (
                        <button onClick={() => { setActiveProducedMana(new Set()); schedule({}); }} className="text-on-surface-variant/30 hover:text-on-surface-variant transition-colors ml-0.5">
                          <span className="material-symbols-outlined text-[13px]">close</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {extraControls}
          </div>
        )}

        {/* ── Natural Language tab ── */}
        {mode === 'ask' && (
          <div className="px-3 py-3 border-b border-white/5 flex-shrink-0 space-y-2">
            <div>
              <p className="text-[8px] text-on-surface-variant/30 uppercase tracking-widest font-bold mb-1.5">Natural Language Query</p>
              <textarea
                value={askPrompt}
                onChange={e => setAskPrompt(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) doAskQuery(); }}
                placeholder={'e.g. Cheap blue instant-speed interaction under $2 for a control deck…'}
                rows={3}
                className="w-full bg-surface-container/60 border border-white/5 rounded-lg py-2 px-3 text-[11px] text-on-surface focus:outline-none focus:border-primary/50 placeholder:text-on-surface-variant/25 resize-none"
              />
            </div>
            <div className="flex gap-2 items-center">
              <button
                onClick={doAskQuery}
                disabled={!askPrompt.trim() || askStatus === 'loading'}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[10px] font-bold transition-all"
                style={{
                  background: 'rgba(242,202,131,0.12)',
                  border: '1px solid rgba(242,202,131,0.25)',
                  color: '#f2ca83',
                  opacity: (!askPrompt.trim() || askStatus === 'loading') ? 0.4 : 1,
                  cursor: (!askPrompt.trim() || askStatus === 'loading') ? 'not-allowed' : 'pointer',
                }}
              >
                <span className={`material-symbols-outlined text-[13px] ${askStatus === 'loading' ? 'animate-spin' : ''}`}>
                  {askStatus === 'loading' ? 'sync' : 'search'}
                </span>
                {askStatus === 'loading' ? 'Searching…' : 'Search'}
              </button>
              <p className="text-[8px] text-on-surface-variant/25">Ctrl+Enter to submit</p>
            </div>
          </div>
        )}

        {/* ── Results ── */}
        <div className="flex-1 overflow-y-auto px-2 py-2 flex flex-col min-h-0">

          {/* Action bar */}
          {hasResults && (
            <div className="flex items-center justify-between px-3 py-2 mb-1.5 rounded-lg bg-white/[0.03] border border-white/5 flex-shrink-0">
              <span className="text-[10px] text-on-surface-variant/45">
                {curResults.length} card{curResults.length !== 1 ? 's' : ''}
                {selectedOracleIds.size > 0 && (
                  <span style={{ color: 'rgba(242,202,131,0.6)' }} className="ml-1">· {selectedOracleIds.size} selected</span>
                )}
                {mode === 'search' && results.length === 60 && (
                  <span className="text-on-surface-variant/25 ml-1">(capped at 60)</span>
                )}
              </span>

              <div className="flex items-center gap-2">
                {multiSelect && (
                  <button
                    onClick={toggleSelectAll}
                    className="text-[9px] font-bold uppercase tracking-wider transition-colors"
                    style={{ color: isAllSelected ? 'rgba(242,202,131,0.5)' : 'rgba(255,255,255,0.28)' }}
                  >
                    {isAllSelected ? 'Deselect All' : 'Select All'}
                  </button>
                )}
                {multiSelect && selectedOracleIds.size > 0 && (
                  <button
                    onClick={handleAddSelected}
                    disabled={addingAll || addAllDone}
                    className="flex items-center gap-1.5 px-3 py-1 rounded-md text-[11px] font-bold transition-all"
                    style={{
                      background: addAllDone ? 'rgba(74,222,128,0.12)' : 'rgba(242,202,131,0.12)',
                      color:      addAllDone ? '#4ade80'                : '#f2ca83',
                      border:     addAllDone ? '1px solid rgba(74,222,128,0.3)' : '1px solid rgba(242,202,131,0.25)',
                      opacity: addingAll ? 0.6 : 1,
                    }}
                  >
                    <span className="material-symbols-outlined text-[13px]">
                      {addAllDone ? 'check' : addingAll ? 'sync' : 'playlist_add'}
                    </span>
                    {addAllDone ? 'Added!' : addingAll ? 'Adding…' : `Add ${selectedOracleIds.size}`}
                  </button>
                )}
                {multiSelect && selectedOracleIds.size === 0 && (
                  <span className="text-[9px] text-on-surface-variant/22 italic">click to select</span>
                )}
              </div>
            </div>
          )}

          {/* ── Search mode states ── */}
          {mode === 'search' && (searchStatus === 'idle' || searchStatus === 'no-db') && (
            <div className="flex flex-col items-center justify-center flex-1 gap-3 text-center px-4">
              {searchStatus === 'no-db' ? (
                <>
                  <span className="material-symbols-outlined text-[40px] text-primary/30">sync</span>
                  <p className="text-body-md text-on-surface-variant/50 font-bold">No cards synced yet</p>
                  <p className="text-label-sm text-on-surface-variant/30">Go to Dashboard → Sync Cards</p>
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined text-[40px] text-on-surface-variant/12">playing_cards</span>
                  <p className="text-body-md text-on-surface-variant/30">Type to search or pick filters</p>
                </>
              )}
            </div>
          )}

          {mode === 'search' && searchStatus === 'loading' && (
            <div className="flex items-center justify-center flex-1">
              <span className="material-symbols-outlined text-[28px] text-primary/30 animate-spin">sync</span>
            </div>
          )}

          {mode === 'search' && searchStatus === 'empty' && (
            <div className="flex flex-col items-center justify-center flex-1 gap-3 text-center px-4">
              <span className="material-symbols-outlined text-[40px] text-on-surface-variant/12">search_off</span>
              <p className="text-body-md text-on-surface-variant/30">No cards found</p>
              {activeFilterCount > 0 && (
                <button onClick={clearAll} className="text-[11px] text-primary/50 hover:text-primary transition-colors">Clear filters</button>
              )}
            </div>
          )}

          {/* ── Search result rows ── */}
          {mode === 'search' && searchStatus === 'results' && results.map(card => (
            <CardRow
              key={card.oracle_id}
              card={card}
              isSelected={selectedOracleIds.has(card.oracle_id)}
              multiSelect={multiSelect}
              onSelect={() => multiSelect ? toggleSelect(card.oracle_id) : onSelectCard(card)}
              onQuickAdd={() => onSelectCard(card)}
              onHoverEnter={y => { setHoverCard(card); setHoverY(y); }}
              onHoverLeave={() => setHoverCard(null)}
            />
          ))}

          {/* ── Ask tab states ── */}
          {mode === 'ask' && askStatus === 'idle' && (
            <div className="flex flex-col items-center justify-center flex-1 gap-3 text-center px-4">
              <span className="material-symbols-outlined text-[40px] text-on-surface-variant/12">search</span>
              <p className="text-body-md text-on-surface-variant/30">Describe what you're looking for</p>
              <p className="text-[10px] text-on-surface-variant/20">e.g. "blue instant removal under $2" or "green ramp creatures"</p>
            </div>
          )}

          {mode === 'ask' && askStatus === 'loading' && (
            <div className="flex items-center justify-center flex-1">
              <span className="material-symbols-outlined text-[28px] text-primary/30 animate-spin">sync</span>
            </div>
          )}

          {mode === 'ask' && askStatus === 'error' && (
            <div
              className="mx-0 mb-3 px-3 py-2 rounded-xl text-[11px] flex-shrink-0"
              style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.18)', color: '#f87171' }}
            >
              {askError || 'Search failed. Make sure the card database is loaded.'}
            </div>
          )}

          {mode === 'ask' && askStatus === 'results' && askCards.length === 0 && (
            <div className="flex flex-col items-center justify-center flex-1 gap-3 text-center px-4">
              <span className="material-symbols-outlined text-[40px] text-on-surface-variant/12">search_off</span>
              <p className="text-body-md text-on-surface-variant/30">No matching cards found</p>
            </div>
          )}

          {/* ── Ask result rows ── */}
          {mode === 'ask' && askCards.map(card => (
            <CardRow
              key={card.oracle_id}
              card={card}
              isSelected={selectedOracleIds.has(card.oracle_id)}
              multiSelect={multiSelect}
              onSelect={() => multiSelect ? toggleSelect(card.oracle_id) : onSelectCard(card)}
              onQuickAdd={() => onSelectCard(card)}
              onHoverEnter={y => { setHoverCard(card); setHoverY(y); }}
              onHoverLeave={() => setHoverCard(null)}
            />
          ))}

        </div>
      </div>
    </>
  );
});
