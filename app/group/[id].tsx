import DateTimePicker from '@react-native-community/datetimepicker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useToast } from 'react-native-toast-notifications';

import { useBpStore } from '../../src/state/bpStore';
import { useUiStore } from '../../src/state/uiStore';
import TimePickerField from '../../src/components/TimePickerField';

export default function GroupDetailScreen() {
  const router = useRouter();
  const toast = useToast();

  const params = useLocalSearchParams<{ id: string }>();
  const id = params.id;

  const groups = useBpStore((s) => s.groups);
  const removeGroup = useBpStore((s) => s.removeGroup);
  const getGroup = useBpStore((s) => s.getGroup);
  const editGroup = useBpStore((s) => s.editGroup);

  const startLoading = useUiStore((s) => s.startLoading);
  const stopLoading = useUiStore((s) => s.stopLoading);

  const group = useMemo(() => groups.find((g) => g.id === id), [groups, id]);

  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detail, setDetail] = useState<null | Awaited<ReturnType<typeof getGroup>>>(null);

  type Row = { systolic: string; diastolic: string; pulse: string };
  const [rows, setRows] = useState<Row[]>([{ systolic: '', diastolic: '', pulse: '' }]);

  const [note, setNote] = useState(group?.note ?? '');
  const [arm, setArm] = useState<'left' | 'right'>(group?.arm ?? 'left');
  const [dt, setDt] = useState<Date>(() => new Date(group?.createdAt ?? Date.now()));
  const [showPicker, setShowPicker] = useState<null | 'date'>(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      if (!id) return;
      setLoadingDetail(true);
      try {
        const d = await getGroup(String(id));
        if (!mounted) return;
        setDetail(d);
        if (d) {
          setNote(d.note ?? '');
          setArm(d.arm);
          setDt(new Date(d.createdAt));
          setRows(
            d.readings.map((r) => ({
              systolic: String(r.systolic),
              diastolic: String(r.diastolic),
              pulse: r.pulse === null ? '' : String(r.pulse),
            }))
          );
        }
      } catch (e: any) {
        toast.show(e?.message ? String(e.message) : 'Failed to load group', { type: 'danger' });
      } finally {
        if (mounted) setLoadingDetail(false);
      }
    }
    void load();
    return () => {
      mounted = false;
    };
  }, [getGroup, id, toast]);

  function parsePositiveInt(value: string) {
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  const parsedReadings = useMemo(() => {
    const errors: string[] = [];
    const readings: Array<{ systolic: number; diastolic: number; pulse?: number | null }> = [];

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
      readings.push({ systolic: s, diastolic: d, pulse: r.pulse.trim() ? p : null });
    });

    return { errors, readings };
  }, [rows]);

  if (!group) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.container}>
          <Text style={styles.title}>Reading not found</Text>
          <TouchableOpacity onPress={() => router.back()} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          style={styles.container}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          automaticallyAdjustKeyboardInsets
        >
          <Text style={styles.title}>Edit Reading</Text>
          <Text style={styles.subtitle}>Edit measurements, metadata, or delete this reading.</Text>

        {loadingDetail ? <Text style={styles.muted}>Loading…</Text> : null}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Date & time</Text>
          <View style={styles.row}>
            <TouchableOpacity onPress={() => setShowPicker('date')} style={styles.pill}>
              <Text style={styles.pillText}>{dt.toLocaleDateString()}</Text>
            </TouchableOpacity>
            <TimePickerField value={dt} onChange={setDt} />
          </View>

          {showPicker ? (
            <DateTimePicker
              value={dt}
              mode={showPicker}
              is24Hour
              onChange={(_, selected) => {
                setShowPicker(null);
                if (!selected) return;
                setDt((prev) => {
                  const next = new Date(prev);
                  next.setFullYear(selected.getFullYear(), selected.getMonth(), selected.getDate());
                  return next;
                });
              }}
            />
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Arm</Text>
          <View style={styles.row}>
            <TouchableOpacity
              onPress={() => setArm('left')}
              style={[styles.pill, arm === 'left' ? styles.pillActive : null]}
            >
              <Text style={[styles.pillText, arm === 'left' ? styles.pillTextActive : null]}>Left</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setArm('right')}
              style={[styles.pill, arm === 'right' ? styles.pillActive : null]}
            >
              <Text style={[styles.pillText, arm === 'right' ? styles.pillTextActive : null]}>Right</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Note</Text>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="Optional"
            placeholderTextColor="#64748B"
            style={styles.input}
          />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Readings</Text>
          <Text style={styles.muted}>Edit the individual measurements. The saved reading will update its averages.</Text>

          <View style={styles.readingHeaderRow}>
            <Text style={styles.readingHeader}>Sys</Text>
            <Text style={styles.readingHeader}>Dia</Text>
            <Text style={styles.readingHeader}>Pulse</Text>
            <Text style={styles.readingHeader}></Text>
          </View>

          {rows.map((r, idx) => (
            <View key={idx} style={styles.readingRow}>
              <TextInput
                value={r.systolic}
                onChangeText={(v) => setRows((prev) => prev.map((x, i) => (i === idx ? { ...x, systolic: v } : x)))}
                keyboardType="number-pad"
                placeholder="120"
                placeholderTextColor="#64748B"
                style={[styles.input, styles.readingInput]}
              />
              <TextInput
                value={r.diastolic}
                onChangeText={(v) => setRows((prev) => prev.map((x, i) => (i === idx ? { ...x, diastolic: v } : x)))}
                keyboardType="number-pad"
                placeholder="80"
                placeholderTextColor="#64748B"
                style={[styles.input, styles.readingInput]}
              />
              <TextInput
                value={r.pulse}
                onChangeText={(v) => setRows((prev) => prev.map((x, i) => (i === idx ? { ...x, pulse: v } : x)))}
                keyboardType="number-pad"
                placeholder="70"
                placeholderTextColor="#64748B"
                style={[styles.input, styles.readingInput]}
              />
              <TouchableOpacity
                onPress={() => setRows((prev) => prev.filter((_, i) => i !== idx))}
                style={styles.removeButton}
                disabled={rows.length <= 1}
              >
                <Text style={[styles.removeButtonText, rows.length <= 1 ? styles.removeButtonTextDisabled : null]}>−</Text>
              </TouchableOpacity>
            </View>
          ))}

          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => setRows((prev) => [...prev, { systolic: '', diastolic: '', pulse: '' }])}
          >
            <Text style={styles.secondaryButtonText}>Add reading</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={styles.primaryButton}
          onPress={async () => {
            if (parsedReadings.errors.length) {
              toast.show(parsedReadings.errors[0], { type: 'warning' });
              return;
            }
            startLoading();
            try {
              await editGroup({
                id: group.id,
                createdAt: dt.getTime(),
                arm,
                note: note.trim() ? note.trim() : null,
                readings: parsedReadings.readings,
              });
              toast.show('Saved changes.', { type: 'success' });
              router.back();
            } catch (e: any) {
              toast.show(e?.message ? String(e.message) : 'Unknown error', { type: 'danger' });
            } finally {
              stopLoading();
            }
          }}
        >
          <Text style={styles.primaryButtonText}>Save changes</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.dangerButton}
          onPress={async () => {
            startLoading();
            try {
              await removeGroup(group.id);
              toast.show('Reading deleted.', { type: 'success' });
              router.replace('/(tabs)/trends');
            } catch (e: any) {
              toast.show(e?.message ? String(e.message) : 'Unknown error', { type: 'danger' });
            } finally {
              stopLoading();
            }
          }}
        >
          <Text style={styles.dangerButtonText}>Delete reading</Text>
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
  },
  muted: {
    color: '#94A3B8',
    fontSize: 13,
    lineHeight: 18,
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
  row: {
    flexDirection: 'row',
    gap: 10,
  },
  pill: {
    flex: 1,
    backgroundColor: '#0B1220',
    borderColor: '#1E293B',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillActive: {
    backgroundColor: '#1D4ED8',
    borderColor: '#1D4ED8',
  },
  pillText: {
    color: '#CBD5E1',
    fontSize: 15,
    fontWeight: '800',
  },
  pillTextActive: {
    color: '#EFF6FF',
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
  readingHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 4,
  },
  readingHeader: {
    width: 70,
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '800',
  },
  readingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  readingInput: {
    width: 70,
    paddingHorizontal: 10,
    paddingVertical: 9,
    fontSize: 15,
    fontWeight: '800',
  },
  removeButton: {
    width: 36,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#0B1220',
    borderColor: '#1E293B',
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeButtonText: {
    color: '#FCA5A5',
    fontSize: 22,
    fontWeight: '900',
    lineHeight: 22,
  },
  removeButtonTextDisabled: {
    color: '#334155',
  },
  primaryButton: {
    marginTop: 4,
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
  secondaryButton: {
    marginTop: 12,
    backgroundColor: '#111B2E',
    borderColor: '#1E293B',
    borderWidth: 1,
    paddingVertical: 14,
    borderRadius: 16,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#E2E8F0',
    fontWeight: '900',
    fontSize: 16,
  },
  dangerButton: {
    backgroundColor: '#EF4444',
    paddingVertical: 14,
    borderRadius: 16,
    alignItems: 'center',
  },
  dangerButtonText: {
    color: '#450A0A',
    fontWeight: '900',
    fontSize: 16,
  },
});
