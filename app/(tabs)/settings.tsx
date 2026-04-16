import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { useMemo, useState, useEffect } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { cacheDirectory, documentDirectory, writeAsStringAsync, EncodingType } from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as Print from 'expo-print';
import { signInWithGoogle, uploadToGoogleDrive, isConfigured as isGoogleDriveConfigured } from '../../src/services/googleDriveService';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useToast } from 'react-native-toast-notifications';
import { Calendar } from 'react-native-calendars';

import { listGroupsInRange } from '../../src/db/bpRepository';
import { groupsToCsv } from '../../src/export/csv';
import { useBpStore } from '../../src/state/bpStore';
import { useSettingsStore } from '../../src/state/settingsStore';
import { useUiStore } from '../../src/state/uiStore';
import TimePickerField from '../../src/components/TimePickerField';
import {
  pickCsvFile,
  parseCsvImport,
  groupImportRowsByDateTime,
  ImportRow,
} from '../../src/services/importService';
import { exportBackupToJson, exportBackupToJsonConsistent, shareBackupFile, BackupData } from '../../src/services/backupService';
import { BpReadingInput } from '../../src/types/bp';

function groupsToHtml(groups: Awaited<ReturnType<typeof listGroupsInRange>>) {
  const rows = groups
    .map((g) => {
      const dt = new Date(g.createdAt);
      const date = dt.toLocaleDateString([], { year: 'numeric', month: '2-digit', day: '2-digit' });
      const time = dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
      const pulse = typeof g.avgPulse === 'number' ? Math.round(g.avgPulse) : '';
      const note = g.note ? String(g.note) : '';
      return `
        <tr>
          <td>${date}</td>
          <td>${time}</td>
          <td>${g.arm}</td>
          <td>${Math.round(g.avgSystolic)}/${Math.round(g.avgDiastolic)}</td>
          <td>${pulse}</td>
          <td>${g.count}</td>
          <td>${note.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</td>
        </tr>
      `;
    })
    .join('');

  return `
  <html>
    <head>
      <meta charset="utf-8" />
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial; padding: 16px; }
        h1 { font-size: 18px; margin: 0 0 8px 0; }
        p { color: #475569; margin: 0 0 14px 0; font-size: 12px; }
        table { width: 100%; border-collapse: collapse; }
        th, td { border-bottom: 1px solid #e2e8f0; padding: 8px 6px; font-size: 11px; text-align: left; vertical-align: top; }
        th { background: #f8fafc; }
      </style>
    </head>
    <body>
      <h1>Blood Pressure Export</h1>
      <p>For personal tracking only. Not medical advice.</p>
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Time</th>
            <th>Arm</th>
            <th>Avg BP</th>
            <th>Avg Pulse</th>
            <th>Count</th>
            <th>Note</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </body>
  </html>
  `;
}

