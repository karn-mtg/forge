// Types for window APIs exposed by preload.js
export interface FolderNode {
  id: number;
  name: string;
  icon?: string;
  parent_id?: number | null;
  children: FolderNode[];
}

export type RecipientType = 'binder' | 'box' | 'deck_box' | 'other';
export type CardStatus = 'in-recipient' | 'in-recipient-diff' | 'proxy' | 'in-collection' | 'missing';

export interface Recipient {
  id: number;
  name: string;
  type: RecipientType;
  notes?: string | null;
  created_at?: string;
}

export interface Deck {
  id: number;
  name: string;
  format: string;
  folder_id?: number | null;
  color_identity?: string;
  cover_image_url?: string;
  cover_scryfall_id?: string;
  power_level?: number;
  /** Normalized to boolean at the IPC boundary (SQLite stores as 0/1). */
  is_favorite?: boolean;
  description?: string;
  cards?: DeckCardEntry[];
  updated_at?: string;
  created_at?: string;
  card_count?: number;
  recipient_id?: number | null;
  recipient_name?: string | null;
  recipient_type?: RecipientType | null;
}

export interface DeckCardEntry {
  id: number;
  oracle_id: string;
  scryfall_id?: string;
  board: 'main' | 'sideboard' | 'commander' | 'partner';
  quantity: number;
  is_proxy?: number; // 0 or 1 from SQLite
}

export interface ActivityLogEntry {
  day: string;
  count: number;
}

export interface CollectionEntry {
  id: number;
  oracle_id: string;
  scryfall_id?: string;
  quantity: number;
  foil: boolean;
  condition: string;
  acquired_price?: number | null;
  recipient_id?: number | null;
}

export interface WishlistEntry {
  id: number;
  oracle_id: string;
  scryfall_id?: string;
  quantity: number;
  priority?: number;
  note?: string;
}

export interface EdhrecCardEntry {
  name: string;
  pct: number | null;
  synergy: number | null;
  section: string;
}

export interface EdhrecPageResult {
  numDecks: number;
  cards: EdhrecCardEntry[];
}

/** Full Scryfall data stored alongside the card row */
export interface CardFullData {
  id?: string;
  image_uris?: { small?: string; normal?: string; large?: string; png?: string };
  card_faces?: Array<{ image_uris?: { small?: string; normal?: string; large?: string } }>;
  legalities?: Record<string, string>;
  prices?: { usd?: string; usd_foil?: string; eur?: string };
  flavor_text?: string;
  /** EDHREC popularity rank from Scryfall (lower = more popular in Commander formats). */
  edhrec_rank?: number;
}

export interface Card {
  oracle_id: string;
  scryfall_id?: string;
  name: string;
  type_line?: string;
  mana_cost?: string;
  cmc?: number;
  color_identity?: string | string[];
  oracle_text?: string;
  power?: string;
  toughness?: string;
  loyalty?: string;
  /** Full Scryfall JSON blob stored in the DB */
  full_data?: CardFullData;
}

export interface CardImage {
  id: string;
  set_code?: string;
  set_name?: string;
  collector_number?: string;
  promo?: boolean;
  image_uris?: { small?: string; normal?: string; large?: string };
}

export interface Arrangement {
  id: number;
  name: string;
  canvas_json: string | null;
}

export interface AgentMemory {
  key: string;
  value: string;
  updated_at: string;
}

