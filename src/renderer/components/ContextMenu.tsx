import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

export interface MenuItem {
  label?: string;
  icon?: string;
  onClick?: () => void;
  danger?: boolean;
  divider?: boolean;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

/**
 * Shared portal-based context menu used by FolderTree, DeckCard, and other
 * components that need a right-click menu anchored to a screen position.
 */
export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  // Clamp to viewport bounds after first paint so we know the menu dimensions
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      x: x + r.width  > window.innerWidth  ? Math.max(4, window.innerWidth  - r.width  - 4) : x,
      y: y + r.height > window.innerHeight ? Math.max(4, window.innerHeight - r.height - 4) : y,
    });
  }, [x, y]);

  // Close on outside click or Escape
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', down, true);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', down, true);
      document.removeEventListener('keydown', key);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      className="fixed z-[9999] min-w-[176px] rounded-lg py-1 shadow-2xl border border-white/10 overflow-hidden"
      style={{ left: pos.x, top: pos.y, background: 'rgba(28,31,38,0.98)', backdropFilter: 'blur(20px)' }}
    >
      {items.map((item, i) =>
        item.divider ? (
          <div key={i} className="my-1 border-t border-white/8" />
        ) : (
          <button
            key={i}
            onClick={() => { item.onClick?.(); onClose(); }}
            className={`w-full flex items-center gap-2.5 px-3 py-[6px] hover:bg-white/8 transition-colors text-left ${
              item.danger
                ? 'text-red-400/90 hover:text-red-300'
                : 'text-on-surface-variant hover:text-on-surface'
            }`}
          >
            {item.icon && (
              <span className="material-symbols-outlined flex-shrink-0" style={{ fontSize: 14 }}>
                {item.icon}
              </span>
            )}
            <span style={{ fontSize: 13 }}>{item.label}</span>
          </button>
        )
      )}
    </div>,
    document.body
  );
}
