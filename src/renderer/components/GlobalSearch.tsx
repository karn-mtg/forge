import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useGlobalSearchStore } from '../store/useGlobalSearchStore';
import { useLibraryStore } from '../store/useLibraryStore';
import { useSearchStore } from '../store/useSearchStore';
import type { FolderNode } from '../types/electron';

// ─── types ────────────────────────────────────────────────────────────────────

interface SearchResult {
  id: string;
  group: string;
  groupIcon: string;
  label: string;
  sublabel?: string;
  icon: string;
  iconFill?: boolean;
  action: () => void;
}

// ─── static pages list ────────────────────────────────────────────────────────

const PAGES = [
  { to: '/',          label: 'Dashboard',  icon: 'dashboard',   fill: true  },
  { to: '/recents',   label: 'Recents',    icon: 'schedule',    fill: false },
  { to: '/collection',label: 'Collection', icon: 'inventory_2', fill: false },
  { to: '/wishlist',  label: 'Wishlist',   icon: 'bookmark',    fill: false },
  { to: '/decks',     label: 'All Decks',  icon: 'grid_view',   fill: false },
  { to: '/favorites', label: 'Favorites',  icon: 'star',        fill: true  },
  { to: '/widgets',   label: 'Widgets',    icon: 'widgets',     fill: false },
  { to: '/settings',  label: 'Settings',   icon: 'settings',    fill: false },
];

// ─── helpers ──────────────────────────────────────────────────────────────────

function flattenFolders(nodes: FolderNode[], path = ''): Array<{ id: number; name: string; path: string }> {
  const result: Array<{ id: number; name: string; path: string }> = [];
  for (const n of nodes) {
    const fullPath = path ? `${path} / ${n.name}` : n.name;
    result.push({ id: n.id, name: n.name, path: fullPath });
    if (n.children?.length) result.push(...flattenFolders(n.children, fullPath));
  }
  return result;
}

/** Wrap every occurrence of `query` in a <mark> element (case-insensitive). */
function highlight(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const q = query.toLowerCase();
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let keyIdx = 0;
  while (remaining.length > 0) {
    const idx = remaining.toLowerCase().indexOf(q);
    if (idx === -1) { parts.push(remaining); break; }
    if (idx > 0) parts.push(remaining.slice(0, idx));
    parts.push(
      <mark key={keyIdx++} className="bg-primary/30 text-primary rounded-[2px] px-[1px]">
        {remaining.slice(idx, idx + query.length)}
      </mark>
    );
    remaining = remaining.slice(idx + query.length);
  }
  return <>{parts}</>;
}

// ─── component ────────────────────────────────────────────────────────────────

