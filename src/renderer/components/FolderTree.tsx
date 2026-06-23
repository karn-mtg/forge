import { useState, useEffect, useRef, useMemo, createContext, useContext, useCallback } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useLibraryStore } from '../store/useLibraryStore';
import { useConfirmStore } from '../store/useConfirmStore';
import { MoveDeckModal } from './MoveDeckModal';
import { ContextMenu } from './ContextMenu';
import type { MenuItem } from './ContextMenu';
import type { FolderNode, Deck } from '../types/electron';

interface CtxMenuState { x: number; y: number; items: MenuItem[] }

type DragItem = { type: 'folder' | 'deck'; id: number } | null;
/** null = no active target; 'root' = My Decks root; number = a folder id */
type DropTargetId = number | 'root' | null;

// ─── Inline Rename ────────────────────────────────────────────────────────────

function InlineRename({ initialValue, onConfirm, onCancel }: {
  initialValue: string;
  onConfirm: (v: string) => void;
  onCancel: () => void;
}) {
  const [val, setVal] = useState(initialValue);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => { ref.current?.focus(); ref.current?.select(); }, 30);
    return () => clearTimeout(t);
  }, []);

  const commit = () => { val.trim() ? onConfirm(val.trim()) : onCancel(); };

  return (
    <input
      ref={ref}
      value={val}
      onChange={e => setVal(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
      }}
      onClick={e => e.stopPropagation()}
      className="flex-1 min-w-0 bg-surface-container border border-primary/50 rounded px-1.5 py-0.5 text-on-surface focus:outline-none"
      style={{ fontSize: 13 }}
    />
  );
}

// ─── Tree helpers ─────────────────────────────────────────────────────────────

/** True if `node` contains a folder with `targetId` anywhere in its subtree. */
function folderContains(node: FolderNode, targetId: number): boolean {
  if (node.id === targetId) return true;
  return node.children.some(c => folderContains(c, targetId));
}

function findFolderNode(folders: FolderNode[], id: number): FolderNode | null {
  for (const f of folders) {
    if (f.id === id) return f;
    const found = findFolderNode(f.children, id);
    if (found) return found;
  }
  return null;
}

// ─── Context ──────────────────────────────────────────────────────────────────

type RenameTarget =
  | { type: 'folder'; id: number; name: string }
  | { type: 'deck';   id: number; name: string };

interface TreeCtx {
  decksByFolder: Map<number | '__root__', Deck[]>;
  renaming: RenameTarget | null;
  openCtx: (e: React.MouseEvent, items: MenuItem[]) => void;
  confirmRenameFolder: (id: number, name: string) => void;
  confirmRenameDeck: (id: number, name: string) => void;
  cancelRename: () => void;
  startRenameFolder: (id: number, name: string) => void;
  startRenameDeck: (id: number, name: string) => void;
  deleteFolder: (id: number) => void;
  deleteDeck: (id: number, name: string) => void;
  onNewFolder: (parentId: number | null) => void;
  onNewDeck: (folderId: number | null) => void;
  onMoveDeck: (id: number, name: string) => void;
  onDuplicateDeck: (id: number) => void;
  // Drag & drop
  dragItem: DragItem;
  dropTargetId: DropTargetId;
  allFolders: FolderNode[];
  onDragStart: (type: 'folder' | 'deck', id: number, e: React.DragEvent) => void;
  onDragEnd: () => void;
  onDragOverTarget: (targetId: number | 'root', e: React.DragEvent) => void;
  onDropOnTarget: (targetId: number | 'root') => void;
  clearDropTarget: () => void;
}

const TreeContext = createContext<TreeCtx>({} as TreeCtx);

// ─── DeckItem ─────────────────────────────────────────────────────────────────

