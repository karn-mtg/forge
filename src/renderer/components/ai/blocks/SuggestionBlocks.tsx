import { useState, useEffect } from 'react';
import type {
  SuggestAddCardEvent,
  SuggestRemoveCardEvent,
  SuggestSwapEvent,
  SuggestCreateDeckEvent,
  SuggestCreateGroupEvent,
} from '../../../../shared/chat-events';

// ── Shared card thumbnail ─────────────────────────────────────────────────────

function CardThumb({ oracleId, label }: { oracleId: string; label?: string }) {
  const [img, setImg] = useState<string | null>(null);
  const [name, setName] = useState('');
  useEffect(() => {
    window.cardsAPI.getCardsBatch({ oracleIds: [oracleId] }).then((r: any[]) => {
      const c = r?.[0];
      setImg(c?.image_uris?.art_crop ?? null);
      setName(c?.name ?? '');
    }).catch(() => {});
  }, [oracleId]);
  return (
    <div className="flex flex-col items-center gap-1">
      {label && <span className="text-[9px] uppercase tracking-wide" style={{ color: '#555' }}>{label}</span>}
      <div className="rounded-lg overflow-hidden" style={{ width: 52, height: 73 }} data-oracle-id={oracleId} title={name}>
        {img
          ? <img src={img} alt={name} className="w-full h-full object-cover" />
          : <div className="w-full h-full animate-pulse" style={{ background: 'rgba(255,255,255,0.06)' }} />
        }
      </div>
      <span className="text-[9px] text-center max-w-[56px] truncate" style={{ color: '#777' }}>{name}</span>
    </div>
  );
}

// ── Shared action buttons ─────────────────────────────────────────────────────

function ActionButtons({ onAccept, onDecline, done }: { onAccept: () => void; onDecline: () => void; done: boolean }) {
  return (
    <div className="flex gap-2 mt-2.5">
      <button
        onClick={onAccept} disabled={done}
        className="flex-1 py-1.5 rounded-lg text-xs font-medium transition-all"
        style={{ background: done ? 'rgba(255,255,255,0.03)' : 'rgba(242,202,131,0.12)', color: done ? '#444' : '#f2ca83', border: `1px solid ${done ? 'rgba(255,255,255,0.06)' : 'rgba(242,202,131,0.25)'}`, cursor: done ? 'default' : 'pointer' }}
      >
        Accept
      </button>
      <button
        onClick={onDecline} disabled={done}
        className="flex-1 py-1.5 rounded-lg text-xs font-medium transition-all"
        style={{ background: 'rgba(255,255,255,0.03)', color: done ? '#333' : '#666', border: '1px solid rgba(255,255,255,0.07)', cursor: done ? 'default' : 'pointer' }}
      >
        Dismiss
      </button>
    </div>
  );
}

// ── suggest_swap ──────────────────────────────────────────────────────────────

