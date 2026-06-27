// ─── Display events ───────────────────────────────────────────────────────────

export interface TextEvent {
  type: 'text'
  content: string
}

export interface CardShowcaseEvent {
  type: 'card_showcase'
  oracle_ids: string[]
  title?: string
}

export interface CardDetailEvent {
  type: 'card_detail'
  oracle_id: string
}

export interface DeckSummaryEvent {
  type: 'deck_summary'
  deck_id: number
}

export interface DeckDiffEvent {
  type: 'deck_diff'
  added: string[]    // oracle_ids
  removed: string[]  // oracle_ids
  deck_id?: number
}

export interface ThinkingEvent {
  type: 'thinking'
  label?: string
}

// ─── Interactive events (Claude suspends until user responds) ─────────────────

export interface AskChoiceOption {
  label: string
  value: string
  description?: string
}

export interface AskChoiceEvent {
  type: 'ask_choice'
  question: string
  options: AskChoiceOption[]
  requestId: string
}

export interface AskConfirmEvent {
  type: 'ask_confirm'
  question: string
  yes_label?: string
  no_label?: string
  requestId: string
}

export interface AskCardPickEvent {
  type: 'ask_card_pick'
  oracle_ids: string[]
  question: string
  requestId: string
}

// ─── Suggestion events (non-blocking, user accepts/dismisses independently) ───

export interface SuggestAddCardEvent {
  type: 'suggest_add_card'
  oracle_id: string
  deck_id: number
  reason?: string
}

export interface SuggestRemoveCardEvent {
  type: 'suggest_remove_card'
  oracle_id: string
  deck_id: number
  reason?: string
}

export interface SuggestSwapEvent {
  type: 'suggest_swap'
  remove_oracle_id: string
  add_oracle_id: string
  deck_id?: number
  reason?: string
}

export interface SuggestCreateDeckEvent {
  type: 'suggest_create_deck'
  name: string
  format: string
  commander_id?: string
  seed_cards: string[]  // oracle_ids
}

export interface SuggestCreateGroupEvent {
  type: 'suggest_create_group'
  oracle_ids: string[]
  name: string
}

export interface SuggestPrintsChangeEvent {
  type: 'suggest_prints_change'
  oracle_id: string
  scryfall_id: string
  set_name?: string
}

// ─── Navigation events (fire and forget) ─────────────────────────────────────

export interface OpenDeckEvent {
  type: 'open_deck'
  deck_id: number
}

export interface HighlightCardsEvent {
  type: 'highlight_cards'
  oracle_ids: string[]
}

export interface SetSearchFiltersEvent {
  type: 'set_search_filters'
  filters: Record<string, unknown>
}

export interface FocusArrangementEvent {
  type: 'focus_arrangement'
  arrangement_id: number
}

// ─── Union types ──────────────────────────────────────────────────────────────

export type DisplayEvent =
  | TextEvent
  | CardShowcaseEvent
  | CardDetailEvent
  | DeckSummaryEvent
  | DeckDiffEvent
  | ThinkingEvent

export type InteractiveEvent =
  | AskChoiceEvent
  | AskConfirmEvent
  | AskCardPickEvent

export type SuggestionEvent =
  | SuggestAddCardEvent
  | SuggestRemoveCardEvent
  | SuggestSwapEvent
  | SuggestCreateDeckEvent
  | SuggestCreateGroupEvent
  | SuggestPrintsChangeEvent

export type NavigationEvent =
  | OpenDeckEvent
  | HighlightCardsEvent
  | SetSearchFiltersEvent
  | FocusArrangementEvent

export type ChatEvent =
  | DisplayEvent
  | InteractiveEvent
  | SuggestionEvent
  | NavigationEvent

// ─── AI Provider port interface ───────────────────────────────────────────────

export interface StoredMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatInput {
  message: string
  systemPrompt?: string
  /** Injected deck/page context — merged into system prompt for new sessions,
   *  prepended to user message for resumed sessions (Claude ignores --system-prompt on --resume) */
  context?: string
  /** Full message history owned by KarnForge; providers without native sessions replay this */
  history: StoredMessage[]
  /** Opaque session token — Claude CLI stores sessionId here for --resume */
  sessionHandle?: string
}

export interface ProviderCapabilities {
  /** True if the provider supports MCP tool calls (Claude CLI: yes; raw OpenAI: no) */
  supportsMCP: boolean
  /** True if the provider manages history internally (Claude CLI --resume); false = replay history[] */
  nativeHistory: boolean
  supportsSystemPrompt: boolean
}

export type ProviderChunk =
  | { kind: 'token';  delta: string }
  | { kind: 'done';   sessionHandle?: string }
  | { kind: 'error';  message: string }

export interface AIProvider {
  readonly id: string
  readonly name: string
  chat(input: ChatInput): AsyncIterable<ProviderChunk>
  abort(): void
  getCapabilities(): ProviderCapabilities
}

// ─── Renderer ChatMessage type ────────────────────────────────────────────────

export type ChatMessage =
  | { id: string; role: 'user';      text: string }
  | { id: string; role: 'assistant'; text: string }
  | { id: string; role: 'error';     text: string }
  | { id: string; role: 'block';     event: ChatEvent; answered?: boolean }
