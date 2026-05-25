import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { CardSearchPanel } from '../components/CardSearchPanel';
import { useLibraryStore } from '../store/useLibraryStore';
import { useToastStore } from '../store/useToastStore';
import type { WishlistEntry, Card, Deck } from '../types/electron';

const PRIORITY_LABELS: Record<number, string> = { 0: 'Low', 1: 'Normal', 2: 'High', 3: 'Critical' };
const PRIORITY_COLORS: Record<number, string> = {
  0: 'text-on-surface-variant/50',
  1: 'text-blue-400/70',
  2: 'text-yellow-400/80',
  3: 'text-red-400/80',
};

/** localStorage key for persisting wishlist drag-to-reorder. */
const ORDER_STORAGE_KEY = 'kf-wishlist-order';

function saveOrder(entries: WishlistEntry[]) {
  try {
    localStorage.setItem(ORDER_STORAGE_KEY, JSON.stringify(entries.map(e => e.id)));
  } catch { /* storage full or unavailable — not critical */ }
}

function applyStoredOrder(entries: WishlistEntry[]): WishlistEntry[] {
  try {
    const raw = localStorage.getItem(ORDER_STORAGE_KEY);
    if (!raw) return entries;
    const ids: number[] = JSON.parse(raw);
    if (!ids.length) return entries;
    const orderMap = new Map(ids.map((id, i) => [id, i]));
    return [...entries].sort(
      (a, b) => (orderMap.get(a.id) ?? 9999) - (orderMap.get(b.id) ?? 9999),
    );
  } catch {
    return entries;
  }
}

// ─── Add-to-Deck popover ──────────────────────────────────────────────────────

function AddToDeckPopover({ oracleId, decks, onClose }: {
  oracleId: string;
  decks: Deck[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [adding, setAdding] = useState<number | null>(null);
  const [done, setDone] = useState<number | null>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  }, [onClose]);

  const handleAdd = async (deck: Deck) => {
    setAdding(deck.id);
    try {
      await window.libraryAPI.addCardToDeck({ deckId: deck.id, oracleId, board: 'main' });
      setDone(deck.id);
      setTimeout(() => { setDone(null); onClose(); }, 900);
    } finally {
      setAdding(null);
    }
  };

  return (
    <div ref={ref} className="absolute right-0 top-8 z-50 min-w-[200px] max-w-[240px] bg-surface-container/95 backdrop-blur-xl rounded-xl shadow-2xl border border-white/10 overflow-hidden py-1">
      {decks.length === 0 ? (
        <div className="px-3 py-4 text-[12px] text-on-surface-variant/50 text-center">No decks yet</div>
      ) : (
        decks.slice(0, 12).map(deck => (
          <button
            key={deck.id}
            onClick={() => handleAdd(deck)}
            disabled={!!adding}
            className="w-full flex items-center gap-2 px-3 py-2 hover:bg-white/8 transition-colors text-left"
          >
            {done === deck.id
              ? <span className="material-symbols-outlined text-[14px] text-green-400 flex-shrink-0">check_circle</span>
              : adding === deck.id
              ? <span className="material-symbols-outlined text-[14px] text-primary/60 animate-spin flex-shrink-0">sync</span>
              : <span className="material-symbols-outlined text-[14px] text-on-surface-variant/40 flex-shrink-0">style</span>
            }
            <span className="text-[12px] text-on-surface-variant hover:text-on-surface truncate">{deck.name}</span>
          </button>
        ))
      )}
    </div>
  );
}

// ─── Wishlist page ────────────────────────────────────────────────────────────

