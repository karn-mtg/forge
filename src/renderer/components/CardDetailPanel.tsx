import { useState, useEffect } from 'react';
import type { Card, CardImage } from '../types/electron';
import { ManaCost, manaCostToHtml } from './ManaSymbol';
import { useToastStore } from '../store/useToastStore';

function renderOracleText(text: string): string {
  return manaCostToHtml(text, 12);
}

function PipRow({ manaCost }: { manaCost?: string }) {
  if (!manaCost) return null;
  return <ManaCost manaCost={manaCost} size="1em" shadow />;
}

const LEGAL_FORMATS = ['standard', 'pioneer', 'modern', 'legacy', 'vintage', 'commander', 'pauper'];

interface CardDetailPanelProps {
  oracleId: string | null;
  deckId: number;
  addBoard: 'main' | 'sideboard';
  onClose: () => void;
  /** DeckView owns the IPC call so it can do a full optimistic update with the real DB id. */
  onAddToDeck: (card: Card) => Promise<void>;
  onCoverChange?: (url: string) => void;
  /** Called immediately when the user picks a different printing — lets DeckView
   *  update canvas cards live without requiring an "Apply" step. */
  onPrintingChange?: (scryfallId: string, imageUrl: string) => void;
  /** Triggers a search for similar cards using oracle text keywords. */
  onFindSimilar?: (query: string) => void;
  /** Active deck format, e.g. 'commander'. Used for banned-card warnings. */
  deckFormat?: string;
  /** Previously selected image URL for this card — restores the user's print choice on open. */
  initialImageUrl?: string;
}

