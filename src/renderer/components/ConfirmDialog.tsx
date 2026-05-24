import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useConfirmStore } from '../store/useConfirmStore';
import type { ConfirmSize } from '../store/useConfirmStore';

const SIZE_CLASSES: Record<ConfirmSize, string> = {
  sm: 'w-[320px]',
  md: 'w-[400px]',
  lg: 'w-[480px]',
};

/**
 * Global confirmation dialog driven by `useConfirmStore`.
 * Mount once in AppLayout — any page or component can trigger it via:
 *   useConfirmStore.getState().show({ title, message, onConfirm })
 */
export function ConfirmDialog() {
  const { isOpen, options, confirm, dismiss } = useConfirmStore();
  const [visible, setVisible] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  // Drive the CSS transition: open → next frame → visible (scale/opacity in)
  useEffect(() => {
    if (isOpen) {
      // Double rAF ensures the 'from' state is painted before we apply 'to' state
      const id = requestAnimationFrame(() =>
        requestAnimationFrame(() => setVisible(true))
      );
      return () => cancelAnimationFrame(id);
    } else {
      setVisible(false);
    }
  }, [isOpen]);

  // Auto-focus the Cancel button when dialog opens (safer default for destructive actions)
  useEffect(() => {
    if (isOpen) {
      const t = setTimeout(() => cancelRef.current?.focus(), 60);
      return () => clearTimeout(t);
    }
  }, [isOpen]);

  // Keyboard: Escape = dismiss · Tab/Shift+Tab = focus trap
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { dismiss(); return; }
      if (e.key === 'Tab') {
        const focusable = [cancelRef.current, confirmRef.current].filter(Boolean) as HTMLElement[];
        if (!focusable.length) return;
        const idx = focusable.indexOf(document.activeElement as HTMLElement);
        e.preventDefault();
        focusable[(idx + (e.shiftKey ? -1 : 1) + focusable.length) % focusable.length].focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, dismiss]);

  if (!isOpen || !options) return null;

  const {
    title,
    message,
    confirmLabel = 'Confirm',
    cancelLabel  = 'Cancel',
    danger       = false,
    size         = 'md',
  } = options;

  return createPortal(
    <div
      className={`fixed inset-0 z-[500] flex items-center justify-center transition-opacity duration-200 ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={dismiss}
      />

      {/* Panel */}
      <div
        className={`relative glass-panel rounded-2xl p-6 ${SIZE_CLASSES[size]} shadow-2xl border border-white/5 transition-all duration-200 ${
          visible ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
        }`}
      >
        <h3 className="font-headline-md text-base font-bold text-on-surface mb-2">
          {title}
        </h3>
        <p className="text-body-md text-on-surface-variant/70 mb-6 leading-relaxed">
          {message}
        </p>

        <div className="flex gap-3">
          <button
            ref={cancelRef}
            onClick={dismiss}
            className="flex-1 py-2 rounded-lg border border-white/10 text-on-surface-variant hover:bg-white/5 transition-all font-bold text-label-md"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            onClick={confirm}
            className={`flex-1 py-2 rounded-lg font-bold text-label-md transition-all ${
              danger
                ? 'bg-red-500/15 text-red-400 border border-red-500/30 hover:bg-red-500/25'
                : 'bg-primary/15 text-primary border border-primary/30 hover:bg-primary/25'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
