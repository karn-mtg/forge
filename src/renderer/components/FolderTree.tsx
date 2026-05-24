import { useState, useEffect, useRef, createContext, useContext } from 'react';
import { createPortal } from 'react-dom';
import { NavLink, useNavigate } from 'react-router-dom';
import { useLibraryStore } from '../store/useLibraryStore';
import { useConfirmStore } from '../store/useConfirmStore';
import { MoveDeckModal } from './MoveDeckModal';
import type { FolderNode, Deck } from '../types/electron';

// ─── Context Menu ─────────────────────────────────────────────────────────────

interface MenuItem {
  label?: string;
  icon?: string;
  onClick?: () => void;
  danger?: boolean;
  divider?: boolean;
}

interface CtxMenuState { x: number; y: number; items: MenuItem[] }

function ContextMenu({ state, onClose }: { state: CtxMenuState; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: state.x, y: state.y });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos({
      x: state.x + rect.width > window.innerWidth ? Math.max(4, window.innerWidth - rect.width - 4) : state.x,
      y: state.y + rect.height > window.innerHeight ? Math.max(4, window.innerHeight - rect.height - 4) : state.y,
    });
  }, [state.x, state.y]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      className="fixed z-[9999] min-w-[176px] rounded-lg py-1 shadow-2xl border border-white/10 overflow-hidden"
      style={{ left: pos.x, top: pos.y, background: 'rgba(28,31,38,0.98)', backdropFilter: 'blur(20px)' }}
    >
      {state.items.map((item, i) =>
        item.divider ? (
          <div key={i} className="my-1 border-t border-white/8" />
        ) : (
          <button
            key={i}
            onClick={() => { item.onClick?.(); onClose(); }}
            className={`w-full flex items-center gap-2.5 px-3 py-[6px] hover:bg-white/8 transition-colors text-left ${
              item.danger ? 'text-red-400/90 hover:text-red-300' : 'text-on-surface-variant hover:text-on-surface'
            }`}
          >
            {item.icon && (
              <span className="material-symbols-outlined flex-shrink-0" style={{ fontSize: 14 }}>{item.icon}</span>
            )}
            <span style={{ fontSize: 13 }}>{item.label}</span>
          </button>
        )
      )}
    </div>,
    document.body
  );
}

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
          <span className="material-symbols-outlined mr-2 flex-shrink-0" style={{ fontSize: 15 }}>style</span>
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

  // Group decks by folder_id
  const decksByFolder = new Map<number | '__root__', Deck[]>();
  for (const d of decks) {
    const key = (d.folder_id ?? '__root__') as number | '__root__';
    if (!decksByFolder.has(key)) decksByFolder.set(key, []);
    decksByFolder.get(key)!.push(d);
  }
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

  const ctx: TreeCtx = {
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
  };

  return (
    <TreeContext.Provider value={ctx}>
      <details open>
        <summary
          className="flex items-center px-3 py-1.5 hover:bg-white/5 rounded-md cursor-pointer select-none transition-colors list-none"
          onContextMenu={e => openCtx(e, rootMenuItems)}
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
          <span className="flex-1 text-on-surface-variant" style={{ fontSize: 13 }}>My Collections</span>
        </summary>

        <div className="ml-4 pl-3 border-l border-white/5 space-y-0.5 mt-0.5">
          {folders.map(folder => <FolderItem key={folder.id} folder={folder} />)}
          {rootDecks.map(deck => <DeckItem key={deck.id} deck={deck} />)}
        </div>
      </details>

      {ctxMenu && <ContextMenu state={ctxMenu} onClose={() => setCtxMenu(null)} />}

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
