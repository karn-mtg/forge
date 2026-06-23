import { useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLibraryStore } from '../store/useLibraryStore';
import { useConfirmStore } from '../store/useConfirmStore';
import { MoveDeckModal } from './MoveDeckModal';
import { ContextMenu } from './ContextMenu';
import { ManaSymbol } from './ManaSymbol';
import type { MenuItem } from './ContextMenu';
import type { Deck } from '../types/electron';

// ─── Shared helpers ───────────────────────────────────────────────────────────

const VALID_COLORS = new Set(['W', 'U', 'B', 'R', 'G', 'C']);

const RECIPIENT_ICONS: Record<string, string> = {
  binder: 'menu_book', box: 'inventory_2', deck_box: 'deployed_code', other: 'location_on',
};

const FORMAT_LABELS: Record<string, string> = {
  commander: 'Commander', modern: 'Modern', standard: 'Standard',
  pioneer: 'Pioneer', legacy: 'Legacy', vintage: 'Vintage', pauper: 'Pauper',
};

function timeAgo(iso?: string): string {
  if (!iso) return '';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ─── DeckCard ─────────────────────────────────────────────────────────────────

interface DeckCardProps { deck: Deck }

export function DeckCard({ deck }: DeckCardProps) {
  const navigate = useNavigate();
  const { updateDeck, deleteDeck, duplicateDeck, reloadLibrary } = useLibraryStore();

  // Context menu
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const closeCtx = useCallback(() => setCtxMenu(null), []);

  const [moveOpen, setMoveOpen] = useState(false);

  // Rename overlay
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameVal, setRenameVal] = useState('');
  const renameRef = useRef<HTMLInputElement>(null);

  const isFav = !!deck.is_favorite;
  const formatLabel = FORMAT_LABELS[deck.format] || deck.format;
  const colorDots = (deck.color_identity || '').toUpperCase().split('').filter(c => VALID_COLORS.has(c));
  const cardCount = Array.isArray(deck.cards) ? deck.cards.length : (deck.card_count ?? 0);

  // #14 – quick-favorite toggle
  const handleFavorite = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    await updateDeck({ id: deck.id, is_favorite: !isFav });
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY });
  };

  const startRename = () => {
    setRenameVal(deck.name);
    setIsRenaming(true);
    setTimeout(() => renameRef.current?.focus(), 30);
  };

  const commitRename = async () => {
    setIsRenaming(false);
    const name = renameVal.trim();
    if (name && name !== deck.name) await updateDeck({ id: deck.id, name });
  };

  const handleDuplicate = async () => {
    const newId = await duplicateDeck({ id: deck.id });
    if (newId) navigate(`/deck/${newId}`);
  };

  // Context menu items for #15
  const ctxItems: MenuItem[] = [
    { label: 'Open',      icon: 'open_in_new',    onClick: () => navigate(`/deck/${deck.id}`) },
    { label: 'Rename',    icon: 'edit',            onClick: startRename },
    { label: 'Duplicate', icon: 'content_copy',    onClick: handleDuplicate },
    { label: 'Move to…',  icon: 'drive_file_move', onClick: () => setMoveOpen(true) },
    { divider: true },
    {
      label: 'Delete', icon: 'delete_outline', danger: true,
      onClick: () => useConfirmStore.getState().show({
        title: 'Delete Deck',
        message: `Delete "${deck.name}"? This cannot be undone.`,
        danger: true,
        confirmLabel: 'Delete',
        onConfirm: () => deleteDeck({ id: deck.id }),
      }),
    },
  ];

  return (
    <>
      <a
        onClick={() => !isRenaming && navigate(`/deck/${deck.id}`)}
        onContextMenu={handleContextMenu}
        className="group relative aspect-[3/4.2] bg-surface rounded-2xl overflow-hidden border border-white/5 hover:border-primary/30 transition-all duration-500 shadow-xl hover:-translate-y-2 block cursor-pointer"
      >
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent z-10" />
        {deck.cover_image_url ? (
          <img src={deck.cover_image_url} className="absolute inset-0 w-full h-full object-cover object-top opacity-40" alt="" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center opacity-10">
            <span
              className="material-symbols-outlined text-[140px] text-primary"
              style={{ fontVariationSettings: isFav ? "'FILL' 1" : "'FILL' 0" }}
            >
              {isFav ? 'star' : 'style'}
            </span>
          </div>
        )}

        {/* Quick-favorite button (#14) */}
        <button
          onClick={handleFavorite}
          title={isFav ? 'Remove from favorites' : 'Add to favorites'}
          className={`absolute top-3 right-3 z-20 w-7 h-7 rounded-full flex items-center justify-center transition-all
            opacity-0 group-hover:opacity-100 hover:scale-110
            ${isFav ? 'opacity-100 text-primary' : 'text-white/60 hover:text-primary bg-black/40 backdrop-blur-sm'}`}
        >
          <span className="material-symbols-outlined text-[16px]" style={{ fontVariationSettings: isFav ? "'FILL' 1" : "'FILL' 0" }}>star</span>
        </button>

        <div className="absolute bottom-0 left-0 right-0 p-5 z-20">
          <div className="flex justify-between items-start mb-2">
            <span className="px-2 py-0.5 rounded-md bg-black/60 backdrop-blur-md border border-white/10 text-[9px] font-bold uppercase tracking-wider text-primary">
              {formatLabel}
            </span>
            <div className="flex items-center gap-[2px]">
              {colorDots.map((c, i) => (
                <ManaSymbol key={i} sym={c} cost shadow size="1rem" />
              ))}
            </div>
          </div>

          {/* Rename overlay (#15) */}
          {isRenaming ? (
            <input
              ref={renameRef}
              value={renameVal}
              onChange={e => setRenameVal(e.target.value)}
              onBlur={commitRename}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
                if (e.key === 'Escape') setIsRenaming(false);
                e.stopPropagation();
              }}
              onClick={e => e.stopPropagation()}
              className="w-full bg-surface-container/80 border border-primary/50 rounded-md px-2 py-1 text-on-surface font-bold text-base focus:outline-none mb-1"
            />
          ) : (
            <h3 className="font-headline-md text-lg text-on-surface mb-1 truncate">{deck.name}</h3>
          )}

          <div className="flex items-center justify-between text-on-surface-variant/60">
            <span className="text-[11px]">{cardCount} Cards</span>
            <span className="text-[10px]">{timeAgo(deck.updated_at)}</span>
          </div>
          {deck.recipient_id ? (
            <div className="flex items-center gap-1 mt-1.5">
              <span
                className="material-symbols-outlined text-[11px] text-emerald-400"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                {RECIPIENT_ICONS[deck.recipient_type ?? 'other'] ?? 'location_on'}
              </span>
              <span className="text-[10px] text-emerald-400 truncate">{deck.recipient_name}</span>
            </div>
          ) : null}
        </div>
      </a>

      {ctxMenu && <ContextMenu x={ctxMenu.x} y={ctxMenu.y} items={ctxItems} onClose={closeCtx} />}

      <MoveDeckModal
        deckId={deck.id}
        deckName={deck.name}
        isOpen={moveOpen}
        onClose={() => setMoveOpen(false)}
        onMoved={reloadLibrary}
      />
    </>
  );
}

export function NewDeckCard({ onOpen }: { onOpen: () => void }) {
  return (
    <div
      onClick={onOpen}
      className="group relative aspect-[3/4.2] bg-surface/30 border-2 border-dashed border-white/5 rounded-2xl flex flex-col items-center justify-center gap-4 cursor-pointer hover:border-primary/40 hover:bg-primary/5 transition-all duration-300"
    >
      <div className="w-12 h-12 rounded-full bg-surface border border-white/10 flex items-center justify-center text-primary group-hover:scale-110 transition-transform shadow-lg">
        <span className="material-symbols-outlined text-[28px]">add</span>
      </div>
      <p className="font-headline-md text-lg text-on-surface-variant group-hover:text-primary">New Deck</p>
    </div>
  );
}
