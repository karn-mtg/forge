import { useState, useEffect, useCallback } from 'react';

interface ArsenalStatus {
  installed: boolean;
  version: string | null;
  cardsDbVersion: string | null;
  rulesDbVersion: string | null;
  rulesInstalled: boolean;
  cardsInstalled: boolean;
}

interface ComponentUpdate {
  current: string | null;
  latest: string | null;
  hasUpdate: boolean;
}

interface AllUpdates {
  server: ComponentUpdate;
  cards: ComponentUpdate;
  rules: ComponentUpdate;
}

export function ArsenalPanel() {
  const [status, setStatus] = useState<ArsenalStatus | null>(null);
  const [updates, setUpdates] = useState<AllUpdates | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [downloading, setDownloading] = useState<'server' | 'cards' | 'rules' | null>(null);
  const [isRestarting, setIsRestarting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const s = await window.arsenalAPI.getStatus();
      setStatus(s);
    } catch {
      setStatus({ installed: false, version: null, cardsDbVersion: null, rulesDbVersion: null, rulesInstalled: false, cardsInstalled: false });
    }
  }, []);

  useEffect(() => {
    refreshStatus();
    const interval = setInterval(refreshStatus, 5000);
    return () => clearInterval(interval);
  }, [refreshStatus]);

  useEffect(() => {
    window.arsenalAPI.onProgress(({ component, pct }) => {
      if (component === downloading || downloading === null) setProgress(pct);
    });
    return () => window.arsenalAPI.removeListeners();
  }, [downloading]);

  const handleCheckUpdates = async () => {
    setIsChecking(true);
    setError(null);
    try {
      const result = await window.arsenalAPI.checkAllForUpdates();
      setUpdates(result);
    } catch {
      setError('Failed to check for updates.');
    } finally {
      setIsChecking(false);
    }
  };

  const handleDownloadServer = async () => {
    if (!updates?.server.latest) return;
    setDownloading('server');
    setProgress(0);
    setError(null);
    try {
      await window.arsenalAPI.downloadUpdate(updates.server.latest);
      setUpdates(prev => prev ? { ...prev, server: { ...prev.server, hasUpdate: false, current: prev.server.latest } } : prev);
      await refreshStatus();
    } catch {
      setError('Server update failed.');
    } finally {
      setDownloading(null);
      setProgress(0);
    }
  };

  const handleDownloadDb = async (component: 'cards' | 'rules') => {
    const latest = updates?.[component]?.latest;
    if (!latest) return;
    setDownloading(component);
    setProgress(0);
    setError(null);
    try {
      await window.arsenalAPI.downloadDbUpdate(component, latest);
      setUpdates(prev => prev ? { ...prev, [component]: { ...prev[component], hasUpdate: false, current: latest } } : prev);
      await refreshStatus();
    } catch {
      setError(`${component === 'cards' ? 'Cards' : 'Rules'} DB update failed.`);
    } finally {
      setDownloading(null);
      setProgress(0);
    }
  };

  const handleRestart = async () => {
    setIsRestarting(true);
    setError(null);
    try {
      await window.arsenalAPI.restart();
      setTimeout(async () => {
        await refreshStatus();
        setIsRestarting(false);
      }, 2000);
    } catch {
      setError('Restart failed.');
      setIsRestarting(false);
    }
  };

  const ServerDot = ({ installed, label }: { installed: boolean; label: string }) => (
    <div className="flex items-center gap-2">
      <span className={`w-2 h-2 rounded-full ${installed ? 'bg-green-400' : 'bg-white/20'}`} />
      <span className="text-body-sm text-on-surface-variant">{label}</span>
      <span className={`text-[11px] font-bold ${installed ? 'text-green-400/80' : 'text-on-surface-variant/40'}`}>
        {installed ? 'Configured' : 'Not installed'}
      </span>
    </div>
  );

  const ComponentRow = ({
    label,
    version,
    update,
    onDownload,
    isActive,
  }: {
    label: string;
    version: string | null;
    update: ComponentUpdate | null;
    onDownload: () => void;
    isActive: boolean;
  }) => (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-body-sm text-on-surface-variant truncate">{label}</span>
        {version && (
          <span className="text-[11px] font-bold text-on-surface-variant/50 bg-surface-container/60 border border-white/10 rounded-full px-2 py-0.5 shrink-0">
            v{version}
          </span>
        )}
        {!version && (
          <span className="text-[11px] text-on-surface-variant/30">Not installed</span>
        )}
      </div>
      <div className="shrink-0">
        {update?.hasUpdate && !isActive ? (
          <button
            onClick={onDownload}
            disabled={!!downloading}
            className="flex items-center gap-1.5 px-3 py-1 bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30 transition-all font-bold rounded-lg text-[11px] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <span className="material-symbols-outlined text-[14px]">download</span>
            v{update.latest}
          </button>
        ) : update && !update.hasUpdate ? (
          <span className="flex items-center gap-1 text-[11px] text-green-400/60">
            <span className="material-symbols-outlined text-[13px]">check_circle</span>
            Up to date
          </span>
        ) : isActive ? (
          <span className="flex items-center gap-1 text-[11px] text-primary/70">
            <span className="material-symbols-outlined text-[13px] animate-spin">sync</span>
            {progress}%
          </span>
        ) : null}
      </div>
    </div>
  );

  return (
    <div className="bg-surface border border-white/5 rounded-2xl p-6 shadow-xl space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="font-headline-md text-base text-on-surface">Arsenal (MCP Servers)</h3>
      </div>

      {/* MCP server status */}
      <div className="bg-surface-container/40 rounded-xl p-4 border border-white/5 space-y-2.5">
        <p className="text-[10px] uppercase tracking-widest text-on-surface-variant/40 font-bold mb-3">MCP Servers</p>
        <ServerDot installed={status?.rulesInstalled ?? false} label="Rules MCP" />
        <ServerDot installed={status?.cardsInstalled ?? false} label="Cards MCP" />
      </div>

      {/* Component version rows */}
      <div className="bg-surface-container/40 rounded-xl p-4 border border-white/5">
        <p className="text-[10px] uppercase tracking-widest text-on-surface-variant/40 font-bold mb-3">Components</p>
        <div className="divide-y divide-white/5">
          <ComponentRow
            label="Server"
            version={status?.version ?? null}
            update={updates?.server ?? null}
            onDownload={handleDownloadServer}
            isActive={downloading === 'server'}
          />
          <ComponentRow
            label="Cards DB"
            version={status?.cardsDbVersion ?? null}
            update={updates?.cards ?? null}
            onDownload={() => handleDownloadDb('cards')}
            isActive={downloading === 'cards'}
          />
          <ComponentRow
            label="Rules DB"
            version={status?.rulesDbVersion ?? null}
            update={updates?.rules ?? null}
            onDownload={() => handleDownloadDb('rules')}
            isActive={downloading === 'rules'}
          />
        </div>
      </div>

      {/* Download progress bar */}
      {downloading && (
        <div>
          <div className="flex items-center justify-between text-[11px] text-on-surface-variant/50 mb-1.5">
            <span>Downloading {downloading === 'server' ? 'server' : `${downloading} DB`}…</span>
            <span className="tabular-nums">{progress}%</span>
          </div>
          <div className="w-full h-1 bg-surface-container rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-300"
              style={{ width: progress > 0 ? `${progress}%` : '5%' }}
            />
          </div>
        </div>
      )}

      {error && (
        <p className="text-[12px] text-red-400/80">{error}</p>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-2 pt-1">
        <button
          onClick={handleCheckUpdates}
          disabled={isChecking || !!downloading}
          className="flex items-center gap-2 px-4 py-2 bg-surface-container border border-white/5 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-white/5 transition-all font-bold text-label-md disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <span className={`material-symbols-outlined text-[18px] ${isChecking ? 'animate-spin' : ''}`}>
            {isChecking ? 'sync' : 'system_update'}
          </span>
          {isChecking ? 'Checking…' : 'Check for Updates'}
        </button>

        <button
          onClick={handleRestart}
          disabled={isRestarting || !!downloading || !status?.installed}
          className="flex items-center gap-2 px-4 py-2 bg-surface-container border border-white/5 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-white/5 transition-all font-bold text-label-md disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <span className={`material-symbols-outlined text-[18px] ${isRestarting ? 'animate-spin' : ''}`}>
            restart_alt
          </span>
          {isRestarting ? 'Restarting…' : 'Restart Servers'}
        </button>
      </div>

      {!status?.installed && (
        <p className="text-[12px] text-on-surface-variant/50">
          Arsenal not installed. Download a release from GitHub to enable MCP servers.
        </p>
      )}
    </div>
  );
}
