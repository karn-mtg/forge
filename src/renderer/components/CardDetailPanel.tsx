import { useState, useEffect } from 'react';
import type { Card, CardImage } from '../types/electron';
import { ManaCost, manaCostToHtml } from './ManaSymbol';

function renderOracleText(text: string): string {
  return manaCostToHtml(text, 13);
}

function PipRow({ manaCost }: { manaCost?: string }) {
  if (!manaCost) return null;
  return <ManaCost manaCost={manaCost} size="1.1em" shadow />;
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
}

export function CardDetailPanel({ oracleId, deckId, addBoard, onClose, onAddToDeck, onCoverChange }: CardDetailPanelProps) {
  const [card, setCard] = useState<Card | null>(null);
  const [images, setImages] = useState<CardImage[]>([]);
  const [currentImgUrl, setCurrentImgUrl] = useState('');
  const [imgError, setImgError] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [addedFlash, setAddedFlash] = useState(false);
  const [coverFlash, setCoverFlash] = useState(false);
  const [wishlistFlash, setWishlistFlash] = useState(false);

  useEffect(() => {
    if (!oracleId) { setCard(null); return; }
    setIsLoading(true);
    setCard(null);
    setImages([]);
    setImgError(false);

    Promise.all([
      window.cardsAPI.getCard({ oracleId }),
      window.cardsAPI.getCardImages({ oracleId }),
    ]).then(([c, imgs]) => {
      setCard(c);
      setImages(imgs || []);
      const bestImg = (imgs || []).find(i => !i.promo && i.image_uris) || (imgs || []).find(i => i.image_uris) || null;
      const fd = c?.full_data || {};
      const url = bestImg?.image_uris?.normal
        || fd.image_uris?.normal
        || (fd.card_faces?.[0]?.image_uris?.normal)
        || '';
      setCurrentImgUrl(url);
    }).catch(err => {
      console.error('Card detail error:', err);
    }).finally(() => setIsLoading(false));
  }, [oracleId]);

  const handleAddToDeck = async () => {
    if (!card || !oracleId) return;
    // IPC call and optimistic state update are handled by DeckView via onAddToDeck
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

  return (
    <div
      className="fixed top-0 right-0 h-full w-80 z-[101] flex flex-col no-drag"
      style={{ background: 'rgba(20,22,27,0.97)', backdropFilter: 'blur(40px)', borderLeft: '1px solid rgba(255,255,255,0.06)' }}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 flex-shrink-0">
        <h3 className="font-headline-md text-sm font-bold text-on-surface truncate">
          {isLoading ? 'Loading…' : card?.name || 'Card Details'}
        </h3>
        <button onClick={onClose} className="w-7 h-7 rounded-md flex items-center justify-center text-on-surface-variant hover:bg-white/10 transition-all flex-shrink-0">
          <span className="material-symbols-outlined text-[18px]">close</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Image */}
        <div className="relative w-full" style={{ aspectRatio: '488/680' }}>
          {currentImgUrl && !imgError ? (
            <img
              src={currentImgUrl}
              loading="lazy"
              className="w-full h-full object-cover"
              onError={() => setImgError(true)}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center bg-surface">
              <span className="material-symbols-outlined text-[64px] opacity-10">playing_cards</span>
            </div>
          )}
        </div>

        {/* Info */}
        {card && (
          <div className="px-4 py-4 space-y-3">
            <div>
              <div className="flex items-center justify-between gap-2 mb-0.5">
                <span className="font-headline-md text-base font-bold text-on-surface">{card.name}</span>
                <PipRow manaCost={card.mana_cost} />
              </div>
              <p className="text-[11px] text-on-surface-variant/50">{card.type_line}</p>
            </div>

            {card.oracle_text && (
              <p
                className="text-[12px] text-on-surface/80 leading-relaxed whitespace-pre-line"
                dangerouslySetInnerHTML={{ __html: renderOracleText(card.oracle_text) }}
              />
            )}

            {(card.power || card.loyalty) && (
              <div className="flex items-center gap-3">
                <span className="text-label-md font-bold text-primary text-sm">
                  {card.power ? `${card.power}/${card.toughness}` : `[${card.loyalty}]`}
                </span>
                {fd.flavor_text && (
                  <span className="text-[10px] text-on-surface-variant/35 italic leading-relaxed">{fd.flavor_text}</span>
                )}
              </div>
            )}

            {/* Legality */}
            <div className="flex flex-wrap gap-1.5">
              {LEGAL_FORMATS.map(f => {
                const val = legalities[f] || 'not_legal';
                const legal = val === 'legal';
                const restricted = val === 'restricted';
                const bg = legal ? 'rgba(39,174,96,0.2)' : restricted ? 'rgba(192,57,43,0.15)' : 'rgba(255,255,255,0.04)';
                const color = legal ? '#27ae60' : restricted ? '#c0392b' : 'rgba(255,255,255,0.2)';
                return (
                  <span key={f} style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, background: bg, color, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em' }}>
                    {f.charAt(0).toUpperCase() + f.slice(1)}
                  </span>
                );
              })}
            </div>

            {/* Prices */}
            {hasPrices && (
              <div className="flex gap-4">
                <div className="text-center">
                  <p className="text-[9px] text-on-surface-variant/40 uppercase tracking-wider">USD</p>
                  <p className="text-label-md font-bold text-on-surface">{prices.usd ? `$${prices.usd}` : '—'}</p>
                </div>
                <div className="text-center">
                  <p className="text-[9px] text-on-surface-variant/40 uppercase tracking-wider">Foil</p>
                  <p className="text-label-md font-bold text-primary">{prices.usd_foil ? `$${prices.usd_foil}` : '—'}</p>
                </div>
                <div className="text-center">
                  <p className="text-[9px] text-on-surface-variant/40 uppercase tracking-wider">EUR</p>
                  <p className="text-label-md font-bold text-on-surface">{prices.eur ? `€${prices.eur}` : '—'}</p>
                </div>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex gap-2 pt-1">
              <button
                onClick={handleAddToDeck}
                className="flex-1 py-2 rounded-lg bg-primary/15 text-primary border border-primary/25 hover:bg-primary/25 transition-all text-label-sm font-bold flex items-center justify-center gap-1.5"
              >
                {addedFlash ? '✓ Added' : (<><span className="material-symbols-outlined text-[14px]">add</span>Add to Deck</>)}
              </button>
              <button
                onClick={handleSetCover}
                title="Set as deck cover"
                className="w-10 h-9 rounded-lg border border-white/10 text-on-surface-variant hover:bg-white/5 transition-all flex items-center justify-center flex-shrink-0"
              >
                <span className="material-symbols-outlined text-[16px]" style={{ color: coverFlash ? '#27ae60' : undefined }}>
                  {coverFlash ? 'check' : 'image'}
                </span>
              </button>
              <button
                onClick={handleAddToWishlist}
                className="w-10 h-9 rounded-lg border border-white/10 text-on-surface-variant hover:bg-white/5 transition-all flex items-center justify-center flex-shrink-0"
              >
                <span className="material-symbols-outlined text-[16px]">{wishlistFlash ? 'bookmark' : 'bookmark_add'}</span>
              </button>
            </div>
          </div>
        )}

        {/* Printings picker */}
        {images.length > 1 && (
          <div className="px-4 pb-4">
            <p className="text-[9px] font-bold uppercase tracking-widest text-on-surface-variant/40 mb-2">Printings</p>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {images.map(img => {
                const thumb = img.image_uris?.small || img.image_uris?.normal || '';
                const full = img.image_uris?.normal || img.image_uris?.large || '';
                return (
                  <button
                    key={img.id}
                    onClick={() => { if (full) { setCurrentImgUrl(full); setImgError(false); } }}
                    title={`${img.set_name || img.set_code || ''} ${img.collector_number || ''}`.trim()}
                    className="flex-shrink-0 rounded-md overflow-hidden border-2 hover:border-primary/60 transition-all"
                    style={{ width: 48, height: 68, background: '#1a1d22', borderColor: currentImgUrl === full ? 'rgba(242,202,131,0.6)' : 'transparent' }}
                  >
                    {thumb && <img src={thumb} loading="lazy" className="w-full h-full object-cover" />}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
