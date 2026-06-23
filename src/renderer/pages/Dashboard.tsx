import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLibraryStore } from '../store/useLibraryStore';
import { useSearchStore } from '../store/useSearchStore';
import { useFilteredDecks } from '../hooks/useFilteredDecks';
import type { DeckSortKey } from '../hooks/useFilteredDecks';
import type { Card } from '../types/electron';
import { DeckCard, NewDeckCard } from '../components/DeckCard';
import { NewDeckModal } from '../components/NewDeckModal';
import { ActivityChart } from '../components/charts/ActivityChart';
import { ColorDonut } from '../components/charts/ColorDonut';
import { PowerGauge } from '../components/charts/PowerGauge';
import { PageHeader } from '../components/PageHeader';

export function Dashboard() {
  const { decks } = useLibraryStore();
  const navigate = useNavigate();
  const [newDeckOpen, setNewDeckOpen] = useState(false);
  const { value: search, setPlaceholder, reset } = useSearchStore();
  const [formatFilter, setFormatFilter] = useState('');
  const [sortBy, setSortBy] = useState<DeckSortKey>('updated');
  const [showFilters, setShowFilters] = useState(false);
  const [mostUsed, setMostUsed] = useState<{ oracleId: string; deckCount: number; name?: string; artUrl?: string }[]>([]);

  useEffect(() => {
    setPlaceholder('Search decks…');
    return () => reset();
  }, [setPlaceholder, reset]);

  useEffect(() => {
    window.libraryAPI.getMostUsedCards({ limit: 10 }).then(async rows => {
      if (!rows?.length) return;
      const oracleIds = rows.map(r => r.oracle_id);
      let cards: Card[] = [];
      try { cards = (await window.cardsAPI.getCardsBatch({ oracleIds })) || []; } catch {}
      const cardMap = new Map(cards.map(c => [c.oracle_id, c]));
      setMostUsed(rows.map(r => {
        const c = cardMap.get(r.oracle_id);
        const fd = (c?.full_data || {}) as Record<string, any>;
        return {
          oracleId: r.oracle_id,
          deckCount: r.deck_count,
          name: c?.name,
          artUrl: fd.image_uris?.art_crop || fd.card_faces?.[0]?.image_uris?.art_crop || '',
        };
      }));
    }).catch(() => {});
  }, []);

  // Show at most 8 decks on the dashboard unless the user is actively filtering
  const displayed = useFilteredDecks(decks, { search, formatFilter, sortBy, limit: 8 });

  return (
    <div className="flex flex-col h-full">
      <PageHeader icon="dashboard" title="Dashboard" iconFill />
      <main className="flex-1 overflow-auto p-margin-desktop">
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

          {/* Format breakdown + Most-used cards */}
          {decks.length > 0 && (
            <section>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Format breakdown bar chart */}
                <div className="bg-surface border border-white/5 rounded-2xl p-5 shadow-xl">
                  <h3 className="text-[11px] font-bold uppercase tracking-widest text-on-surface-variant/40 mb-4">Decks by Format</h3>
                  {(() => {
                    const counts: Record<string, number> = {};
                    for (const d of decks) {
                      const f = d.format || 'other';
                      counts[f] = (counts[f] || 0) + 1;
                    }
                    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
                    const max = sorted[0]?.[1] || 1;
                    const FORMAT_COLORS: Record<string, string> = {
                      commander: '#f2ca83', modern: '#7eb8f7', standard: '#86efac',
                      pioneer: '#c084fc', legacy: '#f87171', pauper: '#fbbf24', vintage: '#94a3b8',
                    };
                    return (
                      <div className="space-y-2">
                        {sorted.map(([fmt, cnt]) => (
                          <div key={fmt} className="flex items-center gap-3">
                            <span className="text-[10px] font-bold capitalize text-on-surface-variant/60 w-20 flex-shrink-0">{fmt}</span>
                            <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
                              <div
                                className="h-full rounded-full transition-all"
                                style={{ width: `${(cnt / max) * 100}%`, background: FORMAT_COLORS[fmt] || '#6b7280' }}
                              />
                            </div>
                            <span className="text-[10px] font-bold tabular-nums text-on-surface-variant/40 w-6 text-right">{cnt}</span>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>

                {/* Most-used cards */}
                {mostUsed.length > 0 && (
                  <div className="bg-surface border border-white/5 rounded-2xl p-5 shadow-xl">
                    <h3 className="text-[11px] font-bold uppercase tracking-widest text-on-surface-variant/40 mb-4">Most-Used Cards</h3>
                    <div className="space-y-1.5">
                      {mostUsed.map((c, i) => (
                        <div key={c.oracleId} className="flex items-center gap-3">
                          <span className="text-[10px] font-black tabular-nums text-on-surface-variant/25 w-4">{i + 1}</span>
                          {c.artUrl ? (
                            <img src={c.artUrl} alt="" className="w-8 h-6 rounded object-cover flex-shrink-0" />
                          ) : (
                            <div className="w-8 h-6 rounded flex-shrink-0" style={{ background: 'rgba(255,255,255,0.04)' }} />
                          )}
                          <span className="flex-1 text-[11px] font-medium text-on-surface truncate">{c.name || c.oracleId}</span>
                          <span className="text-[10px] font-bold tabular-nums text-on-surface-variant/40">{c.deckCount} deck{c.deckCount !== 1 ? 's' : ''}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}

        </div>
      </main>

      <NewDeckModal isOpen={newDeckOpen} onClose={() => setNewDeckOpen(false)} />
    </div>
  );
}