function DeckItem({ deck }: { deck: Deck }) {
  const ctx = useContext(TreeContext);
  const navigate = useNavigate();
  const isRenaming = ctx.renaming?.type === 'deck' && ctx.renaming.id === deck.id;
  const isDragging = ctx.dragItem?.type === 'deck' && ctx.dragItem.id === deck.id;

  const menuItems: MenuItem[] = [
    { label: 'Open',            icon: 'open_in_new',              onClick: () => navigate(`/deck/${deck.id}`) },
    { label: 'Rename',          icon: 'drive_file_rename_outline', onClick: () => ctx.startRenameDeck(deck.id, deck.name) },
    { label: 'Duplicate',       icon: 'content_copy',             onClick: () => ctx.onDuplicateDeck(deck.id) },
    { label: 'Move to Folder…', icon: 'drive_file_move',          onClick: () => ctx.onMoveDeck(deck.id, deck.name) },
    { divider: true },
    { label: 'Delete', icon: 'delete_outline', danger: true, onClick: () => ctx.deleteDeck(deck.id, deck.name) },
  ];

  return (
    <div
      draggable={!isRenaming}
      onDragStart={e => ctx.onDragStart('deck', deck.id, e)}
      onDragEnd={ctx.onDragEnd}
      onContextMenu={e => ctx.openCtx(e, menuItems)}
      style={{ opacity: isDragging ? 0.4 : undefined }}
    >
      {isRenaming ? (
        <div className="flex items-center px-3 py-1.5">
          <span className="material-symbols-outlined mr-2 flex-shrink-0 text-primary/50" style={{ fontSize: 15 }}>style</span>
          <InlineRename
            initialValue={ctx.renaming!.name}
            onConfirm={v => ctx.confirmRenameDeck(deck.id, v)}
            onCancel={ctx.cancelRename}
          />
        </div>
      ) : (
        <NavLink
          to={`/deck/${deck.id}`}
          className={({ isActive }) =>
            `flex items-center px-3 py-1.5 rounded-md transition-all ${
              isActive ? 'tree-item-active' : 'hover:bg-white/5 text-on-surface-variant/70'
            }`
          }
        >
          <span
            className="material-symbols-outlined mr-2 flex-shrink-0"
            style={{
              fontSize: 15,
              fontVariationSettings: deck.is_favorite ? "'FILL' 1" : "'FILL' 0",
              color: deck.is_favorite ? 'var(--color-primary, #a78bfa)' : undefined,
            }}
          >
            {deck.is_favorite ? 'star' : 'style'}
          </span>
          <span className="truncate flex-1" style={{ fontSize: 13 }}>{deck.name}</span>
        </NavLink>
      )}
    </div>
  );
}

// ─── FolderRow ─ the draggable/droppable header row for a folder ──────────────

function FolderItem({ folder }: { folder: FolderNode }) {
  const ctx = useContext(TreeContext);
  const [isOpen, setIsOpen] = useState(true);

  const isRenaming   = ctx.renaming?.type === 'folder' && ctx.renaming.id === folder.id;
  const folderDecks  = ctx.decksByFolder.get(folder.id) || [];
  const hasChildren  = folder.children.length > 0 || folderDecks.length > 0;
  const isDragging   = ctx.dragItem?.type === 'folder' && ctx.dragItem.id === folder.id;
  const isDropTarget = ctx.dropTargetId === folder.id;

  /**
   * A drop is legal if:
   * - Something is being dragged
   * - We are not dropping a folder onto itself
   * - We are not dropping a folder onto one of its own descendants (would create a cycle)
   */
  const canAcceptDrop = useMemo(() => {
    if (!ctx.dragItem) return false;
    if (ctx.dragItem.type === 'folder') {
      if (ctx.dragItem.id === folder.id) return false;
      const dragged = findFolderNode(ctx.allFolders, ctx.dragItem.id);
      if (dragged && folderContains(dragged, folder.id)) return false;
    }
    return true;
  }, [ctx.dragItem, ctx.allFolders, folder.id]);

  const menuItems: MenuItem[] = [
    { label: 'New Subfolder', icon: 'create_new_folder',          onClick: () => ctx.onNewFolder(folder.id) },
    { label: 'New Deck Here', icon: 'add_circle',                  onClick: () => ctx.onNewDeck(folder.id) },
    { divider: true },
    { label: 'Rename',        icon: 'drive_file_rename_outline',   onClick: () => ctx.startRenameFolder(folder.id, folder.name) },
    { label: 'Delete Folder', icon: 'delete_outline', danger: true, onClick: () => ctx.deleteFolder(folder.id) },
  ];

  // ── DnD on the row div (both drag source and drop target) ──────────────────
  const handleDragStart = (e: React.DragEvent) => {
    e.stopPropagation(); // don't bubble to a parent folder's drag handler
    ctx.onDragStart('folder', folder.id, e);
  };

  const handleDragEnd = (e: React.DragEvent) => {
    e.stopPropagation();
    ctx.onDragEnd();
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.stopPropagation(); // prevent parent folder from lighting up simultaneously
    if (canAcceptDrop) {
      ctx.onDragOverTarget(folder.id, e); // calls e.preventDefault() inside
    } else {
      // Hovering over an invalid target — clear any stale highlight
      e.preventDefault(); // still need to allow dragover to prevent "forbidden" cursor
      ctx.clearDropTarget();
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (canAcceptDrop) ctx.onDropOnTarget(folder.id);
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ opacity: isDragging ? 0.4 : undefined }}>

      {/* ── Header row ── */}
      <div
        draggable={!isRenaming}
        className={[
          'flex items-center px-3 py-1.5 rounded-md select-none transition-all',
          isDropTarget ? 'ring-2 ring-primary/50 bg-primary/10' : 'hover:bg-white/5 cursor-pointer',
        ].join(' ')}
        onClick={() => { if (!isRenaming) setIsOpen(o => !o); }}
        onContextMenu={e => ctx.openCtx(e, menuItems)}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {/* Disclosure chevron — rotates 90° when open */}
        <span
          className="material-symbols-outlined mr-1 flex-shrink-0 text-on-surface-variant/30 transition-transform duration-150"
          style={{ fontSize: 15, transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}
        >
          chevron_right
        </span>

        <span className="material-symbols-outlined mr-2 flex-shrink-0 text-on-surface-variant/50" style={{ fontSize: 15 }}>
          folder
        </span>

        {isRenaming ? (
          <InlineRename
            initialValue={ctx.renaming!.name}
            onConfirm={v => ctx.confirmRenameFolder(folder.id, v)}
            onCancel={ctx.cancelRename}
          />
        ) : (
          <span className="flex-1 truncate text-on-surface-variant/80" style={{ fontSize: 13 }}>
            {folder.name}
          </span>
        )}

        {isDropTarget && (
          <span className="material-symbols-outlined ml-auto flex-shrink-0 text-primary/60" style={{ fontSize: 13 }}>
            move_to_inbox
          </span>
        )}
      </div>

      {/* ── Children ── */}
      {isOpen && hasChildren && (
        <div className="ml-4 pl-3 border-l border-white/5 space-y-0.5 mt-0.5">
          {folder.children.map(child => <FolderItem key={child.id} folder={child} />)}
          {folderDecks.map(deck => <DeckItem key={deck.id} deck={deck} />)}
        </div>
      )}
    </div>
  );
}

