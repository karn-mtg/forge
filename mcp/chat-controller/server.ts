import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { randomUUID } from 'crypto';

const BRIDGE_PORT = process.env.KARNFORGE_BRIDGE_PORT;
if (!BRIDGE_PORT) {
  process.stderr.write('[chat-controller] KARNFORGE_BRIDGE_PORT not set — exiting\n');
  process.exit(1);
}

const BRIDGE_BASE = `http://127.0.0.1:${BRIDGE_PORT}`;

async function bridgePost(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${BRIDGE_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Bridge ${path} responded ${res.status}`);
  return res.json();
}

async function bridgeAsk(event: unknown): Promise<unknown> {
  const requestId = randomUUID();
  // /ask holds the connection open until the user responds (up to 5 minutes)
  const res = await fetch(`${BRIDGE_BASE}/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event, requestId }),
    signal: AbortSignal.timeout(310_000),
  });
  if (!res.ok) throw new Error(`Bridge /ask responded ${res.status}`);
  const { value } = (await res.json()) as { value: unknown };
  return value;
}

// ─────────────────────────────────────────────────────────────────────────────

const server = new McpServer({ name: 'chat-controller', version: '1.0.0' });

server.tool(
  'emit_block',
  [
    'Emit a typed UI event to the KarnForge chat interface. Use this to show rich content inline in the conversation.',
    '',
    'Display events (no user interaction needed):',
    '  { type: "card_showcase", oracle_ids: ["uuid-1", "uuid-2"], title?: "string" }',
    '  { type: "card_detail", oracle_id: "uuid" }',
    '  { type: "deck_summary", deck_id: 42 }',
    '  { type: "deck_diff", added: ["uuid"], removed: ["uuid"], deck_id?: 42 }',
    '  { type: "thinking", label?: "Searching cards..." }',
    '',
    'Suggestion events (user can accept or dismiss independently):',
    '  { type: "suggest_add_card", oracle_id: "uuid", deck_id: 42, reason?: "string" }',
    '  { type: "suggest_remove_card", oracle_id: "uuid", deck_id: 42, reason?: "string" }',
    '  { type: "suggest_swap", remove_oracle_id: "uuid", add_oracle_id: "uuid", deck_id?: 42, reason?: "string" }',
    '  { type: "suggest_create_deck", name: "string", format: "commander", commander_id?: "uuid", seed_cards: ["uuid"] }',
    '  { type: "suggest_create_group", oracle_ids: ["uuid"], name: "string" }',
    '  { type: "suggest_prints_change", oracle_id: "uuid", scryfall_id: "uuid", set_name?: "string" }',
    '',
    'Navigation events (auto-execute in the UI):',
    '  { type: "open_deck", deck_id: 42 }',
    '  { type: "highlight_cards", oracle_ids: ["uuid"] }',
    '  { type: "set_search_filters", filters: { colors: ["W","U"], types: ["Creature"] } }',
    '  { type: "focus_arrangement", arrangement_id: 7 }',
    '',
    'Always use oracle_id (UUID) to reference cards, never card names. KarnForge resolves them to images.',
  ].join('\n'),
  {
    event: z.object({ type: z.string() }).passthrough().describe('A ChatEvent object — see tool description for the full vocabulary'),
  },
  async ({ event }) => {
    await bridgePost('/emit', { event });
    return { content: [{ type: 'text' as const, text: `Emitted ${event.type} block` }] };
  }
);

server.tool(
  'ask',
  [
    'Show an interactive prompt to the user and SUSPEND until they respond. Returns the chosen value.',
    'Use this when you need a decision before continuing — it blocks your next action until the user answers.',
    '',
    'Interactive event types:',
    '  ask_choice:   { type: "ask_choice",   question: "string", options: [{ label: "string", value: "string" }] }',
    '  ask_confirm:  { type: "ask_confirm",  question: "string", yes_label?: "string", no_label?: "string" }',
    '  ask_card_pick:{ type: "ask_card_pick",question: "string", oracle_ids: ["uuid-1", "uuid-2"] }',
    '',
    'Returns the selected value (string for ask_choice/ask_confirm, oracle_id string for ask_card_pick).',
    'Times out after 5 minutes if no response.',
  ].join('\n'),
  {
    event: z.object({
      type: z.enum(['ask_choice', 'ask_confirm', 'ask_card_pick']),
    }).passthrough().describe('An interactive ChatEvent — see tool description for the full shape'),
  },
  async ({ event }) => {
    const value = await bridgeAsk(event);
    return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] };
  }
);

;(async () => {
  const transport = new StdioServerTransport();
  await server.connect(transport);
})();
