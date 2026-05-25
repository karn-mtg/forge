import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLibraryStore } from '../store/useLibraryStore';
import { useSearchStore } from '../store/useSearchStore';
import { useFilteredDecks } from '../hooks/useFilteredDecks';
import type { DeckSortKey } from '../hooks/useFilteredDecks';
import { DeckCard, NewDeckCard } from '../components/DeckCard';
import { NewDeckModal } from '../components/NewDeckModal';
import { ActivityChart } from '../components/charts/ActivityChart';
import { ColorDonut } from '../components/charts/ColorDonut';
import { PowerGauge } from '../components/charts/PowerGauge';

export function Dashboard() {
  const { decks } = useLibraryStore();
  const navigate = useNavigate();
  const [newDeckOpen, setNewDeckOpen] = useState(false);
  const { value: search, setPlaceholder, reset } = useSearchStore();
  const [formatFilter, setFormatFilter] = useState('');
  const [sortBy, setSortBy] = useState<DeckSortKey>('updated');
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    setPlaceholder('Search decks…');
    return () => reset();
  }, [setPlaceholder, reset]);

  // Show at most 8 decks on the dashboard unless the user is actively filtering
  const displayed = useFilteredDecks(decks, { search, formatFilter, sortBy, limit: 8 });

  return (
    <>
      <main className="p-margin-desktop min-h-screen">
        <div className="max-w-[1400px] mx-auto space-y-12">

          {/* Overview metrics */}
          <section>
            <div className="flex items-center justify-between mb-6">
              <h2 className="font-headline-lg text-2xl text-on-surface">Overview</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-12 gap-gutter">
              <ActivityChart />

              <div className="md:col-span-6 lg:col-span-5 flex flex-col gap-gutter">
                <ColorDonut decks={decks} />
                <PowerGauge decks={decks} />
              </div>
            </div>
          </section>

          {/* Recent Decks */}
          <section>
            <div className="flex justify-between items-end mb-8">
              <div>
                <h2 className="font-headline-lg text-2xl text-on-surface">Recent Decks</h2>
                <p className="text-on-surface-variant text-body-md mt-1">Continue where you left off</p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowFilters(s => !s)}
                  className={`flex items-center gap-2 px-4 py-2 border rounded-lg transition-all ${showFilters ? 'bg-primary/10 text-primary border-primary/30' : 'bg-surface border-white/5 text-on-surface-variant hover:text-on-surface hover:bg-white/5'}`}
                >
                  <span className="material-symbols-outlined text-[18px]">filter_list</span>
                  <span className="font-label-md">Filter</span>
                </button>
                <button
                  onClick={() => { setShowFilters(true); setSortBy(s => s === 'updated' ? 'name' : s === 'name' ? 'cards' : 'updated'); }}
                  className="flex items-center gap-2 px-4 py-2 bg-surface border border-white/5 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-white/5 transition-all"
                >
                  <span className="material-symbols-outlined text-[18px]">view_list</span>
                  <span className="font-label-md">Sort</span>
                </button>
              </div>
            </div>

            {showFilters && (
              <div className="flex items-center gap-3 mb-6 flex-wrap">
                <span className="text-[10px] text-on-surface-variant/40 uppercase tracking-widest font-bold">Format:</span>
                {['', 'commander', 'modern', 'standard', 'pioneer', 'legacy', 'pauper'].map(f => (
                  <button key={f} onClick={() => setFormatFilter(f)}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-all capitalize ${formatFilter === f ? 'bg-primary/20 text-primary border border-primary/30' : 'text-on-surface-variant/50 hover:bg-white/5 border border-transparent'}`}
                  >{f || 'All'}</button>
                ))}
                <div className="ml-auto flex items-center gap-2">
                  <span className="text-[10px] text-on-surface-variant/40 uppercase tracking-widest font-bold">Sort:</span>
                  <select value={sortBy} onChange={e => setSortBy(e.target.value as DeckSortKey)}
                    className="bg-surface-container/50 border border-white/10 rounded-lg px-2 py-1 text-[11px] focus:outline-none">
                    <option value="updated">Last Updated</option>
                    <option value="name">Name</option>
                    <option value="cards">Card Count</option>
                  </select>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              <NewDeckCard onOpen={() => setNewDeckOpen(true)} />
              {displayed.map(deck => (
                <DeckCard key={deck.id} deck={deck} />
              ))}
            </div>

            {/* "View all" link when limit is active */}
            {!search && !formatFilter && decks.length > 8 && (
              <div className="flex justify-center mt-8">
                <button
                  onClick={() => navigate('/decks')}
                  className="flex items-center gap-2 px-5 py-2 rounded-xl border border-white/5 text-on-surface-variant hover:text-primary hover:border-primary/30 hover:bg-primary/5 transition-all text-label-md font-bold"
                >
                  <span className="material-symbols-outlined text-[16px]">grid_view</span>
                  View all {decks.length} decks
                  <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
                </button>
              </div>
            )}
          </section>

        </div>
      </main>

      <NewDeckModal isOpen={newDeckOpen} onClose={() => setNewDeckOpen(false)} />
    </>
  );
}
