// Types for window APIs exposed by preload.js

export interface FolderNode {
  id: number;
  name: string;
  icon?: string;
  parent_id?: number | null;
  children: FolderNode[];
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
  is_favorite?: number | boolean;
  description?: string;
  cards?: DeckCardEntry[];
  updated_at?: string;
  created_at?: string;
  card_count?: number;
}

export interface DeckCardEntry {
  id: number;
  oracle_id: string;
  scryfall_id?: string;
  board: 'main' | 'sideboard' | 'commander';
  quantity: number;
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
}

export interface WishlistEntry {
  id: number;
  oracle_id: string;
  scryfall_id?: string;
  quantity: number;
  priority?: number;
  note?: string;
}

/** Full Scryfall data stored alongside the card row */
export interface CardFullData {
  id?: string;
  image_uris?: { small?: string; normal?: string; large?: string; png?: string };
  card_faces?: Array<{ image_uris?: { small?: string; normal?: string; large?: string } }>;
  legalities?: Record<string, string>;
  prices?: { usd?: string; usd_foil?: string; eur?: string };
  flavor_text?: string;
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

export interface SyncProgress {
  phase: string;
  count?: number;
  total?: number;
  message?: string;
  error?: string;
}

export interface Arrangement {
  id: number;
  name: string;
  canvas_json: string | null;
}

declare global {
  interface Window {
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
      getCollection(): Promise<CollectionEntry[]>;
      addToCollection(args: unknown): Promise<void>;
      removeFromCollection(args: { id: number }): Promise<void>;
      updateCollectionEntry(args: { id: number; quantity: number; condition: string; foil: boolean; acquiredPrice: number | null }): Promise<void>;
      getWishlist(): Promise<WishlistEntry[]>;
      addToWishlist(args: unknown): Promise<void>;
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
    };
    settingsAPI: {
      get(): Promise<Record<string, unknown>>;
      set(args: Record<string, unknown>): Promise<void>;
      openUserData(): Promise<void>;
    };
    cardsAPI: {
      getStatus(): Promise<{ synced: boolean; cardCount?: number }>;
      startSync(args: { refresh?: boolean }): void;
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
      }): Promise<{ cards: Card[] }>;
      getCard(args: { oracleId: string }): Promise<Card | null>;
      getCardImages(args: { oracleId: string }): Promise<CardImage[]>;
      getCardsBatch(args: { oracleIds: string[] }): Promise<Card[]>;
      onProgress(cb: (data: SyncProgress) => void): () => void;
    };
  }
}
