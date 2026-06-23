import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';

interface TooltipState {
  x: number;
  y: number;
  imgUrl: string;
  name: string;
}

// In-memory cache: oracleId → image URL (or '' if not found)
const imageCache = new Map<string, string>();

function getImageUrl(oracleId: string): string | null {
  if (imageCache.has(oracleId)) return imageCache.get(oracleId) || null;
  return null; // not cached yet
}

async function fetchImageUrl(oracleId: string): Promise<string> {
  if (imageCache.has(oracleId)) return imageCache.get(oracleId) || '';
  try {
    const card = await window.cardsAPI.getCard({ oracleId });
    const fd = (card?.full_data || {}) as Record<string, any>;
    const url: string =
      fd.image_uris?.normal ||
      fd.card_faces?.[0]?.image_uris?.normal ||
      '';
    imageCache.set(oracleId, url);
    return url;
  } catch {
    imageCache.set(oracleId, '');
    return '';
  }
}

export function GlobalCardTooltip() {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const activeOidRef = useRef<string | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hide = useCallback(() => {
    if (showTimerRef.current) clearTimeout(showTimerRef.current);
    activeOidRef.current = null;
    setTooltip(null);
  }, []);

  useEffect(() => {
    const onOver = (e: MouseEvent) => {
      const target = (e.target as HTMLElement).closest('[data-oracle-id]') as HTMLElement | null;
      if (!target) {
        if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
        hideTimerRef.current = setTimeout(hide, 120);
        return;
      }
      const oid = target.dataset.oracleId!;
      if (oid === activeOidRef.current) return;

      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      if (showTimerRef.current) clearTimeout(showTimerRef.current);

      activeOidRef.current = oid;
      const name = target.dataset.cardName || target.textContent || '';
      const x = e.clientX;
      const y = e.clientY;

      const cached = getImageUrl(oid);
      if (cached !== null) {
        if (cached) setTooltip({ x, y, imgUrl: cached, name });
        return;
      }

      showTimerRef.current = setTimeout(async () => {
        if (activeOidRef.current !== oid) return;
        const url = await fetchImageUrl(oid);
        if (activeOidRef.current !== oid) return;
        if (url) setTooltip({ x, y, imgUrl: url, name });
      }, 350); // 350ms delay before fetching
    };

    const onMove = (e: MouseEvent) => {
      if (!tooltip) return;
      setTooltip(prev => prev ? { ...prev, x: e.clientX, y: e.clientY } : null);
    };

    document.addEventListener('mouseover', onOver);
    document.addEventListener('mousemove', onMove);
    return () => {
      document.removeEventListener('mouseover', onOver);
      document.removeEventListener('mousemove', onMove);
    };
  }, [hide, tooltip]);

  if (!tooltip) return null;

  const left = Math.max(8, Math.min(tooltip.x - 220, window.innerWidth - 228));
  const top  = Math.min(tooltip.y - 20, window.innerHeight - 316);

  return createPortal(
    <img
      src={tooltip.imgUrl}
      alt={tooltip.name}
      style={{
        position:      'fixed',
        left,
        top:           Math.max(8, top),
        width:         210,
        borderRadius:  10,
        boxShadow:     '0 12px 40px rgba(0,0,0,0.85), 0 0 0 1px rgba(255,255,255,0.07)',
        zIndex:        99999,
        pointerEvents: 'none',
      }}
    />,
    document.body,
  );
}
