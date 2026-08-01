// Pure, DOM-free computation of tag-derived canvas groups. See the "Canvas
// Revamp: Tag-Based Grouping" plan: a card's effective group at priority
// level N is its tag at position N-1 if it has one; otherwise it falls back
// to the nearest lower-priority tag it does have. An explicit placeholder
// at position N-1 opts the card out of grouping at exactly that level, with
// no fallback.

export interface CardTagSlot {
  position: number;
  tagName: string | null;
  isPlaceholder: boolean;
}

export interface TaggedCard {
  deckCardId: number;
  /** Tags in position order; gaps are allowed (sparse, not a compacted array). */
  tags: CardTagSlot[];
}

export interface EffectiveAssignment {
  tagName: string;
  /** True if the card has a real (non-placeholder) tag exactly at this level. */
  isRealAtLevel: boolean;
}

/**
 * deckCardId -> effective assignment at `level`, or null if the card is
 * free-floating at this level (no tag, or an explicit placeholder here).
 */
export function computeEffectiveGroups(
  cards: TaggedCard[],
  level: number
): Map<number, EffectiveAssignment | null> {
  const index = level - 1;
  const assignment = new Map<number, EffectiveAssignment | null>();

  for (const card of cards) {
    const byPosition = new Map(card.tags.map(t => [t.position, t]));
    const atLevel = byPosition.get(index);

    if (atLevel) {
      assignment.set(
        card.deckCardId,
        atLevel.isPlaceholder ? null : { tagName: atLevel.tagName as string, isRealAtLevel: true }
      );
      continue;
    }

    // No row authored at this exact position — fall back to the nearest
    // lower position that holds a real (non-placeholder) tag.
    let fallback: CardTagSlot | undefined;
    for (const t of card.tags) {
      if (t.position < index && !t.isPlaceholder && (!fallback || t.position > fallback.position)) {
        fallback = t;
      }
    }
    assignment.set(
      card.deckCardId,
      fallback ? { tagName: fallback.tagName as string, isRealAtLevel: false } : null
    );
  }

  return assignment;
}

export function groupByAssignment<T extends { deckCardId: number }>(
  cards: T[],
  assignment: Map<number, EffectiveAssignment | null>
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const card of cards) {
    const a = assignment.get(card.deckCardId);
    if (!a) continue; // free-floating
    if (!groups.has(a.tagName)) groups.set(a.tagName, []);
    groups.get(a.tagName)!.push(card);
  }
  return groups;
}

// ── Local tag-array mutation helpers ──────────────────────────────────────
// Mirror the DB-side position semantics (setCardTagAt/clearCardTagAt) for
// optimistic local state updates in the chip editor / drag-drop handlers.

export function withTagAt(tags: CardTagSlot[], position: number, tagName: string): CardTagSlot[] {
  const next = tags.filter(t => t.position !== position);
  next.push({ position, tagName, isPlaceholder: false });
  return next.sort((a, b) => a.position - b.position);
}

export function withPlaceholderAt(tags: CardTagSlot[], position: number): CardTagSlot[] {
  const next = tags.filter(t => t.position !== position);
  next.push({ position, tagName: null, isPlaceholder: true });
  return next.sort((a, b) => a.position - b.position);
}

export function withoutTagAt(tags: CardTagSlot[], position: number): CardTagSlot[] {
  return tags.filter(t => t.position !== position);
}
