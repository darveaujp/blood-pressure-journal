import { useMemo, useState } from 'react';
import { Dimensions, Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LineChart, PieChart } from 'react-native-chart-kit';
import { useRouter } from 'expo-router';
import { Calendar } from 'react-native-calendars';

import { useBpStore } from '../../src/state/bpStore';

function bpCategory(systolic: number, diastolic: number) {
  if (systolic >= 180 || diastolic >= 120) {
    return { label: 'Hypertensive crisis', color: '#EF4444' };
  }
  if (systolic >= 140 || diastolic >= 90) {
    return { label: 'High (stage 2)', color: '#F97316' };
  }
  if ((systolic >= 130 && systolic <= 139) || (diastolic >= 80 && diastolic <= 89)) {
    return { label: 'High (stage 1)', color: '#F59E0B' };
  }
  if (systolic >= 120 && systolic <= 129 && diastolic < 80) {
    return { label: 'Elevated', color: '#60A5FA' };
  }
  return { label: 'Normal', color: '#22C55E' };
}

function systolicDotColor(systolic: number) {
  if (systolic >= 180) return '#EF4444';
  if (systolic >= 140) return '#F97316';
  if (systolic >= 130) return '#F59E0B';
  if (systolic >= 120) return '#60A5FA';
  return '#22C55E';
}

function diastolicDotColor(diastolic: number) {
  if (diastolic >= 120) return '#EF4444';
  if (diastolic >= 90) return '#F97316';
  if (diastolic >= 80) return '#F59E0B';
  return '#22C55E';
}