export function Wishlist() {
  const { decks } = useLibraryStore();
  const [entries, setEntries] = useState<WishlistEntry[]>([]);
  const [cards, setCards] = useState<Record<string, Card>>({});
  const [collectionIds, setCollectionIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [panelOpen, setPanelOpen] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<number | null>(null);
  const [noteVal, setNoteVal] = useState('');
  const [addToDeckId, setAddToDeckId] = useState<number | null>(null);

  // Drag-to-reorder
  const dragIdRef = useRef<number | null>(null);
  const [dragOverId, setDragOverId] = useState<number | null>(null);

  // Per-entry debounce timers for quantity/priority IPC calls
  const updateTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const loadWishlist = useCallback(async () => {
    setIsLoading(true);
    try {
      const [data, collection] = await Promise.all([
        window.libraryAPI.getWishlist(),
        window.libraryAPI.getCollection().catch(() => [] as Awaited<ReturnType<typeof window.libraryAPI.getCollection>>),
      ]);
      // Restore previously saved drag order
      const ordered = applyStoredOrder(data || []);
      setEntries(ordered);
      setCollectionIds(new Set((collection || []).map(e => e.oracle_id).filter(Boolean)));

      const oracleIds = [...new Set(ordered.map(e => e.oracle_id).filter(Boolean))];
      if (oracleIds.length > 0) {
        try {
          const fetched = await window.cardsAPI.getCardsBatch({ oracleIds });
          const map: Record<string, Card> = {};
          for (const c of fetched || []) map[c.oracle_id] = c;
          setCards(map);
        } catch { /* card data is non-critical */ }
      }
    } catch (err) {
      console.error('Failed to load wishlist:', err);
      useToastStore.getState().push({ type: 'error', title: 'Failed to load wishlist', message: String(err) });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { loadWishlist(); }, [loadWishlist]);

  // Total market value
  const totalValue = useMemo(() => {
    let sum = 0;
    for (const e of entries) {
      const price = parseFloat(cards[e.oracle_id]?.full_data?.prices?.usd || '0');
      if (price > 0) sum += (e.quantity || 1) * price;
    }
    return sum;
  }, [entries, cards]);

  const handleAdd = async (card: Card) => {
    const existing = entries.find(e => e.oracle_id === card.oracle_id);
    if (existing) {
      await handleUpdate(existing.id, (existing.quantity || 1) + 1, existing.priority ?? 0, existing.note);
      setPanelOpen(false);
      return;
    }
    const result = await window.libraryAPI.addToWishlist({
      oracleId: card.oracle_id,
      scryfallId: card.scryfall_id,
      quantity: 1,
    });
    setPanelOpen(false);
    const newEntry: WishlistEntry = { id: result.id, oracle_id: card.oracle_id, quantity: 1, priority: 0, note: '' };
    setEntries(prev => {
      const next = [...prev, newEntry];
      saveOrder(next);
      return next;
    });
    setCards(prev => ({ ...prev, [card.oracle_id]: card }));
  };

  const handleRemove = async (id: number) => {
    await window.libraryAPI.removeFromWishlist({ id });
    setEntries(prev => {
      const next = prev.filter(e => e.id !== id);
      saveOrder(next);
      return next;
    });
  };

  /**
   * Optimistically update local state immediately, then debounce the IPC call.
   * This prevents an IPC storm when the user rapidly clicks +/− on quantity.
   */
  const handleUpdate = useCallback(async (id: number, quantity: number, priority: number, note?: string) => {
    // Immediate UI update
    setEntries(prev => prev.map(e => e.id === id ? { ...e, quantity, priority, note: note ?? e.note } : e));

    // Cancel any pending IPC call for this entry and schedule a new one
    const existing = updateTimers.current.get(id);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(async () => {
      updateTimers.current.delete(id);
      try {
        await window.libraryAPI.updateWishlistEntry({ id, quantity, priority, note });
      } catch (err) {
        console.error('Failed to update wishlist entry:', err);
        useToastStore.getState().push({ type: 'error', title: 'Failed to update wishlist', message: String(err) });
      }
    }, 300);
    updateTimers.current.set(id, timer);
  }, []);

  // Drag-to-reorder handlers
  const handleDragStart = useCallback((id: number) => { dragIdRef.current = id; }, []);
  const handleDragOver = useCallback((e: React.DragEvent, id: number) => {
    e.preventDefault();
    setDragOverId(id);
  }, []);
  const handleDrop = useCallback((targetId: number) => {
    const fromId = dragIdRef.current;
    dragIdRef.current = null;
    setDragOverId(null);
    if (!fromId || fromId === targetId) return;
    setEntries(prev => {
      const arr = [...prev];
      const fi = arr.findIndex(e => e.id === fromId);
      const ti = arr.findIndex(e => e.id === targetId);
      if (fi === -1 || ti === -1) return prev;
      const [item] = arr.splice(fi, 1);
      arr.splice(ti, 0, item);
      // Persist the new order to localStorage so it survives reloads
      saveOrder(arr);
      return arr;
    });
  }, []);

  const startEditNote = (entry: WishlistEntry) => {
    setEditingNoteId(entry.id);
    setNoteVal(entry.note || '');
  };

  const commitNote = async (entry: WishlistEntry) => {
    setEditingNoteId(null);
    if (noteVal !== (entry.note || '')) {
      await handleUpdate(entry.id, entry.quantity || 1, entry.priority ?? 0, noteVal);
    }
  };

  return (
    <>
      <main className="p-margin-desktop min-h-screen">
        <div className="max-w-[1400px] mx-auto space-y-6">

          {/* Header */}
          <div className="flex items-end justify-between">
            <div>
              <h2 className="font-headline-lg text-2xl text-on-surface">Wishlist</h2>
              <p className="text-on-surface-variant text-body-md mt-1">Cards you want to acquire</p>
            </div>
            <div className="flex items-center gap-4">
              {totalValue > 0 && (
                <div className="text-right">
                  <p className="text-[10px] uppercase tracking-widest font-bold text-on-surface-variant/40">Market Value</p>
                  <p className="font-bold text-on-surface text-lg tabular-nums">${totalValue.toFixed(2)}</p>
                </div>
              )}
              <button
                onClick={() => setPanelOpen(true)}
                className="flex items-center gap-2 px-4 py-2 bg-primary/10 text-primary border border-primary/20 rounded-lg hover:bg-primary/20 transition-all font-bold text-label-md"
              >
                <span className="material-symbols-outlined text-[18px]">add</span>
                Add Card
              </button>
            </div>
          </div>

          <div className="bg-surface border border-white/5 rounded-2xl shadow-xl overflow-hidden">
            {isLoading ? (
              <div className="flex flex-col items-center justify-center py-24 gap-4">
                <span className="material-symbols-outlined text-[40px] text-primary/30 animate-spin">sync</span>
                <p className="text-on-surface-variant/40 text-body-md">Loading wishlist…</p>
              </div>
            ) : entries.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 gap-4">
                <span className="material-symbols-outlined text-[56px] text-on-surface-variant/15">bookmark</span>
                <p className="font-headline-md text-lg text-on-surface-variant/40">Your wishlist is empty</p>
                <button onClick={() => setPanelOpen(true)} className="mt-2 px-5 py-2 rounded-lg bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-all font-bold text-label-md">
                  Add your first card
                </button>
              </div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/5 text-left">
                    {['Card Name', 'Qty', 'Priority', 'Price (USD)', 'Note', ''].map(h => (
                      <th key={h} className="px-5 py-3.5 text-[10px] uppercase tracking-widest font-bold text-on-surface-variant/50">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {entries.map(entry => {
                    const card = cards[entry.oracle_id];
                    const name = card?.name || entry.oracle_id || 'Unknown Card';
                    const usdPrice = card?.full_data?.prices?.usd;
                    const isOwned = collectionIds.has(entry.oracle_id);
                    const isEditingNote = editingNoteId === entry.id;

                    return (
                      <tr
                        key={entry.id}
                        draggable
                        onDragStart={() => handleDragStart(entry.id)}
                        onDragOver={e => handleDragOver(e, entry.id)}
                        onDrop={() => handleDrop(entry.id)}
                        onDragEnd={() => setDragOverId(null)}
                        className={`border-b border-white/5 transition-colors group cursor-grab active:cursor-grabbing ${dragOverId === entry.id ? 'bg-primary/5 border-primary/20' : 'hover:bg-white/[0.02]'}`}
                      >
                        {/* Card name + owned indicator */}
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-2">
                            <span className="material-symbols-outlined text-[14px] text-on-surface-variant/20 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 cursor-grab">drag_indicator</span>
                            <span className="text-body-md text-on-surface font-medium">{name}</span>
                            {isOwned && (
                              <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-green-500/10 border border-green-500/20 text-[9px] font-bold text-green-400/90 flex-shrink-0">
                                <span className="material-symbols-outlined text-[10px]">inventory_2</span>
                                Owned
                              </span>
                            )}
                          </div>
                        </td>
                        {/* Qty */}
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-1">
                            <button onClick={() => { if ((entry.quantity || 1) > 1) handleUpdate(entry.id, (entry.quantity || 1) - 1, entry.priority ?? 0, entry.note); }}
                              className="w-5 h-5 rounded text-on-surface-variant/40 hover:text-on-surface hover:bg-white/10 flex items-center justify-center transition-all text-sm leading-none">−</button>
                            <span className="text-body-md text-on-surface-variant tabular-nums w-5 text-center">{entry.quantity || 1}</span>
                            <button onClick={() => handleUpdate(entry.id, (entry.quantity || 1) + 1, entry.priority ?? 0, entry.note)}
                              className="w-5 h-5 rounded text-on-surface-variant/40 hover:text-on-surface hover:bg-white/10 flex items-center justify-center transition-all text-sm leading-none">+</button>
                          </div>
                        </td>
                        {/* Priority */}
                        <td className="px-5 py-3.5">
                          <select value={entry.priority ?? 0}
                            onChange={e => handleUpdate(entry.id, entry.quantity || 1, parseInt(e.target.value), entry.note)}
                            className={`bg-surface-container/50 border border-white/10 rounded-md px-2 py-1 text-[11px] font-bold focus:outline-none focus:border-primary/50 transition-all ${PRIORITY_COLORS[entry.priority ?? 0]}`}>
                            {[0, 1, 2, 3].map(p => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
                          </select>
                        </td>
                        {/* Price */}
                        <td className="px-5 py-3.5">
                          {usdPrice ? (
                            <div className="tabular-nums">
                              <span className="text-body-md text-on-surface-variant">${parseFloat(usdPrice).toFixed(2)}</span>
                              {(entry.quantity || 1) > 1 && (
                                <span className="text-[10px] text-on-surface-variant/40 ml-1.5">
                                  × {entry.quantity} = ${(parseFloat(usdPrice) * (entry.quantity || 1)).toFixed(2)}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-on-surface-variant/30 text-[12px]">—</span>
                          )}
                        </td>
                        {/* Note */}
                        <td className="px-5 py-3.5 max-w-[180px]">
                          {isEditingNote ? (
                            <input autoFocus value={noteVal}
                              onChange={e => setNoteVal(e.target.value)}
                              onBlur={() => commitNote(entry)}
                              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commitNote(entry); } if (e.key === 'Escape') setEditingNoteId(null); }}
                              placeholder="Add a note…"
                              className="w-full bg-surface-container/50 border border-primary/40 rounded-md px-2 py-1 text-[11px] text-on-surface focus:outline-none" />
                          ) : (
                            <button onClick={() => startEditNote(entry)} className="flex items-center gap-1.5 text-left w-full group/note" title={entry.note || 'Click to add a note'}>
                              {entry.note ? (
                                <span className="text-[11px] text-on-surface-variant/60 truncate group-hover/note:text-on-surface-variant transition-colors">{entry.note}</span>
                              ) : (
                                <span className="text-[11px] text-on-surface-variant/20 opacity-0 group-hover:opacity-100 transition-opacity italic">Add note…</span>
                              )}
                            </button>
                          )}
                        </td>
                        {/* Actions */}
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                            <div className="relative">
                              <button
                                onClick={() => setAddToDeckId(addToDeckId === entry.id ? null : entry.id)}
                                className="w-7 h-7 rounded-md flex items-center justify-center text-on-surface-variant/50 hover:text-primary hover:bg-primary/10 transition-all"
                                title="Add to deck"
                              >
                                <span className="material-symbols-outlined text-[16px]">add_circle</span>
                              </button>
                              {addToDeckId === entry.id && (
                                <AddToDeckPopover
                                  oracleId={entry.oracle_id}
                                  decks={decks}
                                  onClose={() => setAddToDeckId(null)}
                                />
                              )}
                            </div>
                            <button onClick={() => handleRemove(entry.id)}
                              className="w-7 h-7 rounded-md flex items-center justify-center text-on-surface-variant/50 hover:text-red-400 hover:bg-red-400/10 transition-all">
                              <span className="material-symbols-outlined text-[16px]">delete_outline</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </main>

      <CardSearchPanel isOpen={panelOpen} onClose={() => setPanelOpen(false)} title="Add to Wishlist" onSelectCard={handleAdd} />
    </>
  );
}
