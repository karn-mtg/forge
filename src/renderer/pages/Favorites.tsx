import { useMemo, useState } from 'react';
import { useLibraryStore } from '../store/useLibraryStore';
import { Header } from '../components/Header';
import { DeckCard } from '../components/DeckCard';

export function Favorites() {
  const { decks } = useLibraryStore();
  const [search, setSearch] = useState('');

  const favorites = useMemo(() => {
    const faves = decks.filter(d => d.is_favorite);
    if (!search) return faves;
    const q = search.toLowerCase();
    return faves.filter(d => d.name.toLowerCase().includes(q));
  }, [decks, search]);

  return (
    <>
      <Header searchPlaceholder="Filter favorites…" searchValue={search} onSearch={setSearch} />
      <main className="p-margin-desktop min-h-screen">
        <div className="max-w-[1400px] mx-auto space-y-8">
          <div>
            <h2 className="font-headline-lg text-2xl text-on-surface">Favorites</h2>
            <p className="text-on-surface-variant text-body-md mt-1">Your starred decks</p>
          </div>
          {favorites.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 gap-4">
              <span className="material-symbols-outlined text-[56px] text-on-surface-variant/15">star</span>
              <p className="font-headline-md text-lg text-on-surface-variant/40">
                {search ? 'No matches' : 'No favorites yet'}
              </p>
              <p className="text-on-surface-variant/30 text-body-md text-center max-w-xs">
                {!search && 'Open a deck and mark it as favorite in Deck Settings.'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {favorites.map(deck => <DeckCard key={deck.id} deck={deck} />)}
            </div>
          )}
        </div>
      </main>
    </>
  );
}
