import { useState, useEffect, useRef } from 'react';
import { WidgetRegistry } from '../widgets/registry';
import type { WidgetDef, WidgetData, WidgetParam } from '../widgets/registry';
import { CardDecoratorRegistry } from '../widgets/overlayRegistry';
import type { CardDecoratorDef, OverlayCardData, OverlayAnchor } from '../widgets/overlayRegistry';

export const WIDGET_ICONS = [
  'widgets','bar_chart','palette','analytics','casino','category','terrain',
  'bolt','auto_awesome','calculate','timeline','query_stats','speed','hub',
  'grid_view','donut_large','show_chart','stacked_bar_chart','scatter_plot',
  'data_object','code','extension','star','favorite','shield','local_fire_department',
];

export const DEFAULT_WIDGET_CODE = `// data.cards   — array of main-deck cards (excl. sideboard)
// data.allCards — all cards incl. sideboard
// data.deckSize — total card count
// Each card: { name, qty, typeLine, manaCost, cmc, colorIdentity, board }
// params        — your defined parameters (key → value)
// Return an HTML string.

const { cards, deckSize } = data;
if (!cards.length) return '<p style="color:rgba(255,255,255,0.25);font-size:11px;text-align:center;padding:8px">Empty deck</p>';

const total = cards.reduce((s, c) => s + c.qty, 0);
return '<div style="font-family:-apple-system,sans-serif;text-align:center;padding:4px 0">'
  + '<div style="font-size:28px;font-weight:700;color:#f2ca83">' + total + '</div>'
  + '<div style="font-size:10px;color:rgba(255,255,255,0.35);margin-top:2px">cards in deck</div>'
  + '</div>';`;

export const DEFAULT_OVERLAY_CODE = `// card   — OverlayCardData (see API reference below)
// params — your defined parameters (key → value)
// Return an HTML string to overlay on each card image.

const name = card.name;
return '<div style="background:rgba(0,0,0,0.82);backdrop-filter:blur(4px);'
  + 'border-radius:8px;padding:2px 7px;font-size:10px;font-weight:700;'
  + 'color:#f2ca83;font-family:-apple-system,sans-serif;white-space:nowrap">'
  + name + '</div>';`;

const SAMPLE_OVERLAY_CARD: OverlayCardData = {
  oracleId: 'preview',
  name: "Atraxa, Praetors' Voice",
  typeLine: 'Legendary Creature — Phyrexian Angel Horror',
  manaCost: '{G}{W}{U}{B}',
  cmc: 4,
  colorIdentity: ['G', 'W', 'U', 'B'],
  edhrecRank: 42,
  edhrecPct: 67.3,
};

const OVERLAY_ANCHORS: { value: OverlayAnchor; label: string }[] = [
  { value: 'bc', label: 'Bottom Center' },
  { value: 'tc', label: 'Top Center' },
  { value: 'tl', label: 'Top Left' },
  { value: 'tr', label: 'Top Right' },
  { value: 'bl', label: 'Bottom Left' },
  { value: 'br', label: 'Bottom Right' },
];

const PARAM_TYPES: WidgetParam['type'][] = ['number', 'boolean', 'text', 'select'];

function emptyParam(): WidgetParam {
  return { key: '', label: '', type: 'number', default: 0 };
}

/** Returns true if def is a CardDecoratorDef (has 'anchor' property). */
function isDecoratorDef(d: unknown): d is CardDecoratorDef {
  return !!(d && typeof d === 'object' && 'anchor' in d);
}

interface Props {
  def: WidgetDef | CardDecoratorDef | null;   // null = new item
  previewData: WidgetData;
  onClose: () => void;
  onSave: (def: WidgetDef) => Promise<void>;
  onSaveOverlay?: (def: CardDecoratorDef) => Promise<void>;
}

