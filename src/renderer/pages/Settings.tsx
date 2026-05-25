import { useState, useEffect } from 'react';
import { useSyncStore } from '../store/useSyncStore';

export function Settings() {
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [saved, setSaved] = useState(false);

  // Card database state
  const [dbStatus, setDbStatus] = useState<{ synced: boolean; cardCount?: number } | null>(null);
  // Sync progress comes directly from useSyncStore — no toast coupling needed
  const { isSyncing, startSync, phase, progress, detail } = useSyncStore();

  useEffect(() => {
    window.settingsAPI.get().then(s => { setSettings(s || {}); setIsLoading(false); });
    window.cardsAPI.getStatus().then(setDbStatus).catch(() => setDbStatus({ synced: false }));
  }, []);

  // Refresh card count after sync completes
  useEffect(() => {
    if (!isSyncing) {
      window.cardsAPI.getStatus().then(setDbStatus).catch(() => {});
    }
  }, [isSyncing]);

  const handleSave = async () => {
    await window.settingsAPI.set(settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const lastSynced = settings.lastSyncedAt as string | undefined;
  const fmtDate = (iso?: string) => {
    if (!iso) return 'Never';
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
      + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <>
      <main className="p-margin-desktop min-h-screen">
        <div className="max-w-2xl mx-auto space-y-8">
          <div>
            <h2 className="font-headline-lg text-2xl text-on-surface">Settings</h2>
            <p className="text-on-surface-variant text-body-md mt-1">App preferences and configuration</p>
          </div>

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

              {/* Card Database (#16) */}
              <div className="bg-surface border border-white/5 rounded-2xl p-6 shadow-xl space-y-5">
                <div className="flex items-center justify-between">
                  <h3 className="font-headline-md text-base text-on-surface">Card Database</h3>
                  {dbStatus?.synced && (
                    <span className="flex items-center gap-1.5 text-[11px] text-green-400/80 font-bold">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-400/80" />
                      Synced
                    </span>
                  )}
                  {!dbStatus?.synced && !isSyncing && (
                    <span className="flex items-center gap-1.5 text-[11px] text-orange-400/80 font-bold">
                      <span className="w-1.5 h-1.5 rounded-full bg-orange-400/80" />
                      Not synced
                    </span>
                  )}
                  {isSyncing && (
                    <span className="flex items-center gap-1.5 text-[11px] text-primary/80 font-bold">
                      <span className="material-symbols-outlined text-[14px] animate-spin">sync</span>
                      Syncing…
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
                    <p className="text-sm font-medium text-on-surface">{fmtDate(lastSynced)}</p>
                  </div>
                </div>

                {/* Sync progress bar */}
                {isSyncing && (
                  <div>
                    <div className="flex items-center justify-between text-[11px] text-on-surface-variant/50 mb-1.5">
                      <span className="capitalize">{phase || 'Syncing…'}</span>
                      {detail && <span className="tabular-nums">{detail}</span>}
                    </div>
                    <div className="w-full h-1 bg-surface-container rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full transition-all duration-300"
                        style={{ width: progress > 0 ? `${progress}%` : '30%' }}
                      />
                    </div>
                  </div>
                )}

                <div className="flex gap-3 pt-1">
                  <button
                    onClick={() => startSync(false)}
                    disabled={isSyncing}
                    className="flex items-center gap-2 px-4 py-2 bg-primary/10 text-primary border border-primary/20 rounded-lg hover:bg-primary/20 transition-all font-bold text-label-md disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <span className={`material-symbols-outlined text-[18px] ${isSyncing ? 'animate-spin' : ''}`}>sync</span>
                    {isSyncing ? 'Syncing…' : 'Sync Now'}
                  </button>
                  <button
                    onClick={() => startSync(true)}
                    disabled={isSyncing}
                    className="flex items-center gap-2 px-4 py-2 bg-surface-container border border-white/5 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-white/5 transition-all font-bold text-label-md disabled:opacity-40 disabled:cursor-not-allowed"
                    title="Re-download all card data from Scryfall"
                  >
                    <span className="material-symbols-outlined text-[18px]">restart_alt</span>
                    Force Refresh
                  </button>
                </div>
              </div>

              {/* Data / files */}
              <div className="bg-surface border border-white/5 rounded-2xl p-6 shadow-xl space-y-4">
                <h3 className="font-headline-md text-base text-on-surface">Data</h3>
                <button
                  onClick={() => window.settingsAPI.openUserData()}
                  className="flex items-center gap-2 px-4 py-2 bg-surface-container border border-white/5 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-white/5 transition-all text-label-md"
                >
                  <span className="material-symbols-outlined text-[18px]">folder_open</span>
                  Open Data Folder
                </button>
              </div>

            </div>
          )}
        </div>
      </main>
    </>
  );
}
