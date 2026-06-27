import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Builds a context snapshot string for the current page/deck.
 * Injected into the system prompt (new sessions) or prepended to the user
 * message (resumed sessions) so Claude knows what the user is looking at.
 */
export function useAIContext(): string {
  const location = useLocation();
  const [context, setContext] = useState('');

  useEffect(() => {
    const match = location.pathname.match(/^\/deck\/(\d+)/);
    if (match) {
      const deckId = parseInt(match[1], 10);
      window.libraryAPI.getDeck({ id: deckId }).then((deck: any) => {
        if (!deck) return;
        const lines = [
          '## KarnForge Context',
          `Page: Deck Editor`,
          `Deck: "${deck.name}" (${deck.format ?? 'unknown format'}, ${deck.color_identity ?? 'colorless'}, ${deck.card_count ?? deck.cards?.length ?? '?'} cards)`,
          deck.description ? `Description: ${deck.description}` : null,
          `Deck ID: ${deck.id}`,
        ].filter(Boolean);
        setContext(lines.join('\n'));
      }).catch(() => {
        setContext(`## KarnForge Context\nPage: Deck Editor\nDeck ID: ${deckId}`);
      });
    } else {
      const pageMap: Record<string, string> = {
        '/':           'Dashboard',
        '/decks':      'All Decks',
        '/collection': 'Collection',
        '/wishlist':   'Wishlist',
        '/recents':    'Recents',
        '/settings':   'Settings',
        '/widgets':    'Widget Gallery',
      };
      const pageName = pageMap[location.pathname] ?? location.pathname.replace('/', '');
      setContext(`## KarnForge Context\nPage: ${pageName}`);
    }
  }, [location.pathname]);

  return context;
}
