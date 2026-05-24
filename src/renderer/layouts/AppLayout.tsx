import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from '../components/Sidebar';
import { ToastStack } from '../components/ToastStack';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useLibraryStore } from '../store/useLibraryStore';

export function AppLayout() {
  const { loadLibrary, isLoaded } = useLibraryStore();

  useEffect(() => {
    if (!isLoaded) loadLibrary();
  }, [isLoaded, loadLibrary]);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="ml-[280px] flex-1 overflow-auto">
        <Outlet />
      </div>

      {/* Global portals — always centred / anchored regardless of page scroll */}
      <ToastStack />
      <ConfirmDialog />
    </div>
  );
}
