import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { TrafficLights } from './TrafficLights';
import { FolderTree } from './FolderTree';
import { NewDeckModal } from './NewDeckModal';
import { NewFolderModal } from './NewFolderModal';
import { useSyncStore } from '../store/useSyncStore';

const NAV_ITEMS = [
  { to: '/decks',      icon: 'grid_view',   label: 'All Decks'  },
  { to: '/collection', icon: 'inventory_2', label: 'Collection' },
  { to: '/wishlist',   icon: 'bookmark',    label: 'Wishlist'   },
  { to: '/favorites',  icon: 'star',        label: 'Favorites'  },
  { to: '/recents',    icon: 'schedule',    label: 'Recents'    },
  { to: '/widgets',    icon: 'widgets',     label: 'Widgets'    },
];

export function Sidebar() {
  // folderId: null = root, number = specific folder, undefined = modal closed
  const [newDeckFolderId, setNewDeckFolderId] = useState<number | null | undefined>(undefined);
  const [newFolderParentId, setNewFolderParentId] = useState<number | null | undefined>(undefined);
  const { isSyncing, startSync } = useSyncStore();

  const openNewDeck = (folderId: number | null) => setNewDeckFolderId(folderId);
  const openNewFolder = (parentId: number | null) => setNewFolderParentId(parentId);

  return (
    <>
      <aside className="fixed h-screen w-[280px] left-0 top-0 glass-sidebar border-r border-white/5 z-50 flex flex-col">
        <TrafficLights />

        <div className="px-4 py-4 flex-1 overflow-y-auto">
          {/* Logo */}
          <div className="flex items-center gap-3 mb-8 px-2">
            <img src="/biglogo.png" alt="Karn Forge" className="w-54" />
          </div>

          <nav className="space-y-0.5">
            {/* Dashboard */}
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                `flex items-center px-3 py-1.5 rounded-md transition-all text-body-md ${
                  isActive ? 'tree-item-active' : 'hover:bg-white/5 text-on-surface-variant'
                }`
              }
            >
              <span className="material-symbols-outlined mr-2 text-[18px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                dashboard
              </span>
              <span>Dashboard</span>
            </NavLink>

            {/* Library */}
            <div className="pt-4 pb-1 px-3">
              <p className="font-label-sm text-[10px] uppercase tracking-widest text-outline/40 font-bold">Library</p>
            </div>
            <FolderTree onNewFolder={openNewFolder} onNewDeck={openNewDeck} />

            {/* Preferences */}
            <div className="pt-6 pb-1 px-3">
              <p className="font-label-sm text-[10px] uppercase tracking-widest text-outline/40 font-bold">Preferences</p>
            </div>
            {NAV_ITEMS.map(({ to, icon, label }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  `flex items-center px-3 py-1.5 rounded-md transition-all text-body-md ${
                    isActive ? 'tree-item-active' : 'hover:bg-white/5 text-on-surface-variant'
                  }`
                }
              >
                <span className="material-symbols-outlined mr-2 text-[18px]">{icon}</span>
                <span>{label}</span>
              </NavLink>
            ))}
          </nav>
        </div>

        {/* Bottom actions */}
        <div className="p-4 border-t border-white/5 space-y-2">
          <button
            onClick={() => openNewDeck(null)}
            className="w-full bg-primary/10 text-primary border border-primary/20 py-2.5 rounded-lg font-bold flex items-center justify-center gap-2 hover:bg-primary/20 transition-all active:scale-[0.98]"
          >
            <span className="material-symbols-outlined text-[20px]">add_circle</span>
            <span className="text-label-md">New Deck</span>
          </button>
          <button
            onClick={() => startSync()}
            disabled={isSyncing}
            className="w-full bg-surface/50 text-on-surface-variant border border-white/5 py-2 rounded-lg flex items-center justify-center gap-2 hover:bg-white/5 transition-all active:scale-[0.98] text-label-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span className={`material-symbols-outlined text-[16px] ${isSyncing ? 'animate-spin' : ''}`}>sync</span>
            <span>{isSyncing ? 'Syncing…' : 'Sync Cards'}</span>
          </button>
        </div>
      </aside>

      <NewDeckModal
        isOpen={newDeckFolderId !== undefined}
        defaultFolderId={newDeckFolderId ?? null}
        onClose={() => setNewDeckFolderId(undefined)}
      />
      <NewFolderModal
        isOpen={newFolderParentId !== undefined}
        parentId={newFolderParentId ?? null}
        onClose={() => setNewFolderParentId(undefined)}
      />
    </>
  );
}
