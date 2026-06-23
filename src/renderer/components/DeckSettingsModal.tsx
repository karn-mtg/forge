import { useState, useEffect, useRef } from 'react';
import type { Deck } from '../types/electron';
import { ManaSymbol } from './ManaSymbol';
import { useLibraryStore } from '../store/useLibraryStore';

const FORMATS = [
  { value: 'commander', label: 'Commander' },
  { value: 'modern', label: 'Modern' },
  { value: 'standard', label: 'Standard' },
  { value: 'pioneer', label: 'Pioneer' },
  { value: 'legacy', label: 'Legacy' },
  { value: 'pauper', label: 'Pauper' },
];

const COLOR_LABELS: Record<string, string> = {
  W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green',
};

interface DeckSettingsModalProps {
  deck: Deck | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (updates: Partial<Deck>) => Promise<void>;
}

const RECIPIENT_TYPE_LABELS: Record<string, string> = {
  binder: 'Binder', box: 'Box', deck_box: 'Deck Box', other: 'Other',
};

export function DeckSettingsModal({ deck, isOpen, onClose, onSave }: DeckSettingsModalProps) {
  const { recipients, mountDeck, unmountDeck } = useLibraryStore();
  const [name, setName] = useState('');
  const [format, setFormat] = useState('commander');
  const [powerLevel, setPowerLevel] = useState(5);
  const [isFavorite, setIsFavorite] = useState(false);
  const [selectedColors, setSelectedColors] = useState<Set<string>>(new Set());
  const [description, setDescription] = useState('');
  const [recipientId, setRecipientId] = useState<number | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!deck || !isOpen) return;
    setName(deck.name || '');
    setFormat(deck.format || 'commander');
    setPowerLevel(deck.power_level ?? 5);
    setIsFavorite(!!deck.is_favorite);
    setDescription(deck.description || '');
    setRecipientId(deck.recipient_id ?? null);
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
      is_favorite: isFavorite,
      color_identity: 'WUBRG'.split('').filter(c => selectedColors.has(c)).join(''),
      description: description.trim() || undefined,
    });
    if (deck) {
      const prev = deck.recipient_id ?? null;
      if (recipientId !== prev) {
        if (recipientId) await mountDeck({ id: deck.id, recipientId });
        else await unmountDeck({ id: deck.id });
      }
    }
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
            <div className="flex gap-3">
              {'WUBRG'.split('').map(color => {
                const active = selectedColors.has(color);
                return (
                  <button
                    key={color}
                    type="button"
                    onClick={() => toggleColor(color)}
                    title={COLOR_LABELS[color]}
                    className={`rounded-full transition-all hover:scale-110 ring-offset-2 ring-offset-surface-container ${
                      active ? 'ring-2 ring-white/70 opacity-100 scale-105' : 'opacity-35 hover:opacity-60'
                    }`}
                  >
                    <ManaSymbol sym={color} cost shadow size="1.6rem" />
                  </button>
                );
              })}
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
          <div>
            <label className="text-label-sm text-on-surface-variant/60 uppercase tracking-wider mb-1.5 block">Physical Location</label>
            <select
              value={recipientId ?? ''}
              onChange={e => setRecipientId(e.target.value ? Number(e.target.value) : null)}
              className="w-full bg-surface-container/50 border border-white/10 rounded-lg py-2.5 px-4 text-body-md text-on-surface focus:outline-none focus:border-primary/50 transition-all"
            >
              <option value="" className="bg-surface-container text-on-surface-variant">Virtual (no physical location)</option>
              {recipients.map(r => (
                <option key={r.id} value={r.id} className="bg-surface-container text-on-surface">
                  {r.name} — {RECIPIENT_TYPE_LABELS[r.type] ?? r.type}
                </option>
              ))}
            </select>
            {recipientId && (
              <p className="text-[10px] text-emerald-400 mt-1 flex items-center gap-1">
                <span className="material-symbols-outlined text-[11px]" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
                Deck will be marked as mounted
              </p>
            )}
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
