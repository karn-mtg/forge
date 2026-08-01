import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useFilteredDecks } from './useFilteredDecks';
import type { Deck } from '../types/electron';

function deck(overrides: Partial<Deck>): Deck {
  return {
    id: 1,
    name: 'Untitled',
    format: 'commander',
    ...overrides,
  };
}

const decks: Deck[] = [
  deck({ id: 1, name: 'Zombie Horde', format: 'commander', is_favorite: false, card_count: 100, updated_at: '2024-01-01', created_at: '2023-01-01' }),
  deck({ id: 2, name: 'Aggro Burn', format: 'standard', is_favorite: true, card_count: 60, updated_at: '2024-03-01', created_at: '2023-06-01' }),
  deck({ id: 3, name: 'Mono Blue Control', format: 'commander', is_favorite: true, card_count: 99, updated_at: '2024-02-01', created_at: '2023-03-01' }),
];

describe('useFilteredDecks', () => {
  it('sorts by updated_at desc by default', () => {
    const { result } = renderHook(() => useFilteredDecks(decks));
    expect(result.current.map(d => d.id)).toEqual([2, 3, 1]);
  });

  it('filters by search (case-insensitive, matches name substring)', () => {
    const { result } = renderHook(() => useFilteredDecks(decks, { search: 'blue' }));
    expect(result.current.map(d => d.id)).toEqual([3]);
  });

  it('filters by format', () => {
    const { result } = renderHook(() => useFilteredDecks(decks, { formatFilter: 'commander' }));
    expect(result.current.map(d => d.id).sort()).toEqual([1, 3]);
  });

  it('filters by favoritesOnly', () => {
    const { result } = renderHook(() => useFilteredDecks(decks, { favoritesOnly: true }));
    expect(result.current.map(d => d.id).sort()).toEqual([2, 3]);
  });

  it('sorts by name', () => {
    const { result } = renderHook(() => useFilteredDecks(decks, { sortBy: 'name' }));
    expect(result.current.map(d => d.name)).toEqual(['Aggro Burn', 'Mono Blue Control', 'Zombie Horde']);
  });

  it('sorts by card count desc', () => {
    const { result } = renderHook(() => useFilteredDecks(decks, { sortBy: 'cards' }));
    expect(result.current.map(d => d.id)).toEqual([1, 3, 2]);
  });

  it('applies limit only when no filter is active', () => {
    const { result: limited } = renderHook(() => useFilteredDecks(decks, { limit: 1 }));
    expect(limited.current).toHaveLength(1);

    const { result: unfiltered } = renderHook(() => useFilteredDecks(decks, { limit: 1, search: 'o' }));
    expect(unfiltered.current.length).toBeGreaterThan(1);
  });
});
