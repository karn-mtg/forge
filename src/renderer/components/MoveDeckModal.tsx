import { useState } from 'react';
import { useLibraryStore } from '../store/useLibraryStore';
import type { FolderNode } from '../types/electron';

interface MoveDeckModalProps {
  deckId: number | null;
  deckName: string;
  isOpen: boolean;
  onClose: () => void;
  onMoved: () => void;
}

function flattenFolders(folders: FolderNode[], depth = 0): { id: number; name: string; depth: number }[] {
  const result: { id: number; name: string; depth: number }[] = [];
  for (const f of folders) {
    result.push({ id: f.id, name: f.name, depth });
    result.push(...flattenFolders(f.children, depth + 1));
  }
  return result;
}

export function MoveDeckModal({ deckId, deckName, isOpen, onClose, onMoved }: MoveDeckModalProps) {
  const { folders } = useLibraryStore();
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const flat = flattenFolders(folders);

  const handleMove = async () => {
    if (deckId == null) return;
    setSaving(true);
    try {
      await window.libraryAPI.moveDeck({ id: deckId, folderId: selectedFolderId });
      onMoved();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[500] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative glass-panel rounded-2xl p-6 w-[360px] shadow-2xl border border-white/5">
        <h3 className="font-headline-md text-base font-bold text-on-surface mb-1">Move Deck</h3>
        <p className="text-[11px] text-on-surface-variant/50 mb-4 truncate">"{deckName}"</p>
        <div className="bg-surface-container/40 rounded-xl border border-white/5 overflow-hidden mb-4 max-h-56 overflow-y-auto">
          <button
            onClick={() => setSelectedFolderId(null)}
            className={`w-full flex items-center gap-2 px-3 py-2.5 text-left transition-all ${selectedFolderId === null ? 'bg-primary/15 text-primary' : 'text-on-surface-variant hover:bg-white/5'}`}
          >
            <span className="material-symbols-outlined text-[15px]" style={{ fontVariationSettings: "'FILL' 1" }}>folder_special</span>
            <span className="text-[13px]">Root (no folder)</span>
          </button>
          {flat.map(f => (
            <button
              key={f.id}
              onClick={() => setSelectedFolderId(f.id)}
              className={`w-full flex items-center gap-2 px-3 py-2.5 text-left transition-all ${selectedFolderId === f.id ? 'bg-primary/15 text-primary' : 'text-on-surface-variant hover:bg-white/5'}`}
              style={{ paddingLeft: 12 + f.depth * 16 }}
            >
              <span className="material-symbols-outlined text-[15px]">folder</span>
              <span className="text-[13px] truncate">{f.name}</span>
            </button>
          ))}
        </div>
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2 rounded-lg border border-white/10 text-on-surface-variant hover:bg-white/5 transition-all font-bold text-label-md">Cancel</button>
          <button onClick={handleMove} disabled={saving}
            className="flex-1 py-2 rounded-lg bg-primary/15 text-primary border border-primary/30 hover:bg-primary/25 transition-all font-bold text-label-md disabled:opacity-50">
            {saving ? 'Moving…' : 'Move Here'}
          </button>
        </div>
      </div>
    </div>
  );
}
