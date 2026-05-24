import { useState, useEffect, useRef } from 'react';
import { useLibraryStore } from '../store/useLibraryStore';

interface NewFolderModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Parent folder id. null = root level. */
  parentId?: number | null;
}

export function NewFolderModal({ isOpen, onClose, parentId }: NewFolderModalProps) {
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const { createFolder } = useLibraryStore();

  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 50);
    else setName('');
  }, [isOpen]);

  const handleSubmit = async () => {
    if (!name.trim()) { inputRef.current?.focus(); return; }
    await createFolder({ name: name.trim(), parent_id: parentId ?? null });
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSubmit();
    if (e.key === 'Escape') onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative glass-panel rounded-2xl p-8 w-[380px] shadow-2xl">
        <h2 className="font-headline-md text-xl text-on-surface mb-2">New Folder</h2>
        {parentId != null && (
          <p className="text-label-sm text-on-surface-variant/40 mb-5">This will be created as a subfolder.</p>
        )}
        {parentId == null && <div className="mb-6" />}
        <input
          ref={inputRef}
          type="text"
          placeholder="e.g. Legacy Decks"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={handleKeyDown}
          className="w-full bg-surface-container/50 border border-white/10 rounded-lg py-2.5 px-4 text-body-md focus:outline-none focus:border-primary/50 transition-all placeholder:text-on-surface-variant/30 mb-6"
        />
        <div className="flex gap-3">
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
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
