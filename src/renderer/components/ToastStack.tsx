import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useToastStore } from '../store/useToastStore';
import type { Toast, ToastType } from '../store/useToastStore';

// ─── Icon resolution ──────────────────────────────────────────────────────────

interface IconConfig { name: string; colorClass: string; filled: boolean }

function typeColorClass(type: ToastType): string {
  switch (type) {
    case 'success':  return 'text-primary';
    case 'error':    return 'text-red-400';
    case 'info':     return 'text-blue-400';
    case 'warning':  return 'text-yellow-400';
    case 'progress': return 'text-primary';
  }
}

function resolveIcon(toast: Toast): IconConfig {
  const colorClass = typeColorClass(toast.type);
  if (toast.icon) return { name: toast.icon, colorClass, filled: false };
  switch (toast.type) {
    case 'success':  return { name: 'check_circle', colorClass, filled: true };
    case 'error':    return { name: 'error',        colorClass, filled: true };
    case 'info':     return { name: 'info',         colorClass, filled: true };
    case 'warning':  return { name: 'warning',      colorClass, filled: true };
    case 'progress': return { name: 'sync',         colorClass, filled: false };
  }
}

// ─── Border accent per type ───────────────────────────────────────────────────

function accentBorder(type: ToastType): string {
  switch (type) {
    case 'success':  return 'border-primary/20';
    case 'error':    return 'border-red-500/25';
    case 'info':     return 'border-blue-500/20';
    case 'warning':  return 'border-yellow-500/20';
    case 'progress': return 'border-white/5';
  }
}

// ─── Single toast item ─────────────────────────────────────────────────────────

function ToastItem({ toast }: { toast: Toast }) {
  const [visible, setVisible] = useState(false);
  const { dismiss } = useToastStore();
  const icon = resolveIcon(toast);

  // Slide-in animation: start hidden (translate-x-8, opacity-0) → visible
  useEffect(() => {
    const id = requestAnimationFrame(() =>
      requestAnimationFrame(() => setVisible(true))
    );
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div
      className={`glass-panel rounded-xl shadow-2xl min-w-[300px] max-w-[360px] border ${accentBorder(toast.type)} transition-all duration-300 origin-bottom-right ${
        visible ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-8'
      }`}
    >
      <div className="px-5 py-4">
        {/* Header row: icon + title + dismiss button */}
        <div className="flex items-start gap-3">
          <span
            className={`material-symbols-outlined text-[20px] mt-0.5 flex-shrink-0 ${icon.colorClass} ${
              toast.spinIcon ? 'animate-spin' : ''
            }`}
            style={{
              fontVariationSettings: icon.filled ? "'FILL' 1" : "'FILL' 0",
            }}
          >
            {icon.name}
          </span>

          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <p className="text-label-md text-on-surface font-bold leading-snug">
                {toast.title}
              </p>
              {toast.dismissible !== false && (
                <button
                  onClick={() => dismiss(toast.id)}
                  className="flex-shrink-0 -mt-0.5 ml-1 text-on-surface-variant/30 hover:text-on-surface-variant/70 transition-colors"
                  aria-label="Dismiss"
                >
                  <span className="material-symbols-outlined text-[16px]">close</span>
                </button>
              )}
            </div>
            {toast.message && (
              <p className="text-[11px] text-on-surface-variant/55 mt-0.5 leading-relaxed">
                {toast.message}
              </p>
            )}
          </div>
        </div>

        {/* Progress bar — always for type=progress, or when progress prop is set */}
        {(toast.type === 'progress' || toast.progress !== undefined) && (
          <div className="mt-3 h-1.5 w-full bg-surface-container rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-300"
              style={{ width: `${toast.progress ?? 0}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Toast stack (portal, bottom-right) ──────────────────────────────────────

/**
 * Global toast stack driven by `useToastStore`.
 * Mount once in AppLayout. Trigger toasts from anywhere via:
 *   useToastStore.getState().push({ type, title, message })
 *
 * Toast types: 'success' | 'error' | 'info' | 'warning' | 'progress'
 * Progress toasts can be updated in-place via useToastStore.getState().update(id, patch).
 */
export function ToastStack() {
  const { toasts } = useToastStore();

  if (toasts.length === 0) return null;

  return createPortal(
    <div className="fixed bottom-6 right-6 z-[200] flex flex-col gap-3 items-end pointer-events-none">
      {toasts.map(toast => (
        <div key={toast.id} className="pointer-events-auto">
          <ToastItem toast={toast} />
        </div>
      ))}
    </div>,
    document.body
  );
}
