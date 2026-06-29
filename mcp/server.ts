import { createRequire } from 'module';
import { z } from 'zod';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const require = createRequire(import.meta.url);
const lib         = require('../db/library');
const cardsModule = require('../db/cards');
const { fetchEdhrecInclusion, fetchEdhrecCommander, fetchSpellbookCombos } = require('../ipc/cards');
const { resolveUserDir, resolveArsenalDbDir } = require('../utils/paths');

// ── Database initialisation ───────────────────────────────────────────────────
const libDb   = lib.initLibrary(resolveUserDir());
const cardsDb = cardsModule.initCards(resolveArsenalDbDir());

// ── Server ────────────────────────────────────────────────────────────────────
const server = new McpServer({ name: 'karnforge', version: '1.0.0' });

function ok(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
}

function err(e: unknown) {
  return { content: [{ type: 'text' as const, text: `Error: ${(e as Error).message}` }], isError: true as const };
}

// ── Card database tools ───────────────────────────────────────────────────────

server.tool(
  'search_cards',
  'Search the local Scryfall card database (~30k cards) by name, text, type, color, CMC, rarity, set, legality, keywords, loyalty, color count, layout, reserved list, EDHREC rank, or produced mana. At least one filter must be provided.',
  {
    q:              z.string().optional().describe('Free-text query (name, type line, oracle text)'),
    colors:         z.array(z.enum(['W', 'U', 'B', 'R', 'G', 'C'])).optional().default([]),
    types:          z.array(z.string()).optional().default([]),
    cmcMin:         z.number().int().min(0).optional(),
    cmcMax:         z.number().int().min(0).optional(),
    rarities:       z.array(z.enum(['common', 'uncommon', 'rare', 'mythic'])).optional().default([]),
    setCode:        z.string().optional().default(''),
    legality:       z.string().optional().default(''),
    searchIn:       z.enum(['all', 'name', 'oracle']).optional().default('all'),
    gameChanger:    z.boolean().optional().default(false),
    maxPriceUsd:    z.number().positive().optional(),
    powerMin:       z.number().int().optional(),
    powerMax:       z.number().int().optional(),
    toughnessMin:   z.number().int().optional(),
    toughnessMax:   z.number().int().optional(),
    page:           z.number().int().min(1).optional().default(1),
    pageSize:       z.number().int().min(1).max(100).optional().default(20),
    keywords:       z.array(z.string()).optional().default([]).describe('MTG keywords the card must have (AND logic) e.g. ["Flying","Deathtouch"]'),
    loyaltyMin:     z.number().int().optional().describe('Minimum loyalty (planeswalkers)'),
    loyaltyMax:     z.number().int().optional().describe('Maximum loyalty (planeswalkers)'),
    colorCount:     z.number().int().min(0).max(5).optional().describe('Number of colors in color identity'),
    colorCountOp:   z.enum(['exactly', 'at-most', 'at-least']).optional().default('exactly'),
    layouts:        z.array(z.string()).optional().default([]).describe('Card layouts to include e.g. ["normal","transform"]'),
    reserved:       z.boolean().optional().default(false).describe('Only reserved list cards'),
    edhrecRankMax:  z.number().int().positive().optional().describe('Max EDHREC rank (lower = more popular)'),
    producedMana:   z.array(z.enum(['W', 'U', 'B', 'R', 'G', 'C'])).optional().default([]).describe('Mana colors the card can produce (OR logic)'),
  },
  async (args) => {
    try { return ok(cardsModule.searchCards(cardsDb, args)); } catch (e) { return err(e); }
  }
);

server.tool(
  'get_card',
  'Get full card details by oracle_id, including oracle text, colors, legalities, prices, and all printings.',
  { oracleId: z.string().describe('Scryfall oracle_id UUID') },
  async (args) => {
    try { return ok(cardsModule.getCard(cardsDb, args)); } catch (e) { return err(e); }
  }
);

server.tool(
  'get_cards_by_names',
  'Look up multiple cards by their exact English names. Returns matched cards with oracle_ids. Useful for importing a decklist.',
  { names: z.array(z.string()).min(1).max(100) },
  async (args) => {
    try { return ok(cardsModule.getCardsByNames(cardsDb, args)); } catch (e) { return err(e); }
  }
);