export function SuggestSwapBlock({ event }: { event: SuggestSwapEvent }) {
  const [done, setDone] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const accept = async () => {
    if (!event.deck_id) { setStatus('No deck specified'); return; }
    try {
      // Get deck to find the deck_cards row id for the card to remove
      const deck = await window.libraryAPI.getDeck({ id: event.deck_id });
      const toRemove = deck?.cards?.find((c: any) => c.oracle_id === event.remove_oracle_id);
      if (toRemove) await window.libraryAPI.removeCardFromDeck({ id: toRemove.id });
      await window.libraryAPI.addCardToDeck({ deckId: event.deck_id, oracleId: event.add_oracle_id });
      setDone(true);
      setStatus('Swap applied');
    } catch (e: any) {
      setStatus(e.message ?? 'Failed');
    }
  };

  return (
    <div className="mb-3 rounded-xl p-3" style={{ border: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.02)' }}>
      <p className="text-[10px] mb-2 font-semibold uppercase tracking-wide" style={{ color: '#888' }}>Card swap suggestion</p>
      {event.reason && <p className="text-xs mb-2.5" style={{ color: '#777' }}>{event.reason}</p>}
      <div className="flex items-center gap-3">
        <CardThumb oracleId={event.remove_oracle_id} label="Remove" />
        <span className="material-symbols-outlined text-[18px]" style={{ color: '#555' }}>arrow_forward</span>
        <CardThumb oracleId={event.add_oracle_id} label="Add" />
      </div>
      {status && <p className="mt-1 text-[10px]" style={{ color: done ? '#3a8' : '#f88' }}>{status}</p>}
      <ActionButtons onAccept={accept} onDecline={() => setDone(true)} done={done} />
    </div>
  );
}

// ── suggest_add_card ──────────────────────────────────────────────────────────

export function SuggestAddCardBlock({ event }: { event: SuggestAddCardEvent }) {
  const [done, setDone] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const accept = async () => {
    try {
      await window.libraryAPI.addCardToDeck({ deckId: event.deck_id, oracleId: event.oracle_id });
      setDone(true);
      setStatus('Added to deck');
    } catch (e: any) {
      setStatus(e.message ?? 'Failed');
    }
  };

  return (
    <div className="mb-3 rounded-xl p-3 flex items-start gap-3" style={{ border: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.02)' }}>
      <CardThumb oracleId={event.oracle_id} />
      <div className="flex-1 min-w-0">
        <p className="text-[10px] mb-1 font-semibold uppercase tracking-wide" style={{ color: '#888' }}>Add card</p>
        {event.reason && <p className="text-xs" style={{ color: '#777' }}>{event.reason}</p>}
        {status && <p className="mt-1 text-[10px]" style={{ color: done ? '#3a8' : '#f88' }}>{status}</p>}
        <ActionButtons onAccept={accept} onDecline={() => setDone(true)} done={done} />
      </div>
    </div>
  );
}

// ── suggest_remove_card ───────────────────────────────────────────────────────

export function SuggestRemoveCardBlock({ event }: { event: SuggestRemoveCardEvent }) {
  const [done, setDone] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const accept = async () => {
    try {
      const deck = await window.libraryAPI.getDeck({ id: event.deck_id });
      const toRemove = deck?.cards?.find((c: any) => c.oracle_id === event.oracle_id);
      if (toRemove) {
        await window.libraryAPI.removeCardFromDeck({ id: toRemove.id });
        setDone(true);
        setStatus('Removed from deck');
      } else {
        setStatus('Card not found in deck');
      }
    } catch (e: any) {
      setStatus(e.message ?? 'Failed');
    }
  };

  return (
    <div className="mb-3 rounded-xl p-3 flex items-start gap-3" style={{ border: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.02)' }}>
      <CardThumb oracleId={event.oracle_id} />
      <div className="flex-1 min-w-0">
        <p className="text-[10px] mb-1 font-semibold uppercase tracking-wide" style={{ color: '#888' }}>Remove card</p>
        {event.reason && <p className="text-xs" style={{ color: '#777' }}>{event.reason}</p>}
        {status && <p className="mt-1 text-[10px]" style={{ color: done ? '#3a8' : '#f88' }}>{status}</p>}
        <ActionButtons onAccept={accept} onDecline={() => setDone(true)} done={done} />
      </div>
    </div>
  );
}

// ── suggest_create_deck ───────────────────────────────────────────────────────

export function SuggestCreateDeckBlock({ event }: { event: SuggestCreateDeckEvent }) {
  const [done, setDone] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const accept = async () => {
    try {
      const result = await window.libraryAPI.createDeck({ name: event.name, format: event.format });
      if (event.seed_cards?.length && result?.id) {
        for (const oracleId of event.seed_cards.slice(0, 10)) {
          await window.libraryAPI.addCardToDeck({ deckId: result.id, oracleId });
        }
      }
      setDone(true);
      setStatus('Deck created!');
    } catch (e: any) {
      setStatus(e.message ?? 'Failed');
    }
  };

  return (
    <div className="mb-3 rounded-xl p-3" style={{ border: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.02)' }}>
      <p className="text-[10px] mb-1 font-semibold uppercase tracking-wide" style={{ color: '#888' }}>Create deck</p>
      <p className="text-sm font-semibold mb-0.5" style={{ color: '#d4d4d4' }}>{event.name}</p>
      <p className="text-xs capitalize" style={{ color: '#666' }}>{event.format}</p>
      {event.seed_cards?.length > 0 && (
        <p className="text-[10px] mt-1" style={{ color: '#555' }}>{event.seed_cards.length} seed cards</p>
      )}
      {status && <p className="mt-1 text-[10px]" style={{ color: done ? '#3a8' : '#f88' }}>{status}</p>}
      <ActionButtons onAccept={accept} onDecline={() => setDone(true)} done={done} />
    </div>
  );
}

// ── suggest_create_group ──────────────────────────────────────────────────────

export function SuggestCreateGroupBlock({ event }: { event: SuggestCreateGroupEvent }) {
  const [done, setDone] = useState(false);

  const accept = () => {
    // Fire DOM event so DeckView can pick it up (same pattern as existing ai:create-group)
    document.dispatchEvent(new CustomEvent('ai:create-group', {
      detail: { oracleIds: event.oracle_ids, name: event.name },
    }));
    setDone(true);
  };

  return (
    <div className="mb-3 rounded-xl p-3" style={{ border: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.02)' }}>
      <p className="text-[10px] mb-1 font-semibold uppercase tracking-wide" style={{ color: '#888' }}>Create group</p>
      <p className="text-sm font-semibold" style={{ color: '#d4d4d4' }}>{event.name}</p>
      <p className="text-[10px] mt-0.5" style={{ color: '#555' }}>{event.oracle_ids.length} cards</p>
      <ActionButtons onAccept={accept} onDecline={() => setDone(true)} done={done} />
    </div>
  );
}