export function GlobalSearch() {
  const { isOpen, close } = useGlobalSearchStore();
  const { decks, folders } = useLibraryStore();
  const navigate = useNavigate();

  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);

  // Card search (debounced, only when query ≥ 2 chars)
  const [cardResults, setCardResults] = useState<Array<{ oracle_id: string; name: string; type_line?: string }>>([]);
  const cardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Reset state on open
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setActiveIdx(0);
      setCardResults([]);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [isOpen]);

  // Card search with debounce
  useEffect(() => {
    if (cardTimerRef.current) clearTimeout(cardTimerRef.current);
    if (query.length < 2) { setCardResults([]); return; }
    cardTimerRef.current = setTimeout(async () => {
      try {
        const { cards } = await window.cardsAPI.search({ q: query, pageSize: 5, searchIn: 'name' });
        setCardResults(cards.slice(0, 5));
      } catch { setCardResults([]); }
    }, 250);
    return () => { if (cardTimerRef.current) clearTimeout(cardTimerRef.current); };
  }, [query]);

  // Build result groups
  const results = useMemo<SearchResult[]>(() => {
    const q = query.trim().toLowerCase();

    const go = (to: string) => { navigate(to); close(); };

    // Pages
    const pageHits = PAGES
      .filter(p => !q || p.label.toLowerCase().includes(q))
      .map(p => ({
        id: `page:${p.to}`,
        group: 'Pages',
        groupIcon: 'map',
        label: p.label,
        icon: p.icon,
        iconFill: p.fill,
        action: () => go(p.to),
      }));

    // Decks
    const deckHits = decks
      .filter(d => !q || d.name.toLowerCase().includes(q))
      .slice(0, 8)
      .map(d => ({
        id: `deck:${d.id}`,
        group: 'Decks',
        groupIcon: 'style',
        label: d.name,
        sublabel: d.format,
        icon: 'style',
        iconFill: false,
        action: () => go(`/deck/${d.id}`),
      }));

    // Folders
    const flatFolders = flattenFolders(folders);
    const folderHits = flatFolders
      .filter(f => !q || f.name.toLowerCase().includes(q))
      .slice(0, 5)
      .map(f => ({
        id: `folder:${f.id}`,
        group: 'Folders',
        groupIcon: 'folder',
        label: f.name,
        sublabel: f.path !== f.name ? f.path : undefined,
        icon: 'folder',
        iconFill: true,
        action: () => go('/decks'),
      }));

    // Cards (async, already in state)
    // Pre-populates the Collection page search so the selected card is immediately visible.
    const cardHits = cardResults.map(c => ({
      id: `card:${c.oracle_id}`,
      group: 'Cards',
      groupIcon: 'playing_cards',
      label: c.name,
      sublabel: c.type_line,
      icon: 'playing_cards',
      iconFill: false,
      action: () => {
        useSearchStore.getState().setValue(c.name);
        navigate('/collection');
        close();
      },
    }));

    return [...pageHits, ...deckHits, ...folderHits, ...cardHits];
  }, [query, decks, folders, cardResults, navigate, close]);

  // Reset active when results change
  useEffect(() => setActiveIdx(0), [results]);

  // Scroll active item into view
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector('[data-active="true"]') as HTMLElement | null;
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  // Keyboard handler
  const handleKey = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); results[activeIdx]?.action(); }
    else if (e.key === 'Escape') close();
  }, [results, activeIdx, close]);

  // Group results for rendering
  const grouped = useMemo(() => {
    const map = new Map<string, { icon: string; items: SearchResult[] }>();
    for (const r of results) {
      if (!map.has(r.group)) map.set(r.group, { icon: r.groupIcon, items: [] });
      map.get(r.group)!.items.push(r);
    }
    return map;
  }, [results]);

  if (!isOpen) return null;

  // Flat index for active tracking
  let flatIdx = 0;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-start justify-center pt-[15vh]"
      onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Palette */}
      <div
        className="relative w-full max-w-[640px] mx-4 glass-sidebar border border-white/10 rounded-2xl shadow-2xl overflow-hidden"
        style={{ animation: 'gsIn 120ms cubic-bezier(0.16,1,0.3,1) both' }}
      >
        {/* Input row */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-white/5">
          <span className="material-symbols-outlined text-on-surface-variant/40 text-[22px]">search</span>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Search decks, cards, folders, pages…"
            className="flex-1 bg-transparent outline-none text-on-surface text-[15px] placeholder:text-on-surface-variant/30"
          />
          {query && (
            <button onClick={() => setQuery('')} className="text-on-surface-variant/30 hover:text-on-surface-variant transition-colors">
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          )}
          <kbd className="hidden sm:flex items-center gap-0.5 px-2 py-0.5 rounded bg-white/5 border border-white/10 text-[10px] text-on-surface-variant/40 font-mono">
            Esc
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[420px] overflow-y-auto overscroll-contain py-2">
          {results.length === 0 && query.length > 0 ? (
            <div className="flex flex-col items-center py-12 gap-2 text-on-surface-variant/30">
              <span className="material-symbols-outlined text-[40px]">search_off</span>
              <p className="text-sm">No results for <span className="font-bold text-on-surface-variant/50">"{query}"</span></p>
            </div>
          ) : results.length === 0 ? (
            <div className="flex flex-col items-center py-10 gap-3 text-on-surface-variant/25">
              <span className="material-symbols-outlined text-[36px]">manage_search</span>
              <p className="text-sm">Start typing to search…</p>
            </div>
          ) : (
            Array.from(grouped.entries()).map(([group, { icon: gIcon, items }]) => (
              <div key={group}>
                {/* Group header */}
                <div className="flex items-center gap-2 px-5 pt-3 pb-1">
                  <span className="material-symbols-outlined text-[13px] text-on-surface-variant/30">{gIcon}</span>
                  <span className="text-[10px] uppercase tracking-widest font-bold text-on-surface-variant/30">{group}</span>
                </div>

                {/* Group items */}
                {items.map((r) => {
                  const myIdx = flatIdx++;
                  const isActive = myIdx === activeIdx;
                  return (
                    <button
                      key={r.id}
                      data-active={isActive}
                      onMouseEnter={() => setActiveIdx(myIdx)}
                      onClick={r.action}
                      className={`w-full flex items-center gap-3 px-5 py-2.5 text-left transition-colors ${
                        isActive ? 'bg-primary/10' : 'hover:bg-white/4'
                      }`}
                    >
                      <span
                        className={`material-symbols-outlined text-[18px] shrink-0 ${isActive ? 'text-primary' : 'text-on-surface-variant/40'}`}
                        style={r.iconFill ? { fontVariationSettings: "'FILL' 1" } : undefined}
                      >
                        {r.icon}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm truncate ${isActive ? 'text-on-surface' : 'text-on-surface-variant'}`}>
                          {highlight(r.label, query)}
                        </p>
                        {r.sublabel && (
                          <p className="text-[11px] text-on-surface-variant/40 truncate">{r.sublabel}</p>
                        )}
                      </div>
                      {isActive && (
                        <kbd className="shrink-0 flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-primary/20 border border-primary/30 text-[10px] text-primary font-mono">
                          ↵
                        </kbd>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer hint */}
        <div className="px-5 py-2.5 border-t border-white/5 flex items-center gap-4 text-[10px] text-on-surface-variant/25">
          <span className="flex items-center gap-1"><kbd className="font-mono">↑↓</kbd> navigate</span>
          <span className="flex items-center gap-1"><kbd className="font-mono">↵</kbd> open</span>
          <span className="flex items-center gap-1"><kbd className="font-mono">Esc</kbd> close</span>
        </div>
      </div>

      <style>{`
        @keyframes gsIn {
          from { opacity: 0; transform: scale(0.96) translateY(-8px); }
          to   { opacity: 1; transform: scale(1)    translateY(0);    }
        }
      `}</style>
    </div>,
    document.body
  );
}
