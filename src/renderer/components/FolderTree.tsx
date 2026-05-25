import { useState, useEffect, useRef, useMemo, createContext, useContext } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useLibraryStore } from '../store/useLibraryStore';
import { useConfirmStore } from '../store/useConfirmStore';
import { MoveDeckModal } from './MoveDeckModal';
import { ContextMenu } from './ContextMenu';
import type { MenuItem } from './ContextMenu';
import type { FolderNode, Deck } from '../types/electron';

interface CtxMenuState { x: number; y: number; items: MenuItem[] }

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

// ─── Shared tree state via context ────────────────────────────────────────────

type RenameTarget =
  | { type: 'folder'; id: number; name: string }
  | { type: 'deck'; id: number; name: string };

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
}

const TreeContext = createContext<TreeCtx>({} as TreeCtx);

// ─── DeckItem ─────────────────────────────────────────────────────────────────

function DeckItem({ deck }: { deck: Deck }) {
  const ctx = useContext(TreeContext);
  const navigate = useNavigate();
  const isRenaming = ctx.renaming?.type === 'deck' && ctx.renaming.id === deck.id;

  const menuItems: MenuItem[] = [
    { label: 'Open', icon: 'open_in_new', onClick: () => navigate(`/deck/${deck.id}`) },
    { label: 'Rename', icon: 'drive_file_rename_outline', onClick: () => ctx.startRenameDeck(deck.id, deck.name) },
    { label: 'Duplicate', icon: 'content_copy', onClick: () => ctx.onDuplicateDeck(deck.id) },
    { label: 'Move to Folder…', icon: 'drive_file_move', onClick: () => ctx.onMoveDeck(deck.id, deck.name) },
    { divider: true },
    { label: 'Delete', icon: 'delete_outline', danger: true, onClick: () => ctx.deleteDeck(deck.id, deck.name) },
  ];

  return (
    <div onContextMenu={e => ctx.openCtx(e, menuItems)}>
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
            style={{ fontSize: 15, fontVariationSettings: deck.is_favorite ? "'FILL' 1" : "'FILL' 0", color: deck.is_favorite ? 'var(--color-primary, #a78bfa)' : undefined }}
          >
            {deck.is_favorite ? 'star' : 'style'}
          </span>
          <span className="truncate flex-1" style={{ fontSize: 13 }}>{deck.name}</span>
        </NavLink>
      )}
    </div>
  );
}

// ─── FolderItem ───────────────────────────────────────────────────────────────

function FolderItem({ folder }: { folder: FolderNode }) {
  const ctx = useContext(TreeContext);
  const isRenaming = ctx.renaming?.type === 'folder' && ctx.renaming.id === folder.id;
  const folderDecks = ctx.decksByFolder.get(folder.id) || [];
  const hasChildren = folder.children.length > 0 || folderDecks.length > 0;

  const menuItems: MenuItem[] = [
    { label: 'New Subfolder', icon: 'create_new_folder', onClick: () => ctx.onNewFolder(folder.id) },
    { label: 'New Deck Here', icon: 'add_circle', onClick: () => ctx.onNewDeck(folder.id) },
    { divider: true },
    { label: 'Rename', icon: 'drive_file_rename_outline', onClick: () => ctx.startRenameFolder(folder.id, folder.name) },
    { label: 'Delete Folder', icon: 'delete_outline', danger: true, onClick: () => ctx.deleteFolder(folder.id) },
  ];

  return (
    <details open>
      <summary
        className="flex items-center px-3 py-1.5 hover:bg-white/5 rounded-md cursor-pointer select-none transition-colors list-none"
        onContextMenu={e => ctx.openCtx(e, menuItems)}
        onClick={e => { if (isRenaming) e.preventDefault(); }}
      >
        <span
          className="material-symbols-outlined mr-1 flex-shrink-0 disclosure-arrow text-on-surface-variant/30"
          style={{ fontSize: 15 }}
        >
          chevron_right
        </span>
        <span
          className="material-symbols-outlined mr-2 flex-shrink-0 text-on-surface-variant/50"
          style={{ fontSize: 15 }}
        >
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
      </summary>

      {hasChildren && (
        <div className="ml-4 pl-3 border-l border-white/5 space-y-0.5 mt-0.5">
          {folder.children.map(child => <FolderItem key={child.id} folder={child} />)}
          {folderDecks.map(deck => <DeckItem key={deck.id} deck={deck} />)}
        </div>
      )}
    </details>
  );
}

