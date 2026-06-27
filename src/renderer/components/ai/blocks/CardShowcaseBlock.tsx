import { useEffect, useState } from 'react';
import type { CardShowcaseEvent, CardDetailEvent } from '../../../../shared/chat-events';

interface CardInfo { oracle_id: string; name: string; image_url: string | null }

interface Props {
  event: CardShowcaseEvent | CardDetailEvent;
}

export function CardShowcaseBlock({ event }: Props) {
  const oracleIds = event.type === 'card_showcase' ? event.oracle_ids : [event.oracle_id];
  const title = event.type === 'card_showcase' ? event.title : undefined;

  const [cards, setCards] = useState<CardInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!oracleIds.length) return;
    window.cardsAPI.getCardsBatch({ oracleIds }).then((results: unknown[]) => {
      const mapped = (results ?? []).map((c: any) => ({
        oracle_id: c.oracle_id ?? c.oracleId,
        name: c.name,
        image_url: c.image_uris?.art_crop ?? c.image_uris?.small ?? null,
      }));
      setCards(mapped);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [oracleIds.join(',')]);

  return (
    <div className="mb-3 rounded-xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.02)' }}>
      {title && (
        <div className="px-3 pt-2.5 pb-1 text-xs font-semibold" style={{ color: '#888' }}>{title}</div>
      )}
      {loading ? (
        <div className="px-3 py-3 flex gap-2">
          {oracleIds.slice(0, 5).map(id => (
            <div key={id} className="rounded-lg animate-pulse flex-shrink-0" style={{ width: 60, height: 84, background: 'rgba(255,255,255,0.06)' }} />
          ))}
        </div>
      ) : (
        <div className="px-3 py-2.5 flex gap-2 overflow-x-auto pb-3">
          {cards.map(card => (
            <div
              key={card.oracle_id}
              className="flex-shrink-0 rounded-lg overflow-hidden cursor-pointer transition-transform hover:scale-105"
              style={{ width: 60, height: 84 }}
              title={card.name}
              data-oracle-id={card.oracle_id}
            >
              {card.image_url ? (
                <img src={card.image_url} alt={card.name} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-[9px] text-center p-1" style={{ background: 'rgba(255,255,255,0.06)', color: '#888' }}>
                  {card.name}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
