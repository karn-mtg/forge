import { create } from 'zustand';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'error';
  text: string;
}

interface AIStore {
  isOpen: boolean;
  messages: ChatMessage[];
  isStreaming: boolean;
  streamingText: string;

  toggle: () => void;
  open: () => void;
  close: () => void;
  sendMessage: (text: string) => Promise<void>;
  abort: () => void;
  clearHistory: () => void;
}

export const useAIStore = create<AIStore>((set, get) => ({
  isOpen: false,
  messages: [],
  isStreaming: false,
  streamingText: '',

  toggle: () => set(s => ({ isOpen: !s.isOpen })),
  open:   () => set({ isOpen: true }),
  close:  () => set({ isOpen: false }),

  sendMessage: async (text: string) => {
    if (get().isStreaming) return;

    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: 'user', text };
    set(s => ({ messages: [...s.messages, userMsg], isStreaming: true, streamingText: '' }));

    window.aiAPI.removeListeners();

    window.aiAPI.onToken((delta) => {
      set(s => ({ streamingText: s.streamingText + delta }));
    });

    window.aiAPI.onDone(() => {
      const { streamingText } = get();
      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        text: streamingText,
      };
      set(s => ({ messages: [...s.messages, assistantMsg], isStreaming: false, streamingText: '' }));
      window.aiAPI.removeListeners();
    });

    window.aiAPI.onError((msg) => {
      const errMsg: ChatMessage = { id: crypto.randomUUID(), role: 'error', text: msg };
      set(s => ({
        messages: [...s.messages, errMsg],
        isStreaming: false,
        streamingText: '',
      }));
      window.aiAPI.removeListeners();
    });

    try {
      await window.aiAPI.chat(text);
    } catch {
      // error already emitted via ai:error event
    }
  },

  abort: () => {
    window.aiAPI.abort();
    window.aiAPI.removeListeners();
    const { streamingText } = get();
    if (streamingText) {
      const msg: ChatMessage = { id: crypto.randomUUID(), role: 'assistant', text: streamingText + ' *(aborted)*' };
      set(s => ({ messages: [...s.messages, msg], isStreaming: false, streamingText: '' }));
    } else {
      set({ isStreaming: false, streamingText: '' });
    }
  },

  clearHistory: () => {
    window.aiAPI.clearSession();
    window.aiAPI.removeListeners();
    set({ messages: [], isStreaming: false, streamingText: '' });
  },
}));