server.tool(
  'get_card_images',
  'Get all printings and image URIs for a card by oracle_id.',
  { oracleId: z.string() },
  async (args) => {
    try { return ok(cardsModule.getCardImages(cardsDb, args)); } catch (e) { return err(e); }
  }
);

server.tool(
  'search_by_role',
  'Search cards by AI-assigned role tags such as "ramp", "draw", "removal", "combo-piece", or "finisher".',
  {
    roles:    z.array(z.string()).min(1).describe('Role tag strings'),
    pageSize: z.number().int().min(1).max(120).optional().default(60),
  },
  async (args) => {
    try { return ok(cardsModule.searchByRole(cardsDb, args)); } catch (e) { return err(e); }
  }
);

// ── External API tools ────────────────────────────────────────────────────────

server.tool(
  'fetch_edhrec_data',
  'Fetch the EDHREC inclusion percentage for a card by name. Shows how often it appears in decks that could run it.',
  { cardName: z.string().describe('Exact English card name') },
  async ({ cardName }) => {
    try { return ok(await fetchEdhrecInclusion(cardName)); } catch (e) { return err(e); }
  }
);

server.tool(
  'fetch_edhrec_commander',
  'Get EDHREC card recommendations for a commander. Returns a sorted card list with inclusion % and synergy scores.',
  { commanderName: z.string().describe('Commander card name') },
  async ({ commanderName }) => {
    try { return ok(await fetchEdhrecCommander(commanderName)); } catch (e) { return err(e); }
  }
);

server.tool(
  'fetch_spellbook_combos',
  'Check Commander Spellbook for known combos involving the given card names. Returns combo lines with results and descriptions.',
  { cardNames: z.array(z.string()).min(2).max(10).describe('Card names to check for combos') },
  async ({ cardNames }) => {
    try { return ok(await fetchSpellbookCombos(cardNames)); } catch (e) { return err(e); }
  }
);

// ── Folder tools ──────────────────────────────────────────────────────────────

server.tool(
  'get_folder_tree',
  'Return the entire folder hierarchy with nested children arrays.',
  {},
  async () => {
    try { return ok(lib.getFolderTree(libDb)); } catch (e) { return err(e); }
  }
);

server.tool(
  'create_folder',
  'Create a new folder, optionally nested under a parent folder.',
  {
    name:      z.string().min(1).max(100),
    parent_id: z.number().int().positive().optional(),
    icon:      z.string().optional().default('folder'),
  },
  async (args) => {
    try { return ok(lib.createFolder(libDb, args)); } catch (e) { return err(e); }
  }
);

// ── Deck tools ────────────────────────────────────────────────────────────────

server.tool(
  'list_decks',
  'List all decks (or decks in a specific folder). Returns id, name, format, color_identity, power_level, card_count.',
  { folderId: z.number().int().positive().optional() },
  async (args) => {
    try { return ok(lib.getDecks(libDb, args)); } catch (e) { return err(e); }
  }
);

server.tool(
  'get_deck',
  'Get a deck by id including all cards (oracle_id, scryfall_id, quantity, board, category).',
  { id: z.number().int().positive() },
  async (args) => {
    try { return ok(lib.getDeck(libDb, args)); } catch (e) { return err(e); }
  }
);

server.tool(
  'create_deck',
  'Create a new deck. Returns the new deck id.',
  {
    name:          z.string().min(1).max(200),
    format:        z.enum(['commander', 'standard', 'modern', 'pioneer', 'legacy', 'vintage', 'pauper', 'oathbreaker', 'brawl', 'historic']).optional().default('commander'),
    folderId:      z.number().int().positive().optional(),
    colorIdentity: z.string().optional().describe('JSON array string like ["W","U"]'),
  },
  async (args) => {
    try { return ok(lib.createDeck(libDb, args)); } catch (e) { return err(e); }
  }
);

