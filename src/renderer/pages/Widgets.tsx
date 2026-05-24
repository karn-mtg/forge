import { useState, useEffect } from 'react';
import { Header } from '../components/Header';
import { WidgetRegistry } from '../widgets/registry';
import type { WidgetDef, WidgetData } from '../widgets/registry';
import { WidgetEditorModal } from '../components/WidgetEditorModal';
import { persistCustomWidgets } from '../App';

// ─── Realistic Commander deck mock data ───────────────────────────────────────
// 100-card Atraxa Superfriends used for all previews on this page.
const MOCK_DATA: WidgetData = (() => {
  const cards: WidgetData['cards'] = [
    // Commander
    { oracleId: 'atraxa',        name: 'Atraxa, Praetors\' Voice', qty: 1, board: 'commander', typeLine: 'Legendary Creature — Phyrexian Angel Horror', manaCost: '{G}{W}{U}{B}', cmc: 4, colorIdentity: ['W','U','B','G'] },
    // Planeswalkers
    { oracleId: 'pw-teferi',     name: 'Teferi, Hero of Dominaria',   qty: 1, board: 'main', typeLine: 'Legendary Planeswalker — Teferi',   manaCost: '{3}{W}{U}', cmc: 5, colorIdentity: ['W','U'] },
    { oracleId: 'pw-jace',       name: 'Jace, the Mind Sculptor',     qty: 1, board: 'main', typeLine: 'Legendary Planeswalker — Jace',     manaCost: '{2}{U}{U}', cmc: 4, colorIdentity: ['U'] },
    { oracleId: 'pw-liliana',    name: 'Liliana of the Veil',         qty: 1, board: 'main', typeLine: 'Legendary Planeswalker — Liliana',  manaCost: '{1}{B}{B}', cmc: 3, colorIdentity: ['B'] },
    { oracleId: 'pw-garruk',     name: 'Garruk Wildspeaker',          qty: 1, board: 'main', typeLine: 'Legendary Planeswalker — Garruk',   manaCost: '{2}{G}{G}', cmc: 4, colorIdentity: ['G'] },
    { oracleId: 'pw-elspeth',    name: 'Elspeth, Sun\'s Champion',    qty: 1, board: 'main', typeLine: 'Legendary Planeswalker — Elspeth',  manaCost: '{4}{W}{W}', cmc: 6, colorIdentity: ['W'] },
    { oracleId: 'pw-nissa',      name: 'Nissa, Who Shakes the World', qty: 1, board: 'main', typeLine: 'Legendary Planeswalker — Nissa',    manaCost: '{3}{G}{G}', cmc: 5, colorIdentity: ['G'] },
    { oracleId: 'pw-ugin',       name: 'Ugin, the Spirit Dragon',     qty: 1, board: 'main', typeLine: 'Legendary Planeswalker — Ugin',     manaCost: '{8}',       cmc: 8, colorIdentity: [] },
    // Creatures
    { oracleId: 'c-bird',        name: 'Birds of Paradise',      qty: 1, board: 'main', typeLine: 'Creature — Bird',             manaCost: '{G}',       cmc: 1, colorIdentity: ['G'] },
    { oracleId: 'c-llanowar',    name: 'Llanowar Elves',         qty: 1, board: 'main', typeLine: 'Creature — Elf Druid',        manaCost: '{G}',       cmc: 1, colorIdentity: ['G'] },
    { oracleId: 'c-arbor',       name: 'Arbor Elf',              qty: 1, board: 'main', typeLine: 'Creature — Elf Druid',        manaCost: '{G}',       cmc: 1, colorIdentity: ['G'] },
    { oracleId: 'c-thalia',      name: 'Thalia, Guardian of Thraben', qty: 1, board: 'main', typeLine: 'Legendary Creature — Human Soldier', manaCost: '{1}{W}', cmc: 2, colorIdentity: ['W'] },
    { oracleId: 'c-tefrel',      name: 'Eternal Witness',        qty: 1, board: 'main', typeLine: 'Creature — Human Shaman',     manaCost: '{1}{G}{G}', cmc: 3, colorIdentity: ['G'] },
    { oracleId: 'c-oracle',      name: 'Sylvan Library',         qty: 1, board: 'main', typeLine: 'Enchantment',                 manaCost: '{1}{G}',    cmc: 2, colorIdentity: ['G'] },
    { oracleId: 'c-trophy',      name: 'Deepglow Skate',         qty: 1, board: 'main', typeLine: 'Creature — Fish',             manaCost: '{4}{U}',    cmc: 5, colorIdentity: ['U'] },
    { oracleId: 'c-sphinx',      name: 'Sphinx of the Second Sun', qty: 1, board: 'main', typeLine: 'Creature — Sphinx',         manaCost: '{5}{W}{W}', cmc: 7, colorIdentity: ['W'] },
    // Instants
    { oracleId: 'i-counterspell',name: 'Counterspell',           qty: 1, board: 'main', typeLine: 'Instant',                    manaCost: '{U}{U}',    cmc: 2, colorIdentity: ['U'] },
    { oracleId: 'i-path',        name: 'Path to Exile',          qty: 1, board: 'main', typeLine: 'Instant',                    manaCost: '{W}',       cmc: 1, colorIdentity: ['W'] },
    { oracleId: 'i-swords',      name: 'Swords to Plowshares',   qty: 1, board: 'main', typeLine: 'Instant',                    manaCost: '{W}',       cmc: 1, colorIdentity: ['W'] },
    { oracleId: 'i-swan',        name: 'Swan Song',              qty: 1, board: 'main', typeLine: 'Instant',                    manaCost: '{U}',       cmc: 1, colorIdentity: ['U'] },
    { oracleId: 'i-fow',         name: 'Force of Will',          qty: 1, board: 'main', typeLine: 'Instant',                    manaCost: '{3}{U}{U}', cmc: 5, colorIdentity: ['U'] },
    { oracleId: 'i-krosan',      name: 'Krosan Grip',            qty: 1, board: 'main', typeLine: 'Instant',                    manaCost: '{2}{G}',    cmc: 3, colorIdentity: ['G'] },
    // Sorceries
    { oracleId: 's-demonic',     name: 'Demonic Tutor',          qty: 1, board: 'main', typeLine: 'Sorcery',                    manaCost: '{1}{B}',    cmc: 2, colorIdentity: ['B'] },
    { oracleId: 's-wrath',       name: 'Wrath of God',           qty: 1, board: 'main', typeLine: 'Sorcery',                    manaCost: '{2}{W}{W}', cmc: 4, colorIdentity: ['W'] },
    { oracleId: 's-cultivate',   name: 'Cultivate',              qty: 1, board: 'main', typeLine: 'Sorcery',                    manaCost: '{2}{G}',    cmc: 3, colorIdentity: ['G'] },
    { oracleId: 's-kodama',      name: 'Kodama\'s Reach',        qty: 1, board: 'main', typeLine: 'Sorcery',                    manaCost: '{2}{G}',    cmc: 3, colorIdentity: ['G'] },
    { oracleId: 's-ponder',      name: 'Ponder',                 qty: 1, board: 'main', typeLine: 'Sorcery',                    manaCost: '{U}',       cmc: 1, colorIdentity: ['U'] },
    // Enchantments
    { oracleId: 'e-rhystic',     name: 'Rhystic Study',          qty: 1, board: 'main', typeLine: 'Enchantment',                manaCost: '{2}{U}',    cmc: 3, colorIdentity: ['U'] },
    { oracleId: 'e-mystic',      name: 'Mystic Remora',          qty: 1, board: 'main', typeLine: 'Enchantment',                manaCost: '{U}',       cmc: 1, colorIdentity: ['U'] },
    { oracleId: 'e-propaganda',  name: 'Propaganda',             qty: 1, board: 'main', typeLine: 'Enchantment',                manaCost: '{2}{U}',    cmc: 3, colorIdentity: ['U'] },
    { oracleId: 'e-doubling',    name: 'Doubling Season',        qty: 1, board: 'main', typeLine: 'Enchantment',                manaCost: '{4}{G}',    cmc: 5, colorIdentity: ['G'] },
    // Artifacts
    { oracleId: 'a-sol',         name: 'Sol Ring',               qty: 1, board: 'main', typeLine: 'Artifact',                   manaCost: '{1}',       cmc: 1, colorIdentity: [] },
    { oracleId: 'a-arcane',      name: 'Arcane Signet',          qty: 1, board: 'main', typeLine: 'Artifact',                   manaCost: '{2}',       cmc: 2, colorIdentity: [] },
    { oracleId: 'a-commanders',  name: 'Commander\'s Sphere',    qty: 1, board: 'main', typeLine: 'Artifact',                   manaCost: '{3}',       cmc: 3, colorIdentity: [] },
    { oracleId: 'a-amulet',      name: 'Amulet of Vigor',        qty: 1, board: 'main', typeLine: 'Artifact',                   manaCost: '{1}',       cmc: 1, colorIdentity: [] },
    { oracleId: 'a-sensei',      name: 'Sensei\'s Divining Top', qty: 1, board: 'main', typeLine: 'Artifact',                   manaCost: '{1}',       cmc: 1, colorIdentity: [] },
    // Lands (37)
    ...Array.from({ length: 4 }, (_, i) => ({
      oracleId: `land-shock-${i}`, name: ['Hallowed Fountain','Watery Grave','Overgrown Tomb','Temple Garden'][i],
      qty: 1, board: 'main', typeLine: 'Land — Plains Island', manaCost: '', cmc: 0,
      colorIdentity: [['W','U'],['U','B'],['B','G'],['G','W']][i] as string[],
    })),
    ...Array.from({ length: 4 }, (_, i) => ({
      oracleId: `land-check-${i}`, name: ['Glacial Fortress','Drowned Catacomb','Woodland Cemetery','Sunpetal Grove'][i],
      qty: 1, board: 'main', typeLine: 'Land', manaCost: '', cmc: 0,
      colorIdentity: [['W','U'],['U','B'],['B','G'],['G','W']][i] as string[],
    })),
    { oracleId: 'land-cmd', name: 'Command Tower',  qty: 1, board: 'main', typeLine: 'Land', manaCost: '', cmc: 0, colorIdentity: [] },
    { oracleId: 'land-ancient', name: 'Ancient Tomb', qty: 1, board: 'main', typeLine: 'Land', manaCost: '', cmc: 0, colorIdentity: [] },
    { oracleId: 'land-cavern', name: 'Cavern of Souls', qty: 1, board: 'main', typeLine: 'Land', manaCost: '', cmc: 0, colorIdentity: [] },
    ...Array.from({ length: 5 }, (_, i) => ({
      oracleId: `land-basic-plains-${i}`, name: 'Plains',
      qty: 1, board: 'main', typeLine: 'Basic Land — Plains', manaCost: '', cmc: 0, colorIdentity: ['W'],
    })),
    ...Array.from({ length: 5 }, (_, i) => ({
      oracleId: `land-basic-island-${i}`, name: 'Island',
      qty: 1, board: 'main', typeLine: 'Basic Land — Island', manaCost: '', cmc: 0, colorIdentity: ['U'],
    })),
    ...Array.from({ length: 5 }, (_, i) => ({
      oracleId: `land-basic-swamp-${i}`, name: 'Swamp',
      qty: 1, board: 'main', typeLine: 'Basic Land — Swamp', manaCost: '', cmc: 0, colorIdentity: ['B'],
    })),
    ...Array.from({ length: 5 }, (_, i) => ({
      oracleId: `land-basic-forest-${i}`, name: 'Forest',
      qty: 1, board: 'main', typeLine: 'Basic Land — Forest', manaCost: '', cmc: 0, colorIdentity: ['G'],
    })),
    ...Array.from({ length: 5 }, (_, i) => ({
      oracleId: `land-fetch-${i}`, name: ['Windswept Heath','Flooded Strand','Polluted Delta','Verdant Catacombs','Misty Rainforest'][i],
      qty: 1, board: 'main', typeLine: 'Land', manaCost: '', cmc: 0, colorIdentity: [],
    })),
  ];

  const mainCards = cards.filter(c => c.board !== 'sideboard');
  return {
    cards: mainCards,
    allCards: cards,
    deckSize: mainCards.reduce((s, c) => s + c.qty, 0),
    // No arrangement groups on the static preview page — widget falls back to card types
    groups: [],
  };
})();

