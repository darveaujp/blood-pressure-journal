import { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useToast } from 'react-native-toast-notifications';
import { Calendar } from 'react-native-calendars';
import { Ionicons } from '@expo/vector-icons';

import type { BpReadingInput } from '../../src/types/bp';
import { useBpStore } from '../../src/state/bpStore';
import { useUiStore } from '../../src/state/uiStore';
import TimePickerField from '../../src/components/TimePickerField';

type Row = {
  systolic: string;
  diastolic: string;
  pulse: string;
};

function parsePositiveInt(value: string) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export default function AddScreen() {
  const addGroup = useBpStore((s) => s.addGroup);
  const startLoading = useUiStore((s) => s.startLoading);
  const stopLoading = useUiStore((s) => s.stopLoading);
  const toast = useToast();

  const [note, setNote] = useState('');
  const [rows, setRows] = useState<Row[]>([{ systolic: '', diastolic: '', pulse: '' }]);
  const [arm, setArm] = useState<'left' | 'right'>('left');

  // Advanced: backdate
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [customDate, setCustomDate] = useState<Date | null>(null);
  const [dateModalOpen, setDateModalOpen] = useState(false);
  const [draftDate, setDraftDate] = useState<Date | null>(null);

  const parsed = useMemo(() => {
    const readings: Array<Omit<BpReadingInput, 'takenAt'>> = [];
    const errors: string[] = [];

    rows.forEach((r, idx) => {
      const s = parsePositiveInt(r.systolic);
      const d = parsePositiveInt(r.diastolic);
      const p = r.pulse.trim() ? parsePositiveInt(r.pulse) : null;

      if (s === null || d === null) {
        errors.push(`Row ${idx + 1}: systolic and diastolic are required`);
        return;
      }

      if (p === null && r.pulse.trim()) {
        errors.push(`Row ${idx + 1}: pulse must be a positive number`);
        return;
      }

      readings.push({
        systolic: s,
        diastolic: d,
        pulse: p,
      });
    });

    const avg = readings.length
      ? {
          systolic: readings.reduce((a, b) => a + b.systolic, 0) / readings.length,
          diastolic: readings.reduce((a, b) => a + b.diastolic, 0) / readings.length,
          pulse: (() => {
            const pulses = readings
              .map((r) => r.pulse)
              .filter((v): v is number => typeof v === 'number');
            return pulses.length ? pulses.reduce((a, b) => a + b, 0) / pulses.length : null;
          })(),
        }
      : null;

    return { readings, errors, avg };
  }, [rows]);

  async function onSave() {
    if (parsed.errors.length) {
      toast.show(parsed.errors[0], { type: 'warning' });
      return;
    }
    if (!parsed.readings.length) {
      toast.show('Add at least one reading.', { type: 'warning' });
      return;
    }

    startLoading();
    try {
      await addGroup({
        arm,
        note: note.trim() ? note.trim() : null,
        readings: parsed.readings,
        createdAt: customDate ? customDate.getTime() : Date.now(),
      });
      setNote('');
      setRows([{ systolic: '', diastolic: '', pulse: '' }]);
      setArm('left');
      setAdvancedOpen(false);
      setCustomDate(null);
      toast.show('Reading saved.', { type: 'success' });
    } catch (e: any) {
      toast.show(e?.message ? String(e.message) : 'Unknown error', { type: 'danger' });
    } finally {
      stopLoading();
    }
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
        >
          <Text style={styles.title}>Add Reading</Text>
          <Text style={styles.subtitle}>Enter one or more measurements. Saved as a single averaged result.</Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Arm</Text>
          <View style={styles.armRow}>
            <TouchableOpacity
              onPress={() => setArm('left')}
              style={[styles.armButton, arm === 'left' ? styles.armButtonActive : null]}
            >
              <Text style={[styles.armButtonText, arm === 'left' ? styles.armButtonTextActive : null]}
              >
                Left
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setArm('right')}
              style={[styles.armButton, arm === 'right' ? styles.armButtonActive : null]}
            >
              <Text style={[styles.armButtonText, arm === 'right' ? styles.armButtonTextActive : null]}
              >
                Right
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.rowHeader}>
            <Text style={styles.cardTitle}>Readings</Text>
            <TouchableOpacity
              onPress={() => setRows((prev) => [...prev, { systolic: '', diastolic: '', pulse: '' }])}
              style={styles.smallButton}
            >
              <Text style={styles.smallButtonText}>Add row</Text>
            </TouchableOpacity>
          </View>

          {rows.map((r, idx) => (
            <View key={idx} style={styles.readingRow}>
              <View style={styles.field}>
                <Text style={styles.label}>Sys</Text>
                <TextInput
                  value={r.systolic}
                  onChangeText={(t) =>
                    setRows((prev) => prev.map((x, i) => (i === idx ? { ...x, systolic: t } : x)))
                  }
                  keyboardType="number-pad"
                  placeholder="120"
                  placeholderTextColor="#64748B"
                  style={styles.input}
                />
              </View>
              <View style={styles.field}>
                <Text style={styles.label}>Dia</Text>
                <TextInput
                  value={r.diastolic}
                  onChangeText={(t) =>
                    setRows((prev) => prev.map((x, i) => (i === idx ? { ...x, diastolic: t } : x)))
                  }
                  keyboardType="number-pad"
                  placeholder="80"
                  placeholderTextColor="#64748B"
                  style={styles.input}
                />
              </View>
              <View style={styles.field}>
                <Text style={styles.label}>Pulse</Text>
                <TextInput
                  value={r.pulse}
                  onChangeText={(t) =>
                    setRows((prev) => prev.map((x, i) => (i === idx ? { ...x, pulse: t } : x)))
                  }
                  keyboardType="number-pad"
                  placeholder="72"
                  placeholderTextColor="#64748B"
                  style={styles.input}
                />
              </View>

              {rows.length > 1 ? (
                <TouchableOpacity
                  onPress={() => setRows((prev) => prev.filter((_, i) => i !== idx))}
                  style={styles.removeButton}
                >
                  <Text style={styles.removeButtonText}>×</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ))}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Optional note</Text>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="e.g., Morning, after coffee"
            placeholderTextColor="#64748B"
            style={styles.input}
          />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Average preview</Text>
          {parsed.avg ? (
            <Text style={styles.avgText}>
              {Math.round(parsed.avg.systolic)}/{Math.round(parsed.avg.diastolic)}
              {parsed.avg.pulse ? `  •  Pulse ${Math.round(parsed.avg.pulse)}` : ''}
            </Text>
          ) : (
            <Text style={styles.muted}>Enter at least one valid row.</Text>
          )}
        </View>

        <View style={styles.card}>
          <TouchableOpacity
            onPress={() => setAdvancedOpen((v) => !v)}
            style={styles.collapseHeader}
            activeOpacity={0.8}
          >
            <Text style={styles.cardTitle}>Advanced</Text>
            <Ionicons
              name={advancedOpen ? 'chevron-up' : 'chevron-down'}
              size={20}
              color="#CBD5E1"
            />
          </TouchableOpacity>

          {advancedOpen ? (
            <>
              <Text style={styles.muted}>Set a custom date and time for this reading.</Text>
              <View style={styles.dateRow}>
                <TouchableOpacity
                  onPress={() => {
                    setDraftDate(customDate ?? new Date());
                    setDateModalOpen(true);
                  }}
                  style={styles.dateButton}
                >
                  <Text style={styles.dateButtonText}>
                    {customDate ? customDate.toLocaleDateString() : 'Select date'}
                  </Text>
                </TouchableOpacity>
                <TimePickerField
                  value={customDate ?? new Date()}
                  onChange={(next) => {
                    setCustomDate((prev) => {
                      const base = prev ?? new Date();
                      const updated = new Date(base);
                      updated.setHours(next.getHours(), next.getMinutes(), 0, 0);
                      return updated;
                    });
                  }}
                />
              </View>
              {customDate ? (
                <TouchableOpacity onPress={() => setCustomDate(null)}>
                  <Text style={styles.clearText}>Clear custom date (use current time)</Text>
                </TouchableOpacity>
              ) : null}
            </>
          ) : null}
        </View>

        <Modal
          visible={dateModalOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setDateModalOpen(false)}
        >
          <View style={styles.modalBackdrop}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setDateModalOpen(false)} />
            <View style={styles.modalCard}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Select date</Text>
                <TouchableOpacity onPress={() => setDateModalOpen(false)} style={styles.iconButton}>
                  <Ionicons name="close" size={18} color="#CBD5E1" />
                </TouchableOpacity>
              </View>

              <View style={styles.calendarWrap}>
                <Calendar
                  enableSwipeMonths
                  style={styles.calendar}
                  markedDates={
                    draftDate
                      ? {
                          [draftDate.toISOString().slice(0, 10)]: {
                            selected: true,
                            selectedColor: 'rgba(96, 165, 250, 0.35)',
                            selectedTextColor: '#F8FAFC',
                          },
                        }
                      : {}
                  }
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
                    setDraftDate(new Date(`${day.dateString}T00:00:00`));
                  }}
                />
              </View>

              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={styles.secondaryPill}
                  onPress={() => setDraftDate(new Date())}
                >
                  <Text style={styles.secondaryPillText}>Today</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.primaryPill}
                  onPress={() => {
                    if (!draftDate) return;
                    setCustomDate((prev) => {
                      const base = prev ?? new Date();
                      const next = new Date(base);
                      next.setFullYear(draftDate.getFullYear(), draftDate.getMonth(), draftDate.getDate());
                      return next;
                    });
                    setDateModalOpen(false);
                  }}
                >
                  <Text style={styles.primaryPillText}>Apply</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        <TouchableOpacity onPress={onSave} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>Save reading</Text>
        </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
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
    flexGrow: 1,
    padding: 20,
    paddingBottom: 140,
    gap: 14,
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
  input: {
    backgroundColor: '#0B1220',
    borderColor: '#1E293B',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#F8FAFC',
    fontSize: 16,
  },
  rowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
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
  smallButton: {
    backgroundColor: '#1D4ED8',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
  },
  smallButtonText: {
    color: '#EFF6FF',
    fontWeight: '700',
    fontSize: 13,
  },
  readingRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-end',
  },
  field: {
    flex: 1,
    gap: 6,
  },
  label: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
  },
  removeButton: {
    width: 36,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0B1220',
  },
  removeButtonText: {
    color: '#E2E8F0',
    fontSize: 22,
    fontWeight: '700',
    lineHeight: 22,
  },
  avgText: {
    color: '#F8FAFC',
    fontSize: 18,
    fontWeight: '800',
  },
  muted: {
    color: '#94A3B8',
    fontSize: 14,
  },
  primaryButton: {
    backgroundColor: '#22C55E',
    paddingVertical: 14,
    borderRadius: 16,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#052E16',
    fontWeight: '900',
    fontSize: 16,
  },
  collapseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dateRow: {
    flexDirection: 'row',
    gap: 10,
  },
  dateButton: {
    flex: 1,
    backgroundColor: '#0B1220',
    borderColor: '#1E293B',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateButtonText: {
    color: '#F8FAFC',
    fontSize: 15,
    fontWeight: '700',
  },
  clearText: {
    color: '#60A5FA',
    fontSize: 13,
    fontWeight: '700',
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
