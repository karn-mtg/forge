import { useState, useEffect } from 'react';
import { DeckCard, NewDeckCard } from '../components/DeckCard';
import { NewDeckModal } from '../components/NewDeckModal';
import { useLibraryStore } from '../store/useLibraryStore';
import { useSearchStore } from '../store/useSearchStore';
import { useFilteredDecks } from '../hooks/useFilteredDecks';
import type { DeckSortKey } from '../hooks/useFilteredDecks';

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

export function AllDecks() {
  const { decks } = useLibraryStore();
  const { value: search, setPlaceholder, reset } = useSearchStore();
  const [formatFilter, setFormatFilter] = useState('');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [sortBy, setSortBy] = useState<DeckSortKey>('updated');
  const [newDeckOpen, setNewDeckOpen] = useState(false);

  useEffect(() => {
    setPlaceholder('Search decks…');
    return () => reset();
  }, [setPlaceholder, reset]);

  const filtered = useFilteredDecks(decks, { search, formatFilter, sortBy, favoritesOnly });

  const hasActiveFilter = !!(search || formatFilter || favoritesOnly);

  return (
    <>
      <main className="p-margin-desktop min-h-screen">
        <div className="max-w-[1400px] mx-auto space-y-8">

          {/* Page header */}
          <div className="flex items-end justify-between">
            <div>
              <h2 className="font-headline-lg text-2xl text-on-surface">My Decks</h2>
              <p className="text-on-surface-variant text-body-md mt-1">
                {filtered.length} deck{filtered.length !== 1 ? 's' : ''}
                {hasActiveFilter ? ' matching filters' : ''}
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
            {/* Favorites chip */}
            <button
              onClick={() => setFavoritesOnly(v => !v)}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-[11px] font-bold transition-all ${
                favoritesOnly
                  ? 'bg-primary/20 text-primary border border-primary/30'
                  : 'text-on-surface-variant/50 hover:bg-white/5 border border-transparent hover:border-white/10'
              }`}
            >
              <span
                className="material-symbols-outlined text-[13px]"
                style={{ fontVariationSettings: favoritesOnly ? "'FILL' 1" : "'FILL' 0" }}
              >
                star
              </span>
              Favorites
            </button>

            <div className="w-px h-4 bg-white/10" />

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
                onChange={e => setSortBy(e.target.value as DeckSortKey)}
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
          {filtered.length === 0 && !hasActiveFilter ? (
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
          ) : filtered.length === 0 && favoritesOnly && !search && !formatFilter ? (
            <div className="flex flex-col items-center justify-center py-24 gap-4">
              <span className="material-symbols-outlined text-[56px] text-on-surface-variant/15">star</span>
              <p className="font-headline-md text-lg text-on-surface-variant/40">No favorites yet</p>
              <p className="text-on-surface-variant/30 text-body-md text-center max-w-xs">
                Open a deck and mark it as favorite to see it here.
              </p>
              <button
                onClick={() => setFavoritesOnly(false)}
                className="text-primary/70 hover:text-primary text-[12px] underline-offset-2 hover:underline transition-all"
              >
                Show all decks
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 gap-3">
              <span className="material-symbols-outlined text-[48px] text-on-surface-variant/15">search_off</span>
              <p className="text-on-surface-variant/40">No decks match your filters</p>
              <button
                onClick={() => { reset(); setFormatFilter(''); setFavoritesOnly(false); }}
                className="text-primary/70 hover:text-primary text-[12px] underline-offset-2 hover:underline transition-all"
              >
                Clear filters
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-6">
              {!favoritesOnly && <NewDeckCard onOpen={() => setNewDeckOpen(true)} />}
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