// ─── FolderTree (root) ────────────────────────────────────────────────────────

interface FolderTreeProps {
  onNewFolder: (parentId: number | null) => void;
  onNewDeck: (folderId: number | null) => void;
}

export function FolderTree({ onNewFolder, onNewDeck }: FolderTreeProps) {
  const {
    folders, decks,
    renameFolder, deleteFolder, updateDeck, deleteDeck, duplicateDeck,
    reloadLibrary, moveFolder,
  } = useLibraryStore();

  const [ctxMenu,      setCtxMenu]      = useState<CtxMenuState | null>(null);
  const [renaming,     setRenaming]     = useState<RenameTarget | null>(null);
  const [moveModal,    setMoveModal]    = useState<{ deckId: number; deckName: string } | null>(null);
  const [dragItem,     setDragItem]     = useState<DragItem>(null);
  const [dropTargetId, setDropTargetId] = useState<DropTargetId>(null);

  const navigate = useNavigate();
  const location = useLocation();

  // Group decks by folder_id — rebuilt only when decks change
  const decksByFolder = useMemo(() => {
    const map = new Map<number | '__root__', Deck[]>();
    for (const d of decks) {
      const key = (d.folder_id ?? '__root__') as number | '__root__';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(d);
    }
    return map;
  }, [decks]);
  const rootDecks = decksByFolder.get('__root__') || [];

  const openCtx = useCallback((e: React.MouseEvent, items: MenuItem[]) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, items });
  }, []);

  const rootMenuItems: MenuItem[] = [
    { label: 'New Folder', icon: 'create_new_folder', onClick: () => onNewFolder(null) },
    { label: 'New Deck',   icon: 'add_circle',         onClick: () => onNewDeck(null) },
  ];

  // ─── DnD handlers ───────────────────────────────────────────────────────────

  const handleDragStart = useCallback((type: 'folder' | 'deck', id: number, e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', JSON.stringify({ type, id }));
    setDragItem({ type, id });
  }, []);

  const handleDragEnd = useCallback(() => {
    setDragItem(null);
    setDropTargetId(null);
  }, []);

  const handleDragOverTarget = useCallback((targetId: number | 'root', e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropTargetId(prev => prev === targetId ? prev : targetId);
  }, []);

  const clearDropTarget = useCallback(() => {
    setDropTargetId(null);
  }, []);

  const handleDropOnTarget = useCallback(async (targetId: number | 'root') => {
    if (!dragItem) return;
    // Capture and clear state BEFORE async op — don't rely on dragend
    // because React may unmount the drag source node during the tree reload.
    const item = dragItem;
    setDragItem(null);
    setDropTargetId(null);

    const folderId = targetId === 'root' ? null : (targetId as number);
    if (item.type === 'deck') {
      await updateDeck({ id: item.id, folder_id: folderId });
    } else {
      await moveFolder({ id: item.id, parent_id: folderId });
    }
  }, [dragItem, updateDeck, moveFolder]);

  const isRootDropTarget = dropTargetId === 'root';
  const isDecksActive    = location.pathname === '/decks';

  // ─── Build context object ────────────────────────────────────────────────────

  const ctx = useMemo<TreeCtx>(() => ({
    decksByFolder,
    renaming,
    openCtx,
    startRenameFolder: (id, name) => setRenaming({ type: 'folder', id, name }),
    startRenameDeck:   (id, name) => setRenaming({ type: 'deck',   id, name }),
    cancelRename: () => setRenaming(null),
    confirmRenameFolder: async (id, name) => {
      setRenaming(null);
      await renameFolder({ id, name });
    },
    confirmRenameDeck: async (id, name) => {
      setRenaming(null);
      await updateDeck({ id, name });
    },
    deleteFolder: (id) => {
      useConfirmStore.getState().show({
        title: 'Delete Folder',
        message: 'Decks inside will be moved to root. This cannot be undone.',
        danger: true,
        confirmLabel: 'Delete',
        onConfirm: async () => { await deleteFolder({ id }); },
      });
    },
    deleteDeck: (id, name) => {
      useConfirmStore.getState().show({
        title: 'Delete Deck',
        message: `Delete "${name}"? This cannot be undone.`,
        danger: true,
        confirmLabel: 'Delete',
        onConfirm: async () => { await deleteDeck({ id }); },
      });
    },
    onNewFolder,
    onNewDeck,
    onMoveDeck:      (id, name) => setMoveModal({ deckId: id, deckName: name }),
    onDuplicateDeck: async (id) => { await duplicateDeck({ id }); },
    // DnD
    dragItem,
    dropTargetId,
    allFolders: folders,
    onDragStart:     handleDragStart,
    onDragEnd:       handleDragEnd,
    onDragOverTarget: handleDragOverTarget,
    onDropOnTarget:  handleDropOnTarget,
    clearDropTarget,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [
    decksByFolder, renaming, openCtx,
    renameFolder, updateDeck, deleteFolder, deleteDeck, duplicateDeck,
    onNewFolder, onNewDeck,
    dragItem, dropTargetId, folders,
    handleDragStart, handleDragEnd, handleDragOverTarget, handleDropOnTarget, clearDropTarget,
  ]);

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <TreeContext.Provider value={ctx}>

      {/* ── "My Decks" root row ── */}
      <div
        className={[
          'flex items-center px-3 py-1.5 rounded-md cursor-pointer select-none transition-all',
          isDecksActive    ? 'tree-item-active' : 'hover:bg-white/5',
          isRootDropTarget ? 'ring-2 ring-primary/50 bg-primary/10' : '',
        ].join(' ')}
        onClick={() => navigate('/decks')}
        onContextMenu={e => openCtx(e, rootMenuItems)}
        onDragOver={e => {
          if (dragItem) {
            e.stopPropagation();
            handleDragOverTarget('root', e);
          }
        }}
        onDrop={e => {
          if (dragItem) {
            e.stopPropagation();
            e.preventDefault();
            handleDropOnTarget('root');
          }
        }}
      >
        {/* Arrow — always pointing down (root is always expanded) */}
        <span
          className="material-symbols-outlined mr-1 flex-shrink-0 text-on-surface-variant/30"
          style={{ fontSize: 16, transform: 'rotate(90deg)' }}
        >
          chevron_right
        </span>
        <span
          className="material-symbols-outlined mr-2 flex-shrink-0 text-on-surface-variant/60"
          style={{ fontSize: 16, fontVariationSettings: "'FILL' 1" }}
        >
          folder_special
        </span>
        <span
          className={`flex-1 ${isDecksActive ? 'text-on-surface' : 'text-on-surface-variant'}`}
          style={{ fontSize: 13 }}
        >
          My Decks
        </span>
        {isRootDropTarget && (
          <span className="material-symbols-outlined ml-auto flex-shrink-0 text-primary/60" style={{ fontSize: 13 }}>
            move_to_inbox
          </span>
        )}
      </div>

      {/* ── Children ── */}
      <div className="ml-4 pl-3 border-l border-white/5 space-y-0.5 mt-0.5">
        {folders.map(folder => <FolderItem key={folder.id} folder={folder} />)}
        {rootDecks.map(deck => <DeckItem key={deck.id} deck={deck} />)}
      </div>

      {ctxMenu && (
        <ContextMenu x={ctxMenu.x} y={ctxMenu.y} items={ctxMenu.items} onClose={() => setCtxMenu(null)} />
      )}

      <MoveDeckModal
        isOpen={!!moveModal}
        deckId={moveModal?.deckId ?? null}
        deckName={moveModal?.deckName ?? ''}
        onClose={() => setMoveModal(null)}
        onMoved={reloadLibrary}
      />
    </TreeContext.Provider>
  );
}