declare global {
  interface Window {
    aiAPI: {
      checkClaude(): Promise<{ installed: boolean; version: string | null; loggedIn: boolean; method: string | null; expired?: boolean }>;
      chat(text: string, context?: string, sessionHandle?: string): Promise<void>;
      abort(): Promise<{ ok: boolean }>;
      clearSession(): Promise<{ ok: boolean }>;
      resetProvider(): Promise<{ ok: boolean }>;
      getMemory(): Promise<AgentMemory[]>;
      upsertMemory(args: { key: string; value: string }): Promise<void>;
      deleteMemory(args: { key: string }): Promise<void>;
      onToken(cb: (delta: string) => void): void;
      onDone(cb: (data: { sessionId: string | null }) => void): void;
      onError(cb: (msg: string) => void): void;
      removeListeners(): void;
      // Conversation persistence
      createConversation(args: { deckId?: number | null; title?: string | null }): Promise<{ id: number }>;
      getConversations(args?: { deckId?: number }): Promise<import('../store/useAIStore').ConversationSummary[]>;
      getConversation(args: { id: number }): Promise<{ id: number; title: string | null; deck_id: number | null; session_handle: string | null; messages: Array<{ role: string; content: string; ui_blocks: unknown[] | null }> } | null>;
      deleteConversation(args: { id: number }): Promise<{ ok: boolean }>;
      appendMessage(args: { conversationId: number; role: string; content: string; uiBlocks?: unknown[] | null }): Promise<{ id: number }>;
      updateConversationHandle(args: { id: number; sessionHandle: string }): Promise<{ ok: boolean }>;
      addDeclinedOracleId(args: { conversationId: number; oracleId: string }): Promise<{ ok: boolean }>;
      // Chat controller block events
      onBlock(cb: (event: import('../../shared/chat-events').ChatEvent) => void): void;
      onAsk(cb: (event: import('../../shared/chat-events').ChatEvent) => void): void;
      respondToAsk(requestId: string, value: unknown): void;
      removeBlockListeners(): void;
      // Card query
      cardQuery(prompt: string): Promise<void>;
      cardQueryAbort(): Promise<{ ok: boolean }>;
      onCardQueryToken(cb: (delta: string) => void): void;
      onCardQueryResult(cb: (data: { oracleIds: string[] }) => void): void;
      onCardQueryDone(cb: () => void): void;
      onCardQueryError(cb: (msg: string) => void): void;
      removeCardQueryListeners(): void;
    };
    electronAPI: {
      minimizeWindow(): void;
      maximizeWindow(): void;
      closeWindow(): void;
    };
    libraryAPI: {
      getFolderTree(): Promise<FolderNode[]>;
      createFolder(args: { name: string; parent_id?: number | null }): Promise<{ id: number }>;
      renameFolder(args: { id: number; name: string }): Promise<void>;
      deleteFolder(args: { id: number }): Promise<void>;
      moveFolder(args: { id: number; parent_id: number | null }): Promise<void>;
      getDecks(args?: unknown): Promise<Deck[]>;
      createDeck(args: { name: string; format: string; folder_id?: number | null }): Promise<{ id: number }>;
      getDeck(args: { id: number }): Promise<Deck>;
      updateDeck(args: Partial<Deck> & { id: number }): Promise<void>;
      deleteDeck(args: { id: number }): Promise<void>;
      moveDeck(args: { id: number; folderId: number | null }): Promise<void>;
      duplicateDeck(args: { id: number }): Promise<{ id: number }>;
      addCardToDeck(args: { deckId: number; oracleId: string; scryfallId?: string; board?: string; quantity?: number }): Promise<{ id: number }>;
      removeCardFromDeck(args: { id: number }): Promise<void>;
      updateCardBoard(args: { id: number; board: string }): Promise<void>;
      updateCardQuantity(args: { id: number; quantity: number }): Promise<void>;
      getRecipients(): Promise<Recipient[]>;
      createRecipient(args: { name: string; type: RecipientType; notes?: string | null }): Promise<{ id: number }>;
      updateRecipient(args: { id: number; name: string; type: RecipientType; notes?: string | null }): Promise<void>;
      deleteRecipient(args: { id: number }): Promise<void>;
      mountDeck(args: { id: number; recipientId: number }): Promise<void>;
      unmountDeck(args: { id: number }): Promise<void>;
      getCollection(): Promise<CollectionEntry[]>;
      addToCollection(args: {
        oracleId: string;
        scryfallId?: string | null;
        quantity: number;
        foil: boolean;
        condition: string;
        acquiredPrice: number | null;
      }): Promise<{ id: number }>;
      removeFromCollection(args: { id: number }): Promise<void>;
      updateCollectionEntry(args: { id: number; quantity: number; condition: string; foil: boolean; acquiredPrice: number | null; recipientId?: number | null }): Promise<void>;
      getDeckCardStatuses(args: { deckId: number }): Promise<Record<string, CardStatus>>;
      updateCardProxy(args: { id: number; isProxy: boolean }): Promise<void>;
      getWishlist(): Promise<WishlistEntry[]>;
      addToWishlist(args: {
        oracleId: string;
        scryfallId?: string | null;
        quantity?: number;
        priority?: number;
        note?: string;
      }): Promise<{ id: number }>;
      removeFromWishlist(args: { id: number }): Promise<void>;
      updateWishlistEntry(args: { id: number; quantity: number; priority: number; note?: string }): Promise<void>;
      logActivity(args: unknown): Promise<void>;
      getActivityLog(args: { days: number }): Promise<ActivityLogEntry[]>;
      saveCanvas(args: unknown): Promise<void>;
      loadCanvas(args: { deckId: number }): Promise<{ stateJson?: string } | null>;
      getArrangements(args: { deckId: number }): Promise<Arrangement[]>;
      createArrangement(args: { deckId: number; name: string }): Promise<{ id: number }>;
      renameArrangement(args: { id: number; name: string }): Promise<void>;
      deleteArrangement(args: { id: number }): Promise<void>;
      saveArrangementCanvas(args: { id: number; canvasJson: string }): Promise<void>;
      loadArrangementCanvas(args: { id: number }): Promise<{ canvasJson?: string } | null>;
      getDecksWithCard(args: { oracleId: string; excludeDeckId?: number }): Promise<{ id: number; name: string }[]>;
      getMostUsedCards(args?: { limit?: number }): Promise<{ oracle_id: string; deck_count: number }[]>;
    };
    settingsAPI: {
      get(): Promise<Record<string, unknown>>;
      set(args: Record<string, unknown>): Promise<void>;
      openUserData(): Promise<void>;
      openLogs(): Promise<void>;
    };
    arsenalAPI: {
      getStatus(): Promise<{
        installed: boolean;
        version: string | null;
        cardsDbVersion: string | null;
        rulesDbVersion: string | null;
      }>;
      checkForUpdates(): Promise<{ current: string | null; latest: string | null; hasUpdate: boolean }>;
      checkForDbUpdates(component: 'cards' | 'rules'): Promise<{ current: string | null; latest: string | null; hasUpdate: boolean }>;
      checkAllForUpdates(): Promise<{
        server: { current: string | null; latest: string | null; hasUpdate: boolean };
        cards:  { current: string | null; latest: string | null; hasUpdate: boolean };
        rules:  { current: string | null; latest: string | null; hasUpdate: boolean };
      }>;
      downloadUpdate(version: string): Promise<void>;
      downloadDbUpdate(component: 'cards' | 'rules', version: string): Promise<void>;
      installAll(): Promise<void>;
      restart(): Promise<void>;
      onProgress(cb: (data: { pct: number }) => void): void;
      onSetupProgress(cb: (data: { phase: 'server' | 'cards' | 'rules'; pct: number }) => void): void;
      removeListeners(): void;
    };
    cardsAPI: {
      getStatus(): Promise<{ cardCount?: number; last_updated_at?: string } | null>;
      /** Returns { cards: Card[] } */
      search(args: {
        q: string;
        pageSize?: number;
        colors?: string[];
        searchIn?: 'all' | 'name' | 'oracle';
        types?: string[];
        cmcMin?: number | null;
        cmcMax?: number | null;
        rarities?: string[];
        setCode?: string;
        legality?: string;
        gameChanger?: boolean;
        powerMin?: number | null;
        powerMax?: number | null;
        toughnessMin?: number | null;
        toughnessMax?: number | null;
        maxPriceUsd?: number | null;
        keywords?: string[];
        loyaltyMin?: number | null;
        loyaltyMax?: number | null;
        colorCount?: number | null;
        colorCountOp?: 'exactly' | 'at-most' | 'at-least';
        layouts?: string[];
        reserved?: boolean;
        edhrecRankMax?: number | null;
        producedMana?: string[];
      }): Promise<{ cards: Card[] }>;
      getCard(args: { oracleId: string }): Promise<Card | null>;
      getCardImages(args: { oracleId: string }): Promise<CardImage[]>;
      getCardsBatch(args: { oracleIds: string[] }): Promise<Card[]>;
      getCardsByNames(args: { names: string[] }): Promise<Card[]>;
      getCardsByNamesLight(args: { names: string[] }): Promise<{ oracle_id: string; name: string }[]>;
      getRoleTags(args: { oracleIds: string[] }): Promise<Record<string, string[]>>;
      searchByRole(args: { roles: string[]; pageSize?: number }): Promise<{ cards: Card[] }>;
      /** Fetch EDHREC generic inclusion % for a card name. Cached 24 h. */
      fetchEdhrecData(args: { cardName: string }): Promise<{ pct: number | null }>;
      /** Fetch EDHREC commander page — top cards + inclusion %. Cached 24 h. */
      fetchEdhrecCommander(args: { commanderName: string }): Promise<EdhrecPageResult>;
      /** Fetch EDHREC theme/archetype page. Cached 24 h. */
      fetchEdhrecTheme(args: { theme: string }): Promise<EdhrecPageResult>;
      fetchSpellbookCombos(args: { cardNames: string[] }): Promise<{ id: string; cards: string[]; results: string[]; description: string; identity: string }[]>;
    };
  }
}
