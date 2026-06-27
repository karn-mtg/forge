import { useState, useEffect, useMemo, useCallback } from 'react';
import { CardSearchPanel } from '../components/CardSearchPanel';
import { RecipientsModal } from '../components/RecipientsModal';
import { useSearchStore } from '../store/useSearchStore';
import { useConfirmStore } from '../store/useConfirmStore';
import { useToastStore } from '../store/useToastStore';
import { useLibraryStore } from '../store/useLibraryStore';
import type { CollectionEntry, Card } from '../types/electron';
import { PageHeader } from '../components/PageHeader';

const CONDITION_STYLES: Record<string, string> = {
  NM: 'bg-green-500/10 text-green-400 border-green-500/20',
  LP: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  MP: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  HP: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  DMG: 'bg-red-500/10 text-red-400 border-red-500/20',
};

const CONDITIONS = ['NM', 'LP', 'MP', 'HP', 'DMG'];
// Show stats for all conditions in priority order
const CONDITIONS_ORDER = ['NM', 'LP', 'MP', 'HP', 'DMG'];

type SortKey = 'name' | 'quantity' | 'condition' | 'price' | 'foil';
type SortDir = 'asc' | 'desc';

const CONDITION_RANK: Record<string, number> = { NM: 0, LP: 1, MP: 2, HP: 3, DMG: 4 };

interface AddFormState {
  card: Card | null;
  qty: number;
  condition: string;
  foil: boolean;
  price: string;
}

interface EditState {
  qty: number;
  condition: string;
  foil: boolean;
  price: string;
  recipientId: number | null;
}

