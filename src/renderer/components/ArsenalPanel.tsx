import { useState, useEffect, useCallback } from 'react';

interface ArsenalStatus {
  installed: boolean;
  version: string | null;
  cardsDbVersion: string | null;
  rulesDbVersion: string | null;
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

type SetupPhase = 'server' | 'cards' | 'rules';

const PHASE_LABELS: Record<SetupPhase, string> = {
  server: 'Downloading server…',
  cards:  'Downloading cards database…',
  rules:  'Downloading rules database…',
};

export function ArsenalPanel() {
  const [status, setStatus] = useState<ArsenalStatus | null>(null);
  const [updates, setUpdates] = useState<AllUpdates | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [downloading, setDownloading] = useState<'server' | 'cards' | 'rules' | null>(null);
  const [isSettingUp, setIsSettingUp] = useState(false);
  const [setupPhase, setSetupPhase] = useState<SetupPhase | null>(null);
  const [setupDone, setSetupDone] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const s = await window.arsenalAPI.getStatus();
      setStatus(s);
    } catch {
      setStatus({ installed: false, version: null, cardsDbVersion: null, rulesDbVersion: null });
    }
  }, []);

  useEffect(() => {
    refreshStatus();
    const interval = setInterval(refreshStatus, 5000);
    return () => clearInterval(interval);
  }, [refreshStatus]);

  // Register all progress listeners once on mount
  useEffect(() => {
    window.arsenalAPI.onProgress(({ pct }) => setProgress(pct));
    window.arsenalAPI.onSetupProgress(({ phase, pct }: { phase: SetupPhase; pct: number }) => {
      setSetupPhase(phase);
      setProgress(pct);
    });
    return () => window.arsenalAPI.removeListeners();
  }, []);

  const handleSetupAll = async () => {
    setIsSettingUp(true);
    setSetupDone(false);
    setError(null);
    setProgress(0);
    setSetupPhase('server');
    try {
      await window.arsenalAPI.installAll();
      setSetupDone(true);
      await refreshStatus();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Installation failed. Check your connection and try again.');
    } finally {
      setIsSettingUp(false);
      setSetupPhase(null);
      setProgress(0);
    }
  };

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
        {version ? (
          <span className="text-[11px] font-bold text-on-surface-variant/50 bg-surface-container/60 border border-white/10 rounded-full px-2 py-0.5 shrink-0">
            v{version}
          </span>
        ) : (
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

  // ── First-run setup state ─────────────────────────────────────────────────
  if (status !== null && !status.installed && !isSettingUp && !setupDone) {
    return (
      <div className="bg-surface border border-white/5 rounded-2xl p-6 shadow-xl space-y-5">
        <div className="flex items-center gap-3">
          <span className="material-symbols-outlined text-[28px] text-primary/70">smart_toy</span>
          <div>
            <h3 className="font-headline-md text-base text-on-surface">Arsenal not installed</h3>
            <p className="text-body-sm text-on-surface-variant/60 mt-0.5">
              Arsenal gives Karn its card search, combo detection, and rules engine.
            </p>
          </div>
        </div>

        <div className="bg-surface-container/40 rounded-xl p-4 border border-white/5 space-y-2 text-body-sm text-on-surface-variant/70">
          <p className="flex items-center gap-2"><span className="material-symbols-outlined text-[16px] text-primary/60">search</span> Semantic card search</p>
          <p className="flex items-center gap-2"><span className="material-symbols-outlined text-[16px] text-primary/60">hub</span> Combo detection via card graph</p>
          <p className="flex items-center gap-2"><span className="material-symbols-outlined text-[16px] text-primary/60">gavel</span> MTG rules engine</p>
        </div>

        {error && <p className="text-[12px] text-red-400/80">{error}</p>}

        <button
          onClick={handleSetupAll}
          className="w-full flex items-center justify-center gap-2 px-5 py-3 bg-primary/15 text-primary border border-primary/30 hover:bg-primary/25 transition-all font-bold rounded-xl text-label-md"
        >
          <span className="material-symbols-outlined text-[20px]">download</span>
          Install Arsenal
        </button>
        <p className="text-[11px] text-on-surface-variant/30 text-center">
          Downloads the server binary and card + rules databases (~500 MB total)
        </p>
      </div>
    );
  }

  // ── In-progress setup ─────────────────────────────────────────────────────
  if (isSettingUp || (setupDone && !status?.installed)) {
    return (
      <div className="bg-surface border border-white/5 rounded-2xl p-6 shadow-xl space-y-5">
        <h3 className="font-headline-md text-base text-on-surface">Installing Arsenal…</h3>

        <div className="space-y-3">
          {(['server', 'cards', 'rules'] as const).map((phase) => {
            const isDone = setupPhase
              ? ['server', 'cards', 'rules'].indexOf(phase) < ['server', 'cards', 'rules'].indexOf(setupPhase)
              : setupDone;
            const isActive = setupPhase === phase;
            return (
              <div key={phase} className="flex items-center gap-3">
                <span className={`material-symbols-outlined text-[18px] ${isDone ? 'text-green-400' : isActive ? 'text-primary animate-spin' : 'text-on-surface-variant/20'}`}>
                  {isDone ? 'check_circle' : isActive ? 'sync' : 'radio_button_unchecked'}
                </span>
                <span className={`text-body-sm ${isActive ? 'text-on-surface' : isDone ? 'text-on-surface-variant/60' : 'text-on-surface-variant/30'}`}>
                  {phase === 'server' ? 'Server binary' : phase === 'cards' ? 'Cards database' : 'Rules database'}
                </span>
                {isActive && <span className="ml-auto text-[11px] text-primary/70 tabular-nums">{progress}%</span>}
              </div>
            );
          })}
        </div>

        {setupPhase && (
          <div>
            <div className="text-[11px] text-on-surface-variant/40 mb-1.5">{PHASE_LABELS[setupPhase]}</div>
            <div className="w-full h-1 bg-surface-container rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-300"
                style={{ width: progress > 0 ? `${progress}%` : '2%' }}
              />
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Installed state ───────────────────────────────────────────────────────
  return (
    <div className="bg-surface border border-white/5 rounded-2xl p-6 shadow-xl space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="font-headline-md text-base text-on-surface">Arsenal</h3>
        {setupDone && (
          <span className="flex items-center gap-1 text-[11px] text-green-400/80 font-bold">
            <span className="material-symbols-outlined text-[14px]">check_circle</span>
            Installed
          </span>
        )}
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

      {/* Download progress bar (individual component updates) */}
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

      {error && <p className="text-[12px] text-red-400/80">{error}</p>}

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
      </div>
    </div>
  );
}
