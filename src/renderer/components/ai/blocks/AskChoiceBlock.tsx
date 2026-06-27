import { useEffect, useState } from 'react';
import type { AskChoiceEvent, AskConfirmEvent, AskCardPickEvent } from '../../../../shared/chat-events';
import { CardShowcaseBlock } from './CardShowcaseBlock';

// ── ask_choice ────────────────────────────────────────────────────────────────

interface AskChoiceProps { event: AskChoiceEvent; answered?: boolean }

export function AskChoiceBlock({ event, answered }: AskChoiceProps) {
  const [chosen, setChosen] = useState<string | null>(null);
  const isLocked = answered || chosen !== null;

  const respond = (value: string) => {
    if (isLocked) return;
    setChosen(value);
    window.aiAPI.respondToAsk(event.requestId, value);
  };

  return (
    <div className="mb-3 rounded-xl p-3" style={{ border: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.02)' }}>
      <p className="text-xs mb-2.5" style={{ color: '#aaa' }}>{event.question}</p>
      <div className="flex flex-wrap gap-2">
        {event.options.map(opt => (
          <button
            key={opt.value}
            onClick={() => respond(opt.value)}
            disabled={isLocked}
            className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
            style={{
              border: `1px solid ${(chosen ?? '') === opt.value ? '#f2ca83' : 'rgba(255,255,255,0.12)'}`,
              background: (chosen ?? '') === opt.value ? 'rgba(242,202,131,0.12)' : 'rgba(255,255,255,0.04)',
              color: (chosen ?? '') === opt.value ? '#f2ca83' : isLocked ? '#444' : '#ccc',
              cursor: isLocked ? 'default' : 'pointer',
            }}
          >
            {opt.label}
          </button>
        ))}
      </div>
      {chosen && event.options.find(o => o.value === chosen)?.description && (
        <p className="mt-1.5 text-[10px]" style={{ color: '#555' }}>
          {event.options.find(o => o.value === chosen)?.description}
        </p>
      )}
    </div>
  );
}

// ── ask_confirm ───────────────────────────────────────────────────────────────

interface AskConfirmProps { event: AskConfirmEvent; answered?: boolean }

export function AskConfirmBlock({ event, answered }: AskConfirmProps) {
  const [chosen, setChosen] = useState<string | null>(null);
  const isLocked = answered || chosen !== null;

  const respond = (value: string) => {
    if (isLocked) return;
    setChosen(value);
    window.aiAPI.respondToAsk(event.requestId, value);
  };

  return (
    <div className="mb-3 rounded-xl p-3" style={{ border: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.02)' }}>
      <p className="text-xs mb-2.5" style={{ color: '#aaa' }}>{event.question}</p>
      <div className="flex gap-2">
        <button
          onClick={() => respond('yes')}
          disabled={isLocked}
          className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
          style={{
            border: `1px solid ${chosen === 'yes' ? '#f2ca83' : 'rgba(255,255,255,0.12)'}`,
            background: chosen === 'yes' ? 'rgba(242,202,131,0.12)' : 'rgba(255,255,255,0.04)',
            color: chosen === 'yes' ? '#f2ca83' : isLocked ? '#444' : '#ccc',
            cursor: isLocked ? 'default' : 'pointer',
          }}
        >
          {event.yes_label ?? 'Yes'}
        </button>
        <button
          onClick={() => respond('no')}
          disabled={isLocked}
          className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
          style={{
            border: `1px solid ${chosen === 'no' ? 'rgba(220,80,80,0.5)' : 'rgba(255,255,255,0.12)'}`,
            background: chosen === 'no' ? 'rgba(220,80,80,0.08)' : 'rgba(255,255,255,0.04)',
            color: chosen === 'no' ? '#ff8080' : isLocked ? '#444' : '#ccc',
            cursor: isLocked ? 'default' : 'pointer',
          }}
        >
          {event.no_label ?? 'No'}
        </button>
      </div>
    </div>
  );
}

// ── ask_card_pick ─────────────────────────────────────────────────────────────

interface AskCardPickProps { event: AskCardPickEvent; answered?: boolean }

export function AskCardPickBlock({ event, answered }: AskCardPickProps) {
  const [picked, setPicked] = useState<string | null>(null);
  const isLocked = answered || picked !== null;

  const handlePick = (oracleId: string) => {
    if (isLocked) return;
    setPicked(oracleId);
    window.aiAPI.respondToAsk(event.requestId, oracleId);
  };

  return (
    <div className="mb-3 rounded-xl p-3" style={{ border: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.02)' }}>
      <p className="text-xs mb-2" style={{ color: '#aaa' }}>{event.question}</p>
      <div
        className="flex gap-2 overflow-x-auto pb-1"
        style={{ pointerEvents: isLocked ? 'none' : 'auto' }}
      >
        {event.oracle_ids.map(id => (
          <div
            key={id}
            onClick={() => handlePick(id)}
            className="flex-shrink-0 rounded-lg overflow-hidden transition-all"
            data-oracle-id={id}
            style={{
              width: 60, height: 84,
              cursor: isLocked ? 'default' : 'pointer',
              outline: picked === id ? '2px solid #f2ca83' : 'none',
              opacity: isLocked && picked !== id ? 0.4 : 1,
            }}
          >
            <CardImageTiny oracleId={id} />
          </div>
        ))}
      </div>
    </div>
  );
}

function CardImageTiny({ oracleId }: { oracleId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    window.cardsAPI.getCardsBatch({ oracleIds: [oracleId] }).then((r: any[]) => {
      const c = r?.[0];
      setUrl(c?.image_uris?.art_crop ?? c?.image_uris?.small ?? null);
    }).catch(() => {});
  }, [oracleId]);
  return url
    ? <img src={url} alt="" className="w-full h-full object-cover" />
    : <div className="w-full h-full animate-pulse" style={{ background: 'rgba(255,255,255,0.06)' }} />;
}
