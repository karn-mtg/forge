import type { ReactNode } from 'react';

interface PageHeaderProps {
  /** Material Symbols icon name */
  icon: string;
  /** Page title displayed next to the icon */
  title: string;
  /** Set true to render the icon with FILL=1 (filled variant) */
  iconFill?: boolean;
  /** Optional content rendered on the right side of the header */
  actions?: ReactNode;
}

/**
 * Consistent page-level header bar used across all app pages.
 * Matches the DeckView subheader: h-14, blurred surface, bottom border.
 *
 * Left  — icon + title
 * Right — `actions` slot (buttons, badges, tab toggles, etc.)
 */
export function PageHeader({ icon, title, iconFill = false, actions }: PageHeaderProps) {
  return (
    <div className="flex items-center justify-between px-margin-desktop border-b border-white/5 bg-surface/40 backdrop-blur-md h-14 flex-shrink-0">
      {/* Left: icon + title */}
      <div className="flex items-center gap-3">
        <span
          className="material-symbols-outlined text-primary text-[20px]"
          style={iconFill ? { fontVariationSettings: "'FILL' 1" } : undefined}
        >
          {icon}
        </span>
        <h1 className="font-headline-md text-base font-bold text-on-surface">
          {title}
        </h1>
      </div>

      {/* Right: page actions */}
      {actions != null && (
        <div className="flex items-center gap-2">
          {actions}
        </div>
      )}
    </div>
  );
}
