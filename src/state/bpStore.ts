import { create } from 'zustand';

import type { Arm, BpGroup, BpReadingInput } from '../types/bp';
import type { BpGroupWithReadings } from '../types/bp';
import { createGroup, deleteGroup, getGroupWithReadings, initDb, listGroups, updateGroup, updateGroupMeta } from '../db/bpRepository';
import { autoBackupIfEnabled } from '../services/backupService';

type BpState = {
  initialized: boolean;
  groups: BpGroup[];
  init: () => Promise<void>;
  refresh: () => Promise<void>;
  getGroup: (groupId: string) => Promise<BpGroupWithReadings | null>;
  addGroup: (params: {
    arm: Arm;
    note: string | null;
    readings: Array<Omit<BpReadingInput, 'takenAt'>>;
    createdAt: number;
  }) => Promise<void>;
  removeGroup: (groupId: string) => Promise<void>;
  editGroupMeta: (params: { id: string; createdAt: number; arm: Arm; note: string | null }) => Promise<void>;
  editGroup: (params: {
    id: string;
    createdAt: number;
    arm: Arm;
    note: string | null;
    readings: Array<{ systolic: number; diastolic: number; pulse?: number | null }>;
  }) => Promise<void>;
};

export const useBpStore = create<BpState>((set, get) => ({
  initialized: false,
  groups: [],

  init: async () => {
    if (get().initialized) return;
    await initDb();
    set({ initialized: true });
    await get().refresh();
  },

  refresh: async () => {
    const groups = await listGroups(500);
    set({ groups });
  },

  getGroup: async (groupId) => {
    return await getGroupWithReadings(groupId);
  },

  addGroup: async ({ arm, note, readings, createdAt }) => {
    await createGroup({ arm, note, readings, createdAt });
    await get().refresh();
    await autoBackupIfEnabled();
  },

  removeGroup: async (groupId) => {
    await deleteGroup(groupId);
    await get().refresh();
    await autoBackupIfEnabled();
  },

  editGroupMeta: async ({ id, createdAt, arm, note }) => {
    await updateGroupMeta({ id, createdAt, arm, note });
    await get().refresh();
    await autoBackupIfEnabled();
  },

  editGroup: async ({ id, createdAt, arm, note, readings }) => {
    await updateGroup({ id, createdAt, arm, note, readings });
    await get().refresh();
    await autoBackupIfEnabled();
  },
}));
