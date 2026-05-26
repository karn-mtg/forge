import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from '../components/Sidebar';
import { ToastStack } from '../components/ToastStack';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { GlobalSearch } from '../components/GlobalSearch';
import { useLibraryStore } from '../store/useLibraryStore';
import { useGlobalSearchStore } from '../store/useGlobalSearchStore';

export function AppLayout() {
  const { loadLibrary, isLoaded } = useLibraryStore();
  const { toggle } = useGlobalSearchStore();

  useEffect(() => {
    if (!isLoaded) loadLibrary();
  }, [isLoaded, loadLibrary]);

  // Global Ctrl+K / Cmd+K shortcut
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="ml-[280px] flex-1 flex flex-col overflow-hidden">
        <Outlet />
      </div>

      {/* Global portals — always centred / anchored regardless of page scroll */}
      <ToastStack />
      <ConfirmDialog />
      <GlobalSearch />
    </div>
  );
}
