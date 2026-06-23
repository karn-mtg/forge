import { create } from 'zustand';
import type { FolderNode, Deck, Recipient, RecipientType } from '../types/electron';
import { useToastStore } from './useToastStore';
import { createLogger } from '../utils/logger';

const log = createLogger('store:library');

interface LibraryState {
  folders: FolderNode[];
  decks: Deck[];
  recipients: Recipient[];
  isLoaded: boolean;
  isLoading: boolean;
  loadLibrary: () => Promise<void>;
  reloadLibrary: () => Promise<void>;
  createDeck: (args: { name: string; format: string; folder_id?: number | null; color_identity?: string }) => Promise<number>;
  createFolder: (args: { name: string; parent_id?: number | null }) => Promise<void>;
  renameFolder: (args: { id: number; name: string }) => Promise<void>;
  deleteFolder: (args: { id: number }) => Promise<void>;
  moveFolder: (args: { id: number; parent_id: number | null }) => Promise<void>;
  updateDeck: (args: { id: number } & Partial<Deck>) => Promise<void>;
  deleteDeck: (args: { id: number }) => Promise<void>;
  updateDeckCardCount: (deckId: number, delta: number) => void;
  duplicateDeck: (args: { id: number }) => Promise<number | undefined>;
  createRecipient: (args: { name: string; type: RecipientType; notes?: string | null }) => Promise<number>;
  updateRecipient: (args: { id: number; name: string; type: RecipientType; notes?: string | null }) => Promise<void>;
  deleteRecipient: (args: { id: number }) => Promise<void>;
  mountDeck: (args: { id: number; recipientId: number }) => Promise<void>;
  unmountDeck: (args: { id: number }) => Promise<void>;
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  folders: [],
  decks: [],
  recipients: [],
  isLoaded: false,
  isLoading: false,

  loadLibrary: async () => {
    const { isLoaded, isLoading } = get();
    if (isLoaded || isLoading) return;
    log.info('loadLibrary start');
    set({ isLoading: true });
    try {
      const [folders, decks, recipients] = await Promise.all([
        window.libraryAPI.getFolderTree(),
        window.libraryAPI.getDecks(),
        window.libraryAPI.getRecipients(),
      ]);
      log.info(`loadLibrary done — ${folders.length} folders, ${decks.length} decks, ${recipients.length} recipients`);
      set({ folders, decks, recipients, isLoaded: true, isLoading: false });
    } catch (err) {
      log.error('loadLibrary failed', err);
      useToastStore.getState().push({ type: 'error', title: 'Failed to load library', message: String(err) });
      set({ isLoading: false });
    }
  },

  reloadLibrary: async () => {
    log.debug('reloadLibrary');
    try {
      const [folders, decks, recipients] = await Promise.all([
        window.libraryAPI.getFolderTree(),
        window.libraryAPI.getDecks(),
        window.libraryAPI.getRecipients(),
      ]);
      log.debug(`reloadLibrary done — ${folders.length} folders, ${decks.length} decks`);
      set({ folders, decks, recipients, isLoaded: true });
    } catch (err) {
      log.error('reloadLibrary failed', err);
      useToastStore.getState().push({ type: 'error', title: 'Failed to reload library', message: String(err) });
    }
  },

  createDeck: async (args) => {
    log.info(`createDeck name="${args.name}" format=${args.format}`);
    const { id } = await window.libraryAPI.createDeck(args);
    log.info(`createDeck → id=${id}`);
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

  createFolder: async (args) => {
    log.info(`createFolder name="${args.name}"`);
    await window.libraryAPI.createFolder(args);
    const folders = await window.libraryAPI.getFolderTree();
    set({ folders });
  },

  renameFolder: async (args) => {
    await window.libraryAPI.renameFolder(args);
    const folders = await window.libraryAPI.getFolderTree();
    set({ folders });
  },

  moveFolder: async (args) => {
    await window.libraryAPI.moveFolder(args);
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

  updateDeck: async (args) => {
    log.debug(`updateDeck id=${args.id}`);
    await window.libraryAPI.updateDeck(args);
    set(state => ({
      decks: state.decks.map(d => d.id === args.id ? { ...d, ...args } : d),
    }));
  },

  deleteDeck: async (args) => {
    log.info(`deleteDeck id=${args.id}`);
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

  createRecipient: async (args) => {
    const { id } = await window.libraryAPI.createRecipient(args);
    const newRecipient: Recipient = { id, name: args.name, type: args.type, notes: args.notes ?? null };
    set(state => ({ recipients: [...state.recipients, newRecipient].sort((a, b) => a.name.localeCompare(b.name)) }));
    return id;
  },

  updateRecipient: async (args) => {
    await window.libraryAPI.updateRecipient(args);
    set(state => ({
      recipients: state.recipients.map(r => r.id === args.id ? { ...r, ...args } : r),
    }));
  },

  deleteRecipient: async (args) => {
    await window.libraryAPI.deleteRecipient(args);
    set(state => ({
      recipients: state.recipients.filter(r => r.id !== args.id),
      decks: state.decks.map(d => d.recipient_id === args.id
        ? { ...d, recipient_id: null, recipient_name: null, recipient_type: null }
        : d),
    }));
  },

  mountDeck: async ({ id, recipientId }) => {
    await window.libraryAPI.mountDeck({ id, recipientId });
    const recipient = get().recipients.find(r => r.id === recipientId);
    set(state => ({
      decks: state.decks.map(d => d.id === id
        ? { ...d, recipient_id: recipientId, recipient_name: recipient?.name ?? null, recipient_type: recipient?.type ?? null }
        : d),
    }));
  },

  unmountDeck: async ({ id }) => {
    await window.libraryAPI.unmountDeck({ id });
    set(state => ({
      decks: state.decks.map(d => d.id === id
        ? { ...d, recipient_id: null, recipient_name: null, recipient_type: null }
        : d),
    }));
  },
}));
