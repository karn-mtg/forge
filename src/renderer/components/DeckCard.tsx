import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useLibraryStore } from '../store/useLibraryStore';
import { useConfirmStore } from '../store/useConfirmStore';
import { MoveDeckModal } from './MoveDeckModal';
import { ManaSymbol } from './ManaSymbol';
import type { Deck } from '../types/electron';

// ─── Shared helpers ───────────────────────────────────────────────────────────

const VALID_COLORS = new Set(['W', 'U', 'B', 'R', 'G', 'C']);

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

// ─── Inline context menu ──────────────────────────────────────────────────────

interface MenuItem { label?: string; icon?: string; onClick?: () => void; danger?: boolean; divider?: boolean }

function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      x: x + r.width  > window.innerWidth  ? Math.max(4, window.innerWidth  - r.width  - 4) : x,
      y: y + r.height > window.innerHeight ? Math.max(4, window.innerHeight - r.height - 4) : y,
    });
  }, [x, y]);

  useEffect(() => {
    const down = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const key  = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', down, true);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down, true); document.removeEventListener('keydown', key); };
  }, [onClose]);

  return createPortal(
    <div ref={ref} className="fixed z-[9999] min-w-[176px] rounded-lg py-1 shadow-2xl border border-white/10 overflow-hidden"
      style={{ left: pos.x, top: pos.y, background: 'rgba(28,31,38,0.98)', backdropFilter: 'blur(20px)' }}>
      {items.map((item, i) =>
        item.divider ? <div key={i} className="my-1 border-t border-white/8" /> : (
          <button key={i} onClick={() => { item.onClick?.(); onClose(); }}
            className={`w-full flex items-center gap-2.5 px-3 py-[6px] hover:bg-white/8 transition-colors text-left ${item.danger ? 'text-red-400/90 hover:text-red-300' : 'text-on-surface-variant hover:text-on-surface'}`}>
            {item.icon && <span className="material-symbols-outlined flex-shrink-0" style={{ fontSize: 14 }}>{item.icon}</span>}
            <span style={{ fontSize: 13 }}>{item.label}</span>
          </button>
        )
      )}
    </div>,
    document.body
  );
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
    await updateDeck({ id: deck.id, is_favorite: isFav ? 0 : 1 });
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
            <span className="material-symbols-outlined text-[140px] text-primary">style</span>
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
