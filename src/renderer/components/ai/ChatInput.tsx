import { useRef, KeyboardEvent } from 'react';

interface Props {
  onSend: (text: string) => void;
  disabled: boolean;
}

export function ChatInput({ onSend, disabled }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const submit = () => {
    const text = ref.current?.value.trim();
    if (!text || disabled) return;
    ref.current!.value = '';
    ref.current!.style.height = 'auto';
    onSend(text);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const onInput = () => {
    if (!ref.current) return;
    ref.current.style.height = 'auto';
    ref.current.style.height = Math.min(ref.current.scrollHeight, 120) + 'px';
  };

  return (
    <div className="flex items-end gap-2 p-3 border-t border-white/5">
      <textarea
        ref={ref}
        rows={1}
        disabled={disabled}
        placeholder="Ask Karn…"
        onKeyDown={onKeyDown}
        onInput={onInput}
        className="flex-1 resize-none rounded-xl px-3 py-2 text-sm outline-none transition-colors overflow-hidden"
        style={{
          background: 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(255,255,255,0.08)',
          color: '#e0e0e0',
          lineHeight: '1.5',
          maxHeight: '120px',
        }}
      />
      <button
        onClick={submit}
        disabled={disabled}
        className="flex-shrink-0 flex items-center justify-center w-9 h-9 rounded-xl transition-all"
        style={{
          background: disabled ? 'rgba(255,255,255,0.05)' : 'rgba(242,202,131,0.15)',
          border: '1px solid rgba(242,202,131,0.2)',
          color: disabled ? '#555' : '#f2ca83',
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
        title="Send (Enter)"
      >
        <span className="material-symbols-outlined text-[18px]">arrow_upward</span>
      </button>
    </div>
  );
}
