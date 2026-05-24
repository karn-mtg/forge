import { useState } from 'react';
import { useLibraryStore } from '../store/useLibraryStore';
import { Header } from '../components/Header';
import { DeckCard } from '../components/DeckCard';

export function Recents() {
  const { decks } = useLibraryStore();
  const [search, setSearch] = useState('');

  // Sort by updated_at descending
  const recent = [...decks]
    .filter(d => d.updated_at)
    .sort((a, b) => new Date(b.updated_at!).getTime() - new Date(a.updated_at!).getTime())
    .slice(0, 12);

  const filtered = search ? recent.filter(d => d.name.toLowerCase().includes(search.toLowerCase())) : recent;

  return (
    <>
      <Header searchPlaceholder="Filter recents…" searchValue={search} onSearch={setSearch} />
      <main className="p-margin-desktop min-h-screen">
        <div className="max-w-[1400px] mx-auto space-y-8">
          <div>
            <h2 className="font-headline-lg text-2xl text-on-surface">Recents</h2>
            <p className="text-on-surface-variant text-body-md mt-1">Recently edited decks</p>
          </div>

          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 gap-4">
              <span className="material-symbols-outlined text-[56px] text-on-surface-variant/15">schedule</span>
              <p className="font-headline-md text-lg text-on-surface-variant/40">{search ? 'No matches' : 'No recent decks'}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {filtered.map(deck => <DeckCard key={deck.id} deck={deck} />)}
            </div>
          )}
        </div>
      </main>
    </>
  );
}
