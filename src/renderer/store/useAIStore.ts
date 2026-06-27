import { create } from 'zustand';
import type { ChatEvent } from '../../shared/chat-events';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ChatMessage =
  | { id: string; role: 'user';      text: string }
  | { id: string; role: 'assistant'; text: string }
  | { id: string; role: 'error';     text: string }
  | { id: string; role: 'block';     event: ChatEvent; answered?: boolean };

export interface ConversationSummary {
  id: number;
  title: string | null;
  deck_id: number | null;
  created_at: string;
  session_handle: string | null;
}

// ─── Store interface ──────────────────────────────────────────────────────────

interface AIStore {
  isOpen: boolean;
  messages: ChatMessage[];
  isStreaming: boolean;
  streamingText: string;
  currentTurnBlocks: ChatEvent[];

  // Conversation persistence
  activeConversationId: number | null;
  sessionHandle: string | null;
  conversations: ConversationSummary[];

  // Panel
  toggle: () => void;
  open:   () => void;
  close:  () => void;

  // Message actions
  pushMessage:  (msg: ChatMessage) => void;
  sendMessage:  (text: string, context?: string) => Promise<void>;
  abort:        () => void;
  clearHistory: () => void;

  // Conversation management
  loadConversations:    (deckId?: number) => Promise<void>;
  loadConversation:     (id: number) => Promise<void>;
  startNewConversation: (deckId?: number) => Promise<void>;
  deleteConversation:   (id: number) => Promise<void>;
}

// ─── Helper: convert DB rows → ChatMessage[] ──────────────────────────────────

function dbRowsToChatMessages(rows: Array<{ role: string; content: string; ui_blocks?: ChatEvent[] | null }>): ChatMessage[] {
  const msgs: ChatMessage[] = [];
  for (const row of rows) {
    if (row.role === 'user') {
      msgs.push({ id: crypto.randomUUID(), role: 'user', text: row.content });
    } else if (row.role === 'assistant') {
      msgs.push({ id: crypto.randomUUID(), role: 'assistant', text: row.content });
      // Inject persisted block messages after the assistant text
      if (Array.isArray(row.ui_blocks)) {
        for (const evt of row.ui_blocks) {
          msgs.push({ id: crypto.randomUUID(), role: 'block', event: evt, answered: true });
        }
      }
    }
  }
  return msgs;
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useAIStore = create<AIStore>((set, get) => ({
  isOpen:    false,
  messages:  [],
  isStreaming:      false,
  streamingText:    '',
  currentTurnBlocks: [],

  activeConversationId: null,
  sessionHandle:        null,
  conversations:        [],

  toggle: () => set(s => ({ isOpen: !s.isOpen })),
  open:   () => set({ isOpen: true }),
  close:  () => set({ isOpen: false }),

  pushMessage: (msg) => set(s => ({ messages: [...s.messages, msg] })),

  // ── Send message ────────────────────────────────────────────────────────────

  sendMessage: async (text: string, context?: string) => {
    if (get().isStreaming) return;

    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: 'user', text };
    set(s => ({
      messages: [...s.messages, userMsg],
      isStreaming: true,
      streamingText: '',
      currentTurnBlocks: [],
    }));

    // Create conversation on first message
    let convId = get().activeConversationId;
    if (convId == null) {
      const created = await window.aiAPI.createConversation({
        title: text.slice(0, 40) || 'New conversation',
      });
      convId = created.id;
      set({ activeConversationId: convId });
    }

    // Persist user message
    await window.aiAPI.appendMessage({
      conversationId: convId,
      role: 'user',
      content: text,
    });

    window.aiAPI.removeListeners();

    window.aiAPI.onToken((delta: string) => {
      set(s => ({ streamingText: s.streamingText + delta }));
    });

    window.aiAPI.onDone(async ({ sessionId }: { sessionId: string | null }) => {
      const { streamingText, currentTurnBlocks } = get();
      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        text: streamingText,
      };
      set(s => ({
        messages: [...s.messages, assistantMsg],
        isStreaming: false,
        streamingText: '',
        currentTurnBlocks: [],
        sessionHandle: sessionId ?? s.sessionHandle,
      }));
      window.aiAPI.removeListeners();

      // Persist assistant message + blocks
      const cid = get().activeConversationId;
      if (cid != null) {
        await window.aiAPI.appendMessage({
          conversationId: cid,
          role: 'assistant',
          content: streamingText,
          uiBlocks: currentTurnBlocks.length > 0 ? currentTurnBlocks : null,
        });
        if (sessionId) {
          await window.aiAPI.updateConversationHandle({ id: cid, sessionHandle: sessionId });
        }
      }

      // Refresh conversation list
      get().loadConversations();
    });

    window.aiAPI.onError((msg: string) => {
      const errMsg: ChatMessage = { id: crypto.randomUUID(), role: 'error', text: msg };
      set(s => ({
        messages: [...s.messages, errMsg],
        isStreaming: false,
        streamingText: '',
      }));
      window.aiAPI.removeListeners();
    });

    try {
      await window.aiAPI.chat(text, context, get().sessionHandle ?? undefined);
    } catch {
      // error already emitted via ai:error
    }
  },

  // ── Abort ───────────────────────────────────────────────────────────────────

  abort: () => {
    window.aiAPI.abort();
    window.aiAPI.removeListeners();
    const { streamingText } = get();
    if (streamingText) {
      const msg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        text: streamingText + ' *(aborted)*',
      };
      set(s => ({ messages: [...s.messages, msg], isStreaming: false, streamingText: '' }));
    } else {
      set({ isStreaming: false, streamingText: '' });
    }
  },

  // ── Clear / new conversation ─────────────────────────────────────────────────

  clearHistory: () => {
    window.aiAPI.clearSession();
    window.aiAPI.removeListeners();
    set({
      messages: [],
      isStreaming: false,
      streamingText: '',
      activeConversationId: null,
      sessionHandle: null,
    });
  },

  // ── Conversation management ──────────────────────────────────────────────────

  loadConversations: async (deckId?: number) => {
    const list = await window.aiAPI.getConversations(deckId != null ? { deckId } : {});
    set({ conversations: list ?? [] });
  },

  loadConversation: async (id: number) => {
    const conv = await window.aiAPI.getConversation({ id });
    if (!conv) return;
    const messages = dbRowsToChatMessages(conv.messages ?? []);
    set({
      activeConversationId: id,
      sessionHandle: conv.session_handle ?? null,
      messages,
      streamingText: '',
      isStreaming: false,
    });
  },

  startNewConversation: async () => {
    window.aiAPI.clearSession();
    set({
      activeConversationId: null,
      sessionHandle: null,
      messages: [],
      streamingText: '',
      isStreaming: false,
    });
  },

  deleteConversation: async (id: number) => {
    await window.aiAPI.deleteConversation({ id });
    const { activeConversationId } = get();
    if (activeConversationId === id) {
      set({ activeConversationId: null, sessionHandle: null, messages: [] });
    }
    get().loadConversations();
  },
}));
