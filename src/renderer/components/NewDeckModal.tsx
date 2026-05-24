import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLibraryStore } from '../store/useLibraryStore';
import type { Card } from '../types/electron';

interface NewDeckModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** If provided, the deck will be created inside this folder. null = root level. */
  defaultFolderId?: number | null;
}

const FORMATS = [
  { value: 'commander', label: 'Commander' },
  { value: 'modern', label: 'Modern' },
  { value: 'standard', label: 'Standard' },
  { value: 'pioneer', label: 'Pioneer' },
  { value: 'legacy', label: 'Legacy' },
  { value: 'pauper', label: 'Pauper' },
];

export function NewDeckModal({ isOpen, onClose, defaultFolderId }: NewDeckModalProps) {
  const [name, setName] = useState('');
  const [format, setFormat] = useState('commander');

  // Commander search
  const [commanderQuery, setCommanderQuery]     = useState('');
  const [commanderResults, setCommanderResults] = useState<Card[]>([]);
  const [commanderSearching, setCommanderSearching] = useState(false);
  const [selectedCommander, setSelectedCommander]   = useState<Card | null>(null);
  const [showDropdown, setShowDropdown]         = useState(false);
  const commanderTimerRef = useRef<ReturnType<typeof setTimeout>>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const { createDeck } = useLibraryStore();
  const navigate = useNavigate();

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
      window.settingsAPI.get().then(s => {
        if (s?.defaultFormat) setFormat(s.defaultFormat as string);
      }).catch(() => {});
    } else {
      setName('');
      setFormat('commander');
      setCommanderQuery('');
      setCommanderResults([]);
      setCommanderSearching(false);
      setSelectedCommander(null);
      setShowDropdown(false);
    }
  }, [isOpen]);

  // ── Commander typeahead ─────────────────────────────────────────────────────
  const searchCommander = async (q: string) => {
    if (!q.trim()) { setCommanderResults([]); setShowDropdown(false); return; }
    setCommanderSearching(true);
    try {
      const res = await window.cardsAPI.search({ q, pageSize: 8 });
      const cards = res?.cards || [];
      setCommanderResults(cards);
      setShowDropdown(cards.length > 0);
    } catch {
      setCommanderResults([]);
    } finally {
      setCommanderSearching(false);
    }
  };

  const handleCommanderInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value;
    setCommanderQuery(q);
    setSelectedCommander(null);
    if (commanderTimerRef.current) clearTimeout(commanderTimerRef.current);
    commanderTimerRef.current = setTimeout(() => searchCommander(q), 200);
  };

  const selectCommander = (card: Card) => {
    setSelectedCommander(card);
    setCommanderQuery('');
    setShowDropdown(false);
    setCommanderResults([]);
  };

  const clearCommander = () => {
    setSelectedCommander(null);
    setCommanderQuery('');
    setCommanderResults([]);
    setShowDropdown(false);
  };

  // ── Submit ──────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!name.trim()) { inputRef.current?.focus(); return; }

    // Derive color identity from commander if selected
    const colorIdentity = selectedCommander
      ? (Array.isArray(selectedCommander.color_identity)
          ? selectedCommander.color_identity.join('')
          : selectedCommander.color_identity || '')
      : '';

    const id = await createDeck({
      name: name.trim(),
      format,
      folder_id: defaultFolderId ?? null,
      color_identity: colorIdentity,
    });

    // Add commander card to the commander board right away
    if (selectedCommander) {
      try {
        await window.libraryAPI.addCardToDeck({
          deckId: id,
          oracleId: selectedCommander.oracle_id,
          scryfallId: selectedCommander.scryfall_id,
          board: 'commander',
          quantity: 1,
        });
      } catch (err) {
        console.error('Failed to add commander to deck:', err);
      }
    }

    onClose();
    navigate(`/deck/${id}`);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSubmit();
    if (e.key === 'Escape') onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative glass-panel rounded-2xl p-8 w-[420px] shadow-2xl">
        <h2 className="font-headline-md text-xl text-on-surface mb-6">New Deck</h2>
        <div className="space-y-4">

          {/* Deck Name */}
          <div>
            <label className="text-label-sm text-on-surface-variant/60 uppercase tracking-wider mb-1.5 block">
              Deck Name
            </label>
            <input
              ref={inputRef}
              type="text"
              placeholder="e.g. Urza's Contraption"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={handleKeyDown}
              className="w-full bg-surface-container/50 border border-white/10 rounded-lg py-2.5 px-4 text-body-md text-on-surface focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/10 transition-all placeholder:text-on-surface-variant/30"
            />
          </div>

          {/* Format */}
          <div>
            <label className="text-label-sm text-on-surface-variant/60 uppercase tracking-wider mb-1.5 block">
              Format
            </label>
            <select
              value={format}
              onChange={(e) => { setFormat(e.target.value); clearCommander(); }}
              className="w-full bg-surface-container/50 border border-white/10 rounded-lg py-2.5 px-4 text-body-md text-on-surface focus:outline-none focus:border-primary/50 transition-all"
            >
              {FORMATS.map(f => (
                <option key={f.value} value={f.value} className="bg-surface-container text-on-surface">
                  {f.label}
                </option>
              ))}
            </select>
          </div>

          {/* Commander picker — only for commander format */}
          {format === 'commander' && (
            <div>
              <label className="text-label-sm text-on-surface-variant/60 uppercase tracking-wider mb-1.5 block">
                Commander{' '}
                <span className="normal-case tracking-normal font-normal text-on-surface-variant/30">
                  (optional)
                </span>
              </label>

              {selectedCommander ? (
                /* Selected state — show the chosen commander */
                <div className="flex items-center gap-3 bg-surface-container/50 border border-primary/30 rounded-lg py-2.5 px-4">
                  <span className="material-symbols-outlined text-[16px] text-primary/60">person</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-body-md text-on-surface font-medium truncate">
                      {selectedCommander.name}
                    </p>
                    <p className="text-[10px] text-on-surface-variant/45 truncate">
                      {selectedCommander.type_line}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={clearCommander}
                    className="text-on-surface-variant/40 hover:text-on-surface-variant transition-colors flex-shrink-0"
                  >
                    <span className="material-symbols-outlined text-[16px]">close</span>
                  </button>
                </div>
              ) : (
                /* Search state — typeahead input */
                <div className="relative">
                  <div className="relative">
                    <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/40 text-[18px]">
                      {commanderSearching ? 'sync' : 'search'}
                    </span>
                    <input
                      type="text"
                      placeholder="Search for a legendary creature…"
                      value={commanderQuery}
                      onChange={handleCommanderInput}
                      onFocus={() => commanderResults.length > 0 && setShowDropdown(true)}
                      onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
                      className="w-full bg-surface-container/50 border border-white/10 rounded-lg py-2.5 pl-9 pr-4 text-body-md text-on-surface focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/10 transition-all placeholder:text-on-surface-variant/30"
                    />
                  </div>

                  {/* Dropdown results */}
                  {showDropdown && commanderResults.length > 0 && (
                    <div
                      className="absolute top-full left-0 right-0 z-20 mt-1 rounded-xl border border-white/10 overflow-hidden shadow-2xl"
                      style={{ background: 'rgba(18,20,25,0.98)', backdropFilter: 'blur(20px)' }}
                    >
                      {commanderResults.slice(0, 6).map(card => (
                        <button
                          key={card.oracle_id}
                          type="button"
                          onMouseDown={() => selectCommander(card)}
                          className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/5 text-left transition-all border-b border-white/[0.04] last:border-0"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-body-md text-on-surface font-medium truncate">{card.name}</p>
                            <p className="text-[10px] text-on-surface-variant/45 truncate">{card.type_line}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

        </div>

        <div className="flex gap-3 mt-8">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-lg border border-white/10 text-on-surface-variant hover:bg-white/5 transition-all font-bold"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            className="flex-1 py-2.5 rounded-lg bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30 transition-all font-bold"
          >
            Create Deck
          </button>
        </div>
      </div>
    </div>
  );
}