export default function SettingsScreen() {
  const toast = useToast();
  const startLoading = useUiStore((s) => s.startLoading);
  const stopLoading = useUiStore((s) => s.stopLoading);
  const addGroup = useBpStore((s) => s.addGroup);
  const groups = useBpStore((s) => s.groups);

  const {
    autoBackupEnabled,
    googleDriveConnected,
    lastBackupAt,
    setAutoBackup,
    setGoogleDriveConnected,
    setLastBackupAt,
  } = useSettingsStore();

  // Export state
  const [exportStart, setExportStart] = useState(() => new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
  const [exportEnd, setExportEnd] = useState(() => new Date());
  const [showPicker, setShowPicker] = useState<null | 'start-date' | 'end-date'>(null);

  // Import state
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importRows, setImportRows] = useState<ImportRow[]>([]);
  const [importArm, setImportArm] = useState<'left' | 'right'>('left');

  // Backup state
  const [backupModalOpen, setBackupModalOpen] = useState(false);
  const [draftDate, setDraftDate] = useState<Date | null>(null);
  const [calendarTarget, setCalendarTarget] = useState<'start' | 'end' | null>(null);

  const rangeLabel = useMemo(() => {
    const a = format(exportStart, 'yyyy-MM-dd HH:mm');
    const b = format(exportEnd, 'yyyy-MM-dd HH:mm');
    return `${a} → ${b}`;
  }, [exportStart, exportEnd]);

  const backupCount = groups.length;

  async function fetchInRange() {
    const startAt = exportStart.getTime();
    const endAt = exportEnd.getTime();
    if (endAt < startAt) {
      toast.show('End must be after Start.', { type: 'warning' });
      return null;
    }

    const inRange = await listGroupsInRange({ startAt, endAt });
    if (!inRange.length) {
      toast.show('No readings found in that date range.', { type: 'warning' });
      return null;
    }

    return inRange;
  }

  async function shareFile(uri: string, mimeType: string) {
    const canShare = await Sharing.isAvailableAsync();
    if (!canShare) {
      toast.show(`Saved to: ${uri}`, { type: 'success' });
      return;
    }

    await Sharing.shareAsync(uri, {
      mimeType,
      dialogTitle: 'Export',
      UTI: mimeType === 'application/pdf' ? 'com.adobe.pdf' : 'public.comma-separated-values-text',
    });
  }

  async function onExportCsv() {
    startLoading();
    try {
      const inRange = await fetchInRange();
      if (!inRange) return;

      const csv = groupsToCsv(inRange);
      const filename = `bp_export_${format(exportStart, 'yyyyMMdd_HHmm')}-${format(exportEnd, 'yyyyMMdd_HHmm')}.csv`;
      const baseDir = cacheDirectory ?? documentDirectory ?? '';
      const uri = `${baseDir}${filename}`;
      await writeAsStringAsync(uri, csv, {
        encoding: EncodingType.UTF8,
      });

      await shareFile(uri, 'text/csv');
      toast.show('CSV ready to share.', { type: 'success' });
    } catch (e: any) {
      toast.show(e?.message ? String(e.message) : 'Unknown error', { type: 'danger' });
    } finally {
      stopLoading();
    }
  }

  async function onExportPdf() {
    startLoading();
    try {
      const inRange = await fetchInRange();
      if (!inRange) return;

      const html = groupsToHtml(inRange);
      const { uri } = await Print.printToFileAsync({ html, base64: false });

      if (!uri) {
        toast.show('Failed to generate PDF.', { type: 'danger' });
        return;
      }

      await shareFile(uri, 'application/pdf');
      toast.show('PDF ready to share.', { type: 'success' });
    } catch (e: any) {
      toast.show(e?.message ? String(e.message) : 'Unknown error', { type: 'danger' });
    } finally {
      stopLoading();
    }
  }

  async function onImportCsv() {
    startLoading();
    try {
      const uri = await pickCsvFile();
      if (!uri) {
        stopLoading();
        return;
      }

      const rows = await parseCsvImport(uri);
      if (!rows.length) {
        toast.show('No valid data found in CSV.', { type: 'warning' });
        stopLoading();
        return;
      }

      setImportRows(rows);
      setImportModalOpen(true);
    } catch (e: any) {
      toast.show(e?.message ? String(e.message) : 'Import failed', { type: 'danger' });
    } finally {
      stopLoading();
    }
  }

  async function onConfirmImport() {
    startLoading();
    try {
      const grouped = groupImportRowsByDateTime(importRows);
      let imported = 0;

      for (const [, rows] of grouped) {
        const readings: Array<Omit<BpReadingInput, 'takenAt'>> = rows.map((r) => ({
          systolic: r.systolic,
          diastolic: r.diastolic,
          pulse: r.pulse,
        }));

        const dateParts = rows[0].date.split(/[-/]/);
        const timeParts = rows[0].time.split(':');
        const year = parseInt(dateParts[0], 10);
        const month = parseInt(dateParts[1], 10) - 1;
        const day = parseInt(dateParts[2], 10);
        const hour = parseInt(timeParts[0], 10);
        const minute = parseInt(timeParts[1], 10);

        const createdAt = new Date(year, month, day, hour, minute).getTime();

        await addGroup({
          arm: importArm,
          note: rows[0].note,
          readings,
          createdAt,
        });
        imported++;
      }

      toast.show(`Imported ${imported} readings.`, { type: 'success' });
      setImportModalOpen(false);
      setImportRows([]);
    } catch (e: any) {
      toast.show(e?.message ? String(e.message) : 'Import failed', { type: 'danger' });
    } finally {
      stopLoading();
    }
  }

  async function onConnectGoogleDrive() {
    startLoading();
    try {
      const auth = await signInWithGoogle();
      if (auth) {
        setGoogleDriveConnected(true, auth.accessToken);
        toast.show('Connected to Google Drive!', { type: 'success' });
      } else {
        toast.show('Google Drive sign-in cancelled.', { type: 'warning' });
      }
    } catch (e: any) {
      toast.show('Google Drive connection failed. ' + (e?.message || ''), { type: 'danger' });
    } finally {
      stopLoading();
    }
  }

  async function onExportBackup() {
    startLoading();
    try {
      let uri: string;
      let filename: string;
      
      if (googleDriveConnected) {
        // Use consistent filename so it overwrites the same file in Google Drive
        uri = await exportBackupToJsonConsistent();
        filename = 'bp_backup_latest.json';
        
        try {
          const accessToken = useSettingsStore.getState().googleAccessToken;
          if (accessToken) {
            const result = await uploadToGoogleDrive(accessToken, uri, filename);
            setLastBackupAt(Date.now());
            toast.show(`Backup updated in Google Drive!`, { type: 'success' });
            return;
          }
        } catch (driveError) {
          console.error('Drive upload failed, falling back to share:', driveError);
          // Fall back to sharing
        }
      } else {
        // Manual backup without Drive - use timestamped filename
        uri = await exportBackupToJson();
        filename = `bp_backup_${format(Date.now(), 'yyyyMMdd_HHmmss')}.json`;
      }
      
      // Fallback: share via system dialog
      await shareBackupFile(uri);
      setLastBackupAt(Date.now());
      toast.show(`Backup saved as ${filename}. Select Google Drive from the share sheet.`, { type: 'success' });
    } catch (e: any) {
      toast.show(e?.message ? String(e.message) : 'Backup failed', { type: 'danger' });
    } finally {
      stopLoading();
    }
  }

  function onToggleAutoBackup(enabled: boolean) {
    setAutoBackup(enabled);
    if (enabled) {
      toast.show('Auto-backup enabled. Data will backup on changes.', { type: 'success' });
    }
  }

  function openCalendar(target: 'start' | 'end') {
    setCalendarTarget(target);
    setDraftDate(target === 'start' ? new Date(exportStart) : new Date(exportEnd));
    setBackupModalOpen(true);
  }

  function applyCalendarDate() {
    if (!draftDate || !calendarTarget) return;
    if (calendarTarget === 'start') {
      setExportStart((prev) => {
        const next = new Date(prev);
        next.setFullYear(draftDate.getFullYear(), draftDate.getMonth(), draftDate.getDate());
        return next;
      });
    } else {
      setExportEnd((prev) => {
        const next = new Date(prev);
        next.setFullYear(draftDate.getFullYear(), draftDate.getMonth(), draftDate.getDate());
        return next;
      });
    }
    setBackupModalOpen(false);
    setCalendarTarget(null);
  }

  const markedCalendarDate = useMemo(() => {
    if (!draftDate) return {};
    const key = draftDate.toISOString().slice(0, 10);
    return {
      [key]: {
        selected: true,
        selectedColor: 'rgba(96, 165, 250, 0.35)',
        selectedTextColor: '#F8FAFC',
      },
    };
  }, [draftDate]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.title}>Settings</Text>
        <Text style={styles.subtitle}>Export, import, and backup your data.</Text>

        {/* Backup Section */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Google Drive Backup</Text>
          <Text style={styles.muted}>
            {backupCount} readings stored •{' '}
            {lastBackupAt ? `Last backup: ${format(lastBackupAt, 'MMM d, HH:mm')}` : 'No backup yet'}
          </Text>

          {/* Google Drive Connection Status */}
          <View style={styles.driveStatusRow}>
            <Ionicons 
              name={googleDriveConnected ? "cloud-done" : "cloud-offline"} 
              size={20} 
              color={googleDriveConnected ? '#22C55E' : '#94A3B8'} 
            />
            <Text style={[styles.driveStatusText, googleDriveConnected && styles.driveStatusConnected]}>
              {googleDriveConnected 
                ? 'Connected to Google Drive' 
                : isGoogleDriveConfigured 
                  ? 'Not connected to Google Drive'
                  : 'Google Drive not configured'}
            </Text>
          </View>

          {!googleDriveConnected && isGoogleDriveConfigured && (
            <TouchableOpacity style={styles.googleButton} onPress={onConnectGoogleDrive}>
              <Ionicons name="logo-google" size={18} color="#F8FAFC" />
              <Text style={styles.googleButtonText}>Connect Google Drive</Text>
            </TouchableOpacity>
          )}

          {!isGoogleDriveConfigured && (
            <View style={styles.configHint}>
              <Ionicons name="information-circle" size={16} color="#60A5FA" />
              <Text style={styles.configHintText}>
                To enable Google Drive backup, set up a Google Cloud project and update GOOGLE_CLIENT_ID in googleDriveService.ts
              </Text>
            </View>
          )}

          <View style={styles.settingRow}>
            <View style={styles.settingInfo}>
              <Text style={styles.settingLabel}>Auto-backup</Text>
              <Text style={styles.settingDesc}>
                {googleDriveConnected 
                  ? 'Auto-upload to Google Drive on changes' 
                  : 'Enable Google Drive first'}
              </Text>
            </View>
            <Switch
              value={autoBackupEnabled && googleDriveConnected}
              onValueChange={onToggleAutoBackup}
              disabled={!googleDriveConnected}
              trackColor={{ false: '#334155', true: 'rgba(96, 165, 250, 0.5)' }}
              thumbColor={autoBackupEnabled && googleDriveConnected ? '#60A5FA' : '#94A3B8'}
            />
          </View>

          <View style={styles.actionsRow}>
            <TouchableOpacity style={styles.primaryButton} onPress={onExportBackup}>
              <Ionicons name="cloud-upload" size={18} color="#0B1220" />
              <Text style={styles.primaryButtonText}>
                {googleDriveConnected 
                  ? 'Backup to Drive' 
                  : isGoogleDriveConfigured 
                    ? 'Create Backup'
                    : 'Share Backup'}
              </Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.mutedSmall}>
            {googleDriveConnected 
              ? 'Backups overwrite the same file (bp_backup_latest.json) in your Google Drive app folder.'
              : 'Connect Google Drive for automatic uploads, or share backups manually. Each backup creates a new file with a timestamp.'}
          </Text>
        </View>

        {/* Export Section */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Export Data</Text>
          <Text style={styles.muted}>{rangeLabel}</Text>

          <View style={styles.exportGrid}>
            <View style={styles.exportCol}>
              <Text style={styles.exportLabel}>Start</Text>
              <View style={styles.exportRow}>
                <TouchableOpacity onPress={() => openCalendar('start')} style={styles.exportButton}>
                  <Text style={styles.exportButtonText}>{exportStart.toLocaleDateString()}</Text>
                </TouchableOpacity>
                <TimePickerField value={exportStart} onChange={setExportStart} />
              </View>
            </View>

            <View style={styles.exportCol}>
              <Text style={styles.exportLabel}>End</Text>
              <View style={styles.exportRow}>
                <TouchableOpacity onPress={() => openCalendar('end')} style={styles.exportButton}>
                  <Text style={styles.exportButtonText}>{exportEnd.toLocaleDateString()}</Text>
                </TouchableOpacity>
                <TimePickerField value={exportEnd} onChange={setExportEnd} />
              </View>
            </View>
          </View>

          {showPicker ? (
            <DateTimePicker
              value={showPicker === 'start-date' ? exportStart : exportEnd}
              mode="date"
              is24Hour
              onChange={(_, selected) => {
                setShowPicker(null);
                if (!selected) return;
                const setter = showPicker === 'start-date' ? setExportStart : setExportEnd;
                setter((prev) => {
                  const next = new Date(prev);
                  next.setFullYear(selected.getFullYear(), selected.getMonth(), selected.getDate());
                  return next;
                });
              }}
            />
          ) : null}

          <View style={styles.actionsRow}>
            <TouchableOpacity style={styles.primaryButton} onPress={onExportCsv}>
              <Ionicons name="download" size={18} color="#0B1220" />
              <Text style={styles.primaryButtonText}>Export CSV</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryButton} onPress={onExportPdf}>
              <Ionicons name="document-text" size={18} color="#F8FAFC" />
              <Text style={styles.secondaryButtonText}>Export PDF</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Import Section */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Import Data</Text>
          <Text style={styles.muted}>Import readings from a CSV file.</Text>

          <TouchableOpacity style={styles.importButton} onPress={onImportCsv}>
            <Ionicons name="cloud-upload-outline" size={20} color="#F8FAFC" />
            <Text style={styles.importButtonText}>Select CSV File</Text>
          </TouchableOpacity>

          <Text style={styles.mutedSmall}>
            CSV format: Date, Time, Arm, BP (sys/dia), Pulse, Note{'\n'}
            Example: 2024-01-15, 08:30, left, 120/80, 72, Morning reading
          </Text>
        </View>

        {Platform.OS === 'android' ? (
          <Text style={styles.mutedSmall}>
            Tip: if sharing isn't available, files will be saved locally and their path shown.
          </Text>
        ) : null}
      </ScrollView>

      {/* Calendar Modal for Export Dates */}
      <Modal visible={backupModalOpen} transparent animationType="fade" onRequestClose={() => setBackupModalOpen(false)}>
        <View style={styles.modalBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setBackupModalOpen(false)} />
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Date</Text>
              <TouchableOpacity onPress={() => setBackupModalOpen(false)} style={styles.iconButton}>
                <Ionicons name="close" size={18} color="#CBD5E1" />
              </TouchableOpacity>
            </View>

            <View style={styles.calendarWrap}>
              <Calendar
                enableSwipeMonths
                style={styles.calendar}
                markedDates={markedCalendarDate}
                theme={{
                  backgroundColor: '#111B2E',
                  calendarBackground: '#111B2E',
                  monthTextColor: '#F8FAFC',
                  dayTextColor: '#CBD5E1',
                  textDisabledColor: '#334155',
                  arrowColor: '#CBD5E1',
                  todayTextColor: '#60A5FA',
                }}
                onDayPress={(day: { dateString: string }) => setDraftDate(new Date(`${day.dateString}T00:00:00`))}
              />
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.secondaryPill} onPress={() => setDraftDate(new Date())}>
                <Text style={styles.secondaryPillText}>Today</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.primaryPill} onPress={applyCalendarDate}>
                <Text style={styles.primaryPillText}>Apply</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Import Confirmation Modal */}
      <Modal visible={importModalOpen} transparent animationType="fade" onRequestClose={() => setImportModalOpen(false)}>
        <View style={styles.modalBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setImportModalOpen(false)} />
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Confirm Import</Text>
              <TouchableOpacity onPress={() => setImportModalOpen(false)} style={styles.iconButton}>
                <Ionicons name="close" size={18} color="#CBD5E1" />
              </TouchableOpacity>
            </View>

            <Text style={styles.muted}>{importRows.length} readings found</Text>

            <View style={styles.importArmRow}>
              <Text style={styles.importArmLabel}>Import as:</Text>
              <View style={styles.armRow}>
                <TouchableOpacity
                  onPress={() => setImportArm('left')}
                  style={[styles.armButton, importArm === 'left' ? styles.armButtonActive : null]}
                >
                  <Text style={[styles.armButtonText, importArm === 'left' ? styles.armButtonTextActive : null]}>
                    Left
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setImportArm('right')}
                  style={[styles.armButton, importArm === 'right' ? styles.armButtonActive : null]}
                >
                  <Text style={[styles.armButtonText, importArm === 'right' ? styles.armButtonTextActive : null]}>
                    Right
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.secondaryPill} onPress={() => setImportModalOpen(false)}>
                <Text style={styles.secondaryPillText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.primaryPill} onPress={onConfirmImport}>
                <Text style={styles.primaryPillText}>Import</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0B1220',
  },
  container: {
    flex: 1,
    backgroundColor: '#0B1220',
  },
  content: {
    padding: 20,
    paddingBottom: 60,
    gap: 12,
  },
  title: {
    color: '#F8FAFC',
    fontSize: 28,
    fontWeight: '800',
  },
  subtitle: {
    color: '#CBD5E1',
    fontSize: 15,
    lineHeight: 20,
    marginBottom: 4,
  },
  card: {
    backgroundColor: '#111B2E',
    borderColor: '#1E293B',
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    gap: 10,
  },
  cardTitle: {
    color: '#E2E8F0',
    fontSize: 14,
    fontWeight: '700',
  },
  muted: {
    color: '#94A3B8',
    fontSize: 13,
    fontWeight: '700',
  },
  mutedSmall: {
    color: '#94A3B8',
    fontSize: 12,
    lineHeight: 16,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  settingInfo: {
    flex: 1,
  },
  settingLabel: {
    color: '#F8FAFC',
    fontSize: 15,
    fontWeight: '700',
  },
  settingDesc: {
    color: '#94A3B8',
    fontSize: 12,
    marginTop: 2,
  },
  exportGrid: {
    gap: 12,
  },
  exportCol: {
    gap: 8,
  },
  exportLabel: {
    color: '#CBD5E1',
    fontSize: 12,
    fontWeight: '700',
  },
  exportRow: {
    flexDirection: 'row',
    gap: 10,
  },
  exportButton: {
    flex: 1,
    backgroundColor: '#0B1220',
    borderColor: '#1E293B',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  exportButtonText: {
    color: '#F8FAFC',
    fontSize: 13,
    fontWeight: '800',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 6,
  },
  primaryButton: {
    flex: 1,
    backgroundColor: '#60A5FA',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  primaryButtonText: {
    color: '#0B1220',
    fontSize: 14,
    fontWeight: '900',
  },
  secondaryButton: {
    flex: 1,
    backgroundColor: '#0B1220',
    borderColor: '#334155',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  secondaryButtonText: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '900',
  },
  importButton: {
    backgroundColor: '#0B1220',
    borderColor: '#1E293B',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  importButtonText: {
    color: '#F8FAFC',
    fontSize: 15,
    fontWeight: '700',
  },
  importArmRow: {
    gap: 10,
    paddingVertical: 10,
  },
  importArmLabel: {
    color: '#CBD5E1',
    fontSize: 13,
    fontWeight: '700',
  },
  armRow: {
    flexDirection: 'row',
    gap: 10,
  },
  armButton: {
    flex: 1,
    backgroundColor: '#0B1220',
    borderColor: '#1E293B',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  armButtonActive: {
    backgroundColor: '#1D4ED8',
    borderColor: '#1D4ED8',
  },
  armButtonText: {
    color: '#CBD5E1',
    fontSize: 15,
    fontWeight: '800',
  },
  armButtonTextActive: {
    color: '#EFF6FF',
  },
  driveStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    backgroundColor: '#0B1220',
    borderColor: '#1E293B',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
  },
  driveStatusText: {
    color: '#94A3B8',
    fontSize: 13,
    fontWeight: '600',
  },
  driveStatusConnected: {
    color: '#22C55E',
  },
  googleButton: {
    backgroundColor: '#0B1220',
    borderColor: '#334155',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  googleButtonText: {
    color: '#F8FAFC',
    fontSize: 15,
    fontWeight: '700',
  },
  configHint: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: 'rgba(96, 165, 250, 0.1)',
    borderColor: 'rgba(96, 165, 250, 0.3)',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
  },
  configHintText: {
    color: '#94A3B8',
    fontSize: 12,
    lineHeight: 16,
    flex: 1,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    padding: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalCard: {
    backgroundColor: '#111B2E',
    borderColor: '#1E293B',
    borderWidth: 1,
    borderRadius: 16,
    overflow: 'hidden',
    width: '100%',
    maxWidth: 420,
  },
  modalHeader: {
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalTitle: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '900',
  },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1E293B',
    backgroundColor: '#0B1220',
    alignItems: 'center',
    justifyContent: 'center',
  },
  calendarWrap: {
    height: 360,
    paddingHorizontal: 8,
    paddingBottom: 6,
  },
  calendar: {
    height: 360,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
    padding: 14,
  },
  primaryPill: {
    flex: 1,
    backgroundColor: '#60A5FA',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryPillText: {
    color: '#0B1220',
    fontSize: 14,
    fontWeight: '900',
  },
  secondaryPill: {
    width: 110,
    backgroundColor: '#0B1220',
    borderColor: '#334155',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryPillText: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '900',
  },
});
