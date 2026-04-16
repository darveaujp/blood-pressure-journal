import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { useMemo, useState } from 'react';
import { Alert, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { cacheDirectory, documentDirectory, writeAsStringAsync, EncodingType } from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as Print from 'expo-print';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useToast } from 'react-native-toast-notifications';
import { Calendar } from 'react-native-calendars';

import { listGroupsInRange } from '../../src/db/bpRepository';
import { groupsToCsv } from '../../src/export/csv';
import { useBpStore } from '../../src/state/bpStore';
import { useSettingsStore } from '../../src/state/settingsStore';
import { useUiStore } from '../../src/state/uiStore';
import { exportBackupToJson, shareBackupFile, importBackupFromJson, restoreBackup, pickBackupFile } from '../../src/services/backupService';

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
  const groups = useBpStore((s) => s.groups);

  const { lastBackupAt, setLastBackupAt } = useSettingsStore();

  // Export date range state (same pattern as trend graph)
  const [exportStart, setExportStart] = useState(() => new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
  const [exportEnd, setExportEnd] = useState(() => new Date());
  const [rangeModalOpen, setRangeModalOpen] = useState(false);
  const [draftStart, setDraftStart] = useState<Date | null>(null);
  const [draftEnd, setDraftEnd] = useState<Date | null>(null);

  const rangeLabel = useMemo(() => {
    return `${exportStart.toLocaleDateString()}  →  ${exportEnd.toLocaleDateString()}`;
  }, [exportStart, exportEnd]);

  const markedRange = useMemo(() => {
    if (!draftStart) return {};
    const startKey = draftStart.toISOString().slice(0, 10);
    const endKey = (draftEnd ?? draftStart).toISOString().slice(0, 10);
    const startTime = new Date(startKey).getTime();
    const endTime = new Date(endKey).getTime();
    const from = Math.min(startTime, endTime);
    const to = Math.max(startTime, endTime);

    const marks: Record<string, any> = {};
    for (let t = from; t <= to; t += 24 * 60 * 60 * 1000) {
      const key = new Date(t).toISOString().slice(0, 10);
      const isStart = t === from;
      const isEnd = t === to;
      marks[key] = {
        startingDay: isStart,
        endingDay: isEnd,
        color: 'rgba(96, 165, 250, 0.25)',
        textColor: '#F8FAFC',
      };
    }
    return marks;
  }, [draftStart, draftEnd]);

  const backupCount = groups.length;

  async function fetchInRange() {
    const startAt = new Date(exportStart).setHours(0, 0, 0, 0);
    const endAt = new Date(exportEnd).setHours(23, 59, 59, 999);
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
      const filename = `bp_export_${format(exportStart, 'yyyyMMdd')}-${format(exportEnd, 'yyyyMMdd')}.csv`;
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




  async function onExportBackup() {
    startLoading();
    try {
      const uri = await exportBackupToJson();

      // Share via system dialog
      await shareBackupFile(uri);
      setLastBackupAt(Date.now());
      toast.show('Backup ready to share.', { type: 'success' });
    } catch (e: any) {
      toast.show(e?.message ? String(e.message) : 'Backup failed', { type: 'danger' });
    } finally {
      stopLoading();
    }
  }

  async function onRestoreBackup() {
    try {
      const uri = await pickBackupFile();
      if (!uri) return;

      const data = await importBackupFromJson(uri);
      const groupCount = data.groups.length;

      Alert.alert(
        'Restore Backup?',
        `This will replace all current data with ${groupCount} readings from the backup (${data.exportedAt ? format(data.exportedAt, 'MMM d, yyyy HH:mm') : 'unknown date'}). This cannot be undone.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Restore',
            style: 'destructive',
            onPress: async () => {
              startLoading();
              try {
                const restoredCount = await restoreBackup(data);
                toast.show(`Restored ${restoredCount} readings from backup.`, { type: 'success' });
                setLastBackupAt(data.exportedAt);
              } catch (e: any) {
                toast.show(e?.message ? String(e.message) : 'Restore failed', { type: 'danger' });
              } finally {
                stopLoading();
              }
            },
          },
        ]
      );
    } catch (e: any) {
      toast.show(e?.message ? String(e.message) : 'Invalid backup file', { type: 'danger' });
    }
  }


  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.title}>Settings</Text>
        <Text style={styles.subtitle}>Export, import, and backup your data.</Text>

        {/* Backup Section */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Backup & Restore</Text>
          <Text style={styles.muted}>
            {backupCount} readings stored •{' '}
            {lastBackupAt ? `Last backup: ${format(lastBackupAt, 'MMM d, HH:mm')}` : 'No backup yet'}
          </Text>

          <View style={styles.actionsRow}>
            <TouchableOpacity style={styles.primaryButton} onPress={onExportBackup}>
              <Ionicons name="cloud-upload" size={18} color="#0B1220" />
              <Text style={styles.primaryButtonText}>Share Backup</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryButton} onPress={onRestoreBackup}>
              <Ionicons name="cloud-download" size={18} color="#F8FAFC" />
              <Text style={styles.secondaryButtonText}>Restore</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.mutedSmall}>
            Share Backup: Creates a backup file and opens the share sheet.{'\n'}
            Restore: Select a backup JSON file to restore your data. Warning: This will replace all current data.
          </Text>
        </View>

        {/* Export Section */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Export Data</Text>

          <View style={styles.graphHeaderRow}>
            <View style={styles.graphHeaderLeft}>
              <Text style={styles.muted}>{rangeLabel}</Text>
            </View>
            <TouchableOpacity
              style={styles.iconButton}
              onPress={() => {
                setDraftStart(exportStart);
                setDraftEnd(exportEnd);
                setRangeModalOpen(true);
              }}
              activeOpacity={0.85}
            >
              <Ionicons name="calendar" size={18} color="#CBD5E1" />
            </TouchableOpacity>
          </View>

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

        {Platform.OS === 'android' ? (
          <Text style={styles.mutedSmall}>
            Tip: if sharing isn't available, files will be saved locally and their path shown.
          </Text>
        ) : null}
      </ScrollView>

      {/* Calendar Range Modal for Export Dates */}
      <Modal
        visible={rangeModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setRangeModalOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setRangeModalOpen(false)} />
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select date range</Text>
              <TouchableOpacity onPress={() => setRangeModalOpen(false)} style={styles.iconButton}>
                <Ionicons name="close" size={18} color="#CBD5E1" />
              </TouchableOpacity>
            </View>

            <View style={styles.calendarWrap}>
              <Calendar
                enableSwipeMonths
                style={styles.calendar}
                markingType="period"
                markedDates={markedRange}
                theme={{
                  backgroundColor: '#111B2E',
                  calendarBackground: '#111B2E',
                  monthTextColor: '#F8FAFC',
                  dayTextColor: '#CBD5E1',
                  textDisabledColor: '#334155',
                  arrowColor: '#CBD5E1',
                  todayTextColor: '#60A5FA',
                }}
                onDayPress={(day: { dateString: string }) => {
                  const picked = new Date(`${day.dateString}T00:00:00`);
                  if (!draftStart || (draftStart && draftEnd)) {
                    setDraftStart(picked);
                    setDraftEnd(null);
                    return;
                  }

                  if (picked.getTime() < draftStart.getTime()) {
                    setDraftEnd(draftStart);
                    setDraftStart(picked);
                  } else {
                    setDraftEnd(picked);
                  }
                }}
              />
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.secondaryPill}
                onPress={() => {
                  setDraftStart(exportStart);
                  setDraftEnd(exportEnd);
                }}
              >
                <Text style={styles.secondaryPillText}>Reset</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.primaryPill}
                onPress={() => {
                  if (!draftStart) return;
                  const end = draftEnd ?? draftStart;
                  setExportStart(draftStart);
                  setExportEnd(end);
                  setRangeModalOpen(false);
                }}
              >
                <Text style={styles.primaryPillText}>Apply</Text>
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
  graphHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  graphHeaderLeft: {
    flex: 1,
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
