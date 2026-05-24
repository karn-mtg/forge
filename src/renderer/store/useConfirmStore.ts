import { create } from 'zustand';

export type ConfirmSize = 'sm' | 'md' | 'lg';

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  /** Dialog width: sm=320px md=400px lg=480px (default: md) */
  size?: ConfirmSize;
  onConfirm: () => void | Promise<void>;
  onCancel?: () => void;
}

interface ConfirmStore {
  isOpen: boolean;
  options: ConfirmOptions | null;
  /** Open the confirmation dialog with the given options. */
  show: (opts: ConfirmOptions) => void;
  /** Call this from the Confirm button — runs onConfirm, closes dialog, does NOT call onCancel. */
  confirm: () => Promise<void>;
  /** Call this from Cancel / backdrop / Escape — closes dialog, calls onCancel if provided. */
  dismiss: () => void;
}

export const useConfirmStore = create<ConfirmStore>((set, get) => ({
  isOpen: false,
  options: null,

  show: (opts) => set({ isOpen: true, options: opts }),

  confirm: async () => {
    const opts = get().options;
    // Close first so the dialog hides immediately, then run the async callback.
    set({ isOpen: false, options: null });
    if (opts?.onConfirm) await opts.onConfirm();
  },

  dismiss: () => {
    const opts = get().options;
    set({ isOpen: false, options: null });
    opts?.onCancel?.();
  },
}));
