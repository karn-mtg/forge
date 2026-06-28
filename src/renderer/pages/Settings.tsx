import { useState, useEffect, useCallback } from 'react';
import { PageHeader } from '../components/PageHeader';
import { ArsenalPanel } from '../components/ArsenalPanel';
import { ClaudeStatusWidget } from '../components/ai/ClaudeStatusWidget';

type ForgeUpdateState =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'available'; version: string }
  | { phase: 'downloading'; pct: number }
  | { phase: 'ready'; version: string }
  | { phase: 'upToDate' }
  | { phase: 'error'; message: string };

function ForgeUpdatePanel() {
  const [appVersion, setAppVersion] = useState('—');
  const [state, setState] = useState<ForgeUpdateState>({ phase: 'idle' });

  useEffect(() => {
    window.forgeUpdateAPI.getVersion().then(setAppVersion).catch(() => {});
  }, []);

  useEffect(() => {
    window.forgeUpdateAPI.onUpdateAvailable(({ version }) =>
      setState({ phase: 'available', version }));
    window.forgeUpdateAPI.onUpdateNotAvailable(() =>
      setState({ phase: 'upToDate' }));
    window.forgeUpdateAPI.onDownloadProgress((pct) =>
      setState({ phase: 'downloading', pct }));
    window.forgeUpdateAPI.onUpdateReady(({ version }) =>
      setState({ phase: 'ready', version }));
    window.forgeUpdateAPI.onError((message) =>
      setState({ phase: 'error', message }));
    return () => window.forgeUpdateAPI.removeListeners();
  }, []);

  const handleCheck = useCallback(async () => {
    setState({ phase: 'checking' });
    try {
      await window.forgeUpdateAPI.checkForUpdate();
    } catch {
      setState({ phase: 'error', message: 'Failed to check for updates.' });
    }
  }, []);

  const handleDownload = useCallback(async () => {
    setState({ phase: 'downloading', pct: 0 });
    try {
      await window.forgeUpdateAPI.downloadUpdate();
    } catch {
      setState({ phase: 'error', message: 'Download failed.' });
    }
  }, []);

  return (
    <div className="bg-surface border border-white/5 rounded-2xl p-6 shadow-xl space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="font-headline-md text-base text-on-surface">Karn Forge</h3>
        <span className="text-[11px] font-bold text-on-surface-variant/50 bg-surface-container/60 border border-white/10 rounded-full px-2 py-0.5">
          v{appVersion}
        </span>
      </div>

      <div className="bg-surface-container/40 rounded-xl p-4 border border-white/5 flex items-center justify-between gap-3">
        <span className="text-body-sm text-on-surface-variant">App</span>

        <div className="shrink-0">
          {state.phase === 'upToDate' && (
            <span className="flex items-center gap-1 text-[11px] text-green-400/60">
              <span className="material-symbols-outlined text-[13px]">check_circle</span>
              Up to date
            </span>
          )}
          {state.phase === 'checking' && (
            <span className="flex items-center gap-1 text-[11px] text-primary/70">
              <span className="material-symbols-outlined text-[13px] animate-spin">sync</span>
              Checking…
            </span>
          )}
          {state.phase === 'available' && (
            <button
              onClick={handleDownload}
              className="flex items-center gap-1.5 px-3 py-1 bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30 transition-all font-bold rounded-lg text-[11px]"
            >
              <span className="material-symbols-outlined text-[14px]">download</span>
              v{state.version}
            </button>
          )}
          {state.phase === 'downloading' && (
            <span className="flex items-center gap-1 text-[11px] text-primary/70">
              <span className="material-symbols-outlined text-[13px] animate-spin">sync</span>
              {state.pct}%
            </span>
          )}
          {state.phase === 'ready' && (
            <button
              onClick={() => window.forgeUpdateAPI.installUpdate()}
              className="flex items-center gap-1.5 px-3 py-1 bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30 transition-all font-bold rounded-lg text-[11px]"
            >
              <span className="material-symbols-outlined text-[14px]">restart_alt</span>
              Install v{state.version}
            </button>
          )}
        </div>
      </div>

      {state.phase === 'downloading' && (
        <div>
          <div className="text-[11px] text-on-surface-variant/40 mb-1.5">Downloading update…</div>
          <div className="w-full h-1 bg-surface-container rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-300"
              style={{ width: state.pct > 0 ? `${state.pct}%` : '2%' }}
            />
          </div>
        </div>
      )}

      {state.phase === 'error' && (
        <p className="text-[12px] text-red-400/80">{state.message}</p>
      )}

      {(state.phase === 'idle' || state.phase === 'upToDate' || state.phase === 'error') && (
        <button
          onClick={handleCheck}
          className="flex items-center gap-2 px-4 py-2 bg-surface-container border border-white/5 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-white/5 transition-all font-bold text-label-md"
        >
          <span className="material-symbols-outlined text-[18px]">system_update</span>
          Check for Updates
        </button>
      )}
    </div>
  );
}