// Defined at module scope so React sees a stable component type across renders
function SortHeader({
  col, label, sortKey, sortDir, setSortKey, setSortDir,
}: {
  col: SortKey; label: string;
  sortKey: SortKey; sortDir: SortDir;
  setSortKey: (k: SortKey) => void;
  setSortDir: (fn: (d: SortDir) => SortDir) => void;
}) {
  return (
    <th
      className="px-5 py-3.5 text-[10px] uppercase tracking-widest font-bold text-on-surface-variant/50 cursor-pointer hover:text-on-surface-variant transition-colors select-none"
      onClick={() => {
        if (sortKey === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        else { setSortKey(col); setSortDir(() => 'asc'); }
      }}
    >
      <span className="flex items-center gap-1">
        {label}
        {sortKey === col && (
          <span className="material-symbols-outlined text-[12px] text-primary">
            {sortDir === 'asc' ? 'arrow_upward' : 'arrow_downward'}
          </span>
        )}
      </span>
    </th>
  );
}

export function Collection() {
  const { recipients } = useLibraryStore();
  const [entries, setEntries] = useState<CollectionEntry[]>([]);
  const [cardNames, setCardNames] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const { value: searchFilter, setPlaceholder, reset } = useSearchStore();
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [panelOpen, setPanelOpen] = useState(false);
  const [recipientsOpen, setRecipientsOpen] = useState(false);
  const [addForm, setAddForm] = useState<AddFormState | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [bulkImportOpen, setBulkImportOpen] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkImporting, setBulkImporting] = useState(false);
  const [bulkResult, setBulkResult] = useState<{ added: number; skipped: string[] } | null>(null);

  useEffect(() => {
    setPlaceholder('Filter collection…');
    return () => reset();
  }, [setPlaceholder, reset]);

  const loadCollection = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await window.libraryAPI.getCollection();
      setEntries(data || []);
      const oracleIds = [...new Set((data || []).map(e => e.oracle_id).filter(Boolean))];
      if (oracleIds.length > 0) {
        try {
          const cards = await window.cardsAPI.getCardsBatch({ oracleIds });
          const names: Record<string, string> = {};
          for (const c of cards || []) names[c.oracle_id] = c.name;
          setCardNames(names);
        } catch { /* card names are a non-critical enhancement */ }
      }
    } catch (err) {
      console.error('Failed to load collection:', err);
      useToastStore.getState().push({ type: 'error', title: 'Failed to load collection', message: String(err) });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { loadCollection(); }, [loadCollection]);

  // Stats: total owned, portfolio value, condition breakdown
  const stats = useMemo(() => {
    let totalQty = 0, portfolioValue = 0;
    const conds: Record<string, number> = {};
    for (const e of entries) {
      const qty = e.quantity || 1;
      totalQty += qty;
      if (e.acquired_price != null) portfolioValue += qty * parseFloat(String(e.acquired_price));
      const c = e.condition || 'NM';
      conds[c] = (conds[c] || 0) + qty;
    }
    return { totalQty, portfolioValue, conds };
  }, [entries]);

  // Sort + filter
  const filtered = useMemo(() => {
    let list = [...entries];
    if (searchFilter) {
      const q = searchFilter.toLowerCase();
      list = list.filter(e => (cardNames[e.oracle_id] || e.oracle_id || '').toLowerCase().includes(q));
    }
    list.sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'name') {
        cmp = (cardNames[a.oracle_id] || a.oracle_id || '').localeCompare(cardNames[b.oracle_id] || b.oracle_id || '');
      } else if (sortKey === 'quantity') {
        cmp = (a.quantity || 1) - (b.quantity || 1);
      } else if (sortKey === 'condition') {
        cmp = (CONDITION_RANK[a.condition] ?? 99) - (CONDITION_RANK[b.condition] ?? 99);
      } else if (sortKey === 'price') {
        cmp = (parseFloat(String(a.acquired_price ?? 0))) - (parseFloat(String(b.acquired_price ?? 0)));
      } else if (sortKey === 'foil') {
        cmp = (b.foil ? 1 : 0) - (a.foil ? 1 : 0);
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [entries, cardNames, searchFilter, sortKey, sortDir]);

  const handleRemove = (id: number) => {
    useConfirmStore.getState().show({
      title: 'Remove from Collection',
      message: 'Remove this card from your collection?',
      danger: true,
      confirmLabel: 'Remove',
      onConfirm: () => doRemove(id),
    });
  };

  const doRemove = async (id: number) => {
    await window.libraryAPI.removeFromCollection({ id });
    setEntries(prev => prev.filter(e => e.id !== id));
  };

  const startEdit = (entry: CollectionEntry) => {
    setEditingId(entry.id);
    setEditState({
      qty: entry.quantity || 1,
      condition: entry.condition || 'NM',
      foil: !!entry.foil,
      price: entry.acquired_price != null ? String(entry.acquired_price) : '',
      recipientId: entry.recipient_id ?? null,
    });
  };

  const cancelEdit = () => { setEditingId(null); setEditState(null); };

  const saveEdit = async (id: number) => {
    if (!editState) return;
    const acquiredPrice = editState.price ? parseFloat(editState.price) : null;
    await window.libraryAPI.updateCollectionEntry({
      id, quantity: editState.qty, condition: editState.condition, foil: editState.foil, acquiredPrice,
      recipientId: editState.recipientId,
    });
    setEntries(prev => prev.map(e => e.id === id ? {
      ...e, quantity: editState.qty, condition: editState.condition, foil: editState.foil,
      acquired_price: acquiredPrice, recipient_id: editState.recipientId,
    } : e));
    cancelEdit();
  };

  const handleSelectCard = (card: Card) => {
    setAddForm({ card, qty: 1, condition: 'NM', foil: false, price: '' });
    setPanelOpen(false);
  };

  const handleSubmitAdd = async () => {
    if (!addForm?.card) return;
    setIsSubmitting(true);
    try {
      // Fetch the real DB id from the IPC so we can safely edit/delete without reload
      const result = await window.libraryAPI.addToCollection({
        oracleId: addForm.card.oracle_id,
        scryfallId: addForm.card.scryfall_id || null,
        quantity: addForm.qty,
        foil: addForm.foil,
        condition: addForm.condition,
        acquiredPrice: addForm.price ? parseFloat(addForm.price) : null,
      });
      const newEntry: CollectionEntry = {
        id: result.id,                                                   // real DB id
        oracle_id: addForm.card.oracle_id,
        quantity: addForm.qty,
        foil: addForm.foil,
        condition: addForm.condition,
        acquired_price: addForm.price ? parseFloat(addForm.price) : null,
      };
      setEntries(prev => [...prev, newEntry]);
      setCardNames(prev => ({ ...prev, [addForm.card!.oracle_id]: addForm.card!.name }));
      setAddForm(null);
    } catch (err) {
      console.error('Failed to add to collection:', err);
      useToastStore.getState().push({ type: 'error', title: 'Failed to add card', message: String(err) });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Bulk import from pasted card list (e.g. "4 Lightning Bolt\n1 Sol Ring")
  const handleBulkImport = async () => {
    const skipped: string[] = [];
    let added = 0;
    setBulkImporting(true);

    // Parse all lines first
    const parsed: { name: string; qty: number }[] = [];
    for (const line of bulkText.split('\n').map(l => l.trim()).filter(Boolean)) {
      const m = line.match(/^(\d+)[x×]?\s+(.+)$/i) || line.match(/^()(.+)$/);
      if (!m) { skipped.push(line); continue; }
      parsed.push({ name: m[2].trim(), qty: parseInt(m[1]) || 1 });
    }

    // Resolve all card names in a single DB round-trip
    const names = parsed.map(p => p.name);
    const resolved = await window.cardsAPI.getCardsByNamesLight({ names });
    const nameToOracleId = new Map(resolved.map(r => [r.name.toLowerCase(), r.oracle_id]));

    // Insert all matched cards in parallel, skipping unresolved names
    const newCardNames: Record<string, string> = {};
    await Promise.allSettled(parsed.map(async ({ name, qty }) => {
      const oracleId = nameToOracleId.get(name.toLowerCase());
      if (!oracleId) { skipped.push(name); return; }
      try {
        await window.libraryAPI.addToCollection({ oracleId, quantity: qty, condition: 'NM', foil: false, acquiredPrice: null });
        newCardNames[oracleId] = resolved.find(r => r.oracle_id === oracleId)?.name ?? name;
        added++;
      } catch { skipped.push(name); }
    }));

    if (Object.keys(newCardNames).length > 0) {
      setCardNames(prev => ({ ...prev, ...newCardNames }));
    }
    setBulkResult({ added, skipped });
    setBulkImporting(false);
    if (added > 0) await loadCollection();
  };

  // CSV export
  const handleExportCSV = () => {
    const rows = [['Name', 'Condition', 'Qty', 'Foil', 'Acquired Price (USD)']];
    for (const e of entries) {
      rows.push([
        cardNames[e.oracle_id] || e.oracle_id || 'Unknown',
        e.condition || '',
        String(e.quantity || 1),
        e.foil ? 'Yes' : 'No',
        e.acquired_price != null ? parseFloat(String(e.acquired_price)).toFixed(2) : '',
      ]);
    }
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'collection.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  // Condition buckets that actually have cards — in priority order
  const condStats = CONDITIONS_ORDER
    .filter(c => stats.conds[c] != null)
    .map(c => ({ cond: c, qty: stats.conds[c] }));

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        icon="inventory_2"
        title="Collection"
        actions={
          <>
            {entries.length > 0 && (
              <button
                onClick={handleExportCSV}
                className="flex items-center gap-2 px-4 py-2 bg-surface-container border border-white/5 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-white/5 transition-all font-bold text-label-md"
                title="Export collection as CSV"
              >
                <span className="material-symbols-outlined text-[18px]">download</span>
                CSV
              </button>
            )}
            <button
              onClick={() => setRecipientsOpen(true)}
              className="flex items-center gap-2 px-4 py-2 bg-surface-container border border-white/5 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-white/5 transition-all font-bold text-label-md"
              title="Manage physical recipients (binders, boxes…)"
            >
              <span className="material-symbols-outlined text-[18px]" style={{ fontVariationSettings: "'FILL' 1" }}>location_on</span>
              Recipients
            </button>
            <button
              onClick={() => { setBulkImportOpen(true); setBulkText(''); setBulkResult(null); }}
              className="flex items-center gap-2 px-4 py-2 bg-surface-container border border-white/5 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-white/5 transition-all font-bold text-label-md"
              title="Bulk import cards from a list"
            >
              <span className="material-symbols-outlined text-[18px]">upload</span>
              Import
            </button>
            <button
              onClick={() => setPanelOpen(true)}
              className="flex items-center gap-2 px-4 py-2 bg-primary/10 text-primary border border-primary/20 rounded-lg hover:bg-primary/20 transition-all font-bold text-label-md"
            >
              <span className="material-symbols-outlined text-[18px]">add</span>
              Add Card
            </button>
          </>
        }
      />
      <main className="flex-1 overflow-auto p-margin-desktop">
        <div className="max-w-[1400px] mx-auto space-y-6">

          {/* Stats summary — shows all non-empty condition buckets */}
          {!isLoading && entries.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="bg-surface border border-white/5 rounded-2xl p-4 shadow-xl">
                <p className="text-[10px] uppercase tracking-widest font-bold text-on-surface-variant/40 mb-1">Total Cards</p>
                <p className="text-2xl font-bold text-on-surface tabular-nums">{stats.totalQty.toLocaleString()}</p>
              </div>
              <div className="bg-surface border border-white/5 rounded-2xl p-4 shadow-xl">
                <p className="text-[10px] uppercase tracking-widest font-bold text-on-surface-variant/40 mb-1">Portfolio Value</p>
                <p className="text-2xl font-bold text-on-surface tabular-nums">
                  {stats.portfolioValue > 0 ? `$${stats.portfolioValue.toFixed(2)}` : '—'}
                </p>
              </div>
              {condStats.map(({ cond, qty }) => (
                <div key={cond} className="bg-surface border border-white/5 rounded-2xl p-4 shadow-xl">
                  <p className="text-[10px] uppercase tracking-widest font-bold text-on-surface-variant/40 mb-1">
                    <span className={`px-1.5 py-0.5 rounded border text-[9px] ${CONDITION_STYLES[cond] || ''}`}>{cond}</span>
                  </p>
                  <p className="text-2xl font-bold text-on-surface tabular-nums">{qty}</p>
                </div>
              ))}
            </div>
          )}

          {/* Table */}
          <div className="bg-surface border border-white/5 rounded-2xl shadow-xl overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/5 text-left">
                  <SortHeader col="name" label="Card Name" sortKey={sortKey} sortDir={sortDir} setSortKey={setSortKey} setSortDir={setSortDir} />
                  <SortHeader col="condition" label="Condition" sortKey={sortKey} sortDir={sortDir} setSortKey={setSortKey} setSortDir={setSortDir} />
                  <SortHeader col="quantity" label="Qty" sortKey={sortKey} sortDir={sortDir} setSortKey={setSortKey} setSortDir={setSortDir} />
                  <SortHeader col="foil" label="Foil" sortKey={sortKey} sortDir={sortDir} setSortKey={setSortKey} setSortDir={setSortDir} />
                  <SortHeader col="price" label="Price" sortKey={sortKey} sortDir={sortDir} setSortKey={setSortKey} setSortDir={setSortDir} />
                  <th className="px-5 py-3.5 text-[10px] uppercase tracking-widest font-bold text-on-surface-variant/50 hidden lg:table-cell">Location</th>
                  <th className="px-5 py-3.5 text-[10px] uppercase tracking-widest font-bold text-on-surface-variant/50" />
                </tr>
              </thead>
              <tbody>
                {!isLoading && filtered.map(entry => {
                  const name = cardNames[entry.oracle_id] || entry.oracle_id || 'Unknown Card';
                  const isEditing = editingId === entry.id;

                  if (isEditing && editState) {
                    return (
                      <tr key={entry.id} className="border-b border-white/5 bg-white/[0.02]">
                        <td className="px-5 py-3 text-body-md text-on-surface font-medium">{name}</td>
                        <td className="px-5 py-3">
                          <select value={editState.condition}
                            onChange={e => setEditState(s => s && { ...s, condition: e.target.value })}
                            className="bg-surface-container/50 border border-white/10 rounded-md px-2 py-1 text-[11px] focus:outline-none focus:border-primary/50">
                            {CONDITIONS.map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                        </td>
                        <td className="px-5 py-3">
                          <input type="number" min="1" value={editState.qty}
                            onChange={e => setEditState(s => s && { ...s, qty: parseInt(e.target.value) || 1 })}
                            className="w-16 bg-surface-container/50 border border-white/10 rounded-md px-2 py-1 text-[11px] focus:outline-none focus:border-primary/50 tabular-nums" />
                        </td>
                        <td className="px-5 py-3">
                          <input type="checkbox" checked={editState.foil}
                            onChange={e => setEditState(s => s && { ...s, foil: e.target.checked })}
                            className="w-4 h-4 rounded border border-white/20 bg-surface-container/50 accent-primary" />
                        </td>
                        <td className="px-5 py-3">
                          <input type="number" min="0" step="0.01" placeholder="0.00" value={editState.price}
                            onChange={e => setEditState(s => s && { ...s, price: e.target.value })}
                            className="w-20 bg-surface-container/50 border border-white/10 rounded-md px-2 py-1 text-[11px] focus:outline-none focus:border-primary/50 tabular-nums" />
                        </td>
                        <td className="px-5 py-3">
                          <select
                            value={editState.recipientId ?? ''}
                            onChange={e => setEditState(s => s && { ...s, recipientId: e.target.value ? Number(e.target.value) : null })}
                            className="bg-surface-container/50 border border-white/10 rounded-md px-2 py-1 text-[11px] focus:outline-none focus:border-primary/50 max-w-[110px]"
                          >
                            <option value="" className="bg-surface-container">No recipient</option>
                            {recipients.map(r => (
                              <option key={r.id} value={r.id} className="bg-surface-container">{r.name}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-1">
                            <button onClick={() => saveEdit(entry.id)} className="w-7 h-7 rounded-md flex items-center justify-center text-green-400 hover:bg-green-500/10 transition-all" title="Save">
                              <span className="material-symbols-outlined text-[16px]">check</span>
                            </button>
                            <button onClick={cancelEdit} className="w-7 h-7 rounded-md flex items-center justify-center text-on-surface-variant/50 hover:bg-white/5 transition-all" title="Cancel">
                              <span className="material-symbols-outlined text-[16px]">close</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  }

                  const price = entry.acquired_price != null ? `$${parseFloat(String(entry.acquired_price)).toFixed(2)}` : '—';
                  const condCls = CONDITION_STYLES[entry.condition] || 'bg-white/5 text-on-surface-variant border-white/10';

                  return (
                    <tr key={entry.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors group">
                      <td className="px-5 py-3.5 text-body-md text-on-surface font-medium">
                        <span data-oracle-id={entry.oracle_id} data-card-name={name} className="cursor-default">{name}</span>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className={`px-2 py-0.5 rounded-md border text-[10px] font-bold ${condCls}`}>{entry.condition || '—'}</span>
                      </td>
                      <td className="px-5 py-3.5 text-body-md text-on-surface-variant tabular-nums">{entry.quantity || 1}</td>
                      <td className="px-5 py-3.5">
                        {entry.foil && <span className="px-1.5 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/20 text-[10px] font-bold">FOIL</span>}
                      </td>
                      <td className="px-5 py-3.5 text-body-md text-on-surface-variant tabular-nums">{price}</td>
                      <td className="px-5 py-3.5 hidden lg:table-cell">
                        {entry.recipient_id ? (
                          <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                            <span className="material-symbols-outlined text-[11px]" style={{ fontVariationSettings: "'FILL' 1" }}>location_on</span>
                            {recipients.find(r => r.id === entry.recipient_id)?.name ?? '—'}
                          </span>
                        ) : <span className="text-[10px] text-on-surface-variant/20">—</span>}
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                          <button onClick={() => startEdit(entry)} className="w-7 h-7 rounded-md flex items-center justify-center text-on-surface-variant/50 hover:text-primary hover:bg-primary/10 transition-all" title="Edit">
                            <span className="material-symbols-outlined text-[16px]">edit</span>
                          </button>
                          <button onClick={() => handleRemove(entry.id)} className="w-7 h-7 rounded-md flex items-center justify-center text-on-surface-variant/50 hover:text-red-400 hover:bg-red-400/10 transition-all" title="Delete">
                            <span className="material-symbols-outlined text-[16px]">delete_outline</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {isLoading && (
              <div className="flex flex-col items-center justify-center py-24 gap-4">
                <span className="material-symbols-outlined text-[40px] text-primary/30 animate-spin">sync</span>
                <p className="text-on-surface-variant/40 text-body-md">Loading collection…</p>
              </div>
            )}
            {!isLoading && filtered.length === 0 && (
              <div className="flex flex-col items-center justify-center py-24 gap-4">
                <span className="material-symbols-outlined text-[56px] text-on-surface-variant/15">inventory_2</span>
                <p className="font-headline-md text-lg text-on-surface-variant/40">No cards in your collection yet</p>
                <button onClick={() => setPanelOpen(true)} className="mt-2 px-5 py-2 rounded-lg bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-all font-bold text-label-md">
                  Add your first card
                </button>
              </div>
            )}
          </div>
        </div>
      </main>

      <CardSearchPanel isOpen={panelOpen} onClose={() => setPanelOpen(false)} title="Add to Collection" onSelectCard={handleSelectCard} />
      <RecipientsModal isOpen={recipientsOpen} onClose={() => setRecipientsOpen(false)} />

      {/* Bulk import modal */}
      {bulkImportOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.7)' }} onClick={e => { if (e.target === e.currentTarget) setBulkImportOpen(false); }}>
          <div className="w-[520px] rounded-2xl flex flex-col gap-4 p-6" style={{ background: 'rgba(20,22,27,0.99)', border: '1px solid rgba(255,255,255,0.07)', boxShadow: '0 24px 80px rgba(0,0,0,0.7)' }}>
            <div className="flex items-center justify-between">
              <h3 className="text-[15px] font-bold text-on-surface">Bulk Import Cards</h3>
              <button onClick={() => setBulkImportOpen(false)} className="w-7 h-7 rounded-md flex items-center justify-center text-on-surface-variant hover:bg-white/10 transition-all">
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>
            <p className="text-[11px] text-on-surface-variant/50 -mt-2">
              Paste a card list. Each line: <code className="text-primary/60">4 Lightning Bolt</code> or just a name.
            </p>
            <textarea
              className="w-full h-48 bg-surface-container/60 border border-white/8 rounded-xl p-3 text-[12px] text-on-surface font-mono focus:outline-none focus:border-primary/50 resize-none placeholder:text-on-surface-variant/25"
              placeholder={"4 Sol Ring\n1 Command Tower\nArcane Signet\n..."}
              value={bulkText}
              onChange={e => setBulkText(e.target.value)}
            />
            {bulkResult && (
              <div className="rounded-xl p-3 text-[11px]" style={{ background: bulkResult.skipped.length > 0 ? 'rgba(251,191,36,0.08)' : 'rgba(74,222,128,0.08)', border: `1px solid ${bulkResult.skipped.length > 0 ? 'rgba(251,191,36,0.2)' : 'rgba(74,222,128,0.2)'}` }}>
                <p className="font-bold" style={{ color: bulkResult.skipped.length > 0 ? '#fbbf24' : '#4ade80' }}>
                  {bulkResult.added} card{bulkResult.added !== 1 ? 's' : ''} imported
                  {bulkResult.skipped.length > 0 ? ` · ${bulkResult.skipped.length} not found` : ''}
                </p>
                {bulkResult.skipped.length > 0 && (
                  <p className="text-on-surface-variant/45 mt-1">Not found: {bulkResult.skipped.slice(0, 5).join(', ')}{bulkResult.skipped.length > 5 ? `… +${bulkResult.skipped.length - 5} more` : ''}</p>
                )}
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <button onClick={() => setBulkImportOpen(false)} className="px-4 py-2 rounded-lg text-[12px] font-bold text-on-surface-variant hover:bg-white/5 transition-all">Cancel</button>
              <button
                onClick={handleBulkImport}
                disabled={bulkImporting || !bulkText.trim()}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] font-bold transition-all disabled:opacity-40"
                style={{ background: 'rgba(242,202,131,0.12)', border: '1px solid rgba(242,202,131,0.25)', color: '#f2ca83' }}
              >
                {bulkImporting ? (
                  <><span className="material-symbols-outlined text-[14px] animate-spin">sync</span>Importing…</>
                ) : (
                  <><span className="material-symbols-outlined text-[14px]">upload</span>Import</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add form panel */}
      {addForm && (
        <div className="fixed top-0 right-0 h-full w-80 z-[101] flex flex-col"
          style={{ background: 'rgba(20,22,27,0.97)', backdropFilter: 'blur(40px)', borderLeft: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 flex-shrink-0">
            <button onClick={() => { setAddForm(null); setPanelOpen(true); }} className="w-7 h-7 rounded-md flex items-center justify-center text-on-surface-variant hover:bg-white/10 transition-all">
              <span className="material-symbols-outlined text-[18px]">arrow_back</span>
            </button>
            <h3 className="font-headline-md text-sm font-bold text-on-surface truncate flex-1 mx-3">{addForm.card?.name}</h3>
            <button onClick={() => setAddForm(null)} className="w-7 h-7 rounded-md flex items-center justify-center text-on-surface-variant hover:bg-white/10 transition-all">
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
            <div>
              <label className="text-label-sm text-on-surface-variant/60 uppercase tracking-wider mb-1.5 block">Quantity</label>
              <input type="number" min="1" value={addForm.qty}
                onChange={e => setAddForm(f => f && { ...f, qty: parseInt(e.target.value) || 1 })}
                className="w-full bg-surface-container/50 border border-white/10 rounded-lg py-2.5 px-4 text-body-md focus:outline-none focus:border-primary/50 transition-all" />
            </div>
            <div>
              <label className="text-label-sm text-on-surface-variant/60 uppercase tracking-wider mb-1.5 block">Condition</label>
              <select value={addForm.condition} onChange={e => setAddForm(f => f && { ...f, condition: e.target.value })}
                className="w-full bg-surface-container/50 border border-white/10 rounded-lg py-2.5 px-4 text-body-md focus:outline-none focus:border-primary/50 transition-all">
                <option value="NM">NM — Near Mint</option>
                <option value="LP">LP — Lightly Played</option>
                <option value="MP">MP — Moderately Played</option>
                <option value="HP">HP — Heavily Played</option>
                <option value="DMG">DMG — Damaged</option>
              </select>
            </div>
            <div className="flex items-center gap-3">
              <input type="checkbox" id="foil-check" checked={addForm.foil}
                onChange={e => setAddForm(f => f && { ...f, foil: e.target.checked })}
                className="w-4 h-4 rounded border border-white/20 bg-surface-container/50 accent-primary" />
              <label htmlFor="foil-check" className="text-body-md text-on-surface cursor-pointer">Foil</label>
            </div>
            <div>
              <label className="text-label-sm text-on-surface-variant/60 uppercase tracking-wider mb-1.5 block">Acquired Price (USD)</label>
              <input type="number" min="0" step="0.01" placeholder="0.00" value={addForm.price}
                onChange={e => setAddForm(f => f && { ...f, price: e.target.value })}
                className="w-full bg-surface-container/50 border border-white/10 rounded-lg py-2.5 px-4 text-body-md focus:outline-none focus:border-primary/50 transition-all placeholder:text-on-surface-variant/30" />
            </div>
          </div>
          <div className="p-4 border-t border-white/5">
            <button onClick={handleSubmitAdd} disabled={isSubmitting}
              className="w-full py-2.5 rounded-lg bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30 transition-all font-bold disabled:opacity-50">
              {isSubmitting ? 'Adding…' : 'Add to Collection'}
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
