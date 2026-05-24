import { useState, useEffect, useRef } from 'react';
import type { Deck } from '../types/electron';

const FORMATS = [
  { value: 'commander', label: 'Commander' },
  { value: 'modern', label: 'Modern' },
  { value: 'standard', label: 'Standard' },
  { value: 'pioneer', label: 'Pioneer' },
  { value: 'legacy', label: 'Legacy' },
  { value: 'pauper', label: 'Pauper' },
];

const COLOR_BTNS = [
  { color: 'W', bg: '#f0d870', textColor: '#000', title: 'White' },
  { color: 'U', bg: '#4a7cc9', textColor: '#fff', title: 'Blue' },
  { color: 'B', bg: '#2a2a2a', textColor: '#fff', title: 'Black', border: '#888' },
  { color: 'R', bg: '#c0392b', textColor: '#fff', title: 'Red' },
  { color: 'G', bg: '#27ae60', textColor: '#fff', title: 'Green' },
];

interface DeckSettingsModalProps {
  deck: Deck | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (updates: Partial<Deck>) => Promise<void>;
}

export function DeckSettingsModal({ deck, isOpen, onClose, onSave }: DeckSettingsModalProps) {
  const [name, setName] = useState('');
  const [format, setFormat] = useState('commander');
  const [powerLevel, setPowerLevel] = useState(5);
  const [isFavorite, setIsFavorite] = useState(false);
  const [selectedColors, setSelectedColors] = useState<Set<string>>(new Set());
  const [description, setDescription] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!deck || !isOpen) return;
    setName(deck.name || '');
    setFormat(deck.format || 'commander');
    setPowerLevel(deck.power_level ?? 5);
    setIsFavorite(!!deck.is_favorite);
    setDescription(deck.description || '');
    const ci = (deck.color_identity || '').toUpperCase();
    setSelectedColors(new Set(ci.split('').filter(c => 'WUBRG'.includes(c))));
    setTimeout(() => nameRef.current?.focus(), 50);
  }, [deck, isOpen]);

  const toggleColor = (c: string) => {
    setSelectedColors(prev => {
      const next = new Set(prev);
      next.has(c) ? next.delete(c) : next.add(c);
      return next;
    });
  };

  const handleSave = async () => {
    if (!name.trim()) { nameRef.current?.focus(); return; }
    await onSave({
      name: name.trim(),
      format,
      power_level: powerLevel,
      is_favorite: isFavorite ? 1 : 0,
      color_identity: 'WUBRG'.split('').filter(c => selectedColors.has(c)).join(''),
      description: description.trim() || undefined,
    });
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative glass-panel rounded-2xl p-8 w-[400px] shadow-2xl">
        <h2 className="font-headline-md text-xl text-on-surface mb-6">Deck Settings</h2>
        <div className="space-y-4">
          <div>
            <label className="text-label-sm text-on-surface-variant/60 uppercase tracking-wider mb-1.5 block">Name</label>
            <input
              ref={nameRef}
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') onClose(); }}
              className="w-full bg-surface-container/50 border border-white/10 rounded-lg py-2.5 px-4 text-body-md text-on-surface focus:outline-none focus:border-primary/50 transition-all"
            />
          </div>
          <div>
            <label className="text-label-sm text-on-surface-variant/60 uppercase tracking-wider mb-1.5 block">Format</label>
            <select
              value={format}
              onChange={e => setFormat(e.target.value)}
              className="w-full bg-surface-container/50 border border-white/10 rounded-lg py-2.5 px-4 text-body-md text-on-surface focus:outline-none focus:border-primary/50 transition-all"
            >
              {FORMATS.map(f => <option key={f.value} value={f.value} className="bg-surface-container text-on-surface">{f.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-label-sm text-on-surface-variant/60 uppercase tracking-wider mb-1.5 block">
              Power Level{' '}
              <span className="text-primary normal-case tracking-normal font-normal">{powerLevel}</span>
            </label>
            <input
              type="range" min="1" max="10" value={powerLevel}
              onChange={e => setPowerLevel(parseInt(e.target.value))}
              className="w-full accent-primary"
            />
            <div className="flex justify-between text-[9px] text-on-surface-variant/30 mt-1">
              <span>Casual</span><span>Focused</span><span>Optimized</span><span>Competitive</span>
            </div>
          </div>
          <div>
            <label className="text-label-sm text-on-surface-variant/60 uppercase tracking-wider mb-2 block">Color Identity</label>
            <div className="flex gap-2">
              {COLOR_BTNS.map(({ color, bg, textColor, title, border }) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => toggleColor(color)}
                  title={title}
                  className="w-8 h-8 rounded-full border-2 hover:scale-110 transition-all flex items-center justify-center text-[10px] font-bold"
                  style={{
                    background: bg,
                    color: textColor,
                    borderColor: selectedColors.has(color) ? 'white' : (border || 'transparent'),
                    opacity: selectedColors.has(color) ? 1 : 0.5,
                  }}
                >
                  {color}
                </button>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={isFavorite}
              onChange={e => setIsFavorite(e.target.checked)}
              className="w-4 h-4 accent-primary"
            />
            <span className="text-body-md text-on-surface-variant">Mark as favorite</span>
          </label>
          {/* #27 – Description field (decks.description column exists in DB) */}
          <div>
            <label className="text-label-sm text-on-surface-variant/60 uppercase tracking-wider mb-1.5 block">Description</label>
            <textarea
              rows={3}
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Optional notes about this deck…"
              className="w-full bg-surface-container/50 border border-white/10 rounded-lg py-2.5 px-4 text-body-md text-on-surface focus:outline-none focus:border-primary/50 transition-all resize-none placeholder:text-on-surface-variant/30"
            />
          </div>
        </div>
        <div className="flex gap-3 mt-8">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-lg border border-white/10 text-on-surface-variant hover:bg-white/5 transition-all font-bold">Cancel</button>
          <button onClick={handleSave} className="flex-1 py-2.5 rounded-lg bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30 transition-all font-bold">Save</button>
        </div>
      </div>
    </div>
  );
}
