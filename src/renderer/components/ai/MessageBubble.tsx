import { useMemo } from 'react';
import { marked } from 'marked';
import type { ChatMessage } from '../../store/useAIStore';

marked.use({ breaks: true, gfm: true });

interface Props {
  message: ChatMessage;
}

export function MessageBubble({ message }: Props) {
  const html = useMemo(() => {
    if (message.role === 'user') return null;
    return marked.parse(message.text) as string;
  }, [message.text, message.role]);

  if (message.role === 'user') {
    return (
      <div className="flex justify-end mb-3">
        <div
          className="max-w-[85%] px-3 py-2 rounded-2xl rounded-tr-sm text-sm leading-relaxed"
          style={{ background: 'rgba(242, 202, 131, 0.12)', color: '#f2ca83', border: '1px solid rgba(242,202,131,0.2)' }}
        >
          {message.text}
        </div>
      </div>
    );
  }

  if (message.role === 'error') {
    return (
      <div className="flex justify-start mb-3">
        <div
          className="max-w-[90%] px-3 py-2 rounded-2xl rounded-tl-sm text-sm leading-relaxed"
          style={{ background: 'rgba(220, 80, 80, 0.1)', color: '#ff8080', border: '1px solid rgba(220,80,80,0.2)' }}
        >
          <span className="material-symbols-outlined text-[14px] mr-1 align-middle">error</span>
          {message.text}
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start mb-3">
      <div
        className="max-w-[90%] px-3 py-2 rounded-2xl rounded-tl-sm text-sm leading-relaxed prose-karn"
        style={{ background: 'rgba(255,255,255,0.04)', color: '#d4d4d4', border: '1px solid rgba(255,255,255,0.06)' }}
        dangerouslySetInnerHTML={{ __html: html ?? '' }}
      />
    </div>
  );
}
