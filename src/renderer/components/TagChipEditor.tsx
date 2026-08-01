import { useState, useEffect, useRef, useCallback } from 'react';
import { TagManagerModal } from './TagManagerModal';

// Same 6-swatch palette used for canvas group colors — tags ARE groups now,
// so this is the single source of truth for group color everywhere.
const TAG_COLOR_PALETTE = ['#f2ca83', '#bcd0ff', '#86efac', '#c4c6cd', '#d4aa7d', '#c084fc'];

interface TagChipEditorProps {
  deckCardId: number;
  deckId: number;
  /** Called after any tag mutation is persisted — lets the canvas re-derive its groups live. */
  onChanged?: () => void;
}

/** Drops any placeholder (null) slots trailing off the end — a gap only means
 *  something when there's a real tag above it to distinguish from fallback. */
function trimTrailingGaps(tags: (string | null)[]): (string | null)[] {
  let end = tags.length;
  while (end > 0 && tags[end - 1] == null) end--;
  return tags.slice(0, end);
}

/**
 * Editable, drag-reorderable, priority-ordered list of a card's tags.
 * A `null` entry is an explicit empty slot: it deliberately opts the card
 * out of grouping at exactly that priority level (no fallback), distinct
 * from simply not having reached that position yet.
 */
export function TagChipEditor({ deckCardId, deckId, onChanged }: TagChipEditorProps) {
  const [tags, setTags] = useState<(string | null)[]>([]);
  const [loading, setLoading] = useState(true);
  const [deckTagNames, setDeckTagNames] = useState<string[]>([]);
  const [colors, setColors] = useState<Record<string, string>>({});
  const [inputValue, setInputValue] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [colorPickerFor, setColorPickerFor] = useState<string | null>(null);
  const [managerOpen, setManagerOpen] = useState(false);
  const dragIndexRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [cardTags, deckTags, deckColors] = await Promise.all([
      window.libraryAPI.getCardTags({ deckCardId }),
      window.libraryAPI.getDeckTags({ deckId }),
      window.libraryAPI.getDeckTagColors({ deckId }),
    ]);
    const maxPos = cardTags.reduce((m, t) => Math.max(m, t.position), -1);
    const arr: (string | null)[] = [];
    for (let i = 0; i <= maxPos; i++) {
      const t = cardTags.find(t => t.position === i);
      arr.push(t && !t.is_placeholder ? t.tag_name : null);
    }
    setTags(arr);
    const names = Array.from(new Set(deckTags.filter(t => !t.is_placeholder && t.tag_name).map(t => t.tag_name as string)));
    setDeckTagNames(names.sort((a, b) => a.localeCompare(b)));
    setColors(Object.fromEntries(deckColors.map(c => [c.tag_name, c.color])));
    setLoading(false);
  }, [deckCardId, deckId]);

  useEffect(() => { load(); }, [load]);

  async function persist(next: (string | null)[]) {
    setTags(next);
    await window.libraryAPI.setCardTags({ deckCardId, tags: next });
    onChanged?.();
    load(); // refresh colors/suggestions (new tag may have gotten an auto-color)
  }

  function addTag(name: string) {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    persist([...tags, trimmedName]);
    setInputValue('');
    setShowSuggestions(false);
  }

  function removeAt(index: number) {
    persist(trimTrailingGaps(tags.filter((_, i) => i !== index)));
  }

  function addEmptySlot() {
    // Not trimmed — this trailing gap IS the point of the click. It only
    // gets trimmed away later if it's still trailing after some other edit.
    persist([...tags, null]);
  }

  function onDrop(targetIndex: number) {
    const from = dragIndexRef.current;
    dragIndexRef.current = null;
    if (from == null || from === targetIndex) return;
    const next = [...tags];
    const [moved] = next.splice(from, 1);
    next.splice(targetIndex, 0, moved);
    persist(trimTrailingGaps(next));
  }

  async function setColor(tagName: string, color: string) {
    setColors(prev => ({ ...prev, [tagName]: color }));
    setColorPickerFor(null);
    await window.libraryAPI.setTagColor({ deckId, tagName, color });
    onChanged?.();
  }

  const usedNames = new Set(tags.filter((t): t is string => t != null).map(t => t.toLowerCase()));
  const suggestions = inputValue.trim()
    ? deckTagNames.filter(n => n.toLowerCase().includes(inputValue.trim().toLowerCase()) && !usedNames.has(n.toLowerCase()))
    : deckTagNames.filter(n => !usedNames.has(n.toLowerCase()));

  if (loading) return null;

  return (
    <div className="px-4 pb-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[9px] font-bold uppercase tracking-widest text-on-surface-variant/35">Your Tags</p>
        <button
          onClick={() => setManagerOpen(true)}
          className="flex items-center gap-1 text-[10px] font-semibold text-on-surface-variant/45 hover:text-primary transition-colors"
        >
          <span className="material-symbols-outlined text-[13px]">sell</span>
          Manage all tags
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 p-2.5 rounded-xl border border-white/[0.06] bg-white/[0.02]">
        {tags.length === 0 && (
          <span className="text-[11px] text-on-surface-variant/25 italic px-0.5">No tags yet — add one below</span>
        )}
        {tags.map((tag, i) =>
          tag == null ? (
            <div
              key={i}
              draggable
              onDragStart={() => { dragIndexRef.current = i; }}
              onDragOver={e => e.preventDefault()}
              onDrop={() => onDrop(i)}
              title={`Priority ${i + 1}: explicit empty slot — this card has no group at this level`}
              className="flex items-center gap-1.5 border border-dashed border-white/20 rounded-full pl-3 pr-2 py-1.5 cursor-grab hover:border-white/35 transition-colors"
              style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}
            >
              <span className="italic">empty</span>
              <button onClick={() => removeAt(i)} className="w-4 h-4 rounded-full flex items-center justify-center hover:bg-white/10 hover:text-white/70 transition-colors" aria-label="Remove empty slot">×</button>
            </div>
          ) : (
            <div key={i} className="relative">
              <div
                draggable
                onDragStart={() => { dragIndexRef.current = i; }}
                onDragOver={e => e.preventDefault()}
                onDrop={() => onDrop(i)}
                className="flex items-center gap-2 rounded-full pl-2.5 pr-2 py-1.5 cursor-grab select-none shadow-sm hover:brightness-110 transition-all"
                style={{
                  fontSize: 12, fontWeight: 700,
                  background: (colors[tag] || TAG_COLOR_PALETTE[0]) + '26',
                  border: `1px solid ${(colors[tag] || TAG_COLOR_PALETTE[0])}66`,
                  color: colors[tag] || TAG_COLOR_PALETTE[0],
                }}
                title={`Priority ${i + 1}`}
              >
                <button
                  onClick={() => setColorPickerFor(p => p === tag ? null : tag)}
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0 ring-1 ring-white/20"
                  style={{ background: colors[tag] || TAG_COLOR_PALETTE[0] }}
                  aria-label="Change color"
                />
                <span>{tag}</span>
                <button onClick={() => removeAt(i)} className="w-4 h-4 rounded-full flex items-center justify-center hover:bg-black/20 transition-colors" aria-label="Remove tag">×</button>
              </div>
              {colorPickerFor === tag && (
                <div className="absolute z-10 top-full mt-1.5 left-0 flex gap-1.5 p-2 rounded-xl glass-panel border border-white/10 shadow-2xl">
                  {TAG_COLOR_PALETTE.map(c => (
                    <button
                      key={c}
                      onClick={() => setColor(tag, c)}
                      className="w-5 h-5 rounded-full border border-white/20 hover:scale-110 transition-transform"
                      style={{ background: c }}
                      aria-label={`Set color ${c}`}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        )}

        <button
          onClick={addEmptySlot}
          title="Add an explicit empty slot (opts this card out of grouping at that priority level, no fallback)"
          className="flex items-center gap-0.5 text-[11px] font-semibold px-2.5 py-1.5 rounded-full border border-dashed border-white/20 text-on-surface-variant/45 hover:text-on-surface-variant/80 hover:border-white/40 transition-colors"
        >
          <span className="material-symbols-outlined text-[13px]">add</span>
          gap
        </button>
      </div>

      <div className="relative mt-2">
        <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-[14px] text-on-surface-variant/30 pointer-events-none">sell</span>
        <input
          value={inputValue}
          onChange={e => { setInputValue(e.target.value); setShowSuggestions(true); }}
          onFocus={() => setShowSuggestions(true)}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 120)}
          onKeyDown={e => { if (e.key === 'Enter') addTag(inputValue); }}
          placeholder="Add a tag…"
          className="w-full text-[12px] bg-white/[0.03] border border-white/10 rounded-lg pl-8 pr-2.5 py-2 text-on-surface placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/40 focus:bg-white/[0.05] transition-colors"
        />
        {showSuggestions && suggestions.length > 0 && (
          <div className="absolute z-10 top-full mt-1 left-0 right-0 max-h-40 overflow-y-auto rounded-lg glass-panel border border-white/10 shadow-xl">
            {suggestions.map(name => (
              <button
                key={name}
                onMouseDown={e => e.preventDefault()}
                onClick={() => addTag(name)}
                className="w-full text-left text-[11px] px-2.5 py-1.5 hover:bg-white/5 text-on-surface-variant/80 flex items-center gap-2"
              >
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: colors[name] || TAG_COLOR_PALETTE[0] }} />
                {name}
              </button>
            ))}
          </div>
        )}
      </div>

      {managerOpen && (
        <TagManagerModal
          deckId={deckId}
          onClose={() => setManagerOpen(false)}
          onChanged={() => { load(); onChanged?.(); }}
        />
      )}
    </div>
  );
}