server.tool(
  'update_deck',
  'Update deck metadata fields: name, format, description, power_level, color_identity, is_favorite, folder_id.',
  {
    id:             z.number().int().positive(),
    name:           z.string().min(1).max(200).optional(),
    format:         z.string().optional(),
    description:    z.string().optional(),
    color_identity: z.string().optional(),
    power_level:    z.number().int().min(1).max(10).optional(),
    is_favorite:    z.boolean().optional(),
    folder_id:      z.number().int().positive().optional(),
  },
  async (args) => {
    try { return ok(lib.updateDeck(libDb, args)); } catch (e) { return err(e); }
  }
);

server.tool(
  'delete_deck',
  'Permanently and irreversibly delete a deck and all its cards. You MUST set confirm to true to proceed; omitting it or passing false will do nothing.',
  {
    id:      z.number().int().positive(),
    confirm: z.literal(true).describe('Must be explicitly true — prevents accidental deletion'),
  },
  async (args) => {
    try { return ok(lib.deleteDeck(libDb, { id: args.id })); } catch (e) { return err(e); }
  }
);

server.tool(
  'duplicate_deck',
  'Duplicate a deck (copies name with "(Copy)" suffix and all cards). Returns the new deck id.',
  { id: z.number().int().positive() },
  async (args) => {
    try { return ok(lib.duplicateDeck(libDb, args)); } catch (e) { return err(e); }
  }
);

// ── Deck card tools ───────────────────────────────────────────────────────────

server.tool(
  'add_card_to_deck',
  'Add a card to a deck. Specify the board: main, sideboard, commanders, or maybeboard. Returns the new deck_cards row id.',
  {
    deckId:    z.number().int().positive(),
    oracleId:  z.string().describe('Scryfall oracle_id UUID'),
    scryfallId: z.string().optional().describe('Specific printing scryfall_id'),
    quantity:  z.number().int().min(1).max(99).optional().default(1),
    board:     z.enum(['main', 'sideboard', 'commanders', 'maybeboard']).optional().default('main'),
    category:  z.string().optional(),
  },
  async (args) => {
    try { return ok(lib.addCardToDeck(libDb, args)); } catch (e) { return err(e); }
  }
);

server.tool(
  'remove_card_from_deck',
  'Remove a card entry from a deck by its deck_cards row id (not the oracle_id).',
  { id: z.number().int().positive().describe('deck_cards row id') },
  async (args) => {
    try { return ok(lib.removeCardFromDeck(libDb, args)); } catch (e) { return err(e); }
  }
);

server.tool(
  'update_card_quantity',
  'Update the quantity of a card in a deck by its deck_cards row id.',
  {
    id:       z.number().int().positive(),
    quantity: z.number().int().min(1).max(99),
  },
  async (args) => {
    try { return ok(lib.updateCardQuantity(libDb, args)); } catch (e) { return err(e); }
  }
);

server.tool(
  'update_card_board',
  'Move a card between boards (main, sideboard, commanders, maybeboard) by its deck_cards row id.',
  {
    id:    z.number().int().positive(),
    board: z.enum(['main', 'sideboard', 'commanders', 'maybeboard']),
  },
  async (args) => {
    try { return ok(lib.updateCardBoard(libDb, args)); } catch (e) { return err(e); }
  }
);

server.tool(
  'get_deck_card_statuses',
  'For each card in a deck, return its ownership status: in-collection, in-recipient, missing, or proxy.',
  { deckId: z.number().int().positive() },
  async (args) => {
    try { return ok(lib.getDeckCardStatuses(libDb, args)); } catch (e) { return err(e); }
  }
);

// ── Collection tools ──────────────────────────────────────────────────────────

server.tool(
  'get_collection',
  'Return all cards in the physical collection with quantity, condition, foil status, and price paid.',
  {},
  async () => {
    try { return ok(lib.getCollection(libDb)); } catch (e) { return err(e); }
  }
);

server.tool(
  'add_to_collection',
  'Add a card copy to the collection. Returns the new collection row id.',
  {
    oracleId:   z.string(),
    scryfallId: z.string().optional(),
    quantity:   z.number().int().min(1).optional().default(1),
    foil:       z.boolean().optional().default(false),
    condition:  z.enum(['NM', 'LP', 'MP', 'HP', 'DMG']).optional().default('NM'),
  },
  async (args) => {
    try { return ok(lib.addToCollection(libDb, args)); } catch (e) { return err(e); }
  }
);

