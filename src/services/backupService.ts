import {
  writeAsStringAsync,
  readAsStringAsync,
  cacheDirectory,
  documentDirectory,
  EncodingType,
} from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { format } from 'date-fns';
import { useBpStore } from '../state/bpStore';
import { useSettingsStore } from '../state/settingsStore';

export type BackupData = {
  version: '1.0';
  exportedAt: number;
  groups: ReturnType<typeof useBpStore.getState>['groups'];
};

export async function createBackupData(): Promise<BackupData> {
  const groups = useBpStore.getState().groups;
  return {
    version: '1.0',
    exportedAt: Date.now(),
    groups,
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
    dialogTitle: 'Save Backup to Google Drive',
    UTI: 'public.json',
  });
}

export async function autoBackupIfEnabled(): Promise<void> {
  const { autoBackupEnabled, googleDriveConnected, googleAccessToken, setLastBackupAt } = useSettingsStore.getState();
  
  if (!autoBackupEnabled) return;
  
  try {
    // Use consistent filename for auto-backup
    const uri = await exportBackupToJsonConsistent();
    
    if (googleDriveConnected && googleAccessToken) {
      // Import and use Google Drive upload
      const { uploadToGoogleDrive } = await import('./googleDriveService');
      try {
        await uploadToGoogleDrive(
          googleAccessToken,
          uri,
          'bp_backup_latest.json'
        );
        console.log('Auto-backup uploaded to Google Drive');
      } catch (uploadError) {
        console.error('Google Drive upload failed:', uploadError);
        // Still saved locally, will retry next time
      }
    }
    
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