// ─── FolderTree (root) ────────────────────────────────────────────────────────

interface FolderTreeProps {
  onNewFolder: (parentId: number | null) => void;
  onNewDeck: (folderId: number | null) => void;
}

export function FolderTree({ onNewFolder, onNewDeck }: FolderTreeProps) {
  const { folders, decks, renameFolder, deleteFolder, updateDeck, deleteDeck, duplicateDeck, reloadLibrary } = useLibraryStore();
  const [ctxMenu, setCtxMenu] = useState<CtxMenuState | null>(null);
  const [renaming, setRenaming] = useState<RenameTarget | null>(null);
  const [moveModal, setMoveModal] = useState<{ deckId: number; deckName: string } | null>(null);
  const navigate = useNavigate();
  const location = useLocation();

  // Group decks by folder_id — memoized so the Map is only rebuilt when decks change
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

  const openCtx = (e: React.MouseEvent, items: MenuItem[]) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, items });
  };

  const rootMenuItems: MenuItem[] = [
    { label: 'New Folder', icon: 'create_new_folder', onClick: () => onNewFolder(null) },
    { label: 'New Deck', icon: 'add_circle', onClick: () => onNewDeck(null) },
  ];

  // Memoize the context value so child tree nodes only re-render when their
  // relevant slice of state changes, not on every Sidebar render.
  const ctx = useMemo<TreeCtx>(() => ({
    decksByFolder,
    renaming,
    openCtx,
    startRenameFolder: (id, name) => setRenaming({ type: 'folder', id, name }),
    startRenameDeck: (id, name) => setRenaming({ type: 'deck', id, name }),
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
    onMoveDeck: (id, name) => setMoveModal({ deckId: id, deckName: name }),
    onDuplicateDeck: async (id) => {
      await duplicateDeck({ id });
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [decksByFolder, renaming, openCtx, renameFolder, updateDeck, deleteFolder, deleteDeck, onNewFolder, onNewDeck, duplicateDeck]);

  const isDecksActive = location.pathname === '/decks';

  return (
    <TreeContext.Provider value={ctx}>
      <details open>
        <summary
          className={`flex items-center px-3 py-1.5 rounded-md cursor-pointer select-none transition-colors list-none ${isDecksActive ? 'tree-item-active' : 'hover:bg-white/5'}`}
          onContextMenu={e => openCtx(e, rootMenuItems)}
          onClick={e => { e.preventDefault(); navigate('/decks'); }}
        >
          <span
            className="material-symbols-outlined mr-1 flex-shrink-0 disclosure-arrow text-on-surface-variant/30"
            style={{ fontSize: 16 }}
          >
            chevron_right
          </span>
          <span
            className="material-symbols-outlined mr-2 flex-shrink-0 text-on-surface-variant/60"
            style={{ fontSize: 16, fontVariationSettings: "'FILL' 1" }}
          >
            folder_special
          </span>
          <span className={`flex-1 ${isDecksActive ? 'text-on-surface' : 'text-on-surface-variant'}`} style={{ fontSize: 13 }}>My Decks</span>
        </summary>

        <div className="ml-4 pl-3 border-l border-white/5 space-y-0.5 mt-0.5">
          {folders.map(folder => <FolderItem key={folder.id} folder={folder} />)}
          {rootDecks.map(deck => <DeckItem key={deck.id} deck={deck} />)}
        </div>
      </details>

      {ctxMenu && <ContextMenu x={ctxMenu.x} y={ctxMenu.y} items={ctxMenu.items} onClose={() => setCtxMenu(null)} />}

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
