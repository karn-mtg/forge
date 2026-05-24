import { useState, useEffect, useRef, useCallback } from 'react';
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
  { color: 'W', bg: '#f0d870', title: 'White' },
  { color: 'U', bg: '#4a7cc9', title: 'Blue' },
  { color: 'B', bg: '#5a5a5a', title: 'Black' },
  { color: 'R', bg: '#c0392b', title: 'Red' },
  { color: 'G', bg: '#27ae60', title: 'Green' },
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
  { value: 'standard',   label: 'Std'   },
  { value: 'pioneer',    label: 'Pio'   },
  { value: 'modern',     label: 'Mod'   },
  { value: 'legacy',     label: 'Leg'   },
  { value: 'vintage',    label: 'Vin'   },
  { value: 'commander',  label: 'EDH'   },
  { value: 'pauper',     label: 'Ppr'   },
  { value: 'explorer',   label: 'Exp'   },
];

type SearchIn = 'all' | 'name' | 'oracle';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function FilterLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[9px] text-on-surface-variant/35 uppercase tracking-widest font-bold mb-1.5">
      {children}
    </p>
  );
}

function StatInput({
  placeholder, value, onChange,
}: { placeholder: string; value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="text"
      inputMode="numeric"
      placeholder={placeholder}
      value={value}
      onChange={e => onChange(e.target.value.replace(/[^0-9]/g, ''))}
      className="w-14 bg-surface-container/60 border border-white/5 rounded-md px-2 py-1 text-[11px] text-on-surface focus:outline-none focus:border-primary/50 placeholder:text-on-surface-variant/25 text-center"
    />
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
  showColorFilters?: boolean;
}

export function CardSearchPanel({
  isOpen, onClose, title = 'Add Card',
  onSelectCard, onAddAll, extraControls, showColorFilters = false,
}: CardSearchPanelProps) {

  // ── Core search state ──────────────────────────────────────────────────────
  const [query,        setQuery]        = useState('');
  const [results,      setResults]      = useState<Card[]>([]);
  const [searchStatus, setSearchStatus] = useState<'idle' | 'loading' | 'results' | 'empty' | 'no-db'>('idle');
  const [searchIn,     setSearchIn]     = useState<SearchIn>('all');

  // ── Filter state ───────────────────────────────────────────────────────────
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

  // ── UI state ───────────────────────────────────────────────────────────────
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [addingAll,    setAddingAll]    = useState(false);
  const [addAllDone,   setAddAllDone]   = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(null);

  const showCreatureStats = activeTypes.has('Creature');

  // Count of active advanced filters (for badge)
  const advancedCount =
    (searchIn !== 'all' ? 1 : 0) +
    activeTypes.size + activeRarities.size +
    (cmcMin !== '' ? 1 : 0) + (cmcMax !== '' ? 1 : 0) +
    (powerMin !== '' ? 1 : 0) + (powerMax !== '' ? 1 : 0) +
    (toughMin !== '' ? 1 : 0) + (toughMax !== '' ? 1 : 0) +
    (setCode !== '' ? 1 : 0) +
    (legality !== '' ? 1 : 0) +
    (gameChanger ? 1 : 0);

  // ── Reset on open/close ────────────────────────────────────────────────────
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
      setSetCode(''); setLegality(''); setGameChanger(false);
      setShowAdvanced(false);
      setAddingAll(false); setAddAllDone(false);
    }
  }, [isOpen]);

  // ── Search ─────────────────────────────────────────────────────────────────
  const doSearch = useCallback(async (overrides: Partial<{
    q: string; colors: Set<string>; mode: SearchIn;
    types: Set<string>; rarities: Set<string>;
    cMin: string; cMax: string;
    pMin: string; pMax: string;
    tMin: string; tMax: string;
    set: string; legal: string; gc: boolean;
  }> = {}) => {
    const q       = overrides.q       ?? query.trim();
    const colors  = overrides.colors  ?? activeColors;
    const mode    = overrides.mode    ?? searchIn;
    const types   = overrides.types   ?? activeTypes;
    const rarities= overrides.rarities?? activeRarities;
    const cMin    = overrides.cMin    ?? cmcMin;
    const cMax    = overrides.cMax    ?? cmcMax;
    const pMin    = overrides.pMin    ?? powerMin;
    const pMax    = overrides.pMax    ?? powerMax;
    const tMin    = overrides.tMin    ?? toughMin;
    const tMax    = overrides.tMax    ?? toughMax;
    const set     = overrides.set     ?? setCode;
    const legal   = overrides.legal   ?? legality;
    const gc      = overrides.gc      ?? gameChanger;

    const hasAny = q || colors.size || types.size || rarities.size ||
      cMin || cMax || pMin || pMax || tMin || tMax || set || legal || gc;

    if (!hasAny) { setSearchStatus('idle'); return; }
    setSearchStatus('loading');
    try {
      const res = await window.cardsAPI.search({
        q, pageSize: 60, searchIn: mode,
        colors:   Array.from(colors),
        types:    Array.from(types),
        rarities: Array.from(rarities),
        cmcMin:      cMin !== '' ? Number(cMin) : null,
        cmcMax:      cMax !== '' ? Number(cMax) : null,
        powerMin:    pMin !== '' ? Number(pMin) : null,
        powerMax:    pMax !== '' ? Number(pMax) : null,
        toughnessMin: tMin !== '' ? Number(tMin) : null,
        toughnessMax: tMax !== '' ? Number(tMax) : null,
        setCode: set, legality: legal, gameChanger: gc,
      });
      const cards = res?.cards || [];
      setResults(cards);
      setSearchStatus(cards.length ? 'results' : 'empty');
      setAddAllDone(false);
    } catch {
      setSearchStatus('no-db');
    }
  }, [query, activeColors, searchIn, activeTypes, activeRarities,
      cmcMin, cmcMax, powerMin, powerMax, toughMin, toughMax,
      setCode, legality, gameChanger]);

  const schedule = useCallback((overrides: Parameters<typeof doSearch>[0] = {}) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => doSearch(overrides), 180);
  }, [doSearch]);

  // ── Event handlers ─────────────────────────────────────────────────────────
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
      // Clear P/T when no creature selected
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

  const handleSearchInChange = (mode: SearchIn) => {
    setSearchIn(mode);
    schedule({ mode });
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

  const clearAdvanced = () => {
    setSearchIn('all'); setActiveTypes(new Set()); setActiveRarities(new Set());
    setCmcMin(''); setCmcMax(''); setPowerMin(''); setPowerMax('');
    setToughMin(''); setToughMax(''); setSetCode(''); setLegality(''); setGameChanger(false);
    schedule({ mode: 'all', types: new Set(), rarities: new Set(),
               cMin: '', cMax: '', pMin: '', pMax: '', tMin: '', tMax: '',
               set: '', legal: '', gc: false });
  };

  const handleAddAll = async () => {
    if (!onAddAll || !results.length) return;
    setAddingAll(true);
    try { await onAddAll(results); setAddAllDone(true); }
    finally { setAddingAll(false); }
  };

  if (!isOpen) return null;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div
      className="fixed top-0 right-0 h-full w-[340px] z-[100] flex flex-col no-drag"
      style={{ background: 'rgba(20,22,27,0.97)', backdropFilter: 'blur(40px)', borderLeft: '1px solid rgba(255,255,255,0.06)' }}
    >
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 flex-shrink-0">
        <h3 className="font-headline-md text-sm font-bold text-on-surface">{title}</h3>
        <button onClick={onClose} className="w-7 h-7 rounded-md flex items-center justify-center text-on-surface-variant hover:bg-white/10 transition-all">
          <span className="material-symbols-outlined text-[18px]">close</span>
        </button>
      </div>

      {/* ── Controls ── */}
      <div className="px-3 py-3 border-b border-white/5 flex-shrink-0 space-y-2.5">

        {/* Search input */}
        <div className="relative">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/40 text-[18px]">search</span>
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
            className="w-full bg-surface-container/60 border border-white/5 rounded-lg py-2 pl-9 pr-3 text-body-md focus:outline-none focus:border-primary/50 placeholder:text-on-surface-variant/30"
          />
        </div>

        {/* Color filters */}
        {showColorFilters && (
          <div className="flex gap-1.5">
            {COLOR_FILTERS.map(({ color, bg, title: t, label }) => (
              <button
                key={color}
                onClick={() => toggleColor(color)}
                title={t}
                className="w-6 h-6 rounded-full border-2 hover:scale-110 transition-all flex items-center justify-center text-[8px] font-bold text-white"
                style={{
                  background:  bg,
                  borderColor: activeColors.has(color) ? 'white' : 'transparent',
                  opacity:     activeColors.size > 0 && !activeColors.has(color) ? 0.45 : 1,
                }}
              >
                {label || ''}
              </button>
            ))}
          </div>
        )}

        {/* Advanced toggle */}
        <button
          onClick={() => setShowAdvanced(v => !v)}
          className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider transition-all w-full"
          style={{ color: advancedCount > 0 ? '#f2ca83' : 'rgba(255,255,255,0.3)' }}
        >
          <span className="material-symbols-outlined text-[14px]">{showAdvanced ? 'expand_less' : 'tune'}</span>
          Filters
          {advancedCount > 0 && (
            <span className="ml-1 px-1.5 py-0.5 rounded-full bg-primary/20 text-primary text-[9px]">{advancedCount}</span>
          )}
          <span className="flex-1" />
          {advancedCount > 0 && (
            <button
              onClick={e => { e.stopPropagation(); clearAdvanced(); }}
              className="text-[9px] text-on-surface-variant/40 hover:text-on-surface-variant transition-colors normal-case tracking-normal font-medium"
            >
              Clear all
            </button>
          )}
        </button>

        {/* ── Advanced section ── */}
        {showAdvanced && (
          <div className="space-y-3 pt-0.5">

            {/* Search In */}
            <div>
              <FilterLabel>Search In</FilterLabel>
              <div className="flex gap-1 bg-surface-container/40 rounded-lg p-0.5">
                {(['all','name','oracle'] as SearchIn[]).map(m => (
                  <button
                    key={m}
                    onClick={() => handleSearchInChange(m)}
                    className="flex-1 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all capitalize"
                    style={{
                      background: searchIn === m ? 'rgba(242,202,131,0.15)' : 'transparent',
                      color:      searchIn === m ? '#f2ca83' : 'rgba(255,255,255,0.35)',
                    }}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            {/* Type */}
            <div>
              <FilterLabel>Type</FilterLabel>
              <div className="flex flex-wrap gap-1">
                {TYPE_FILTERS.map(t => (
                  <button
                    key={t}
                    onClick={() => toggleType(t)}
                    className="px-2 py-0.5 rounded-md text-[10px] font-bold transition-all border"
                    style={{
                      background:  activeTypes.has(t) ? 'rgba(242,202,131,0.15)' : 'rgba(255,255,255,0.04)',
                      borderColor: activeTypes.has(t) ? 'rgba(242,202,131,0.4)'  : 'rgba(255,255,255,0.07)',
                      color:       activeTypes.has(t) ? '#f2ca83'                 : 'rgba(255,255,255,0.45)',
                    }}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            {/* Power / Toughness — only shown when Creature is selected */}
            {showCreatureStats && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <FilterLabel>Power</FilterLabel>
                  <div className="flex items-center gap-1.5">
                    <StatInput placeholder="Min" value={powerMin} onChange={v => { setPowerMin(v); schedule({ pMin: v }); }} />
                    <span className="text-on-surface-variant/30 text-[11px]">–</span>
                    <StatInput placeholder="Max" value={powerMax} onChange={v => { setPowerMax(v); schedule({ pMax: v }); }} />
                  </div>
                </div>
                <div>
                  <FilterLabel>Toughness</FilterLabel>
                  <div className="flex items-center gap-1.5">
                    <StatInput placeholder="Min" value={toughMin} onChange={v => { setToughMin(v); schedule({ tMin: v }); }} />
                    <span className="text-on-surface-variant/30 text-[11px]">–</span>
                    <StatInput placeholder="Max" value={toughMax} onChange={v => { setToughMax(v); schedule({ tMax: v }); }} />
                  </div>
                </div>
              </div>
            )}

            {/* Mana Value */}
            <div>
              <FilterLabel>Mana Value</FilterLabel>
              <div className="flex items-center gap-2">
                <StatInput placeholder="Min" value={cmcMin} onChange={v => { setCmcMin(v); schedule({ cMin: v }); }} />
                <span className="text-on-surface-variant/30 text-[11px]">–</span>
                <StatInput placeholder="Max" value={cmcMax} onChange={v => { setCmcMax(v); schedule({ cMax: v }); }} />
              </div>
            </div>

            {/* Rarity */}
            <div>
              <FilterLabel>Rarity</FilterLabel>
              <div className="flex gap-2">
                {RARITY_FILTERS.map(({ value, label, color, title: t }) => (
                  <button
                    key={value}
                    onClick={() => toggleRarity(value)}
                    title={t}
                    className="w-7 h-7 rounded-full border-2 flex items-center justify-center text-[10px] font-black transition-all hover:scale-110"
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

            {/* Set */}
            <div>
              <FilterLabel>Set Code</FilterLabel>
              <input
                type="text"
                value={setCode}
                onChange={handleSetCode}
                placeholder="e.g. mkm, otj, m21…"
                maxLength={6}
                className="w-full bg-surface-container/60 border border-white/5 rounded-md px-3 py-1.5 text-[11px] text-on-surface focus:outline-none focus:border-primary/50 placeholder:text-on-surface-variant/25 font-mono tracking-widest uppercase"
              />
            </div>

            {/* Legal In */}
            <div>
              <FilterLabel>Legal In</FilterLabel>
              <div className="flex flex-wrap gap-1">
                {FORMAT_FILTERS.map(({ value, label }) => (
                  <button
                    key={value}
                    onClick={() => handleLegality(value)}
                    className="px-2.5 py-0.5 rounded-md text-[10px] font-bold transition-all border"
                    style={{
                      background:  legality === value ? 'rgba(96,165,250,0.15)' : 'rgba(255,255,255,0.04)',
                      borderColor: legality === value ? 'rgba(96,165,250,0.4)'  : 'rgba(255,255,255,0.07)',
                      color:       legality === value ? '#60a5fa'                : 'rgba(255,255,255,0.45)',
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Game Changer */}
            <button
              onClick={handleGameChanger}
              className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg border transition-all"
              style={{
                background:  gameChanger ? 'rgba(251,191,36,0.08)' : 'rgba(255,255,255,0.03)',
                borderColor: gameChanger ? 'rgba(251,191,36,0.3)'  : 'rgba(255,255,255,0.07)',
              }}
            >
              <span
                className="material-symbols-outlined text-[16px] transition-colors"
                style={{ color: gameChanger ? '#fbbf24' : 'rgba(255,255,255,0.25)' }}
              >
                {gameChanger ? 'star' : 'star_border'}
              </span>
              <span className="text-[11px] font-bold transition-colors"
                style={{ color: gameChanger ? '#fbbf24' : 'rgba(255,255,255,0.4)' }}>
                Game Changer only
              </span>
              <span className="ml-auto text-[9px] text-on-surface-variant/25">
                Scryfall tag
              </span>
            </button>

          </div>
        )}

        {extraControls}
      </div>

      {/* ── Results ── */}
      <div className="flex-1 overflow-y-auto px-2 py-2 flex flex-col min-h-0">

        {/* Add All bar */}
        {searchStatus === 'results' && onAddAll && (
          <div className="flex items-center justify-between px-3 py-2 mb-1 rounded-lg bg-white/[0.03] border border-white/5 flex-shrink-0">
            <span className="text-[10px] text-on-surface-variant/50">
              {results.length} card{results.length !== 1 ? 's' : ''}
              {results.length === 60 && <span className="text-on-surface-variant/30"> (capped)</span>}
            </span>
            <button
              onClick={handleAddAll}
              disabled={addingAll || addAllDone}
              className="flex items-center gap-1.5 px-3 py-1 rounded-md text-[11px] font-bold transition-all"
              style={{
                background:  addAllDone ? 'rgba(74,222,128,0.12)' : 'rgba(242,202,131,0.12)',
                color:       addAllDone ? '#4ade80'               : '#f2ca83',
                border:      addAllDone ? '1px solid rgba(74,222,128,0.3)' : '1px solid rgba(242,202,131,0.25)',
                opacity: addingAll ? 0.6 : 1,
              }}
            >
              <span className="material-symbols-outlined text-[13px]">
                {addAllDone ? 'check' : addingAll ? 'sync' : 'playlist_add'}
              </span>
              {addAllDone ? 'Added!' : addingAll ? 'Adding…' : 'Add All'}
            </button>
          </div>
        )}

        {/* States */}
        {(searchStatus === 'idle' || searchStatus === 'no-db') && (
          <div className="flex flex-col items-center justify-center flex-1 gap-3 text-center px-4">
            {searchStatus === 'no-db' ? (
              <>
                <span className="material-symbols-outlined text-[40px] text-primary/30">sync</span>
                <p className="text-body-md text-on-surface-variant/50 font-bold">No cards synced yet</p>
                <p className="text-label-sm text-on-surface-variant/30">Go to Dashboard → Sync Cards</p>
              </>
            ) : (
              <>
                <span className="material-symbols-outlined text-[40px] text-on-surface-variant/15">playing_cards</span>
                <p className="text-body-md text-on-surface-variant/35">Type to search or pick filters</p>
              </>
            )}
          </div>
        )}

        {searchStatus === 'loading' && (
          <div className="flex flex-col items-center justify-center flex-1 gap-3">
            <span className="material-symbols-outlined text-[28px] text-primary/30 animate-spin">sync</span>
          </div>
        )}

        {searchStatus === 'empty' && (
          <div className="flex flex-col items-center justify-center flex-1 gap-3 text-center px-4">
            <span className="material-symbols-outlined text-[40px] text-on-surface-variant/15">search_off</span>
            <p className="text-body-md text-on-surface-variant/35">No cards found</p>
            {advancedCount > 0 && (
              <button onClick={clearAdvanced} className="text-[11px] text-primary/60 hover:text-primary transition-colors">
                Clear filters
              </button>
            )}
          </div>
        )}

        {searchStatus === 'results' && results.map(card => (
          <button
            key={card.oracle_id}
            onClick={() => onSelectCard(card)}
            className="w-full flex items-start gap-2 px-3 py-2.5 rounded-lg hover:bg-white/5 active:bg-white/10 transition-all text-left flex-shrink-0"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="text-label-md font-bold text-on-surface truncate">{card.name}</span>
                <PipRow manaCost={card.mana_cost} />
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <p className="text-[10px] text-on-surface-variant/45 truncate flex-1">{card.type_line || ''}</p>
                {/* P/T badge for creatures */}
                {card.power != null && card.toughness != null && (
                  <span className="text-[10px] font-bold text-on-surface-variant/50 flex-shrink-0 tabular-nums">
                    {card.power}/{card.toughness}
                  </span>
                )}
                {/* Loyalty badge for planeswalkers */}
                {card.loyalty != null && (
                  <span className="text-[10px] font-bold text-blue-400/60 flex-shrink-0">
                    ◆{card.loyalty}
                  </span>
                )}
              </div>
            </div>
          </button>
        ))}

      </div>
    </div>
  );
}
