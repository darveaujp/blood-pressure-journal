import { create } from 'zustand';

export type SettingsState = {
  autoBackupEnabled: boolean;
  googleDriveConnected: boolean;
  googleAccessToken: string | null;
  lastBackupAt: number | null;
};

type SettingsActions = {
  setAutoBackup: (enabled: boolean) => void;
  setGoogleDriveConnected: (connected: boolean, token?: string | null) => void;
  setLastBackupAt: (timestamp: number) => void;
};

export const useSettingsStore = create<SettingsState & SettingsActions>((set) => ({
  autoBackupEnabled: false,
  googleDriveConnected: false,
  googleAccessToken: null,
  lastBackupAt: null,

  setAutoBackup: (enabled) => set({ autoBackupEnabled: enabled }),
  setGoogleDriveConnected: (connected, token = null) =>
    set({ googleDriveConnected: connected, googleAccessToken: token }),
  setLastBackupAt: (timestamp) => set({ lastBackupAt: timestamp }),
}));
