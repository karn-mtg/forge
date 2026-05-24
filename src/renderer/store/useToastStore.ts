import { create } from 'zustand';

export type ToastType = 'success' | 'error' | 'info' | 'warning' | 'progress';

export interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  // ── progress extras ──────────────────────────────────────────────────────────
  /** 0–100; shows a progress bar when present (always shown for type="progress") */
  progress?: number;
  /** Material Symbols icon name (overrides per-type default) */
  icon?: string;
  /** Applies animate-spin to the icon */
  spinIcon?: boolean;
  // ── lifecycle ────────────────────────────────────────────────────────────────
  /** Auto-dismiss after N ms. 0 = sticky. Omit to use the per-type default. */
  duration?: number;
  /** Show the × dismiss button (default: true) */
  dismissible?: boolean;
}

interface ToastStore {
  toasts: Toast[];
  /** Add a toast. Optionally supply a fixed `id` (useful for update-in-place). Returns the id. */
  push: (toast: Omit<Toast, 'id'> & { id?: string }) => string;
  /** Patch an existing toast by id (useful for progress updates). */
  update: (id: string, patch: Partial<Omit<Toast, 'id'>>) => void;
  /** Remove a toast by id. */
  dismiss: (id: string) => void;
  /** Remove all toasts. */
  clear: () => void;
}

let _seq = 0;

function defaultDuration(type: ToastType): number {
  switch (type) {
    case 'success':  return 4000;
    case 'info':     return 5000;
    case 'warning':  return 6000;
    case 'error':    return 0;       // sticky — user must dismiss
    case 'progress': return 0;       // sticky — caller dismisses when done
  }
}

export const useToastStore = create<ToastStore>((set, get) => ({
  toasts: [],

  push: (toast) => {
    const id = toast.id ?? `t${++_seq}-${Date.now()}`;
    const full: Toast = { dismissible: true, ...toast, id };
    set(s => ({ toasts: [...s.toasts, full] }));

    const duration = full.duration ?? defaultDuration(full.type);
    if (duration > 0) {
      setTimeout(() => get().dismiss(id), duration);
    }
    return id;
  },

  update: (id, patch) => {
    set(s => ({
      toasts: s.toasts.map(t => t.id === id ? { ...t, ...patch } : t),
    }));
  },

  dismiss: (id) => {
    set(s => ({ toasts: s.toasts.filter(t => t.id !== id) }));
  },

  clear: () => set({ toasts: [] }),
}));