server.tool(
  'remove_from_collection',
  'Remove a card entry from the collection by its collection row id.',
  { id: z.number().int().positive() },
  async (args) => {
    try { return ok(lib.removeFromCollection(libDb, args)); } catch (e) { return err(e); }
  }
);

// ── Wishlist tools ────────────────────────────────────────────────────────────

server.tool(
  'get_wishlist',
  'Return all cards on the wishlist sorted by priority.',
  {},
  async () => {
    try { return ok(lib.getWishlist(libDb)); } catch (e) { return err(e); }
  }
);

server.tool(
  'add_to_wishlist',
  'Add a card to the wishlist. Returns the new wishlist row id.',
  {
    oracleId:   z.string(),
    scryfallId: z.string().optional(),
    quantity:   z.number().int().min(1).optional().default(1),
    priority:   z.number().int().min(0).max(10).optional().default(0),
    notes:      z.string().optional(),
  },
  async (args) => {
    try { return ok(lib.addToWishlist(libDb, args)); } catch (e) { return err(e); }
  }
);

server.tool(
  'remove_from_wishlist',
  'Remove a card from the wishlist by its wishlist row id.',
  { id: z.number().int().positive() },
  async (args) => {
    try { return ok(lib.removeFromWishlist(libDb, args)); } catch (e) { return err(e); }
  }
);

// ── Analytics tools ───────────────────────────────────────────────────────────

server.tool(
  'get_most_used_cards',
  'Return the most frequently used cards across all decks, ranked by how many decks include them.',
  { limit: z.number().int().min(1).max(100).optional().default(10) },
  async (args) => {
    try { return ok(lib.getMostUsedCards(libDb, args)); } catch (e) { return err(e); }
  }
);

server.tool(
  'get_decks_with_card',
  'Return all decks that contain a specific card (by oracle_id).',
  {
    oracleId:      z.string(),
    excludeDeckId: z.number().int().positive().optional(),
  },
  async (args) => {
    try { return ok(lib.getDecksWithCard(libDb, args)); } catch (e) { return err(e); }
  }
);

server.tool(
  'get_activity_log',
  'Get daily activity counts for the last N days.',
  { days: z.number().int().min(1).max(365).optional().default(7) },
  async (args) => {
    try { return ok(lib.getActivityLog(libDb, args)); } catch (e) { return err(e); }
  }
);

// ── Resources ─────────────────────────────────────────────────────────────────

function resourceContent(uri: string, data: unknown) {
  return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(data) }] };
}

server.resource('decks', 'karnforge://decks', { mimeType: 'application/json' },
  async () => resourceContent('karnforge://decks', lib.getDecks(libDb))
);

server.resource('collection', 'karnforge://collection', { mimeType: 'application/json' },
  async () => resourceContent('karnforge://collection', lib.getCollection(libDb))
);

server.resource('wishlist', 'karnforge://wishlist', { mimeType: 'application/json' },
  async () => resourceContent('karnforge://wishlist', lib.getWishlist(libDb))
);

server.resource('folder-tree', 'karnforge://folders', { mimeType: 'application/json' },
  async () => resourceContent('karnforge://folders', lib.getFolderTree(libDb))
);

server.resource(
  'deck',
  new ResourceTemplate('karnforge://deck/{id}', { list: undefined }),
  { mimeType: 'application/json' },
  async (uri, { id }) => {
    const deck = lib.getDeck(libDb, { id: Number(id) });
    return resourceContent(uri.href, deck);
  }
);

// ── Canvas helpers ────────────────────────────────────────────────────────────

function loadCanvas(arrangementId: number): Record<string, unknown> {
  const row = lib.loadArrangementCanvas(libDb, { id: arrangementId });
  if (!row?.canvasJson) return {};
  return JSON.parse(row.canvasJson) as Record<string, unknown>;
}

// ── Arrangement tools ─────────────────────────────────────────────────────────

server.tool(
  'get_arrangements',
  'List all named canvas arrangements for a deck.',
  { deckId: z.number().int().positive().describe('Deck ID') },
  async (args) => { try { return ok(lib.getArrangements(libDb, args)); } catch(e) { return err(e); } }
);

