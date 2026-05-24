import { useState, useMemo } from 'react';
import { Header } from '../components/Header';
import { DeckCard, NewDeckCard } from '../components/DeckCard';
import { NewDeckModal } from '../components/NewDeckModal';
import { useLibraryStore } from '../store/useLibraryStore';

const FORMAT_OPTIONS = [
  { value: '', label: 'All Formats' },
  { value: 'commander', label: 'Commander' },
  { value: 'modern', label: 'Modern' },
  { value: 'standard', label: 'Standard' },
  { value: 'pioneer', label: 'Pioneer' },
  { value: 'legacy', label: 'Legacy' },
  { value: 'vintage', label: 'Vintage' },
  { value: 'pauper', label: 'Pauper' },
];

type SortKey = 'updated' | 'name' | 'cards' | 'created';

export function AllDecks() {
  const { decks } = useLibraryStore();
  const [search, setSearch] = useState('');
  const [formatFilter, setFormatFilter] = useState('');
  const [sortBy, setSortBy] = useState<SortKey>('updated');
  const [newDeckOpen, setNewDeckOpen] = useState(false);

  const filtered = useMemo(() => {
    let list = [...decks];
    if (search) list = list.filter(d => d.name.toLowerCase().includes(search.toLowerCase()));
    if (formatFilter) list = list.filter(d => d.format === formatFilter);
    if (sortBy === 'name') list.sort((a, b) => a.name.localeCompare(b.name));
    else if (sortBy === 'cards') list.sort((a, b) => (b.card_count ?? 0) - (a.card_count ?? 0));
    else if (sortBy === 'created') list.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
    else list.sort((a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime());
    return list;
  }, [decks, search, formatFilter, sortBy]);

  return (
    <>
      <Header searchPlaceholder="Search all decks…" searchValue={search} onSearch={setSearch} />

      <main className="p-margin-desktop min-h-screen">
        <div className="max-w-[1400px] mx-auto space-y-8">

          {/* Page header */}
          <div className="flex items-end justify-between">
            <div>
              <h2 className="font-headline-lg text-2xl text-on-surface">All Decks</h2>
              <p className="text-on-surface-variant text-body-md mt-1">
                {filtered.length} deck{filtered.length !== 1 ? 's' : ''}
                {(search || formatFilter) ? ' matching filters' : ''}
              </p>
            </div>
            <button
              onClick={() => setNewDeckOpen(true)}
              className="flex items-center gap-2 px-4 py-2 bg-primary/10 text-primary border border-primary/20 rounded-lg hover:bg-primary/20 transition-all font-bold text-label-md"
            >
              <span className="material-symbols-outlined text-[18px]">add</span>
              New Deck
            </button>
          </div>

          {/* Filters */}
          <div className="flex items-center gap-3 flex-wrap">
            {/* Format chips */}
            <div className="flex items-center gap-1.5 flex-wrap">
              {FORMAT_OPTIONS.map(f => (
                <button
                  key={f.value}
                  onClick={() => setFormatFilter(f.value)}
                  className={`px-3 py-1 rounded-lg text-[11px] font-bold transition-all ${
                    formatFilter === f.value
                      ? 'bg-primary/20 text-primary border border-primary/30'
                      : 'text-on-surface-variant/50 hover:bg-white/5 border border-transparent hover:border-white/10'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {/* Sort */}
            <div className="ml-auto flex items-center gap-2">
              <span className="text-[10px] text-on-surface-variant/40 uppercase tracking-widest font-bold">Sort:</span>
              <select
                value={sortBy}
                onChange={e => setSortBy(e.target.value as SortKey)}
                className="bg-surface-container/50 border border-white/10 rounded-lg px-3 py-1.5 text-[11px] text-on-surface-variant focus:outline-none focus:border-primary/50 transition-all"
              >
                <option value="updated">Last Updated</option>
                <option value="name">Name (A–Z)</option>
                <option value="cards">Card Count</option>
                <option value="created">Date Created</option>
              </select>
            </div>
          </div>

          {/* Grid */}
          {filtered.length === 0 && !search && !formatFilter ? (
            <div className="flex flex-col items-center justify-center py-32 gap-4">
              <span className="material-symbols-outlined text-[64px] text-on-surface-variant/15">style</span>
              <p className="font-headline-md text-lg text-on-surface-variant/40">No decks yet</p>
              <button
                onClick={() => setNewDeckOpen(true)}
                className="px-5 py-2 rounded-lg bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-all font-bold text-label-md"
              >
                Create your first deck
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 gap-3">
              <span className="material-symbols-outlined text-[48px] text-on-surface-variant/15">search_off</span>
              <p className="text-on-surface-variant/40">No decks match your search</p>
              <button
                onClick={() => { setSearch(''); setFormatFilter(''); }}
                className="text-primary/70 hover:text-primary text-[12px] underline-offset-2 hover:underline transition-all"
              >
                Clear filters
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-6">
              <NewDeckCard onOpen={() => setNewDeckOpen(true)} />
              {filtered.map(deck => (
                <DeckCard key={deck.id} deck={deck} />
              ))}
            </div>
          )}
        </div>
      </main>

      <NewDeckModal isOpen={newDeckOpen} onClose={() => setNewDeckOpen(false)} />
    </>
  );
}
