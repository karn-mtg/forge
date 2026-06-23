import { useState, useRef, useEffect } from 'react';
import { useLibraryStore } from '../store/useLibraryStore';
import { useConfirmStore } from '../store/useConfirmStore';
import type { Recipient, RecipientType } from '../types/electron';

const TYPE_OPTIONS: { value: RecipientType; label: string; icon: string }[] = [
  { value: 'binder',   label: 'Binder',   icon: 'menu_book' },
  { value: 'box',      label: 'Box',      icon: 'inventory_2' },
  { value: 'deck_box', label: 'Deck Box', icon: 'deployed_code' },
  { value: 'other',    label: 'Other',    icon: 'location_on' },
];

function typeIcon(type: string) {
  return TYPE_OPTIONS.find(t => t.value === type)?.icon ?? 'location_on';
}
function typeLabel(type: string) {
  return TYPE_OPTIONS.find(t => t.value === type)?.label ?? type;
}

interface NewFormState { name: string; type: RecipientType }
interface EditFormState { name: string; type: RecipientType }

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export function RecipientsModal({ isOpen, onClose }: Props) {
  const { recipients, createRecipient, updateRecipient, deleteRecipient } = useLibraryStore();
  const [showNewForm, setShowNewForm] = useState(false);
  const [newForm, setNewForm] = useState<NewFormState>({ name: '', type: 'binder' });
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<EditFormState>({ name: '', type: 'binder' });
  const [isSaving, setIsSaving] = useState(false);
  const newNameRef = useRef<HTMLInputElement>(null);
  const editNameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) {
      setShowNewForm(false);
      setNewForm({ name: '', type: 'binder' });
      setEditingId(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (showNewForm) setTimeout(() => newNameRef.current?.focus(), 30);
  }, [showNewForm]);

  useEffect(() => {
    if (editingId != null) setTimeout(() => editNameRef.current?.focus(), 30);
  }, [editingId]);

  const handleCreate = async () => {
    const name = newForm.name.trim();
    if (!name) { newNameRef.current?.focus(); return; }
    setIsSaving(true);
    try {
      await createRecipient({ name, type: newForm.type });
      setNewForm({ name: '', type: 'binder' });
      setShowNewForm(false);
    } finally {
      setIsSaving(false);
    }
  };

  const startEdit = (r: Recipient) => {
    setEditingId(r.id);
    setEditForm({ name: r.name, type: r.type });
  };

  const handleUpdate = async (id: number) => {
    const name = editForm.name.trim();
    if (!name) { editNameRef.current?.focus(); return; }
    setIsSaving(true);
    try {
      await updateRecipient({ id, name, type: editForm.type });
      setEditingId(null);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = (r: Recipient) => {
    useConfirmStore.getState().show({
      title: 'Delete Recipient',
      message: `Delete "${r.name}"? Any decks mounted here will become virtual again.`,
      danger: true,
      confirmLabel: 'Delete',
      onConfirm: () => deleteRecipient({ id: r.id }),
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative glass-panel rounded-2xl shadow-2xl w-[480px] max-h-[80vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-white/5 flex-shrink-0">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-[20px] text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>location_on</span>
            <h2 className="font-headline-md text-lg text-on-surface">Recipients</h2>
            {recipients.length > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-[10px] font-bold text-on-surface-variant/60 tabular-nums">
                {recipients.length}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!showNewForm && (
              <button
                onClick={() => setShowNewForm(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-all text-label-sm font-bold"
              >
                <span className="material-symbols-outlined text-[15px]">add</span>
                New
              </button>
            )}
            <button
              onClick={onClose}
              className="w-7 h-7 rounded-md flex items-center justify-center text-on-surface-variant hover:bg-white/10 transition-all"
            >
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">

          {/* New recipient form */}
          {showNewForm && (
            <div className="px-6 py-4 border-b border-white/5 bg-primary/[0.03]">
              <p className="text-[10px] uppercase tracking-widest font-bold text-on-surface-variant/40 mb-3">New Recipient</p>
              <div className="flex gap-2 items-start">
                <div className="flex-1">
                  <input
                    ref={newNameRef}
                    type="text"
                    placeholder="Name (e.g. Red Binder, Commander Box)"
                    value={newForm.name}
                    onChange={e => setNewForm(f => ({ ...f, name: e.target.value }))}
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleCreate();
                      if (e.key === 'Escape') { setShowNewForm(false); setNewForm({ name: '', type: 'binder' }); }
                    }}
                    className="w-full bg-surface-container/50 border border-white/10 rounded-lg py-2 px-3 text-body-sm text-on-surface focus:outline-none focus:border-primary/50 transition-all placeholder:text-on-surface-variant/30"
                  />
                </div>
                <TypeSelect value={newForm.type} onChange={type => setNewForm(f => ({ ...f, type }))} />
                <button
                  onClick={handleCreate}
                  disabled={isSaving || !newForm.name.trim()}
                  className="w-8 h-8 mt-0.5 rounded-lg flex items-center justify-center bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30 transition-all disabled:opacity-40"
                  title="Create"
                >
                  <span className="material-symbols-outlined text-[16px]">check</span>
                </button>
                <button
                  onClick={() => { setShowNewForm(false); setNewForm({ name: '', type: 'binder' }); }}
                  className="w-8 h-8 mt-0.5 rounded-lg flex items-center justify-center text-on-surface-variant/50 hover:bg-white/5 transition-all"
                  title="Cancel"
                >
                  <span className="material-symbols-outlined text-[16px]">close</span>
                </button>
              </div>
            </div>
          )}

          {/* Recipient list */}
          {recipients.length === 0 && !showNewForm ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <span className="material-symbols-outlined text-[48px] text-on-surface-variant/15">location_off</span>
              <p className="text-on-surface-variant/40 text-body-md">No recipients yet</p>
              <button
                onClick={() => setShowNewForm(true)}
                className="mt-1 px-4 py-2 rounded-lg bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-all font-bold text-label-sm"
              >
                Create your first recipient
              </button>
            </div>
          ) : (
            <ul>
              {recipients.map((r, idx) => (
                <li
                  key={r.id}
                  className={`flex items-center gap-3 px-6 py-3.5 group transition-colors ${idx < recipients.length - 1 ? 'border-b border-white/5' : ''}`}
                >
                  {editingId === r.id ? (
                    // Edit mode
                    <div className="flex gap-2 items-center w-full">
                      <span
                        className="material-symbols-outlined text-[18px] text-primary/60 flex-shrink-0"
                        style={{ fontVariationSettings: "'FILL' 1" }}
                      >
                        {typeIcon(editForm.type)}
                      </span>
                      <div className="flex-1">
                        <input
                          ref={editNameRef}
                          type="text"
                          value={editForm.name}
                          onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                          onKeyDown={e => {
                            if (e.key === 'Enter') handleUpdate(r.id);
                            if (e.key === 'Escape') setEditingId(null);
                          }}
                          className="w-full bg-surface-container/50 border border-white/10 rounded-lg py-1.5 px-3 text-body-sm text-on-surface focus:outline-none focus:border-primary/50 transition-all"
                        />
                      </div>
                      <TypeSelect value={editForm.type} onChange={type => setEditForm(f => ({ ...f, type }))} />
                      <button
                        onClick={() => handleUpdate(r.id)}
                        disabled={isSaving || !editForm.name.trim()}
                        className="w-7 h-7 rounded-md flex items-center justify-center text-green-400 hover:bg-green-500/10 transition-all disabled:opacity-40"
                        title="Save"
                      >
                        <span className="material-symbols-outlined text-[15px]">check</span>
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="w-7 h-7 rounded-md flex items-center justify-center text-on-surface-variant/40 hover:bg-white/5 transition-all"
                        title="Cancel"
                      >
                        <span className="material-symbols-outlined text-[15px]">close</span>
                      </button>
                    </div>
                  ) : (
                    // View mode
                    <>
                      <span
                        className="material-symbols-outlined text-[18px] text-primary/70 flex-shrink-0"
                        style={{ fontVariationSettings: "'FILL' 1" }}
                      >
                        {typeIcon(r.type)}
                      </span>
                      <span className="flex-1 text-body-md text-on-surface font-medium truncate">{r.name}</span>
                      <span className="px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-[9px] uppercase tracking-widest font-bold text-on-surface-variant/50 flex-shrink-0">
                        {typeLabel(r.type)}
                      </span>
                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-all ml-1">
                        <button
                          onClick={() => startEdit(r)}
                          className="w-7 h-7 rounded-md flex items-center justify-center text-on-surface-variant/40 hover:text-primary hover:bg-primary/10 transition-all"
                          title="Edit"
                        >
                          <span className="material-symbols-outlined text-[15px]">edit</span>
                        </button>
                        <button
                          onClick={() => handleDelete(r)}
                          className="w-7 h-7 rounded-md flex items-center justify-center text-on-surface-variant/40 hover:text-red-400 hover:bg-red-400/10 transition-all"
                          title="Delete"
                        >
                          <span className="material-symbols-outlined text-[15px]">delete_outline</span>
                        </button>
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function TypeSelect({ value, onChange }: { value: RecipientType; onChange: (t: RecipientType) => void }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value as RecipientType)}
      className="bg-surface-container/50 border border-white/10 rounded-lg py-2 px-2 text-[11px] text-on-surface focus:outline-none focus:border-primary/50 transition-all flex-shrink-0"
    >
      {TYPE_OPTIONS.map(t => (
        <option key={t.value} value={t.value} className="bg-surface-container text-on-surface">
          {t.label}
        </option>
      ))}
    </select>
  );
}
