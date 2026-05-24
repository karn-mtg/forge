import { create } from 'zustand';
import type { FolderNode, Deck } from '../types/electron';

interface LibraryState {
  folders: FolderNode[];
  decks: Deck[];
  isLoaded: boolean;
  isLoading: boolean;
  loadLibrary: () => Promise<void>;
  reloadLibrary: () => Promise<void>;
  createDeck: (args: { name: string; format: string; folder_id?: number | null; color_identity?: string }) => Promise<number>;
  createFolder: (args: { name: string; parent_id?: number | null }) => Promise<void>;
  renameFolder: (args: { id: number; name: string }) => Promise<void>;
  deleteFolder: (args: { id: number }) => Promise<void>;
  updateDeck: (args: { id: number } & Partial<Deck>) => Promise<void>;
  deleteDeck: (args: { id: number }) => Promise<void>;
  updateDeckCardCount: (deckId: number, delta: number) => void;
  duplicateDeck: (args: { id: number }) => Promise<number | undefined>;
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  folders: [],
  decks: [],
  isLoaded: false,
  isLoading: false,

  loadLibrary: async () => {
    const { isLoaded, isLoading } = get();
    if (isLoaded || isLoading) return;
    set({ isLoading: true });
    try {
      const [folders, decks] = await Promise.all([
        window.libraryAPI.getFolderTree(),
        window.libraryAPI.getDecks(),
      ]);
      set({ folders, decks, isLoaded: true, isLoading: false });
    } catch (err) {
      console.error('Failed to load library:', err);
      set({ isLoading: false });
    }
  },

  reloadLibrary: async () => {
    try {
      const [folders, decks] = await Promise.all([
        window.libraryAPI.getFolderTree(),
        window.libraryAPI.getDecks(),
      ]);
      set({ folders, decks, isLoaded: true });
    } catch {}
  },

  // Fix #4: optimistic update — no full reload after mutation
  createDeck: async (args) => {
    const { id } = await window.libraryAPI.createDeck(args);
    const newDeck: Deck = {
      id,
      name: args.name,
      format: args.format,
      folder_id: args.folder_id ?? null,
      color_identity: args.color_identity ?? '',
      card_count: 0,
    };
    set(state => ({ decks: [...state.decks, newDeck] }));
    return id;
  },

  // Folders mutate the tree structure so a reload is simpler than tree surgery
  createFolder: async (args) => {
    await window.libraryAPI.createFolder(args);
    const folders = await window.libraryAPI.getFolderTree();
    set({ folders });
  },

  renameFolder: async (args) => {
    await window.libraryAPI.renameFolder(args);
    const folders = await window.libraryAPI.getFolderTree();
    set({ folders });
  },

  deleteFolder: async (args) => {
    await window.libraryAPI.deleteFolder(args);
    // Folder delete can cascade-null deck.folder_id so reload both
    const [folders, decks] = await Promise.all([
      window.libraryAPI.getFolderTree(),
      window.libraryAPI.getDecks(),
    ]);
    set({ folders, decks });
  },

  // Fix #4: optimistic deck mutations — O(n) local array ops, zero IPC reloads
  updateDeck: async (args) => {
    await window.libraryAPI.updateDeck(args);
    set(state => ({
      decks: state.decks.map(d => d.id === args.id ? { ...d, ...args } : d),
    }));
  },

  deleteDeck: async (args) => {
    await window.libraryAPI.deleteDeck(args);
    set(state => ({ decks: state.decks.filter(d => d.id !== args.id) }));
  },

  updateDeckCardCount: (deckId: number, delta: number) => {
    set(state => ({
      decks: state.decks.map(d => d.id === deckId ? { ...d, card_count: Math.max(0, (d.card_count ?? 0) + delta) } : d),
    }));
  },

  duplicateDeck: async (args: { id: number }) => {
    const result = await window.libraryAPI.duplicateDeck(args);
    if (!result?.id) return;
    // Reload full list since we need the copy's full data
    const decks = await window.libraryAPI.getDecks();
    set({ decks });
    return result.id;
  },
}));