export function Settings() {
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [saved, setSaved] = useState(false);

  const [dbStatus, setDbStatus] = useState<{ cardCount?: number; last_updated_at?: string } | null>(null);

  useEffect(() => {
    window.settingsAPI.get().then(s => { setSettings(s || {}); setIsLoading(false); });
    window.cardsAPI.getStatus().then(setDbStatus).catch(() => setDbStatus(null));
  }, []);

  const handleSave = async () => {
    await window.settingsAPI.set(settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const fmtDate = (iso?: string) => {
    if (!iso) return 'Never';
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
      + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="flex flex-col h-full">
      <PageHeader icon="settings" title="Settings" />
      <main className="flex-1 overflow-auto p-margin-desktop">
        <div className="max-w-2xl mx-auto space-y-8">

          {isLoading ? (
            <div className="flex items-center justify-center py-24">
              <span className="material-symbols-outlined text-[40px] text-primary/30 animate-spin">sync</span>
            </div>
          ) : (
            <div className="space-y-6">

              {/* App preferences */}
              <div className="bg-surface border border-white/5 rounded-2xl p-6 shadow-xl space-y-6">
                <h3 className="font-headline-md text-base text-on-surface">Preferences</h3>
                <div>
                  <label className="text-label-sm text-on-surface-variant/60 uppercase tracking-wider mb-1.5 block">Default Deck Format</label>
                  <select
                    value={(settings.defaultFormat as string) || 'commander'}
                    onChange={e => setSettings(s => ({ ...s, defaultFormat: e.target.value }))}
                    className="bg-surface-container/50 border border-white/10 rounded-lg py-2.5 px-4 text-body-md focus:outline-none focus:border-primary/50 transition-all"
                  >
                    {['commander', 'modern', 'standard', 'pioneer', 'legacy', 'pauper'].map(f => (
                      <option key={f} value={f}>{f.charAt(0).toUpperCase() + f.slice(1)}</option>
                    ))}
                  </select>
                </div>

                <div className="border-t border-white/5 pt-6 flex justify-end">
                  <button
                    onClick={handleSave}
                    className="flex items-center gap-2 px-5 py-2 bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30 transition-all font-bold rounded-lg text-label-md"
                  >
                    {saved ? (
                      <><span className="material-symbols-outlined text-[18px]">check</span>Saved</>
                    ) : 'Save Settings'}
                  </button>
                </div>
              </div>

              {/* Card Database */}
              <div className="bg-surface border border-white/5 rounded-2xl p-6 shadow-xl space-y-5">
                <div className="flex items-center justify-between">
                  <h3 className="font-headline-md text-base text-on-surface">Card Database</h3>
                  {(dbStatus?.cardCount ?? 0) > 0 ? (
                    <span className="flex items-center gap-1.5 text-[11px] text-green-400/80 font-bold">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-400/80" />
                      Ready
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-[11px] text-orange-400/80 font-bold">
                      <span className="w-1.5 h-1.5 rounded-full bg-orange-400/80" />
                      Not installed
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-surface-container/40 rounded-xl p-4 border border-white/5">
                    <p className="text-[10px] uppercase tracking-widest text-on-surface-variant/40 font-bold mb-1">Cards in Database</p>
                    <p className="text-xl font-bold text-on-surface tabular-nums">
                      {dbStatus?.cardCount != null ? dbStatus.cardCount.toLocaleString() : '—'}
                    </p>
                  </div>
                  <div className="bg-surface-container/40 rounded-xl p-4 border border-white/5">
                    <p className="text-[10px] uppercase tracking-widest text-on-surface-variant/40 font-bold mb-1">Last Updated</p>
                    <p className="text-sm font-medium text-on-surface">{fmtDate(dbStatus?.last_updated_at)}</p>
                  </div>
                </div>

                <p className="text-[12px] text-on-surface-variant/50 flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[14px]">shield</span>
                  Managed by Arsenal — install or update via the Arsenal panel below.
                </p>
              </div>

              {/* AI Assistant */}
              <div className="bg-surface border border-white/5 rounded-2xl p-6 shadow-xl space-y-5">
                <h3 className="font-headline-md text-base text-on-surface">AI Assistant</h3>

                <div>
                  <label className="text-label-sm text-on-surface-variant/60 uppercase tracking-wider mb-1.5 block">Provider</label>
                  <select
                    value={((settings as any).ai?.provider as string) || 'claude-cli'}
                    onChange={async e => {
                      const provider = e.target.value;
                      setSettings(s => ({ ...s, ai: { ...((s as any).ai ?? {}), provider } }));
                      await window.settingsAPI.set({ ai: { ...((settings as any).ai ?? {}), provider } });
                      await window.aiAPI.resetProvider();
                    }}
                    className="bg-surface-container/50 border border-white/10 rounded-lg py-2.5 px-4 text-body-md focus:outline-none focus:border-primary/50 transition-all"
                  >
                    <option value="claude-cli">Claude Code (local)</option>
                    <option value="openai" disabled>OpenAI (coming soon)</option>
                  </select>
                </div>

                <ClaudeStatusWidget />
              </div>

              {/* Forge app updates */}
              <ForgeUpdatePanel />

              {/* Arsenal MCP servers */}
              <ArsenalPanel />

              {/* Data / files */}
              <div className="bg-surface border border-white/5 rounded-2xl p-6 shadow-xl space-y-4">
                <h3 className="font-headline-md text-base text-on-surface">Data</h3>
                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={() => window.settingsAPI.openUserData()}
                    className="flex items-center gap-2 px-4 py-2 bg-surface-container border border-white/5 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-white/5 transition-all text-label-md"
                  >
                    <span className="material-symbols-outlined text-[18px]">folder_open</span>
                    Open Data Folder
                  </button>
                  <button
                    onClick={() => window.settingsAPI.openLogs()}
                    className="flex items-center gap-2 px-4 py-2 bg-surface-container border border-white/5 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-white/5 transition-all text-label-md"
                  >
                    <span className="material-symbols-outlined text-[18px]">terminal</span>
                    Open Logs Folder
                  </button>
                </div>
              </div>

            </div>
          )}
        </div>
      </main>
    </div>
  );
}
