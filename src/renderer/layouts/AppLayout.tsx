import { useEffect, useState, useCallback } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { Sidebar } from '../components/Sidebar';
import { ToastStack } from '../components/ToastStack';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { GlobalSearch } from '../components/GlobalSearch';
import { useLibraryStore } from '../store/useLibraryStore';
import { useGlobalSearchStore } from '../store/useGlobalSearchStore';

function ArsenalSetupBanner() {
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(false);
  const [installed, setInstalled] = useState<boolean | null>(null);

  const check = useCallback(async () => {
    try {
      const s = await window.arsenalAPI.getStatus();
      setInstalled(s.installed);
    } catch {
      setInstalled(false);
    }
  }, []);

  useEffect(() => {
    check();
    // Re-check occasionally so the banner hides once installation finishes
    const id = setInterval(check, 8000);
    return () => clearInterval(id);
  }, [check]);

  if (dismissed || installed === null || installed) return null;

  return (
    <div className="flex items-center gap-3 px-5 py-2.5 bg-primary/8 border-b border-primary/15 text-sm">
      <span className="material-symbols-outlined text-[18px] text-primary/70 flex-shrink-0">smart_toy</span>
      <p className="flex-1 text-on-surface-variant">
        <span className="font-bold text-on-surface">Arsenal not installed.</span>
        {' '}Set it up once and Karn will handle card search, combos, and rules automatically.
      </p>
      <button
        onClick={() => navigate('/settings')}
        className="flex items-center gap-1.5 px-3 py-1 bg-primary/15 text-primary border border-primary/25 hover:bg-primary/25 transition-all font-bold rounded-lg text-[12px] flex-shrink-0"
      >
        <span className="material-symbols-outlined text-[14px]">download</span>
        Set Up Arsenal
      </button>
      <button
        onClick={() => setDismissed(true)}
        className="text-on-surface-variant/30 hover:text-on-surface-variant transition-colors flex-shrink-0"
        title="Dismiss"
      >
        <span className="material-symbols-outlined text-[18px]">close</span>
      </button>
    </div>
  );
}

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
        <ArsenalSetupBanner />
        <Outlet />
      </div>

      {/* Global portals — always centred / anchored regardless of page scroll */}
      <ToastStack />
      <ConfirmDialog />
      <GlobalSearch />
    </div>
  );
}