export default function TrendsScreen() {
  const router = useRouter();
  const groups = useBpStore((s) => s.groups);

  const [rangesOpen, setRangesOpen] = useState(false);
  const [recentOpen, setRecentOpen] = useState(false);
  const [mode, setMode] = useState<'left' | 'right' | 'daily'>('daily');
  const [rangeStart, setRangeStart] = useState(() => new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
  const [rangeEnd, setRangeEnd] = useState(() => new Date());
  const [rangeModalOpen, setRangeModalOpen] = useState(false);
  const [draftStart, setDraftStart] = useState<Date | null>(null);
  const [draftEnd, setDraftEnd] = useState<Date | null>(null);

  const rangeLabel = useMemo(() => {
    return `${rangeStart.toLocaleDateString()}  →  ${rangeEnd.toLocaleDateString()}`;
  }, [rangeStart, rangeEnd]);

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

  const lastReading = useMemo(() => {
    if (!groups.length) return null;
    return groups.reduce((best, g) => (g.createdAt > best.createdAt ? g : best), groups[0]);
  }, [groups]);

  const last30Pie = useMemo(() => {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const recent = groups.filter((g) => g.createdAt >= cutoff);

    const buckets = new Map<
      string,
      {
        name: string;
        count: number;
        color: string;
        legendFontColor: string;
        legendFontSize: number;
      }
    >();

    for (const g of recent) {
      const s = Number(g.avgSystolic);
      const d = Number(g.avgDiastolic);
      if (!Number.isFinite(s) || !Number.isFinite(d)) continue;
      const c = bpCategory(s, d);
      const key = c.label;
      const cur = buckets.get(key);
      if (cur) cur.count += 1;
      else {
        buckets.set(key, {
          name: c.label,
          count: 1,
          color: c.color,
          legendFontColor: '#CBD5E1',
          legendFontSize: 12,
        });
      }
    }

    const data = [...buckets.values()]
      .sort((a, b) => b.count - a.count)
      .map((b) => ({
        name: b.name,
        population: b.count,
        color: b.color,
        legendFontColor: b.legendFontColor,
        legendFontSize: b.legendFontSize,
      }));

    return { total: data.reduce((a, b) => a + b.population, 0), data };
  }, [groups]);

  const chartData = useMemo(() => {
    const width = Dimensions.get('window').width;
    const chartWidth = Math.max(280, Math.floor(width - 40));

    const startAt = rangeStart.getTime();
    const endAt = rangeEnd.getTime();
    const sorted = [...groups]
      .filter((g) => g.createdAt >= startAt && g.createdAt <= endAt)
      .sort((a, b) => a.createdAt - b.createdAt);
    const windowed = sorted;

    type Point = { label: string; systolic: number; diastolic: number };

    const rawPoints: Point[] = (() => {
      if (mode === 'daily') {
        const map = new Map<string, { sSum: number; dSum: number; n: number; ts: number }>();
        for (const g of windowed) {
          const s = Number(g.avgSystolic);
          const d = Number(g.avgDiastolic);
          if (!Number.isFinite(s) || !Number.isFinite(d)) continue;
          const day = new Date(g.createdAt);
          const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
          const cur = map.get(key);
          if (!cur) {
            map.set(key, { sSum: s, dSum: d, n: 1, ts: new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime() });
          } else {
            cur.sSum += s;
            cur.dSum += d;
            cur.n += 1;
          }
        }
        return [...map.entries()]
          .sort((a, b) => a[1].ts - b[1].ts)
          .map(([key, v]) => {
            const m = key.split('-');
            const label = `${Number(m[1])}/${Number(m[2])}`;
            return { label, systolic: v.sSum / v.n, diastolic: v.dSum / v.n };
          });
      }

      const arm = mode;
      return windowed
        .filter((g) => g.arm === arm)
        .map((g) => {
          const d = new Date(g.createdAt);
          return {
            label: `${d.getMonth() + 1}/${d.getDate()}`,
            systolic: Number(g.avgSystolic),
            diastolic: Number(g.avgDiastolic),
          };
        })
        .filter((p) => Number.isFinite(p.systolic) && Number.isFinite(p.diastolic));
    })();

    const points: Point[] = (() => {
      if (rawPoints.length >= 2) return rawPoints;
      if (rawPoints.length === 1) {
        const p = rawPoints[0];
        return [p, { ...p, label: '' }];
      }
      return [
        { label: '', systolic: 0, diastolic: 0 },
        { label: '', systolic: 0, diastolic: 0 },
      ];
    })();

    const safeLabels =
      points.length > 8
        ? points.map((p, i) => (i % Math.ceil(points.length / 6) === 0 ? p.label : ''))
        : points.map((p) => p.label);

    return {
      count: rawPoints.length,
      width: chartWidth,
      bp: {
        labels: safeLabels,
        datasets: [
          { data: points.map((p) => p.systolic) as any, color: () => '#22C55E', strokeWidth: 2 },
          { data: points.map((p) => p.diastolic) as any, color: () => '#60A5FA', strokeWidth: 2 },
        ],
        legend: ['Systolic', 'Diastolic'],
      },
    };
  }, [groups, mode, rangeStart, rangeEnd]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.title}>Trends</Text>
        <Text style={styles.subtitle}>Showing your saved reading averages over time, separated by arm.</Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Last reading</Text>
        {!lastReading ? (
          <Text style={styles.muted}>No saved readings yet.</Text>
        ) : (
          <TouchableOpacity
            style={styles.lastReadingBox}
            activeOpacity={0.85}
            onPress={() => router.push(`/group/${lastReading.id}`)}
          >
            {(() => {
              const c = bpCategory(Number(lastReading.avgSystolic), Number(lastReading.avgDiastolic));
              const dt = new Date(lastReading.createdAt);
              return (
                <>
                  <View style={[styles.categoryBar, { backgroundColor: c.color }]} />
                  <View style={styles.lastReadingHeader}>
                    <View style={styles.lastReadingLeft}>
                      <Text style={styles.bpValue}>
                        <Text style={styles.bpPrimary}>{Math.round(lastReading.avgSystolic)}</Text>
                        <Text style={styles.bpSlash}>/</Text>
                        <Text style={styles.bpSecondary}>{Math.round(lastReading.avgDiastolic)}</Text>
                        <Text style={styles.bpUnit}> mmHg</Text>
                      </Text>
                      {typeof lastReading.avgPulse === 'number' ? (
                        <Text style={styles.pulseText}>{`Pulse ${Math.round(lastReading.avgPulse)} bpm`}</Text>
                      ) : (
                        <Text style={styles.pulseText}>Pulse —</Text>
                      )}
                    </View>

                    <Ionicons name="chevron-forward" size={18} color="#94A3B8" />
                  </View>

                  <View style={styles.lastReadingMetaRow}>
                    <Text style={styles.readingMeta}>
                      {dt.toLocaleDateString([], { year: 'numeric', month: '2-digit', day: '2-digit' })}
                      {'  •  '}
                      {dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}
                    </Text>
                    <View style={[styles.categoryChip, { borderColor: c.color }]}>
                      <Text style={[styles.categoryChipText, { color: c.color }]}>{c.label}</Text>
                    </View>
                  </View>

                  <View style={styles.chipRow}>
                    <View
                      style={[
                        styles.chip,
                        lastReading.arm === 'left' ? styles.chipLeft : styles.chipRight,
                      ]}
                    >
                      <Text style={styles.chipText}>{lastReading.arm === 'left' ? 'Left arm' : 'Right arm'}</Text>
                    </View>
                    <View style={styles.chip}>
                      <Text style={styles.chipText}>Tap to edit</Text>
                    </View>
                  </View>

                  {lastReading.note ? (
                    <Text style={styles.readingNote} numberOfLines={3}>
                      {lastReading.note}
                    </Text>
                  ) : null}
                </>
              );
            })()}
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Last 30 days (distribution)</Text>
        {last30Pie.total === 0 ? (
          <Text style={styles.muted}>Add readings in the last 30 days to see this chart.</Text>
        ) : (
          <PieChart
            data={last30Pie.data as any}
            width={chartData.width}
            height={220}
            chartConfig={{
              backgroundColor: '#111B2E',
              backgroundGradientFrom: '#111B2E',
              backgroundGradientTo: '#111B2E',
              color: (opacity = 1) => `rgba(203, 213, 225, ${opacity})`,
              labelColor: (opacity = 1) => `rgba(203, 213, 225, ${opacity})`,
            }}
            accessor="population"
            backgroundColor="transparent"
            paddingLeft="12"
            absolute
          />
        )}
        {last30Pie.total ? (
          <Text style={styles.muted}>Based on your saved reading averages over the last 30 days.</Text>
        ) : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Blood pressure (avg)</Text>

        <View style={styles.graphHeaderRow}>
          <View style={styles.graphHeaderLeft}>
            <Text style={styles.muted}>{rangeLabel}</Text>
          </View>
          <TouchableOpacity
            style={styles.iconButton}
            onPress={() => {
              setDraftStart(rangeStart);
              setDraftEnd(rangeEnd);
              setRangeModalOpen(true);
            }}
            activeOpacity={0.85}
          >
            <Ionicons name="calendar" size={18} color="#CBD5E1" />
          </TouchableOpacity>
        </View>

        <View style={styles.segmented}>
          <TouchableOpacity
            style={[styles.segment, mode === 'daily' ? styles.segmentActive : null]}
            onPress={() => setMode('daily')}
            activeOpacity={0.85}
          >
            <Text style={[styles.segmentText, mode === 'daily' ? styles.segmentTextActive : null]}>Daily avg</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.segment, mode === 'left' ? styles.segmentActive : null]}
            onPress={() => setMode('left')}
            activeOpacity={0.85}
          >
            <Text style={[styles.segmentText, mode === 'left' ? styles.segmentTextActive : null]}>Left arm</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.segment, mode === 'right' ? styles.segmentActive : null]}
            onPress={() => setMode('right')}
            activeOpacity={0.85}
          >
            <Text style={[styles.segmentText, mode === 'right' ? styles.segmentTextActive : null]}>Right arm</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.legendRow}>
          <View style={styles.legendItem}>
            <View style={[styles.dot, { backgroundColor: '#22C55E' }]} />
            <Text style={styles.legendText}>Systolic</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.dot, { backgroundColor: '#60A5FA' }]} />
            <Text style={styles.legendText}>Diastolic</Text>
          </View>
        </View>
        <LineChart
          data={chartData.bp as any}
          width={chartData.width}
          height={220}
          withDots
          withInnerLines={false}
          withOuterLines={false}
          withVerticalLines={false}
          withHorizontalLines
          bezier
          chartConfig={{
            backgroundColor: '#111B2E',
            backgroundGradientFrom: '#111B2E',
            backgroundGradientTo: '#111B2E',
            decimalPlaces: 0,
            color: (opacity = 1) => `rgba(148, 163, 184, ${opacity})`,
            labelColor: (opacity = 1) => `rgba(203, 213, 225, ${opacity})`,
            propsForBackgroundLines: { stroke: '#1E293B', strokeWidth: 1 },
            propsForDots: {
              r: '3',
              strokeWidth: '2',
              stroke: '#0B1220',
            },
          }}
          fromZero={false}
          segments={5}
          yAxisSuffix=""
          yLabelsOffset={8}
          formatYLabel={(v) => `${Math.round(Number(v))}`}
          getDotColor={(value) => {
            const n = Number(value);
            const s = systolicDotColor(n);
            const d = diastolicDotColor(n);
            return n >= 100 ? s : d;
          }}
          style={{ borderRadius: 16 }}
        />
      </View>

      <View style={styles.card}>
        <TouchableOpacity
          onPress={() => setRangesOpen((v) => !v)}
          style={styles.collapseHeader}
          activeOpacity={0.8}
        >
          <Text style={styles.cardTitle}>Blood pressure ranges (basic)</Text>
          <Ionicons
            name={rangesOpen ? 'chevron-up' : 'chevron-down'}
            size={20}
            color="#CBD5E1"
          />
        </TouchableOpacity>

        {rangesOpen ? (
          <>
            <Text style={styles.muted}>Not medical advice. Ranges are general guidance only.</Text>
            <View style={styles.rangeList}>
              <View style={styles.rangeRow}>
                <View style={[styles.rangeSwatch, { backgroundColor: '#22C55E' }]} />
                <Text style={styles.rangeText}>Normal: &lt;120 and &lt;80</Text>
              </View>
              <View style={styles.rangeRow}>
                <View style={[styles.rangeSwatch, { backgroundColor: '#60A5FA' }]} />
                <Text style={styles.rangeText}>Elevated: 120–129 and &lt;80</Text>
              </View>
              <View style={styles.rangeRow}>
                <View style={[styles.rangeSwatch, { backgroundColor: '#F59E0B' }]} />
                <Text style={styles.rangeText}>High (stage 1): 130–139 or 80–89</Text>
              </View>
              <View style={styles.rangeRow}>
                <View style={[styles.rangeSwatch, { backgroundColor: '#F97316' }]} />
                <Text style={styles.rangeText}>High (stage 2): ≥140 or ≥90</Text>
              </View>
              <View style={styles.rangeRow}>
                <View style={[styles.rangeSwatch, { backgroundColor: '#EF4444' }]} />
                <Text style={styles.rangeText}>Crisis: ≥180 or ≥120</Text>
              </View>
            </View>
          </>
        ) : null}
      </View>

      <View style={styles.card}>
        <TouchableOpacity
          onPress={() => setRecentOpen((v) => !v)}
          style={styles.collapseHeader}
          activeOpacity={0.8}
        >
          <Text style={styles.cardTitle}>Recent readings</Text>
          <Ionicons
            name={recentOpen ? 'chevron-up' : 'chevron-down'}
            size={20}
            color="#CBD5E1"
          />
        </TouchableOpacity>

        {recentOpen ? (
          <>
            {groups.length === 0 ? (
              <Text style={styles.muted}>No saved readings yet.</Text>
            ) : (
              <View style={styles.list}>
                {[...groups]
                  .filter((g) => (mode === 'daily' ? true : g.arm === mode))
                  .sort((a, b) => b.createdAt - a.createdAt)
                  .slice(0, 20)
                  .map((g) => {
                    const c = bpCategory(Number(g.avgSystolic), Number(g.avgDiastolic));
                    return (
                  <TouchableOpacity
                    key={g.id}
                    style={styles.readingItem}
                    onPress={() => router.push(`/group/${g.id}`)}
                  >
                    <View style={[styles.categoryBar, { backgroundColor: c.color }]} />
                    <View style={styles.readingHeaderRow}>
                      <View style={styles.readingHeaderLeft}>
                        <Text style={styles.bpValue}>
                          <Text style={styles.bpPrimary}>{Math.round(g.avgSystolic)}</Text>
                          <Text style={styles.bpSlash}>/</Text>
                          <Text style={styles.bpSecondary}>{Math.round(g.avgDiastolic)}</Text>
                          <Text style={styles.bpUnit}> mmHg</Text>
                        </Text>
                        {typeof g.avgPulse === 'number' ? (
                          <Text style={styles.pulseText}>{`Pulse ${Math.round(g.avgPulse)} bpm`}</Text>
                        ) : null}
                      </View>

                      <View style={styles.readingHeaderRight}>
                        <Text style={styles.readingMeta}>
                          {new Date(g.createdAt).toLocaleDateString([], {
                            year: 'numeric',
                            month: '2-digit',
                            day: '2-digit',
                          })}
                        </Text>
                        <Text style={styles.readingMeta}>
                          {new Date(g.createdAt).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                            hour12: false,
                          })}
                        </Text>
                        <View style={[styles.categoryChip, { borderColor: c.color }]}>
                          <Text style={[styles.categoryChipText, { color: c.color }]}>{c.label}</Text>
                        </View>
                      </View>
                    </View>

                    <View style={styles.chipRow}>
                      <View style={[styles.chip, g.arm === 'left' ? styles.chipLeft : styles.chipRight]}>
                        <Text style={styles.chipText}>{g.arm === 'left' ? 'Left arm' : 'Right arm'}</Text>
                      </View>
                      <View style={styles.chip}>
                        <Text style={styles.chipText}>Tap to edit</Text>
                      </View>
                    </View>

                    {g.note ? <Text style={styles.readingNote} numberOfLines={2}>{g.note}</Text> : null}
                  </TouchableOpacity>
                    );
                  })}

                {mode !== 'daily' && ![...groups].some((g) => g.arm === mode) ? (
                  <Text style={styles.muted}>No {mode === 'left' ? 'left' : 'right'} arm readings yet.</Text>
                ) : null}
              </View>
            )}
          </>
        ) : null}
      </View>

      </ScrollView>

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
                  setDraftStart(rangeStart);
                  setDraftEnd(rangeEnd);
                }}
              >
                <Text style={styles.secondaryPillText}>Reset</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.primaryPill}
                onPress={() => {
                  if (!draftStart) return;
                  const end = draftEnd ?? draftStart;
                  setRangeStart(draftStart);
                  setRangeEnd(end);
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
    paddingBottom: 40,
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
  collapseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  segmented: {
    flexDirection: 'row',
    backgroundColor: '#0B1220',
    borderColor: '#1E293B',
    borderWidth: 1,
    borderRadius: 12,
    padding: 4,
    gap: 6,
  },
  segment: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentActive: {
    backgroundColor: '#1D4ED8',
  },
  segmentText: {
    color: '#CBD5E1',
    fontSize: 13,
    fontWeight: '900',
  },
  segmentTextActive: {
    color: '#F8FAFC',
  },
  graphHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  graphHeaderLeft: {
    flex: 1,
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
    maxHeight: 520,
  },
  calendarWrap: {
    height: 360,
    paddingHorizontal: 8,
    paddingBottom: 6,
  },
  calendar: {
    height: 360,
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
  list: {
    gap: 10,
  },
  rangeList: {
    gap: 10,
    marginTop: 2,
  },
  rangeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  rangeSwatch: {
    width: 10,
    height: 10,
    borderRadius: 999,
  },
  rangeText: {
    color: '#CBD5E1',
    fontSize: 13,
    fontWeight: '700',
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#0B1220',
    borderColor: '#1E293B',
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  listItemLeft: {
    flex: 1,
    gap: 4,
  },
  listItemTitle: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '900',
  },
  listItemSubtitle: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '700',
  },
  readingItem: {
    backgroundColor: '#0B1220',
    borderColor: '#1E293B',
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 8,
  },
  lastReadingBox: {
    backgroundColor: '#0B1220',
    borderColor: '#1E293B',
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 10,
  },
  lastReadingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  lastReadingLeft: {
    flex: 1,
    gap: 4,
  },
  lastReadingMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  categoryBar: {
    height: 4,
    borderRadius: 999,
  },
  categoryChip: {
    marginTop: 2,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
  },
  categoryChipText: {
    fontSize: 12,
    fontWeight: '900',
  },
  readingHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  readingHeaderLeft: {
    flex: 1,
    gap: 4,
  },
  readingHeaderRight: {
    alignItems: 'flex-end',
    gap: 4,
  },
  bpValue: {
    color: '#F8FAFC',
    fontSize: 20,
    fontWeight: '900',
  },
  bpPrimary: {
    color: '#F8FAFC',
    fontSize: 22,
    fontWeight: '900',
  },
  bpSlash: {
    color: '#94A3B8',
    fontSize: 20,
    fontWeight: '900',
  },
  bpSecondary: {
    color: '#E2E8F0',
    fontSize: 22,
    fontWeight: '900',
  },
  bpUnit: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '800',
  },
  pulseText: {
    color: '#CBD5E1',
    fontSize: 13,
    fontWeight: '800',
  },
  readingTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  readingValue: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '900',
  },
  readingMeta: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '700',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#1E293B',
    backgroundColor: '#0B1220',
  },
  chipLeft: {
    backgroundColor: 'rgba(34, 197, 94, 0.12)',
    borderColor: 'rgba(34, 197, 94, 0.35)',
  },
  chipRight: {
    backgroundColor: 'rgba(96, 165, 250, 0.12)',
    borderColor: 'rgba(96, 165, 250, 0.35)',
  },
  chipText: {
    color: '#CBD5E1',
    fontSize: 12,
    fontWeight: '800',
  },
  readingNote: {
    color: '#CBD5E1',
    fontSize: 13,
    lineHeight: 18,
  },
  muted: {
    color: '#94A3B8',
    fontSize: 14,
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
    fontSize: 14,
    fontWeight: '700',
  },
  primaryButton: {
    marginTop: 6,
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
  legendRow: {
    flexDirection: 'row',
    gap: 14,
    marginTop: 6,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  legendText: {
    color: '#CBD5E1',
    fontSize: 13,
    fontWeight: '600',
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 999,
  },
});