server.tool(
  'create_arrangement',
  'Create a new named arrangement (visual canvas layout) for a deck. Returns the new arrangement id.',
  {
    deckId: z.number().int().positive().describe('Deck ID'),
    name:   z.string().min(1).max(100).optional().default('New Arrangement').describe('Arrangement name'),
  },
  async (args) => { try { return ok(lib.createArrangement(libDb, args)); } catch(e) { return err(e); } }
);

server.tool(
  'get_arrangement_canvas',
  'Get the canvas JSON for a specific arrangement (card positions, groups, stickers). Read before writing.',
  { id: z.number().int().positive().describe('Arrangement ID') },
  async ({ id }) => {
    try {
      const row = lib.loadArrangementCanvas(libDb, { id });
      return ok({ id, canvasJson: row?.canvasJson ?? null });
    } catch(e) { return err(e); }
  }
);

server.tool(
  'save_arrangement_canvas',
  'Replace the canvas JSON for an arrangement. Always call get_arrangement_canvas first, modify, then save.',
  {
    id:         z.number().int().positive().describe('Arrangement ID'),
    canvasJson: z.string().describe('Full canvas JSON string'),
  },
  async (args) => { try { return ok(lib.saveArrangementCanvas(libDb, args)); } catch(e) { return err(e); } }
);

// ── Print selection ───────────────────────────────────────────────────────────

server.tool(
  'update_card_print',
  'Change which printing (set/art) is used for a card in a deck by updating its scryfall_id. Use get_deck to find the deck_cards row id.',
  {
    id:         z.number().int().positive().describe('deck_cards row id (NOT oracle_id)'),
    scryfallId: z.string().describe('Scryfall printing ID for the desired edition'),
  },
  async (args) => { try { return ok(lib.updateCardPrint(libDb, args)); } catch(e) { return err(e); } }
);

// ── Canvas group / sticker helpers ────────────────────────────────────────────

server.tool(
  'create_canvas_group',
  'Add a named group of cards to an arrangement canvas. The group will appear as a labeled section in DeckView.',
  {
    arrangementId: z.number().int().positive().describe('Arrangement ID'),
    name:          z.string().min(1).max(100).describe('Group label'),
    oracleIds:     z.array(z.string()).min(1).describe('oracle_id strings for cards to include'),
    color:         z.string().optional().default('#4a9eff').describe('Group accent color (CSS hex)'),
  },
  async ({ arrangementId, name, oracleIds, color }) => {
    try {
      const canvas = loadCanvas(arrangementId);
      canvas.groups = (canvas.groups as unknown[] | undefined) ?? [];
      (canvas.groups as unknown[]).push({ id: crypto.randomUUID(), name, color, oracleIds });
      lib.saveArrangementCanvas(libDb, { id: arrangementId, canvasJson: JSON.stringify(canvas) });
      return ok({ ok: true, groupCount: (canvas.groups as unknown[]).length });
    } catch(e) { return err(e); }
  }
);

server.tool(
  'create_canvas_sticker',
  'Add a text sticker/label to an arrangement canvas.',
  {
    arrangementId: z.number().int().positive().describe('Arrangement ID'),
    text:          z.string().min(1).max(500).describe('Sticker text content (supports Markdown)'),
    color:         z.string().optional().default('#f2ca83').describe('Sticker background color (CSS hex)'),
  },
  async ({ arrangementId, text, color }) => {
    try {
      const canvas = loadCanvas(arrangementId);
      canvas.stickers = (canvas.stickers as unknown[] | undefined) ?? [];
      (canvas.stickers as unknown[]).push({ id: crypto.randomUUID(), text, color, x: 100, y: 100 });
      lib.saveArrangementCanvas(libDb, { id: arrangementId, canvasJson: JSON.stringify(canvas) });
      return ok({ ok: true, stickerCount: (canvas.stickers as unknown[]).length });
    } catch(e) { return err(e); }
  }
);

// ── Connect ───────────────────────────────────────────────────────────────────

(async () => {
  const transport = new StdioServerTransport();
  await server.connect(transport);
})();
