import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type {
  ThinkingEvent,
  DeckDiffEvent,
  OpenDeckEvent,
  HighlightCardsEvent,
  SetSearchFiltersEvent,
  FocusArrangementEvent,
} from '../../../../shared/chat-events';

// ── thinking ──────────────────────────────────────────────────────────────────

export function ThinkingBlock({ event }: { event: ThinkingEvent }) {
  return (
    <div className="mb-2 flex items-center gap-2 px-1" style={{ color: '#555' }}>
      <span className="material-symbols-outlined text-[14px] animate-spin">progress_activity</span>
      <span className="text-xs">{event.label ?? 'Thinking…'}</span>
    </div>
  );
}

// ── deck_diff ─────────────────────────────────────────────────────────────────

function CardImageMicro({ oracleId }: { oracleId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    window.cardsAPI.getCardsBatch({ oracleIds: [oracleId] }).then((r: any[]) => {
      const c = r?.[0];
      setUrl(c?.image_uris?.art_crop ?? null);
    }).catch(() => {});
  }, [oracleId]);
  return url
    ? <img src={url} alt="" className="w-full h-full object-cover" />
    : <div className="w-full h-full animate-pulse" style={{ background: 'rgba(255,255,255,0.06)' }} />;
}

export function DeckDiffBlock({ event }: { event: DeckDiffEvent }) {
  return (
    <div className="mb-3 rounded-xl p-3" style={{ border: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.02)' }}>
      <p className="text-[10px] mb-2 font-semibold uppercase tracking-wide" style={{ color: '#888' }}>Deck changes</p>
      <div className="flex gap-4">
        {event.added.length > 0 && (
          <div>
            <p className="text-[9px] mb-1" style={{ color: '#3a8' }}>+ Added ({event.added.length})</p>
            <div className="flex gap-1 flex-wrap">
              {event.added.slice(0, 8).map(id => (
                <div key={id} className="w-10 h-14 rounded overflow-hidden" data-oracle-id={id}
                  style={{ border: '1px solid rgba(50,160,100,0.3)' }}>
                  <CardImageMicro oracleId={id} />
                </div>
              ))}
            </div>
          </div>
        )}
        {event.removed.length > 0 && (
          <div>
            <p className="text-[9px] mb-1" style={{ color: '#f88' }}>− Removed ({event.removed.length})</p>
            <div className="flex gap-1 flex-wrap">
              {event.removed.slice(0, 8).map(id => (
                <div key={id} className="w-10 h-14 rounded overflow-hidden opacity-50" data-oracle-id={id}
                  style={{ border: '1px solid rgba(220,80,80,0.3)' }}>
                  <CardImageMicro oracleId={id} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Navigation blocks (auto-execute on render) ────────────────────────────────

export function OpenDeckBlock({ event }: { event: OpenDeckEvent }) {
  const navigate = useNavigate();
  useEffect(() => { navigate(`/deck/${event.deck_id}`); }, []);
  return (
    <div className="mb-2 flex items-center gap-1.5 text-xs" style={{ color: '#555' }}>
      <span className="material-symbols-outlined text-[13px]">open_in_new</span>
      Opened deck #{event.deck_id}
    </div>
  );
}

export function HighlightCardsBlock({ event }: { event: HighlightCardsEvent }) {
  useEffect(() => {
    document.dispatchEvent(new CustomEvent('ai:highlight-cards', { detail: { oracleIds: event.oracle_ids } }));
  }, []);
  return (
    <div className="mb-2 flex items-center gap-1.5 text-xs" style={{ color: '#555' }}>
      <span className="material-symbols-outlined text-[13px]">highlight</span>
      Highlighted {event.oracle_ids.length} card{event.oracle_ids.length !== 1 ? 's' : ''}
    </div>
  );
}

export function SetSearchFiltersBlock({ event }: { event: SetSearchFiltersEvent }) {
  useEffect(() => {
    document.dispatchEvent(new CustomEvent('ai:set-search-filters', { detail: event.filters }));
  }, []);
  return (
    <div className="mb-2 flex items-center gap-1.5 text-xs" style={{ color: '#555' }}>
      <span className="material-symbols-outlined text-[13px]">filter_list</span>
      Search filters applied
    </div>
  );
}

export function FocusArrangementBlock({ event }: { event: FocusArrangementEvent }) {
  useEffect(() => {
    document.dispatchEvent(new CustomEvent('ai:focus-arrangement', { detail: { arrangementId: event.arrangement_id } }));
  }, []);
  return (
    <div className="mb-2 flex items-center gap-1.5 text-xs" style={{ color: '#555' }}>
      <span className="material-symbols-outlined text-[13px]">dashboard</span>
      Switched arrangement
    </div>
  );
}
