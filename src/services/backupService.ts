import {
  writeAsStringAsync,
  readAsStringAsync,
  cacheDirectory,
  documentDirectory,
  EncodingType,
} from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import { format } from 'date-fns';
import { useBpStore } from '../state/bpStore';
import { useSettingsStore } from '../state/settingsStore';
import { listAllGroups, getGroupWithReadings, deleteAllGroups } from '../db/bpRepository';

export type BackupData = {
  version: '1.0';
  exportedAt: number;
  groups: Array<{
    id: string;
    createdAt: number;
    arm: 'left' | 'right';
    note: string | null;
    readings: Array<{
      systolic: number;
      diastolic: number;
      pulse: number | null;
    }>;
  }>;
};

export async function createBackupData(): Promise<BackupData> {
  // Query DB directly with no limit to ensure ALL groups are backed up
  const groups = await listAllGroups();
  
  // Fetch full group data with readings
  const groupsWithReadings = await Promise.all(
    groups.map(async (group) => {
      const fullGroup = await getGroupWithReadings(group.id);
      return {
        id: group.id,
        createdAt: group.createdAt,
        arm: group.arm,
        note: group.note,
        readings: fullGroup?.readings.map(r => ({
          systolic: r.systolic,
          diastolic: r.diastolic,
          pulse: r.pulse,
        })) || [],
      };
    })
  );
  
  return {
    version: '1.0',
    exportedAt: Date.now(),
    groups: groupsWithReadings,
  };
}

// For manual export - uses timestamp in filename
export async function exportBackupToJson(): Promise<string> {
  const data = await createBackupData();
  const json = JSON.stringify(data, null, 2);
  
  const baseDir = cacheDirectory ?? documentDirectory ?? '';
  const filename = `bp_backup_${format(Date.now(), 'yyyyMMdd_HHmmss')}.json`;
  const uri = `${baseDir}${filename}`;
  
  await writeAsStringAsync(uri, json, {
    encoding: EncodingType.UTF8,
  });
  
  return uri;
}

// For auto-backup - uses consistent filename so it overwrites the same file
export async function exportBackupToJsonConsistent(): Promise<string> {
  const data = await createBackupData();
  const json = JSON.stringify(data, null, 2);
  
  // Use documentDirectory for persistent storage
  const baseDir = documentDirectory ?? cacheDirectory ?? '';
  const filename = 'bp_backup_latest.json';
  const uri = `${baseDir}${filename}`;
  
  await writeAsStringAsync(uri, json, {
    encoding: EncodingType.UTF8,
  });
  
  return uri;
}

export async function shareBackupFile(uri: string): Promise<void> {
  const canShare = await Sharing.isAvailableAsync();
  if (!canShare) {
    throw new Error(`Backup saved locally: ${uri}`);
  }
  
  await Sharing.shareAsync(uri, {
    mimeType: 'application/json',
    dialogTitle: 'Save Backup',
    UTI: 'public.json',
  });
}

export async function autoBackupIfEnabled(): Promise<void> {
  const { autoBackupEnabled, setLastBackupAt } = useSettingsStore.getState();
  
  if (!autoBackupEnabled) return;
  
  try {
    await exportBackupToJsonConsistent();
    setLastBackupAt(Date.now());
  } catch (e) {
    console.error('Auto-backup failed:', e);
  }
}

export async function importBackupFromJson(uri: string): Promise<BackupData> {
  const content = await readAsStringAsync(uri, {
    encoding: EncodingType.UTF8,
  });

  const data: BackupData = JSON.parse(content);

  if (!data.version || !Array.isArray(data.groups)) {
    throw new Error('Invalid backup file format');
  }

  return data;
}

// Restore backup data to the app
export async function restoreBackup(data: BackupData): Promise<number> {
  const { addGroup } = useBpStore.getState();

  // Clear all existing data directly via DB (no store limit)
  await deleteAllGroups();

  // Restore groups
  let restoredCount = 0;
  for (const group of data.groups) {
    await addGroup({
      arm: group.arm,
      note: group.note,
      readings: group.readings,
      createdAt: group.createdAt,
    });
    restoredCount++;
  }
  
  return restoredCount;
}

// Pick a backup JSON file
export async function pickBackupFile(): Promise<string | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: 'application/json',
    copyToCacheDirectory: true,
  });
  
  if (result.canceled || !result.assets?.length) return null;
  
  return result.assets[0].uri;
}
