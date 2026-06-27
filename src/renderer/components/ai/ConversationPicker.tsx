import { useEffect, useRef, useState } from 'react';
import { useAIStore, type ConversationSummary } from '../../store/useAIStore';

function fmtDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return d.toLocaleDateString(undefined, { weekday: 'short' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

interface Props {
  currentDeckId?: number;
}

export function ConversationPicker({ currentDeckId }: Props) {
  const { activeConversationId, conversations, loadConversations, loadConversation, startNewConversation, deleteConversation } = useAIStore();
  const [open, setOpen] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadConversations();
  }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!dropRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const deckConvs = conversations.filter(c => c.deck_id === currentDeckId);
  const globalConvs = conversations.filter(c => c.deck_id !== currentDeckId);
  const active = conversations.find(c => c.id === activeConversationId);
  const label = active?.title || (active ? 'Conversation' : 'New conversation');

  const select = (c: ConversationSummary) => {
    loadConversation(c.id);
    setOpen(false);
  };

  const deleteAndRefresh = async (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    await deleteConversation(id);
    setOpen(false);
  };

  return (
    <div className="relative" ref={dropRef}>
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs transition-all hover:bg-white/5 max-w-[200px]"
        style={{ color: '#888', border: '1px solid rgba(255,255,255,0.06)' }}
      >
        <span className="material-symbols-outlined text-[12px]">chat_bubble</span>
        <span className="truncate">{label}</span>
        <span className="material-symbols-outlined text-[12px] flex-shrink-0">expand_more</span>
      </button>

      {open && (
        <div
          className="absolute top-full left-0 mt-1 rounded-xl overflow-hidden z-50"
          style={{
            width: 260,
            background: 'rgba(18,18,18,0.98)',
            border: '1px solid rgba(255,255,255,0.08)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
          }}
        >
          {/* New conversation */}
          <button
            onClick={() => { startNewConversation(); setOpen(false); }}
            className="w-full flex items-center gap-2 px-3 py-2.5 text-xs text-left transition-all hover:bg-white/5"
            style={{ color: '#f2ca83', borderBottom: '1px solid rgba(255,255,255,0.05)' }}
          >
            <span className="material-symbols-outlined text-[14px]">add</span>
            New conversation
          </button>

          <div className="max-h-60 overflow-y-auto">
            {deckConvs.length > 0 && (
              <>
                <p className="px-3 pt-2 pb-1 text-[9px] uppercase tracking-widest font-bold" style={{ color: '#444' }}>This deck</p>
                {deckConvs.slice(0, 5).map(c => (
                  <ConvRow key={c.id} c={c} active={c.id === activeConversationId} onSelect={select} onDelete={deleteAndRefresh} />
                ))}
              </>
            )}
            {globalConvs.length > 0 && (
              <>
                <p className="px-3 pt-2 pb-1 text-[9px] uppercase tracking-widest font-bold" style={{ color: '#444', borderTop: deckConvs.length > 0 ? '1px solid rgba(255,255,255,0.04)' : undefined, marginTop: deckConvs.length > 0 ? 4 : 0 }}>Other</p>
                {globalConvs.slice(0, 5).map(c => (
                  <ConvRow key={c.id} c={c} active={c.id === activeConversationId} onSelect={select} onDelete={deleteAndRefresh} />
                ))}
              </>
            )}
            {conversations.length === 0 && (
              <p className="px-3 py-3 text-xs" style={{ color: '#444' }}>No conversations yet.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ConvRow({
  c, active, onSelect, onDelete,
}: {
  c: ConversationSummary;
  active: boolean;
  onSelect: (c: ConversationSummary) => void;
  onDelete: (e: React.MouseEvent, id: number) => void;
}) {
  return (
    <button
      onClick={() => onSelect(c)}
      className="group w-full flex items-center gap-2 px-3 py-2 text-left transition-all hover:bg-white/5"
      style={{
        background: active ? 'rgba(242,202,131,0.06)' : undefined,
        color: active ? '#f2ca83' : '#aaa',
      }}
    >
      <span className="flex-1 min-w-0">
        <span className="block text-xs truncate">{c.title ?? 'Conversation'}</span>
        <span className="block text-[9px] mt-0.5" style={{ color: '#555' }}>{fmtDate(c.created_at)}</span>
      </span>
      <span
        onClick={e => onDelete(e, c.id)}
        className="opacity-0 group-hover:opacity-100 material-symbols-outlined text-[13px] flex-shrink-0 transition-all hover:text-red-400"
        style={{ color: '#555' }}
      >
        delete
      </span>
    </button>
  );
}
