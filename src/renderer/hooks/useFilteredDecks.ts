import { useMemo } from 'react';
import type { Deck } from '../types/electron';

export type DeckSortKey = 'updated' | 'name' | 'cards' | 'created';

interface FilterOptions {
  search?: string;
  formatFilter?: string;
  sortBy?: DeckSortKey;
  favoritesOnly?: boolean;
  /** Slice result to N items — only applied when no search/format filter is active. */
  limit?: number;
}

/**
 * Single source of truth for deck filtering + sorting.
 * Replaces the duplicated filter/sort pipelines in Dashboard and AllDecks.
 */
export function useFilteredDecks(
  decks: Deck[],
  { search = '', formatFilter = '', sortBy = 'updated', favoritesOnly = false, limit }: FilterOptions = {},
): Deck[] {
  return useMemo(() => {
    let list = [...decks];

    if (favoritesOnly) {
      list = list.filter(d => !!d.is_favorite);
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(d => d.name.toLowerCase().includes(q));
    }
    if (formatFilter) {
      list = list.filter(d => d.format === formatFilter);
    }

    switch (sortBy) {
      case 'name':
        list.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'cards':
        list.sort((a, b) => (b.card_count ?? 0) - (a.card_count ?? 0));
        break;
      case 'created':
        list.sort((a, b) =>
          new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime(),
        );
        break;
      default: // 'updated'
        list.sort((a, b) =>
          new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime(),
        );
    }

    // Only slice when there is no active filter (show everything when user searches)
    if (limit !== undefined && !search && !formatFilter && !favoritesOnly) {
      return list.slice(0, limit);
    }
    return list;
  }, [decks, search, formatFilter, sortBy, favoritesOnly, limit]);
}
