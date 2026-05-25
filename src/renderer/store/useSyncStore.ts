import { create } from 'zustand';
import { useToastStore } from './useToastStore';

/** Fixed toast id so we can update-in-place instead of stacking multiple sync toasts. */
const SYNC_TOAST_ID = 'kf-sync';

interface SyncState {
  isSyncing: boolean;
  /** Current sync phase label (e.g. "Downloading", "Parsing"). Empty when idle. */
  phase: string;
  /** 0–100 progress percentage. 0 when idle or indeterminate. */
  progress: number;
  /** Human-readable detail string (card count, message). Empty when idle. */
  detail: string;
  startSync: (refresh?: boolean) => void;
}

export const useSyncStore = create<SyncState>((set) => ({
  isSyncing: false,
  phase: '',
  progress: 0,
  detail: '',

  startSync: (refresh = false) => {
    set({ isSyncing: true, phase: 'Starting…', progress: 0, detail: '' });

    const { push, update, dismiss } = useToastStore.getState();

    // Initial progress toast (sticky, not dismissible while running)
    push({
      id: SYNC_TOAST_ID,
      type: 'progress',
      title: 'Syncing…',
      icon: 'sync',
      spinIcon: true,
      progress: 0,
      dismissible: false,
      duration: 0,
    });

    const unsubscribe = window.cardsAPI.onProgress(({ phase, count, total, message }) => {
      const pct = total && count ? Math.min(100, Math.round((count / total) * 100)) : 0;
      const phaseLabel = phase
        ? phase.charAt(0).toUpperCase() + phase.slice(1)
        : 'Working…';
      const detail = message || (count ? `${count.toLocaleString()} cards` : '');

      if (phase === 'done' || phase === 'error') {
        if (typeof unsubscribe === 'function') unsubscribe();

        if (phase === 'done') {
          try {
            window.settingsAPI?.set({ lastSyncedAt: new Date().toISOString() });
          } catch { /* ignore */ }

          set({ isSyncing: false, phase: 'Done', progress: 100, detail });
          update(SYNC_TOAST_ID, {
            type: 'success',
            title: 'Sync Complete!',
            message: detail || 'Card database is up to date.',
            icon: 'check_circle',
            spinIcon: false,
            progress: 100,
            dismissible: true,
            // duration intentionally omitted — the explicit setTimeout below is the only dismiss path
          });
          // Auto-dismiss after 4 s then clear store state
          setTimeout(() => {
            dismiss(SYNC_TOAST_ID);
            set({ phase: '', progress: 0, detail: '' });
          }, 4000);
        } else {
          set({ isSyncing: false, phase: 'Error', progress: 0, detail });
          update(SYNC_TOAST_ID, {
            type: 'error',
            title: 'Sync Failed',
            message: detail || 'An error occurred during sync.',
            icon: 'error',
            spinIcon: false,
            dismissible: true,
            duration: 0, // sticky — user should see the error
          });
        }
      } else {
        // In-progress update
        set({ phase: phaseLabel, progress: pct, detail });
        update(SYNC_TOAST_ID, {
          title: phaseLabel,
          message: detail,
          progress: pct,
        });
      }
    });

    window.cardsAPI.startSync({ refresh });
  },
}));
