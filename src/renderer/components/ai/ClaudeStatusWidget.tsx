import { useEffect, useState } from 'react';

type Status = 'checking' | 'ready' | 'not_installed' | 'not_logged_in';

export function ClaudeStatusWidget() {
  const [status, setStatus] = useState<Status>('checking');
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    window.aiAPI.checkClaude().then(r => {
      if (!r.installed) setStatus('not_installed');
      else if (!r.loggedIn) setStatus('not_logged_in');
      else { setStatus('ready'); setVersion(r.version); }
    }).catch(() => setStatus('not_installed'));
  }, []);

  if (status === 'checking') {
    return (
      <div className="flex items-center gap-2 text-xs" style={{ color: '#555' }}>
        <span className="material-symbols-outlined text-[14px] animate-spin">progress_activity</span>
        Checking Claude Code…
      </div>
    );
  }

  if (status === 'not_installed') {
    return (
      <div className="rounded-xl px-3 py-2.5 text-xs" style={{ background: 'rgba(220,80,80,0.07)', border: '1px solid rgba(220,80,80,0.15)' }}>
        <div className="flex items-center gap-1.5 font-semibold mb-1" style={{ color: '#ff8080' }}>
          <span className="material-symbols-outlined text-[14px]">error</span>
          Claude Code not found
        </div>
        <p style={{ color: '#cc6060' }}>
          Install from <span className="font-mono">claude.ai/code</span>, then restart KarnForge.
        </p>
      </div>
    );
  }

  if (status === 'not_logged_in') {
    return (
      <div className="rounded-xl px-3 py-2.5 text-xs" style={{ background: 'rgba(220,160,60,0.07)', border: '1px solid rgba(220,160,60,0.15)' }}>
        <div className="flex items-center gap-1.5 font-semibold mb-1" style={{ color: '#e8c060' }}>
          <span className="material-symbols-outlined text-[14px]">key</span>
          Not logged in
        </div>
        <p style={{ color: '#b09040' }}>
          Run <span className="font-mono bg-black/20 px-1 rounded">claude login</span> in your terminal.
        </p>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-xs" style={{ color: '#3a8' }}>
      <span className="material-symbols-outlined text-[14px]">check_circle</span>
      Claude Code ready{version ? ` — ${version}` : ''}
    </div>
  );
}
