import { useState, useEffect, useCallback } from 'react';
import { useConfirmStore } from '../store/useConfirmStore';

const TAG_COLOR_PALETTE = ['#f2ca83', '#bcd0ff', '#86efac', '#c4c6cd', '#d4aa7d', '#c084fc'];

interface TagSummary {
  name: string;
  color: string;
  cardCount: number;
}

interface TagManagerModalProps {
  deckId: number;
  onClose: () => void;
  /** Called after any rename/recolor/delete — lets callers refresh their own tag state. */
  onChanged?: () => void;
}

/** Every tag defined in this deck — including empty ones (a tag with color but 0 cards, e.g. a group box created with nothing in it yet) — with a live card count. */
export function TagManagerModal({ deckId, onClose, onChanged }: TagManagerModalProps) {
  const [tags, setTags] = useState<TagSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [colorPickerFor, setColorPickerFor] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [deckTags, deckColors] = await Promise.all([
      window.libraryAPI.getDeckTags({ deckId }),
      window.libraryAPI.getDeckTagColors({ deckId }),
    ]);
    const counts = new Map<string, number>();
    for (const t of deckTags) {
      if (t.is_placeholder || !t.tag_name) continue;
      counts.set(t.tag_name, (counts.get(t.tag_name) || 0) + 1);
    }
    const colorMap = new Map(deckColors.map(c => [c.tag_name, c.color]));
    const names = new Set<string>([...counts.keys(), ...colorMap.keys()]);
    const summaries = Array.from(names).map(name => ({
      name,
      color: colorMap.get(name) || TAG_COLOR_PALETTE[0],
      cardCount: counts.get(name) || 0,
    }));
    summaries.sort((a, b) => b.cardCount - a.cardCount || a.name.localeCompare(b.name));
    setTags(summaries);
    setLoading(false);
  }, [deckId]);

  useEffect(() => { load(); }, [load]);

  async function commitRename(oldName: string) {
    const newName = renameValue.trim();
    setRenaming(null);
    if (!newName || newName === oldName) return;
    await window.libraryAPI.renameTagInDeck({ deckId, oldName, newName });
    onChanged?.();
    load();
  }

  async function setColor(name: string, color: string) {
    setColorPickerFor(null);
    setTags(prev => prev.map(t => t.name === name ? { ...t, color } : t));
    await window.libraryAPI.setTagColor({ deckId, tagName: name, color });
    onChanged?.();
  }

  function deleteTag(t: TagSummary) {
    useConfirmStore.getState().show({
      title: `Delete "${t.name}"?`,
      message: t.cardCount > 0
        ? `This removes the tag from ${t.cardCount} card${t.cardCount === 1 ? '' : 's'} and deletes its group box. This can't be undone.`
        : `This tag has no cards. It'll be removed from the deck.`,
      confirmLabel: 'Delete',
      danger: true,
      onConfirm: async () => {
        await window.libraryAPI.deleteTagFromDeck({ deckId, tagName: t.name });
        onChanged?.();
        load();
      },
    });
  }

  return (
    <div className="fixed inset-0 z-[800] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative glass-panel rounded-2xl p-6 w-[420px] max-h-[70vh] flex flex-col shadow-2xl border border-white/5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-headline-md text-lg text-on-surface font-bold">Deck Tags</h2>
          <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center text-on-surface-variant/50 hover:text-on-surface hover:bg-white/5 transition-all">
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        {loading ? (
          <p className="text-label-md text-on-surface-variant/40 py-6 text-center">Loading…</p>
        ) : tags.length === 0 ? (
          <p className="text-label-md text-on-surface-variant/40 py-6 text-center">No tags yet. Tag a card or create a group on the canvas to get started.</p>
        ) : (
          <div className="flex-1 overflow-y-auto -mx-2 px-2 space-y-1">
            {tags.map(t => (
              <div key={t.name} className="flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-white/[0.03] group">
                <div className="relative flex-shrink-0">
                  <button
                    onClick={() => setColorPickerFor(p => p === t.name ? null : t.name)}
                    className="w-4 h-4 rounded-full ring-1 ring-white/20 hover:scale-110 transition-transform"
                    style={{ background: t.color }}
                    aria-label="Change color"
                  />
                  {colorPickerFor === t.name && (
                    <div className="absolute z-10 top-full mt-1.5 left-0 flex gap-1.5 p-2 rounded-xl glass-panel border border-white/10 shadow-2xl">
                      {TAG_COLOR_PALETTE.map(c => (
                        <button
                          key={c}
                          onClick={() => setColor(t.name, c)}
                          className="w-5 h-5 rounded-full border border-white/20 hover:scale-110 transition-transform"
                          style={{ background: c }}
                          aria-label={`Set color ${c}`}
                        />
                      ))}
                    </div>
                  )}
                </div>

                {renaming === t.name ? (
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={e => setRenameValue(e.target.value)}
                    onBlur={() => commitRename(t.name)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                      if (e.key === 'Escape') setRenaming(null);
                    }}
                    className="flex-1 min-w-0 text-body-md bg-white/[0.05] border border-primary/40 rounded px-1.5 py-0.5 text-on-surface focus:outline-none"
                  />
                ) : (
                  <span
                    className="flex-1 min-w-0 truncate text-body-md text-on-surface font-medium cursor-text"
                    onClick={() => { setRenaming(t.name); setRenameValue(t.name); }}
                    title="Click to rename"
                  >
                    {t.name}
                  </span>
                )}

                <span className="text-[10px] font-bold tabular-nums text-on-surface-variant/35 flex-shrink-0 px-1.5">
                  {t.cardCount} {t.cardCount === 1 ? 'card' : 'cards'}
                </span>

                <button
                  onClick={() => deleteTag(t)}
                  className="w-6 h-6 rounded flex items-center justify-center text-on-surface-variant/0 group-hover:text-on-surface-variant/40 hover:!text-red-400 hover:bg-red-500/10 transition-all flex-shrink-0"
                  aria-label={`Delete tag ${t.name}`}
                >
                  <span className="material-symbols-outlined text-[16px]">delete_outline</span>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
