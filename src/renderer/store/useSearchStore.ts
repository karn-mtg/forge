import { create } from 'zustand';

interface SearchStore {
  value: string;
  placeholder: string;
  setValue: (v: string) => void;
  setPlaceholder: (p: string) => void;
  reset: () => void;
}

export const useSearchStore = create<SearchStore>((set) => ({
  value: '',
  placeholder: 'Search…',
  setValue: (v) => set({ value: v }),
  setPlaceholder: (p) => set({ placeholder: p }),
  reset: () => set({ value: '', placeholder: 'Search…' }),
}));
