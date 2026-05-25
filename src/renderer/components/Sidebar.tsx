import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { TrafficLights } from './TrafficLights';
import { FolderTree } from './FolderTree';
import { NewDeckModal } from './NewDeckModal';
import { NewFolderModal } from './NewFolderModal';
import { useGlobalSearchStore } from '../store/useGlobalSearchStore';

const BROWSE_ITEMS = [
  { to: '/recents',    icon: 'schedule',    label: 'Recents'    },
  { to: '/collection', icon: 'inventory_2', label: 'Collection' },
  { to: '/wishlist',   icon: 'bookmark',    label: 'Wishlist'   },
];

const CUSTOMIZATION_ITEMS = [
  { to: '/widgets',  icon: 'widgets',  label: 'Widgets'  },
  { to: '/settings', icon: 'settings', label: 'Settings' },
];

export function Sidebar() {
  const [newDeckFolderId, setNewDeckFolderId] = useState<number | null | undefined>(undefined);
  const [newFolderParentId, setNewFolderParentId] = useState<number | null | undefined>(undefined);
  const { open: openGlobalSearch } = useGlobalSearchStore();

  const openNewDeck = (folderId: number | null) => setNewDeckFolderId(folderId);
  const openNewFolder = (parentId: number | null) => setNewFolderParentId(parentId);

  return (
    <>
      <aside className="fixed h-screen w-[280px] left-0 top-0 glass-sidebar border-r border-white/5 z-50 flex flex-col">
        <TrafficLights />

        <div className="px-4 flex-1 overflow-y-auto">
          {/* Logo */}
          <div className="flex items-center gap-3 mb-4 px-2">
            <img src="/biglogo.png" alt="Karn Forge" className="w-[216px]" />
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

            {/* Browse */}
            <div className="pt-4 pb-1 px-3">
              <p className="font-label-sm text-[10px] uppercase tracking-widest text-outline/40 font-bold">Browse</p>
            </div>
            {BROWSE_ITEMS.map(({ to, icon, label }) => (
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

            {/* Customization */}
            <div className="pt-4 pb-1 px-3">
              <p className="font-label-sm text-[10px] uppercase tracking-widest text-outline/40 font-bold">Customization</p>
            </div>
            {CUSTOMIZATION_ITEMS.map(({ to, icon, label }) => (
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