export function WidgetEditorModal({ def, previewData, onClose, onSave, onSaveOverlay }: Props) {
  const isNew = def === null;
  const initOverlay = isDecoratorDef(def);

  const [mode,          setMode]    = useState<'widget' | 'overlay'>(initOverlay ? 'overlay' : 'widget');
  const [name,          setName]    = useState(def?.name        ?? '');
  const [description,   setDesc]    = useState(def?.description ?? '');
  const [icon,          setIcon]    = useState(def?.icon        ?? 'widgets');
  const [width,         setWidth]   = useState(isDecoratorDef(def) ? 220 : ((def as WidgetDef | null)?.width ?? 220));
  const [anchor,        setAnchor]  = useState<OverlayAnchor>(isDecoratorDef(def) ? def.anchor : 'bc');
  const [code,          setCode]    = useState(def?.code        ?? (initOverlay ? DEFAULT_OVERLAY_CODE : DEFAULT_WIDGET_CODE));
  const [params,        setParams]  = useState<WidgetParam[]>(def?.params ?? []);
  const [saving,        setSaving]  = useState(false);
  const [previewHtml,   setPreview] = useState('');
  const [iconPickerOpen, setIconPicker] = useState(false);
  const [paramsOpen,    setParamsOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  // When mode toggles, reset code to the appropriate default (only for new items)
  const handleModeChange = (m: 'widget' | 'overlay') => {
    setMode(m);
    if (isNew) {
      setCode(m === 'overlay' ? DEFAULT_OVERLAY_CODE : DEFAULT_WIDGET_CODE);
    }
  };

  // Live preview — debounced 400 ms after last keystroke
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const instanceParams = Object.fromEntries(params.map(p => [p.key, p.default]));
      if (mode === 'overlay') {
        setPreview(CardDecoratorRegistry.renderCode(code, SAMPLE_OVERLAY_CARD, instanceParams, params));
      } else {
        setPreview(WidgetRegistry.renderCode(code, previewData, instanceParams, params));
      }
    }, 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [code, previewData, params, mode]);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    const id = def?.id ?? `custom-${Date.now()}`;
    const cleanParams = params.filter(p => p.key.trim());
    if (mode === 'overlay') {
      await onSaveOverlay?.({ id, name: name.trim(), description: description.trim(), icon, readonly: false, anchor, params: cleanParams.length ? cleanParams : undefined, code });
    } else {
      await onSave({ id, name: name.trim(), description: description.trim(), icon, readonly: false, width, params: cleanParams.length ? cleanParams : undefined, code });
    }
    setSaving(false);
  };

  const updateParam = (i: number, patch: Partial<WidgetParam>) => {
    setParams(prev => prev.map((p, idx) => idx === i ? { ...p, ...patch } : p));
  };

  return (
    <div
      className="fixed inset-0 z-[800] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="glass-panel rounded-2xl shadow-2xl border border-white/5 flex flex-col"
        style={{ width: 900, maxHeight: '90vh' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 flex-shrink-0">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-primary text-[18px]">
              {isNew ? 'add_circle' : 'edit'}
            </span>
            <h3 className="font-headline-md text-[15px] font-bold text-on-surface">
              {isNew ? (mode === 'overlay' ? 'New Card Overlay' : 'New Widget') : `Edit — ${def.name}`}
            </h3>
            {/* Type toggle — only show for new items */}
            {isNew && (
              <div className="flex items-center gap-0.5 bg-surface-container/80 rounded-lg p-0.5 border border-white/5">
                <button
                  onClick={() => handleModeChange('widget')}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-bold transition-all ${mode === 'widget' ? 'bg-primary/15 text-primary' : 'text-on-surface-variant/50 hover:text-on-surface-variant/80'}`}
                >
                  <span className="material-symbols-outlined text-[12px]">widgets</span>
                  Widget Panel
                </button>
                <button
                  onClick={() => handleModeChange('overlay')}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-bold transition-all ${mode === 'overlay' ? 'bg-primary/15 text-primary' : 'text-on-surface-variant/50 hover:text-on-surface-variant/80'}`}
                >
                  <span className="material-symbols-outlined text-[12px]">layers</span>
                  Card Overlay
                </button>
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-md flex items-center justify-center text-on-surface-variant hover:bg-white/10 transition-all"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        {/* Body — two columns */}
        <div className="flex flex-1 min-h-0">

          {/* ── Left: meta + params + code ──────────────────────────────────── */}
          <div className="flex flex-col w-[480px] flex-shrink-0 border-r border-white/5 min-h-0">

            {/* Meta fields */}
            <div className="px-5 py-4 space-y-3 border-b border-white/5 flex-shrink-0">
              <div className="flex gap-3">

                {/* Icon picker */}
                <div className="flex-shrink-0 relative">
                  <p className="text-[9px] font-bold uppercase tracking-widest text-on-surface-variant/40 mb-1.5">Icon</p>
                  <button
                    onClick={() => setIconPicker(p => !p)}
                    className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center hover:bg-primary/20 transition-all"
                  >
                    <span
                      className="material-symbols-outlined text-primary text-[22px]"
                      style={{ fontVariationSettings: "'FILL' 1" }}
                    >
                      {icon}
                    </span>
                  </button>
                  {iconPickerOpen && (
                    <>
                      <div className="fixed inset-0 z-[10]" onClick={() => setIconPicker(false)} />
                      <div
                        className="absolute left-0 top-full mt-1.5 z-[11] glass-panel rounded-xl shadow-2xl border border-white/5 p-2"
                        style={{ width: 200 }}
                      >
                        <div className="grid grid-cols-6 gap-1">
                          {WIDGET_ICONS.map(ic => (
                            <button
                              key={ic}
                              onClick={() => { setIcon(ic); setIconPicker(false); }}
                              title={ic}
                              className={`w-7 h-7 rounded-md flex items-center justify-center transition-all hover:bg-white/10 ${ic === icon ? 'bg-primary/20 text-primary' : 'text-on-surface-variant/60'}`}
                            >
                              <span
                                className="material-symbols-outlined text-[16px]"
                                style={{ fontVariationSettings: "'FILL' 1" }}
                              >
                                {ic}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </div>

                {/* Name + description */}
                <div className="flex-1 min-w-0 space-y-2">
                  <div>
                    <p className="text-[9px] font-bold uppercase tracking-widest text-on-surface-variant/40 mb-1">Name</p>
                    <input
                      autoFocus
                      value={name}
                      onChange={e => setName(e.target.value)}
                      placeholder="e.g. My Combo Counter"
                      className="w-full bg-surface-container/60 border border-white/5 rounded-lg px-3 py-1.5 text-[12px] text-on-surface focus:outline-none focus:border-primary/50 placeholder:text-on-surface-variant/25"
                    />
                  </div>
                  <div>
                    <p className="text-[9px] font-bold uppercase tracking-widest text-on-surface-variant/40 mb-1">Description</p>
                    <input
                      value={description}
                      onChange={e => setDesc(e.target.value)}
                      placeholder="Short description shown in the picker"
                      className="w-full bg-surface-container/60 border border-white/5 rounded-lg px-3 py-1.5 text-[12px] text-on-surface focus:outline-none focus:border-primary/50 placeholder:text-on-surface-variant/25"
                    />
                  </div>
                </div>
              </div>

              {mode === 'widget' ? (
                /* Width slider */
                <div className="flex items-center gap-3">
                  <p className="text-[9px] font-bold uppercase tracking-widest text-on-surface-variant/40 flex-shrink-0 w-10">Width</p>
                  <input
                    type="range" min={160} max={480} step={10}
                    value={width}
                    onChange={e => setWidth(Number(e.target.value))}
                    className="flex-1 accent-primary"
                  />
                  <span className="text-[11px] font-bold text-primary w-10 text-right tabular-nums">{width}px</span>
                </div>
              ) : (
                /* Anchor selector */
                <div className="flex items-center gap-3">
                  <p className="text-[9px] font-bold uppercase tracking-widest text-on-surface-variant/40 flex-shrink-0 w-10">Anchor</p>
                  <select
                    value={anchor}
                    onChange={e => setAnchor(e.target.value as OverlayAnchor)}
                    className="flex-1 bg-[#0d0f14] border border-white/5 rounded-lg px-2 py-1.5 text-[11px] text-on-surface/80 focus:outline-none focus:border-primary/30"
                  >
                    {OVERLAY_ANCHORS.map(a => (
                      <option key={a.value} value={a.value}>{a.label}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* ── Parameters section ──────────────────────────────────────── */}
            <div className="border-b border-white/5 flex-shrink-0">
              <button
                onClick={() => setParamsOpen(o => !o)}
                className="w-full flex items-center justify-between px-5 py-2.5 hover:bg-white/[0.02] transition-all"
              >
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-[14px] text-primary/60">tune</span>
                  <p className="text-[9px] font-bold uppercase tracking-widest text-on-surface-variant/40">
                    Parameters
                  </p>
                  {params.length > 0 && (
                    <span className="text-[9px] font-bold text-primary/50 bg-primary/10 rounded-full px-1.5 py-0.5">
                      {params.filter(p => p.key.trim()).length}
                    </span>
                  )}
                </div>
                <span className="material-symbols-outlined text-[14px] text-on-surface-variant/30 transition-transform"
                  style={{ transform: paramsOpen ? 'rotate(180deg)' : 'none' }}>
                  expand_more
                </span>
              </button>

              {paramsOpen && (
                <div className="px-5 pb-3 space-y-2">
                  <p className="text-[10px] text-on-surface-variant/35 mb-2">
                    Define params accessible in code as <code className="font-mono text-primary/60">params.key</code>.
                  </p>
                  {params.map((p, i) => (
                    <div key={i} className="flex gap-2 items-start bg-white/[0.02] rounded-lg p-2 border border-white/5">
                      <div className="flex-1 grid grid-cols-2 gap-1.5 min-w-0">
                        <input
                          value={p.key}
                          onChange={e => updateParam(i, { key: e.target.value.replace(/\s/g, '_') })}
                          placeholder="key"
                          className="bg-transparent border border-white/5 rounded px-2 py-1 text-[10px] font-mono text-primary/80 focus:outline-none focus:border-primary/30 placeholder:text-on-surface-variant/20"
                        />
                        <input
                          value={p.label}
                          onChange={e => updateParam(i, { label: e.target.value })}
                          placeholder="Label"
                          className="bg-transparent border border-white/5 rounded px-2 py-1 text-[10px] text-on-surface/70 focus:outline-none focus:border-primary/30 placeholder:text-on-surface-variant/20"
                        />
                        <select
                          value={p.type}
                          onChange={e => updateParam(i, { type: e.target.value as WidgetParam['type'], default: e.target.value === 'boolean' ? false : e.target.value === 'number' ? 0 : '' })}
                          className="bg-[#0d0f14] border border-white/5 rounded px-2 py-1 text-[10px] text-on-surface/70 focus:outline-none"
                        >
                          {PARAM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                        {p.type === 'boolean' ? (
                          <button
                            onClick={() => updateParam(i, { default: !p.default })}
                            className={`flex items-center gap-1.5 px-2 py-1 rounded border text-[10px] font-bold transition-all ${p.default ? 'border-primary/30 bg-primary/10 text-primary' : 'border-white/5 text-on-surface-variant/50'}`}
                          >
                            {p.default ? 'Default: true' : 'Default: false'}
                          </button>
                        ) : p.type === 'number' ? (
                          <div className="flex gap-1">
                            <input
                              type="number"
                              value={p.default as number}
                              onChange={e => updateParam(i, { default: Number(e.target.value) })}
                              placeholder="default"
                              className="flex-1 min-w-0 bg-transparent border border-white/5 rounded px-2 py-1 text-[10px] text-on-surface/70 focus:outline-none focus:border-primary/30"
                            />
                            <input
                              type="number"
                              value={p.min ?? ''}
                              onChange={e => updateParam(i, { min: e.target.value ? Number(e.target.value) : undefined })}
                              placeholder="min"
                              className="w-12 bg-transparent border border-white/5 rounded px-2 py-1 text-[10px] text-on-surface-variant/50 focus:outline-none"
                            />
                            <input
                              type="number"
                              value={p.max ?? ''}
                              onChange={e => updateParam(i, { max: e.target.value ? Number(e.target.value) : undefined })}
                              placeholder="max"
                              className="w-12 bg-transparent border border-white/5 rounded px-2 py-1 text-[10px] text-on-surface-variant/50 focus:outline-none"
                            />
                          </div>
                        ) : (
                          <input
                            value={p.default as string}
                            onChange={e => updateParam(i, { default: e.target.value })}
                            placeholder="default value"
                            className="bg-transparent border border-white/5 rounded px-2 py-1 text-[10px] text-on-surface/70 focus:outline-none focus:border-primary/30"
                          />
                        )}
                      </div>
                      <button
                        onClick={() => setParams(prev => prev.filter((_, idx) => idx !== i))}
                        className="w-5 h-5 mt-1 flex-shrink-0 rounded flex items-center justify-center text-on-surface-variant/30 hover:text-red-400 hover:bg-red-500/10 transition-all"
                      >
                        <span className="material-symbols-outlined text-[13px]">close</span>
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() => setParams(prev => [...prev, emptyParam()])}
                    className="w-full flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-dashed border-white/10 text-[10px] text-on-surface-variant/40 hover:border-primary/30 hover:text-primary/60 transition-all"
                  >
                    <span className="material-symbols-outlined text-[13px]">add</span>
                    Add parameter
                  </button>
                </div>
              )}
            </div>

            {/* Code editor */}
            <div className="flex flex-col flex-1 min-h-0 px-5 py-3">
              <div className="flex items-center justify-between mb-2 flex-shrink-0">
                <p className="text-[9px] font-bold uppercase tracking-widest text-on-surface-variant/40">Code</p>
                <span className="text-[9px] text-on-surface-variant/25 font-mono">
                  {mode === 'overlay' ? 'function(card, params) { … }' : 'function(data, params) { … }'}
                </span>
              </div>
              <textarea
                value={code}
                onChange={e => setCode(e.target.value)}
                spellCheck={false}
                className="flex-1 w-full bg-[#0d0f14] border border-white/5 rounded-xl px-4 py-3 font-mono text-[11px] text-on-surface/85 resize-none focus:outline-none focus:border-primary/30 leading-relaxed"
                style={{ minHeight: 200 }}
              />
            </div>
          </div>

          {/* ── Right: preview + API reference ──────────────────────────────── */}
          <div className="flex flex-col flex-1 min-h-0">
            <div className="flex items-center justify-between px-5 pt-4 pb-2 flex-shrink-0">
              <p className="text-[9px] font-bold uppercase tracking-widest text-on-surface-variant/40">Live Preview</p>
              <span className="text-[9px] text-on-surface-variant/25">updates as you type</span>
            </div>

            {/* Simulated widget card / overlay preview */}
            <div className="flex-1 flex items-start justify-center overflow-auto px-5 pb-5 pt-2">
              {mode === 'widget' ? (
                <div className="canvas-widget" style={{ width, flexShrink: 0 }}>
                  <div className="widget-header">
                    <span
                      className="material-symbols-outlined"
                      style={{ fontSize: 13, color: 'rgba(242,202,131,0.55)', flexShrink: 0, fontVariationSettings: "'FILL' 1" }}
                    >
                      {icon}
                    </span>
                    <span className="widget-name">{name || 'Untitled Widget'}</span>
                  </div>
                  <div className="widget-body" dangerouslySetInnerHTML={{ __html: previewHtml }} />
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3">
                  <p className="text-[9px] text-on-surface-variant/30 uppercase tracking-widest font-bold">Card Preview</p>
                  <div style={{ position: 'relative', width: 160, height: 240, flexShrink: 0 }}>
                    {/* Simulated card image */}
                    <div style={{
                      position: 'absolute', inset: 0, borderRadius: 12, overflow: 'hidden',
                      background: 'linear-gradient(160deg, #1e2230 0%, #12151c 60%, #0d0f14 100%)',
                      border: '1px solid rgba(255,255,255,0.06)',
                      boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
                    }}>
                      {/* Card art placeholder */}
                      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.08 }}>
                        <span className="material-symbols-outlined" style={{ fontSize: 64 }}>playing_cards</span>
                      </div>
                      {/* Overlay HTML */}
                      <div dangerouslySetInnerHTML={{ __html: previewHtml }} style={{ position: 'absolute', inset: 0 }} />
                    </div>
                  </div>
                  <p className="text-[9px] text-on-surface-variant/25 text-center max-w-[160px]">
                    Sample: Atraxa, Praetors' Voice · EDHREC rank #42 · 67.3%
                  </p>
                </div>
              )}
            </div>

            {/* API cheatsheet */}
            <div className="px-5 pb-4 pt-2 border-t border-white/5 flex-shrink-0">
              <p className="text-[9px] font-bold uppercase tracking-widest text-on-surface-variant/30 mb-2">API Reference</p>
              <div className="space-y-1 text-[10px] font-mono">
                {mode === 'widget' ? (
                  ([
                    ['data.cards',         'WidgetCard[]', 'Main deck (no sideboard)'],
                    ['data.allCards',      'WidgetCard[]', 'Entire deck incl. sideboard'],
                    ['data.deckSize',      'number',       'Sum of main-deck quantities'],
                    ['params.<key>',       'any',          'Your defined parameter values'],
                    ['card.name',          'string',       'Card name'],
                    ['card.qty',           'number',       'Quantity in deck'],
                    ['card.cmc',           'number',       'Mana value'],
                    ['card.typeLine',      'string',       'Type line'],
                    ['card.colorIdentity', 'string[]',     'Color identity array'],
                  ] as const).map(([prop, type, desc]) => (
                    <div key={prop} className="flex items-baseline gap-2">
                      <span className="text-primary/70 flex-shrink-0">{prop}</span>
                      <span className="text-on-surface-variant/30 flex-shrink-0">{type}</span>
                      <span className="text-on-surface-variant/40 truncate">{desc}</span>
                    </div>
                  ))
                ) : (
                  ([
                    ['card.name',          'string',          'Card name'],
                    ['card.oracleId',      'string',          'Scryfall oracle ID'],
                    ['card.typeLine',      'string',          'Type line'],
                    ['card.manaCost',      'string',          'Mana cost string'],
                    ['card.cmc',           'number',          'Converted mana cost'],
                    ['card.colorIdentity', 'string[]',        'Color identity (W/U/B/R/G)'],
                    ['card.edhrecRank',    'number?',         'EDHREC rank (offline, lower=popular)'],
                    ['card.edhrecPct',     'number|null?',    'Inclusion % (async, may be null)'],
                    ['params.<key>',       'any',             'Your defined parameter values'],
                  ] as const).map(([prop, type, desc]) => (
                    <div key={prop} className="flex items-baseline gap-2">
                      <span className="text-primary/70 flex-shrink-0">{prop}</span>
                      <span className="text-on-surface-variant/30 flex-shrink-0">{type}</span>
                      <span className="text-on-surface-variant/40 truncate">{desc}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-white/5 flex-shrink-0">
          <p className="text-[10px] text-on-surface-variant/30">
            {mode === 'overlay'
              ? 'Return an HTML string · Placed on each card image · Inline CSS only'
              : 'Return an HTML string · All CSS must be inline · Use '}
            {mode === 'widget' && <><code className="font-mono">params.key</code> for parameters</>}
          </p>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-white/5 text-on-surface-variant text-label-md font-bold hover:bg-white/5 transition-all"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!name.trim() || saving || (mode === 'overlay' && !onSaveOverlay)}
              className="px-5 py-2 rounded-lg bg-primary/10 border border-primary/20 text-primary text-label-md font-bold hover:bg-primary/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {saving && (
                <span className="material-symbols-outlined text-[14px] animate-spin">progress_activity</span>
              )}
              {isNew ? (mode === 'overlay' ? 'Create Overlay' : 'Create Widget') : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
