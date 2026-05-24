import { useNavigate } from 'react-router-dom';

interface HeaderProps {
  searchPlaceholder?: string;
  onSearch?: (value: string) => void;
  searchValue?: string;
}

export function Header({ searchPlaceholder = 'Search your library...', onSearch, searchValue }: HeaderProps) {
  const navigate = useNavigate();

  return (
    <header className="sticky top-0 w-full z-40 bg-background/80 backdrop-blur-md border-b border-white/5">
      <div className="flex justify-between items-center h-16 px-margin-desktop titlebar-drag">
        <div className="flex-1 max-w-xl no-drag">
          <div className="relative group">
            <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant/50 group-focus-within:text-primary transition-colors">
              search
            </span>
            <input
              className="w-full bg-surface-container/50 border border-white/5 rounded-lg py-2 pl-12 pr-4 text-body-md focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/10 transition-all placeholder:text-on-surface-variant/30"
              placeholder={searchPlaceholder}
              type="text"
              value={searchValue ?? undefined}
              onChange={(e) => onSearch?.(e.target.value)}
            />
          </div>
        </div>
        <div className="flex items-center gap-2 no-drag">
          <button
            onClick={() => navigate('/settings')}
            className="w-9 h-9 rounded-lg flex items-center justify-center text-on-surface-variant hover:bg-white/5 transition-all"
          >
            <span className="material-symbols-outlined text-[22px]">settings</span>
          </button>
        </div>
      </div>
    </header>
  );
}
