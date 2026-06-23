import { useEffect, useRef, useState } from 'react';
import { marked } from 'marked';
import { useAIStore } from '../../store/useAIStore';
import { MessageBubble } from './MessageBubble';
import { ChatInput } from './ChatInput';

marked.use({ breaks: true, gfm: true });

type SetupStatus = 'checking' | 'ready' | 'not_installed' | 'not_logged_in';

interface SetupBannerProps { status: SetupStatus; version: string | null }

function SetupBanner({ status, version }: SetupBannerProps) {
  if (status === 'checking') {
    return (
      <div className="mx-3 mt-3 px-3 py-2.5 rounded-xl text-xs flex items-center gap-2 flex-shrink-0"
        style={{ background: 'rgba(255,255,255,0.04)', color: '#555', border: '1px solid rgba(255,255,255,0.06)' }}>
        <span className="material-symbols-outlined text-[14px] animate-spin">progress_activity</span>
        Checking Claude Code…
      </div>
    );
  }
  if (status === 'not_installed') {
    return (
      <div className="mx-3 mt-3 px-3 py-3 rounded-xl text-xs flex-shrink-0"
        style={{ background: 'rgba(220,80,80,0.08)', color: '#ff8080', border: '1px solid rgba(220,80,80,0.18)' }}>
        <div className="flex items-center gap-1.5 font-semibold mb-1">
          <span className="material-symbols-outlined text-[14px]">error</span>
          Claude Code not found
        </div>
        <p style={{ color: '#cc6060' }}>
          Install it from <span className="font-mono">claude.ai/code</span>, then restart KarnForge.
        </p>
      </div>
    );
  }
  if (status === 'not_logged_in') {
    return (
      <div className="mx-3 mt-3 px-3 py-3 rounded-xl text-xs flex-shrink-0"
        style={{ background: 'rgba(220,160,60,0.08)', color: '#e8c060', border: '1px solid rgba(220,160,60,0.18)' }}>
        <div className="flex items-center gap-1.5 font-semibold mb-1">
          <span className="material-symbols-outlined text-[14px]">key</span>
          Not logged in to Claude Code
        </div>
        <p style={{ color: '#b09040' }}>
          Run <span className="font-mono bg-black/20 px-1 rounded">claude login</span> in your terminal, then reopen this panel.
        </p>
      </div>
    );
  }
  // ready
  if (version) {
    return (
      <div className="mx-3 mt-2 px-2 py-1 rounded-lg text-[10px] flex items-center gap-1 flex-shrink-0"
        style={{ color: '#3a8' }}>
        <span className="material-symbols-outlined text-[11px]">check_circle</span>
        {version}
      </div>
    );
  }
  return null;
}

export function AIChatPanel() {
  const { isOpen, close, messages, isStreaming, streamingText, sendMessage, abort, clearHistory } = useAIStore();
  const bottomRef = useRef<HTMLDivElement>(null);
  const [setupStatus, setSetupStatus] = useState<SetupStatus>('checking');
  const [claudeVersion, setClaudeVersion] = useState<string | null>(null);

  // Run setup check each time the panel opens
  useEffect(() => {
    if (!isOpen) return;
    setSetupStatus('checking');
    window.aiAPI.checkClaude().then(result => {
      if (!result.installed) {
        setSetupStatus('not_installed');
      } else if (!result.loggedIn) {
        setSetupStatus('not_logged_in');
      } else {
        setSetupStatus('ready');
        setClaudeVersion(result.version);
      }
    }).catch(() => setSetupStatus('not_installed'));
  }, [isOpen]);

  // Auto-scroll when new content arrives
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText]);

  if (!isOpen) return null;

  const isReady = setupStatus === 'ready';

  return (
    <div
      className="fixed top-0 right-0 h-screen z-[300] flex flex-col no-drag"
      style={{
        width: 480,
        background: 'rgba(13,13,13,0.97)',
        backdropFilter: 'blur(40px)',
        WebkitBackdropFilter: 'blur(40px)',
        borderLeft: '1px solid rgba(255,255,255,0.07)',
        boxShadow: '-12px 0 48px rgba(0,0,0,0.6)',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 flex-shrink-0"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
      >
        <div className="flex items-center gap-2">
          <span
            className="material-symbols-outlined text-[18px]"
            style={{ color: '#f2ca83', fontVariationSettings: "'FILL' 1" }}
          >
            auto_awesome
          </span>
          <span className="text-sm font-semibold" style={{ color: '#f2ca83' }}>Karn AI</span>
          <span
            className="text-xs px-2 py-0.5 rounded-full"
            style={{ background: 'rgba(242,202,131,0.1)', color: '#a08050', border: '1px solid rgba(242,202,131,0.15)' }}
          >
            Claude Code
          </span>
        </div>
        <div className="flex items-center gap-1">
          {messages.length > 0 && (
            <button
              onClick={clearHistory}
              className="flex items-center justify-center w-7 h-7 rounded-lg transition-all hover:bg-white/5"
              style={{ color: '#666' }}
              title="Clear conversation"
            >
              <span className="material-symbols-outlined text-[16px]">delete_sweep</span>
            </button>
          )}
          <button
            onClick={close}
            className="flex items-center justify-center w-7 h-7 rounded-lg transition-all hover:bg-white/5"
            style={{ color: '#666' }}
            title="Close"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>
      </div>

      {/* Setup status banner */}
      <SetupBanner status={setupStatus} version={claudeVersion} />

      {/* Message list */}
      <div className="flex-1 overflow-y-auto px-3 py-3">
        {isReady && messages.length === 0 && !isStreaming && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-6">
            <span
              className="material-symbols-outlined text-[40px]"
              style={{ color: 'rgba(242,202,131,0.25)', fontVariationSettings: "'FILL' 1" }}
            >
              auto_awesome
            </span>
            <p className="text-sm" style={{ color: '#555' }}>
              Ask me about your decks, search for cards, or let me help you build something new.
            </p>
            <p className="text-xs" style={{ color: '#333' }}>
              KarnForge MCP tools are available if registered with Claude Code.
            </p>
          </div>
        )}

        {messages.map(msg => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {/* Streaming text bubble */}
        {isStreaming && (
          <div className="flex justify-start mb-3">
            <div
              className="max-w-[90%] px-3 py-2 rounded-2xl rounded-tl-sm text-sm leading-relaxed"
              style={{ background: 'rgba(255,255,255,0.04)', color: '#d4d4d4', border: '1px solid rgba(255,255,255,0.06)' }}
            >
              {streamingText ? (
                <span dangerouslySetInnerHTML={{ __html: marked.parse(streamingText) as string }} />
              ) : (
                <span className="flex gap-1 items-center" style={{ color: '#555' }}>
                  <span className="animate-pulse">●</span>
                  <span className="animate-pulse" style={{ animationDelay: '0.2s' }}>●</span>
                  <span className="animate-pulse" style={{ animationDelay: '0.4s' }}>●</span>
                </span>
              )}
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Abort button (visible while streaming) */}
      {isStreaming && (
        <div className="px-3 pb-1 flex-shrink-0">
          <button
            onClick={abort}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs transition-all hover:bg-white/5"
            style={{ color: '#666', border: '1px solid rgba(255,255,255,0.06)' }}
          >
            <span className="material-symbols-outlined text-[14px]">stop_circle</span>
            Stop generating
          </button>
        </div>
      )}

      {/* Input — disabled until setup is confirmed ready */}
      <ChatInput onSend={sendMessage} disabled={isStreaming || !isReady} />
    </div>
  );
}
