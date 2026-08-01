import { describe, it, expect } from 'vitest';
import { computeEffectiveGroups, groupByAssignment, withTagAt, withPlaceholderAt, withoutTagAt, type TaggedCard } from './tagGrouping';

function slot(position: number, tagName: string) {
  return { position, tagName, isPlaceholder: false };
}

describe('computeEffectiveGroups', () => {
  it('matches the worked example from the design spec', () => {
    const cardA: TaggedCard = { deckCardId: 1, tags: [slot(0, 'TagA'), slot(1, 'TagB')] };
    const cardB: TaggedCard = { deckCardId: 2, tags: [slot(0, 'TagA')] };

    const level1 = computeEffectiveGroups([cardA, cardB], 1);
    expect(level1.get(1)).toEqual({ tagName: 'TagA', isRealAtLevel: true });
    expect(level1.get(2)).toEqual({ tagName: 'TagA', isRealAtLevel: true });
    const groups1 = groupByAssignment([cardA, cardB], level1);
    expect(groups1.get('TagA')?.map(c => c.deckCardId)).toEqual([1, 2]);

    const level2 = computeEffectiveGroups([cardA, cardB], 2);
    expect(level2.get(1)).toEqual({ tagName: 'TagB', isRealAtLevel: true });
    expect(level2.get(2)).toEqual({ tagName: 'TagA', isRealAtLevel: false }); // fallback
    const groups2 = groupByAssignment([cardA, cardB], level2);
    expect(groups2.get('TagA')?.map(c => c.deckCardId)).toEqual([2]);
    expect(groups2.get('TagB')?.map(c => c.deckCardId)).toEqual([1]);
  });

  it('cards with zero tags are free-floating at every level', () => {
    const card: TaggedCard = { deckCardId: 1, tags: [] };
    expect(computeEffectiveGroups([card], 1).get(1)).toBeNull();
    expect(computeEffectiveGroups([card], 5).get(1)).toBeNull();
  });

  it('an explicit placeholder at the queried level is free-floating with no fallback', () => {
    const card: TaggedCard = {
      deckCardId: 1,
      tags: [slot(0, 'TagA'), { position: 1, tagName: null, isPlaceholder: true }, slot(2, 'TagC')],
    };
    expect(computeEffectiveGroups([card], 1).get(1)).toEqual({ tagName: 'TagA', isRealAtLevel: true });
    expect(computeEffectiveGroups([card], 2).get(1)).toBeNull(); // placeholder blocks fallback at its own level
    expect(computeEffectiveGroups([card], 3).get(1)).toEqual({ tagName: 'TagC', isRealAtLevel: true });
  });

  it('falls back past a level with no row to the nearest lower real tag', () => {
    // tags at 0 and 3 only; querying level 5 (index 4) should fall back to position 3.
    const card: TaggedCard = { deckCardId: 1, tags: [slot(0, 'TagA'), slot(3, 'TagD')] };
    expect(computeEffectiveGroups([card], 5).get(1)).toEqual({ tagName: 'TagD', isRealAtLevel: false });
    expect(computeEffectiveGroups([card], 4).get(1)).toEqual({ tagName: 'TagD', isRealAtLevel: true });
  });
});

describe('tag array mutation helpers', () => {
  it('withTagAt replaces or inserts at a position, keeping order', () => {
    const tags = [slot(0, 'A'), slot(2, 'C')];
    const result = withTagAt(tags, 1, 'B');
    expect(result.map(t => [t.position, t.tagName])).toEqual([[0, 'A'], [1, 'B'], [2, 'C']]);
  });

  it('withPlaceholderAt marks a slot empty without disturbing neighbors', () => {
    const tags = [slot(0, 'A'), slot(2, 'C')];
    const result = withPlaceholderAt(tags, 1);
    expect(result.map(t => [t.position, t.tagName, t.isPlaceholder])).toEqual([
      [0, 'A', false],
      [1, null, true],
      [2, 'C', false],
    ]);
  });

  it('withoutTagAt clears a slot entirely, leaving neighbors untouched', () => {
    const tags = [slot(0, 'A'), slot(1, 'B'), slot(2, 'C')];
    const result = withoutTagAt(tags, 1);
    expect(result.map(t => t.position)).toEqual([0, 2]);
  });
});