// ─── Single widget preview card ───────────────────────────────────────────────

function WidgetPreviewCard({
  def,
  onEdit,
  onDelete,
}: {
  def: WidgetDef;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const html = WidgetRegistry.render(def.id, MOCK_DATA);

  return (
    <div className="group relative flex flex-col rounded-2xl border border-white/5 bg-surface-container/30 hover:border-white/10 transition-all overflow-hidden">
      {/* Widget preview */}
      <div className="flex items-center justify-center px-6 py-8 bg-[#0D0D0D]/60 min-h-[140px]">
        <div className="canvas-widget" style={{ width: def.width ?? 220, flexShrink: 0 }}>
          <div className="widget-header">
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 13, color: 'rgba(242,202,131,0.55)', flexShrink: 0, fontVariationSettings: "'FILL' 1" }}
            >
              {def.icon}
            </span>
            <span className="widget-name">{def.name}</span>
          </div>
          <div className="widget-body" dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      </div>

      {/* Card footer */}
      <div className="flex items-start justify-between gap-3 px-4 py-3 border-t border-white/5">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <p className="text-[12px] font-bold text-on-surface truncate">{def.name}</p>
            {def.readonly
              ? <span className="flex-shrink-0 text-[8px] font-bold uppercase tracking-widest text-primary/35 border border-primary/15 rounded px-1 py-px">built-in</span>
              : <span className="flex-shrink-0 text-[8px] font-bold uppercase tracking-widest text-green-400/50 border border-green-400/15 rounded px-1 py-px">custom</span>
            }
          </div>
          {def.description && (
            <p className="text-[10px] text-on-surface-variant/45 leading-snug line-clamp-2">{def.description}</p>
          )}
        </div>

        {/* Edit / Delete for custom widgets */}
        {!def.readonly && (
          <div className="flex gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={onEdit}
              title="Edit widget"
              className="w-7 h-7 rounded-lg flex items-center justify-center text-on-surface-variant/50 hover:text-primary hover:bg-primary/10 transition-all"
            >
              <span className="material-symbols-outlined text-[15px]">edit</span>
            </button>
            <button
              onClick={onDelete}
              title="Delete widget"
              className="w-7 h-7 rounded-lg flex items-center justify-center text-on-surface-variant/50 hover:text-red-400 hover:bg-red-500/10 transition-all"
            >
              <span className="material-symbols-outlined text-[15px]">delete_outline</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function Widgets() {
  const [editorOpen,    setEditorOpen]    = useState(false);
  const [editorDef,     setEditorDef]     = useState<WidgetDef | null>(null);
  const [registryVersion, setVersion]     = useState(0);

  const bump = () => setVersion(v => v + 1);

  // Re-render when the editor closes (version bump from save also triggers this)
  const allWidgets = WidgetRegistry.getAll();
  const builtins   = allWidgets.filter(d =>  d.readonly);
  const customs    = allWidgets.filter(d => !d.readonly);

  // Trigger initial render once settings have loaded custom widgets
  useEffect(() => { bump(); }, []);

  const handleDelete = async (def: WidgetDef) => {
    WidgetRegistry.unregister(def.id);
    await persistCustomWidgets();
    bump();
  };

  const handleSave = async (saved: WidgetDef) => {
    WidgetRegistry.register({ ...saved, readonly: false });
    await persistCustomWidgets();
    bump();
    setEditorOpen(false);
  };

  return (
    <>
      <Header />
      <main className="px-margin-desktop py-8 min-h-screen">
        <div className="max-w-6xl mx-auto space-y-10">

          {/* Page header */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-headline-lg text-2xl text-on-surface">Widgets</h2>
              <p className="text-on-surface-variant text-body-md mt-1">
                Data panels you can place on any deck canvas · previewed below with a sample Commander deck
              </p>
            </div>
            <button
              onClick={() => { setEditorDef(null); setEditorOpen(true); }}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary/10 border border-primary/20 text-primary font-bold text-label-md hover:bg-primary/20 transition-all flex-shrink-0"
            >
              <span className="material-symbols-outlined text-[18px]">add</span>
              New Widget
            </button>
          </div>

          {/* Mock deck note */}
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white/[0.03] border border-white/5">
            <span className="material-symbols-outlined text-primary/50 text-[18px] flex-shrink-0">info</span>
            <p className="text-[11px] text-on-surface-variant/50">
              Previews use a mocked 100-card Atraxa Superfriends deck (W/U/B/G, ~37 lands, 7 planeswalkers).
              On a real deck canvas, widgets update live as you add or remove cards.
            </p>
          </div>

          {/* ── My Widgets ───────────────────────────────────────────────────── */}
          <section key={`custom-${registryVersion}`}>
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                <h3 className="font-label-md text-[11px] font-bold uppercase tracking-widest text-on-surface-variant/50">
                  My Widgets
                </h3>
                {customs.length > 0 && (
                  <span className="text-[10px] font-bold text-primary/50 bg-primary/10 rounded-full px-2 py-0.5">
                    {customs.length}
                  </span>
                )}
              </div>
            </div>

            {customs.length === 0 ? (
              <div
                onClick={() => { setEditorDef(null); setEditorOpen(true); }}
                className="flex flex-col items-center justify-center gap-4 py-16 rounded-2xl border-2 border-dashed border-white/5 hover:border-primary/20 hover:bg-primary/[0.03] transition-all cursor-pointer group"
              >
                <div className="w-14 h-14 rounded-2xl bg-primary/10 group-hover:bg-primary/15 flex items-center justify-center transition-all">
                  <span className="material-symbols-outlined text-primary text-[28px]">add</span>
                </div>
                <div className="text-center">
                  <p className="text-[13px] font-bold text-on-surface/60 group-hover:text-on-surface/80 transition-all">
                    No custom widgets yet
                  </p>
                  <p className="text-[11px] text-on-surface-variant/35 mt-1">
                    Click to create your first widget with live preview
                  </p>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {customs.map(def => (
                  <WidgetPreviewCard
                    key={def.id}
                    def={def}
                    onEdit={() => { setEditorDef(def); setEditorOpen(true); }}
                    onDelete={() => handleDelete(def)}
                  />
                ))}
                {/* "Add another" ghost card */}
                <button
                  onClick={() => { setEditorDef(null); setEditorOpen(true); }}
                  className="flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-white/5 hover:border-primary/25 hover:bg-primary/[0.03] transition-all min-h-[200px] group"
                >
                  <span className="material-symbols-outlined text-on-surface-variant/25 group-hover:text-primary/50 text-[28px] transition-all">add_circle</span>
                  <span className="text-[11px] text-on-surface-variant/30 group-hover:text-primary/50 font-bold transition-all">New Widget</span>
                </button>
              </div>
            )}
          </section>

          {/* ── Built-in Widgets ─────────────────────────────────────────────── */}
          <section key={`builtins-${registryVersion}`}>
            <div className="flex items-center gap-3 mb-5">
              <h3 className="font-label-md text-[11px] font-bold uppercase tracking-widest text-on-surface-variant/50">
                Built-in
              </h3>
              <span className="text-[10px] font-bold text-on-surface-variant/30 bg-white/5 rounded-full px-2 py-0.5">
                {builtins.length}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {builtins.map(def => (
                <WidgetPreviewCard key={def.id} def={def} />
              ))}
            </div>
          </section>

        </div>
      </main>

      {/* Widget editor modal */}
      {editorOpen && (
        <WidgetEditorModal
          def={editorDef}
          previewData={MOCK_DATA}
          onClose={() => setEditorOpen(false)}
          onSave={handleSave}
        />
      )}
    </>
  );
}
