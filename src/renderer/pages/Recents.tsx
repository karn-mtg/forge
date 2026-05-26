import { useMemo, useEffect } from 'react';
import { useLibraryStore } from '../store/useLibraryStore';
import { useSearchStore } from '../store/useSearchStore';
import { DeckCard } from '../components/DeckCard';
import { PageHeader } from '../components/PageHeader';

export function Recents() {
  const { decks } = useLibraryStore();
  const { value: search, setPlaceholder, reset } = useSearchStore();

  useEffect(() => {
    setPlaceholder('Filter recents…');
    return () => reset();
  }, [setPlaceholder, reset]);

  // Sort by updated_at descending, take top 12 — memoized so it only runs when decks change
  const recent = useMemo(
    () =>
      [...decks]
        .filter(d => d.updated_at)
        .sort((a, b) => new Date(b.updated_at!).getTime() - new Date(a.updated_at!).getTime())
        .slice(0, 12),
    [decks],
  );

  const filtered = useMemo(
    () =>
      search
        ? recent.filter(d => d.name.toLowerCase().includes(search.toLowerCase()))
        : recent,
    [recent, search],
  );

  return (
    <div className="flex flex-col h-full">
      <PageHeader icon="schedule" title="Recents" />
      <main className="flex-1 overflow-auto p-margin-desktop">
        <div className="max-w-[1400px] mx-auto space-y-8">

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
    </div>
  );
}