export function CardDetailPanel({ oracleId, deckId, addBoard, onClose, onAddToDeck, onCoverChange, onPrintingChange, onFindSimilar, deckFormat, initialImageUrl }: CardDetailPanelProps) {
  const [card, setCard] = useState<Card | null>(null);
  const [images, setImages] = useState<CardImage[]>([]);
  const [currentImgUrl, setCurrentImgUrl] = useState('');
  const [currentScryfallId, setCurrentScryfallId] = useState('');
  const [imgError, setImgError] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [addedFlash, setAddedFlash] = useState(false);
  const [coverFlash, setCoverFlash] = useState(false);
  const [wishlistFlash, setWishlistFlash] = useState(false);
  const [oracleExpanded, setOracleExpanded] = useState(false);
  const [roleTags, setRoleTags] = useState<string[]>([]);
  const [edhrecPct, setEdhrecPct] = useState<number | null | undefined>(undefined);
  const [faceIndex, setFaceIndex] = useState(0);
  const [alsoInDecks, setAlsoInDecks] = useState<{ id: number; name: string }[]>([]);

  useEffect(() => {
    if (!oracleId) { setCard(null); return; }
    setIsLoading(true);
    setCard(null);
    setImages([]);
    setImgError(false);
    setOracleExpanded(false);
    setRoleTags([]);
    setEdhrecPct(undefined);
    setFaceIndex(0);
    setAlsoInDecks([]);

    Promise.all([
      window.cardsAPI.getCard({ oracleId }),
      window.cardsAPI.getCardImages({ oracleId }),
    ]).then(([c, imgs]) => {
      setCard(c);
      setImages(imgs || []);
      const preferred = initialImageUrl
        ? (imgs || []).find(i => i.image_uris?.normal === initialImageUrl)
        : null;
      const bestImg = preferred
        || (imgs || []).find(i => !i.promo && i.image_uris)
        || (imgs || []).find(i => i.image_uris)
        || null;
      const fd = c?.full_data || {};
      const url = bestImg?.image_uris?.normal
        || fd.image_uris?.normal
        || (fd.card_faces?.[0]?.image_uris?.normal)
        || '';
      setCurrentImgUrl(url);
      setCurrentScryfallId(bestImg?.id || fd.id || '');
    }).catch(err => {
      console.error('Card detail error:', err);
      useToastStore.getState().push({ type: 'error', title: 'Failed to load card details', message: String(err) });
    }).finally(() => setIsLoading(false));
  }, [oracleId, initialImageUrl]);

  // Async enrichment: role tags + EDHREC % once card is loaded
  useEffect(() => {
    if (!card) return;
    let cancelled = false;
    (async () => {
      try {
        const tagMap = await window.cardsAPI.getRoleTags({ oracleIds: [card.oracle_id] });
        if (!cancelled) setRoleTags(tagMap[card.oracle_id] ?? []);
      } catch { /* optional */ }
      try {
        const { pct } = await window.cardsAPI.fetchEdhrecData({ cardName: card.name });
        if (!cancelled) setEdhrecPct(pct);
      } catch { if (!cancelled) setEdhrecPct(null); }
      try {
        const decks = await window.libraryAPI.getDecksWithCard({ oracleId: card.oracle_id, excludeDeckId: deckId });
        if (!cancelled) setAlsoInDecks(decks || []);
      } catch { /* optional */ }
    })();
    return () => { cancelled = true; };
  }, [card]);

  const handleAddToDeck = async () => {
    if (!card || !oracleId) return;
    try {
      await onAddToDeck(card);
      setAddedFlash(true);
      setTimeout(() => setAddedFlash(false), 1200);
    } catch { /* DeckView logs the error */ }
  };

  const handleSetCover = async () => {
    if (!currentImgUrl) return;
    const fd = card?.full_data || {};
    const bestImg = images.find(i => i.image_uris?.normal === currentImgUrl) || null;
    await window.libraryAPI.updateDeck({ id: deckId, cover_image_url: currentImgUrl, cover_scryfall_id: bestImg?.id || fd.id });
    onCoverChange?.(currentImgUrl);
    setCoverFlash(true);
    setTimeout(() => setCoverFlash(false), 1500);
  };

  const handleAddToWishlist = async () => {
    if (!oracleId) return;
    await window.libraryAPI.addToWishlist({ oracleId });
    setWishlistFlash(true);
    setTimeout(() => setWishlistFlash(false), 1500);
  };

  if (!oracleId) return null;

  const fd = card?.full_data || {};
  const legalities = fd.legalities || {};
  const prices = fd.prices || {};
  const hasPrices = prices.usd || prices.eur;
  // Detect long oracle text for expand toggle
  const oracleLines = (card?.oracle_text || '').split('\n');
  const isLongOracle = oracleLines.length > 4 || (card?.oracle_text || '').length > 220;

  // DFC (double-faced card) support
  const cardFaces: any[] = fd.card_faces || [];
  const isDFC = cardFaces.length >= 2;
  const activeFace = isDFC ? cardFaces[faceIndex] : null;
  const activeImgUrl = isDFC
    ? (activeFace?.image_uris?.normal || activeFace?.image_uris?.small || currentImgUrl)
    : currentImgUrl;
  const activeOracleText = isDFC ? (activeFace?.oracle_text || '') : (card?.oracle_text || '');
  const activeTypeLine = isDFC ? (activeFace?.type_line || card?.type_line || '') : (card?.type_line || '');
  const activePower = isDFC ? activeFace?.power : card?.power;
  const activeToughness = isDFC ? activeFace?.toughness : card?.toughness;
  const activeLoyalty = isDFC ? activeFace?.loyalty : card?.loyalty;
  const activeManaCost = isDFC ? (activeFace?.mana_cost || '') : (card?.mana_cost || '');
  const activeFlavorText = isDFC ? (activeFace?.flavor_text || '') : (fd.flavor_text || '');

  // Banned status for the deck's format
  const deckFormatLegal = deckFormat ? (legalities[deckFormat] || 'not_legal') : null;
  const isBannedInDeck = deckFormatLegal === 'banned';

  return (
    <div
      className="absolute top-0 right-0 h-full w-[460px] z-[101] flex flex-col no-drag"
      style={{
        background: 'rgba(16,18,23,0.98)',
        backdropFilter: 'blur(40px)',
        borderLeft: '1px solid rgba(255,255,255,0.07)',
        boxShadow: '-8px 0 40px rgba(0,0,0,0.5)',
      }}
    >
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 flex-shrink-0">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          {isLoading ? (
            <span className="text-sm font-bold text-on-surface/50">Loading…</span>
          ) : (
            <>
              <span className="font-headline-md text-sm font-bold text-on-surface truncate">{card?.name || 'Card Details'}</span>
              {card?.mana_cost && <PipRow manaCost={card.mana_cost} />}
            </>
          )}
        </div>
        <button
          onClick={onClose}
          className="w-7 h-7 rounded-md flex items-center justify-center text-on-surface-variant hover:bg-white/10 transition-all flex-shrink-0 ml-2"
        >
          <span className="material-symbols-outlined text-[18px]">close</span>
        </button>
      </div>

      {/* ── Body ───────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto min-h-0">

        {/* Loading skeleton */}
        {isLoading && (
          <div className="p-4 space-y-3 animate-pulse">
            <div className="flex gap-3">
              <div className="w-[148px] flex-shrink-0 rounded-xl bg-white/5" style={{ aspectRatio: '488/680' }} />
              <div className="flex-1 space-y-2 pt-1">
                <div className="h-3 bg-white/5 rounded w-3/4" />
                <div className="h-2.5 bg-white/5 rounded w-1/2" />
                <div className="h-2.5 bg-white/5 rounded w-full" />
                <div className="h-2.5 bg-white/5 rounded w-5/6" />
                <div className="h-2.5 bg-white/5 rounded w-4/6" />
              </div>
            </div>
          </div>
        )}

        {/* Card content */}
        {!isLoading && card && (
          <>
            {/* ── 2-column: image + card info ── */}
            <div className="flex gap-3 p-4 pb-3">

              {/* Left: card image */}
              <div className="flex-shrink-0" style={{ width: 148 }}>
                <div
                  className="relative rounded-xl overflow-hidden shadow-2xl"
                  style={{ aspectRatio: '488/680', background: '#1a1d22' }}
                >
                  {activeImgUrl && !imgError ? (
                    <img
                      src={activeImgUrl}
                      loading="lazy"
                      className="w-full h-full object-cover"
                      onError={() => setImgError(true)}
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="material-symbols-outlined text-[48px] opacity-10">playing_cards</span>
                    </div>
                  )}
                  {/* DFC flip button */}
                  {isDFC && (
                    <button
                      onClick={() => setFaceIndex(i => 1 - i)}
                      title="Flip card"
                      className="absolute bottom-1.5 right-1.5 w-7 h-7 rounded-full flex items-center justify-center transition-all"
                      style={{ background: 'rgba(0,0,0,0.65)', border: '1px solid rgba(255,255,255,0.15)' }}
                    >
                      <span className="material-symbols-outlined text-[15px] text-white/70">flip</span>
                    </button>
                  )}
                </div>

                {/* Printings below image — grid picker */}
                {images.length > 1 && (
                  <div className="mt-2">
                    <p className="text-[8px] font-bold uppercase tracking-widest text-on-surface-variant/25 mb-1.5">
                      Printings · {images.length}
                    </p>
                    <div
                      className="overflow-y-auto rounded-lg"
                      style={{ maxHeight: 200 }}
                    >
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 3 }}>
                        {images.map(img => {
                          const thumb = img.image_uris?.small || img.image_uris?.normal || '';
                          const full  = img.image_uris?.normal || img.image_uris?.large || '';
                          const isSel = currentImgUrl === full;
                          return (
                            <button
                              key={img.id}
                              onClick={() => {
                                if (!full) return;
                                setCurrentImgUrl(full);
                                setCurrentScryfallId(img.id);
                                setImgError(false);
                                onPrintingChange?.(img.id, full);
                              }}
                              title={`${img.set_name || img.set_code || ''} #${img.collector_number || ''}`.trim()}
                              style={{
                                background: '#1a1d22',
                                border: `2px solid ${isSel ? 'rgba(242,202,131,0.65)' : 'rgba(255,255,255,0.06)'}`,
                                borderRadius: 5,
                                overflow: 'hidden',
                                padding: 0,
                                cursor: 'pointer',
                                outline: 'none',
                                transition: 'border-color 0.12s',
                              }}
                            >
                              <div style={{ aspectRatio: '488/680', width: '100%', background: '#111315' }}>
                                {thumb && (
                                  <img
                                    src={thumb}
                                    loading="lazy"
                                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                                  />
                                )}
                              </div>
                              <div style={{
                                padding: '2px 2px 3px',
                                textAlign: 'center',
                                fontSize: 7,
                                color: isSel ? 'rgba(242,202,131,0.8)' : 'rgba(255,255,255,0.28)',
                                fontWeight: 600,
                                letterSpacing: '0.04em',
                                textTransform: 'uppercase',
                                lineHeight: 1.2,
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                              }}>
                                {img.set_code?.toUpperCase() || '?'} {img.collector_number || '?'}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Right: card info */}
              <div className="flex-1 min-w-0 flex flex-col gap-2">

                {/* Banned badge */}
                {isBannedInDeck && (
                  <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg" style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)' }}>
                    <span className="material-symbols-outlined text-[13px] text-red-400" style={{ fontVariationSettings: "'FILL' 1" }}>block</span>
                    <span className="text-[10px] font-bold text-red-400 uppercase tracking-wide">Banned in {deckFormat}</span>
                  </div>
                )}

                {/* DFC face name */}
                {isDFC && activeFace && (
                  <p className="text-[9px] font-bold uppercase tracking-widest text-on-surface-variant/30">
                    {faceIndex === 0 ? 'Front face' : 'Back face'} · {activeFace.name}
                  </p>
                )}

                {/* Mana cost for DFC faces (each face can have its own) */}
                {isDFC && activeManaCost && <PipRow manaCost={activeManaCost} />}

                {/* Type line */}
                <p className="text-[10px] text-on-surface-variant/50 leading-snug">{activeTypeLine}</p>

                {/* Oracle text */}
                {activeOracleText && (
                  <div>
                    <p
                      className="text-[11px] text-on-surface/80 leading-relaxed whitespace-pre-line"
                      style={oracleExpanded ? undefined : {
                        display: '-webkit-box',
                        WebkitLineClamp: 5,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      } as React.CSSProperties}
                      dangerouslySetInnerHTML={{ __html: renderOracleText(activeOracleText) }}
                    />
                    {isLongOracle && (
                      <button
                        onClick={() => setOracleExpanded(v => !v)}
                        className="text-[9px] text-primary/50 hover:text-primary transition-colors mt-0.5"
                      >
                        {oracleExpanded ? 'Show less' : 'Show more'}
                      </button>
                    )}
                  </div>
                )}

                {/* P/T or Loyalty */}
                {(activePower != null || activeLoyalty != null) && (
                  <div className="flex items-center gap-2">
                    <span
                      className="text-sm font-black tabular-nums px-2 py-0.5 rounded-md"
                      style={{
                        background: 'rgba(242,202,131,0.12)',
                        border: '1px solid rgba(242,202,131,0.2)',
                        color: '#f2ca83',
                      }}
                    >
                      {activePower != null ? `${activePower}/${activeToughness}` : `◆${activeLoyalty}`}
                    </span>
                    {card.cmc != null && (
                      <span className="text-[10px] text-on-surface-variant/35">CMC {card.cmc}</span>
                    )}
                  </div>
                )}
                {activePower == null && activeLoyalty == null && card.cmc != null && (
                  <span className="text-[10px] text-on-surface-variant/35">CMC {card.cmc}</span>
                )}

                {/* Flavor text (short cards only) */}
                {activeFlavorText && !isLongOracle && (
                  <p className="text-[10px] text-on-surface-variant/30 italic leading-snug line-clamp-2 border-t border-white/5 pt-2">
                    {activeFlavorText}
                  </p>
                )}
              </div>
            </div>

            {/* ── EDHREC % + Role tags ── */}
            {(edhrecPct != null || roleTags.length > 0) && (
              <div className="px-4 pb-3">
                <div className="flex items-center gap-3 flex-wrap">
                  {/* EDHREC inclusion % */}
                  {edhrecPct != null && (() => {
                    const col = edhrecPct >= 50 ? '#f2ca83' : edhrecPct >= 20 ? '#86efac' : '#7eb8f7';
                    return (
                      <div className="flex items-center gap-1.5">
                        <span className="text-[8px] font-bold uppercase tracking-widest text-on-surface-variant/25">EDHREC</span>
                        <span
                          className="text-[11px] font-bold tabular-nums px-2 py-0.5 rounded-md"
                          style={{ color: col, background: col + '18', border: `1px solid ${col}30` }}
                        >
                          {edhrecPct.toFixed(1)}%
                        </span>
                        <span className="text-[9px] text-on-surface-variant/25">of decks</span>
                      </div>
                    );
                  })()}

                  {/* Role tags */}
                  {roleTags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {roleTags.map(tag => {
                        const ROLE_COLORS: Record<string, string> = {
                          ramp: '#27ae60', draw: '#4a7cc9', removal: '#c0392b',
                          board_wipe: '#f87171', tutor: '#c084fc', counterspell: '#7eb8f7',
                          graveyard: '#86efac', token: '#f2ca83', win_condition: '#fbbf24',
                        };
                        const col = ROLE_COLORS[tag] || 'rgba(255,255,255,0.3)';
                        const label = tag.replace(/_/g, ' ');
                        return (
                          <span
                            key={tag}
                            style={{
                              fontSize: 9, padding: '2px 7px', borderRadius: 4,
                              background: col + '18', border: `1px solid ${col}35`,
                              color: col, fontWeight: 700, textTransform: 'capitalize',
                              letterSpacing: '.04em',
                            }}
                          >
                            {label}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── Legality chips ── */}
            <div className="px-4 pb-3">
              <p className="text-[8px] font-bold uppercase tracking-widest text-on-surface-variant/25 mb-1.5">Legality</p>
              <div className="flex flex-wrap gap-1">
                {LEGAL_FORMATS.map(f => {
                  const val = legalities[f] || 'not_legal';
                  const legal = val === 'legal';
                  const banned = val === 'banned';
                  const restricted = val === 'restricted';
                  const bg    = legal ? 'rgba(39,174,96,0.18)' : banned ? 'rgba(239,68,68,0.18)' : restricted ? 'rgba(251,191,36,0.15)' : 'rgba(255,255,255,0.04)';
                  const color = legal ? '#27ae60'              : banned ? '#f87171'               : restricted ? '#fbbf24'              : 'rgba(255,255,255,0.18)';
                  const label = f === 'commander' ? 'EDH' : f.charAt(0).toUpperCase() + f.slice(1);
                  return (
                    <span
                      key={f}
                      title={banned ? `Banned in ${label}` : restricted ? `Restricted in ${label}` : undefined}
                      style={{ fontSize: 9, padding: '2px 7px', borderRadius: 4, background: bg, color, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em' }}
                    >
                      {label}{banned ? ' ✕' : restricted ? ' R' : ''}
                    </span>
                  );
                })}
              </div>
            </div>

            {/* ── Also in decks ── */}
            {alsoInDecks.length > 0 && (
              <div className="px-4 pb-3">
                <p className="text-[8px] font-bold uppercase tracking-widest text-on-surface-variant/25 mb-1.5">Also in</p>
                <div className="flex flex-wrap gap-1">
                  {alsoInDecks.map(d => (
                    <span key={d.id} className="text-[9px] px-2 py-0.5 rounded-md" style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.35)', border: '1px solid rgba(255,255,255,0.07)' }}>
                      {d.name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* ── Prices + actions ── */}
            <div className="px-4 pb-3 flex items-center gap-4">
              {hasPrices && (
                <div className="flex gap-4 flex-1">
                  {prices.usd && (
                    <div>
                      <p className="text-[8px] text-on-surface-variant/35 uppercase tracking-wider mb-0.5">USD</p>
                      <p className="text-[13px] font-bold text-on-surface tabular-nums">${prices.usd}</p>
                    </div>
                  )}
                  {prices.usd_foil && (
                    <div>
                      <p className="text-[8px] text-on-surface-variant/35 uppercase tracking-wider mb-0.5">Foil</p>
                      <p className="text-[13px] font-bold text-primary tabular-nums">${prices.usd_foil}</p>
                    </div>
                  )}
                  {prices.eur && (
                    <div>
                      <p className="text-[8px] text-on-surface-variant/35 uppercase tracking-wider mb-0.5">EUR</p>
                      <p className="text-[13px] font-bold text-on-surface tabular-nums">€{prices.eur}</p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ── Action buttons ── */}
            <div className="px-4 pb-5 flex flex-col gap-2">
              <div className="flex gap-2">
                <button
                  onClick={handleAddToDeck}
                  className="flex-1 py-2.5 rounded-xl text-label-sm font-bold flex items-center justify-center gap-1.5 transition-all"
                  style={{
                    background: addedFlash ? 'rgba(74,222,128,0.14)' : 'rgba(242,202,131,0.12)',
                    border: addedFlash ? '1px solid rgba(74,222,128,0.3)' : '1px solid rgba(242,202,131,0.25)',
                    color: addedFlash ? '#4ade80' : '#f2ca83',
                  }}
                >
                  <span className="material-symbols-outlined text-[15px]">
                    {addedFlash ? 'check' : 'add'}
                  </span>
                  {addedFlash ? 'Added!' : 'Add to Deck'}
                </button>
                <button
                  onClick={handleSetCover}
                  title="Set as deck cover"
                  className="w-11 h-10 rounded-xl border border-white/8 text-on-surface-variant hover:bg-white/5 transition-all flex items-center justify-center flex-shrink-0"
                  style={{ borderColor: coverFlash ? 'rgba(39,174,96,0.4)' : 'rgba(255,255,255,0.08)' }}
                >
                  <span className="material-symbols-outlined text-[17px]" style={{ color: coverFlash ? '#27ae60' : undefined }}>
                    {coverFlash ? 'check' : 'image'}
                  </span>
                </button>
                <button
                  onClick={handleAddToWishlist}
                  title="Add to wishlist"
                  className="w-11 h-10 rounded-xl border border-white/8 text-on-surface-variant hover:bg-white/5 transition-all flex items-center justify-center flex-shrink-0"
                  style={{ borderColor: wishlistFlash ? 'rgba(96,165,250,0.4)' : 'rgba(255,255,255,0.08)' }}
                >
                  <span className="material-symbols-outlined text-[17px]" style={{ color: wishlistFlash ? '#60a5fa' : undefined }}>
                    {wishlistFlash ? 'bookmark' : 'bookmark_add'}
                  </span>
                </button>
              </div>
              {onFindSimilar && (
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      const stopWords = new Set(['a','an','the','of','to','you','your','its','may','each','or','and','in','on','at','is','are','be','when','for','from','with','that','this','as','if','it','by','do','not','up','put','get']);
                      const words = (card.oracle_text || '')
                        .replace(/[^a-zA-Z ]/g, ' ')
                        .split(/\s+/)
                        .map(w => w.toLowerCase())
                        .filter(w => w.length > 3 && !stopWords.has(w));
                      const unique = [...new Set(words)].slice(0, 4);
                      const typeParts = (card.type_line || '').split('—')[0].split(/\s+/).filter(w => w && !['Legendary','Basic','Snow','Token'].includes(w));
                      onFindSimilar([...typeParts, ...unique].join(' ').trim() || card.name);
                    }}
                    className="flex-1 py-2 rounded-xl text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all"
                    style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.4)' }}
                  >
                    <span className="material-symbols-outlined text-[13px]">search</span>
                    Find Similar
                  </button>
                </div>
              )}
            </div>
          </>
        )}

        {/* Empty / no card */}
        {!isLoading && !card && oracleId && (
          <div className="flex flex-col items-center justify-center h-48 gap-3 text-center px-6">
            <span className="material-symbols-outlined text-[40px] text-on-surface-variant/15">playing_cards</span>
            <p className="text-body-md text-on-surface-variant/35">Card not found</p>
          </div>
        )}
      </div>
    </div>
  );
}
