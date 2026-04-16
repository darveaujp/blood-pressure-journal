import { create } from 'zustand';

type UiState = {
  loadingCount: number;
  startLoading: () => void;
  stopLoading: () => void;
};

export const useUiStore = create<UiState>((set) => ({
  loadingCount: 0,
  startLoading: () => set((s) => ({ loadingCount: s.loadingCount + 1 })),
  stopLoading: () =>
    set((s) => ({
      loadingCount: Math.max(0, s.loadingCount - 1),
    })),
}));
