import type { Arm, BpGroup, BpReadingInput, BpGroupWithReadings } from '../types/bp';
import { execAsync, queryAllAsync } from './sqlite';
import { uuidv4 } from '../utils/uuid';

export async function initDb() {
  await execAsync('PRAGMA journal_mode = WAL;');
  await execAsync('PRAGMA foreign_keys = ON;');
  await execAsync(
    `CREATE TABLE IF NOT EXISTS bp_groups (
      id TEXT PRIMARY KEY NOT NULL,
      created_at INTEGER NOT NULL,
      arm TEXT NOT NULL DEFAULT 'left',
      note TEXT,
      avg_systolic REAL NOT NULL,
      avg_diastolic REAL NOT NULL,
      avg_pulse REAL,
      count INTEGER NOT NULL
    );`
  );

  await execAsync("ALTER TABLE bp_groups ADD COLUMN arm TEXT NOT NULL DEFAULT 'left';").catch(() => undefined);

  await execAsync(
    `CREATE TABLE IF NOT EXISTS bp_readings (
      id TEXT PRIMARY KEY NOT NULL,
      group_id TEXT NOT NULL,
      systolic INTEGER NOT NULL,
      diastolic INTEGER NOT NULL,
      pulse INTEGER,
      taken_at INTEGER NOT NULL,
      FOREIGN KEY (group_id) REFERENCES bp_groups(id) ON DELETE CASCADE
    );`
  );

  await execAsync('CREATE INDEX IF NOT EXISTS idx_bp_readings_group_id ON bp_readings(group_id);');
  await execAsync('CREATE INDEX IF NOT EXISTS idx_bp_groups_created_at ON bp_groups(created_at);');
}

function computeAverages(readings: BpReadingInput[]) {
  const count = readings.length;
  const sumS = readings.reduce((acc, r) => acc + r.systolic, 0);
  const sumD = readings.reduce((acc, r) => acc + r.diastolic, 0);

  const pulses = readings.map((r) => r.pulse).filter((p): p is number => typeof p === 'number');
  const avgPulse = pulses.length ? pulses.reduce((a, b) => a + b, 0) / pulses.length : null;

  return {
    count,
    avgSystolic: sumS / count,
    avgDiastolic: sumD / count,
    avgPulse,
  };
}

export async function createGroup(params: {
  note: string | null;
  arm: Arm;
  readings: Array<Omit<BpReadingInput, 'takenAt'>>;
  createdAt: number;
}): Promise<BpGroupWithReadings> {
  const { note, arm, readings: readingsWithoutTime, createdAt } = params;

  const readings: BpReadingInput[] = readingsWithoutTime.map((r) => ({
    ...r,
    takenAt: createdAt,
  }));

  if (!readings.length) {
    throw new Error('At least one reading is required');
  }

  const groupId = await uuidv4();
  const { count, avgSystolic, avgDiastolic, avgPulse } = computeAverages(readings);

  await execAsync(
    'INSERT INTO bp_groups (id, created_at, arm, note, avg_systolic, avg_diastolic, avg_pulse, count) VALUES (?, ?, ?, ?, ?, ?, ?, ?);',
    [groupId, createdAt, arm, note, avgSystolic, avgDiastolic, avgPulse, count]
  );

  const readingRows: BpGroupWithReadings['readings'] = [];
  for (const r of readings) {
    const id = await uuidv4();
    await execAsync(
      'INSERT INTO bp_readings (id, group_id, systolic, diastolic, pulse, taken_at) VALUES (?, ?, ?, ?, ?, ?);',
      [id, groupId, r.systolic, r.diastolic, r.pulse ?? null, r.takenAt]
    );
    readingRows.push({
      id,
      groupId,
      systolic: r.systolic,
      diastolic: r.diastolic,
      pulse: r.pulse ?? null,
      takenAt: r.takenAt,
    });
  }

  return {
    id: groupId,
    createdAt,
    arm,
    note,
    avgSystolic,
    avgDiastolic,
    avgPulse,
    count,
    readings: readingRows,
  };
}

export async function listGroups(limit = 200): Promise<BpGroup[]> {
  const rows = await queryAllAsync<any>(
    "SELECT id, created_at, arm, note, avg_systolic, avg_diastolic, avg_pulse, count FROM bp_groups ORDER BY created_at DESC LIMIT ?;",
    [limit]
  );

  return rows.map((r) => ({
    id: String(r.id),
    createdAt: Number(r.created_at),
    arm: (r.arm === 'right' ? 'right' : 'left') as Arm,
    note: r.note ?? null,
    avgSystolic: Number(r.avg_systolic),
    avgDiastolic: Number(r.avg_diastolic),
    avgPulse: r.avg_pulse === null || r.avg_pulse === undefined ? null : Number(r.avg_pulse),
    count: Number(r.count),
  }));
}

export async function deleteGroup(groupId: string) {
  await execAsync('DELETE FROM bp_groups WHERE id = ?;', [groupId]);
}

export async function updateGroupMeta(params: {
  id: string;
  createdAt: number;
  arm: Arm;
  note: string | null;
}) {
  const { id, createdAt, arm, note } = params;
  await execAsync('UPDATE bp_groups SET created_at = ?, arm = ?, note = ? WHERE id = ?;', [createdAt, arm, note, id]);
  await execAsync('UPDATE bp_readings SET taken_at = ? WHERE group_id = ?;', [createdAt, id]);
}

export async function getGroupWithReadings(groupId: string): Promise<BpGroupWithReadings | null> {
  const groupRows = await queryAllAsync<any>(
    'SELECT id, created_at, arm, note, avg_systolic, avg_diastolic, avg_pulse, count FROM bp_groups WHERE id = ? LIMIT 1;',
    [groupId]
  );
  const g = groupRows[0];
  if (!g) return null;

  const readingRows = await queryAllAsync<any>(
    'SELECT id, group_id, systolic, diastolic, pulse, taken_at FROM bp_readings WHERE group_id = ? ORDER BY taken_at ASC, id ASC;',
    [groupId]
  );

  return {
    id: String(g.id),
    createdAt: Number(g.created_at),
    arm: (g.arm === 'right' ? 'right' : 'left') as Arm,
    note: g.note ?? null,
    avgSystolic: Number(g.avg_systolic),
    avgDiastolic: Number(g.avg_diastolic),
    avgPulse: g.avg_pulse === null || g.avg_pulse === undefined ? null : Number(g.avg_pulse),
    count: Number(g.count),
    readings: readingRows.map((r) => ({
      id: String(r.id),
      groupId: String(r.group_id),
      systolic: Number(r.systolic),
      diastolic: Number(r.diastolic),
      pulse: r.pulse === null || r.pulse === undefined ? null : Number(r.pulse),
      takenAt: Number(r.taken_at),
    })),
  };
}

export async function updateGroup(params: {
  id: string;
  createdAt: number;
  arm: Arm;
  note: string | null;
  readings: Array<{ systolic: number; diastolic: number; pulse?: number | null }>;
}) {
  const { id, createdAt, arm, note } = params;

  const readings: BpReadingInput[] = params.readings.map((r) => ({
    systolic: r.systolic,
    diastolic: r.diastolic,
    pulse: r.pulse ?? null,
    takenAt: createdAt,
  }));

  if (!readings.length) {
    throw new Error('At least one reading is required');
  }

  const { count, avgSystolic, avgDiastolic, avgPulse } = computeAverages(readings);

  await execAsync('BEGIN;');
  try {
    await execAsync(
      'UPDATE bp_groups SET created_at = ?, arm = ?, note = ?, avg_systolic = ?, avg_diastolic = ?, avg_pulse = ?, count = ? WHERE id = ?;',
      [createdAt, arm, note, avgSystolic, avgDiastolic, avgPulse, count, id]
    );

    await execAsync('DELETE FROM bp_readings WHERE group_id = ?;', [id]);

    for (const r of readings) {
      const rid = await uuidv4();
      await execAsync(
        'INSERT INTO bp_readings (id, group_id, systolic, diastolic, pulse, taken_at) VALUES (?, ?, ?, ?, ?, ?);',
        [rid, id, r.systolic, r.diastolic, r.pulse ?? null, r.takenAt]
      );
    }

    await execAsync('COMMIT;');
  } catch (e) {
    await execAsync('ROLLBACK;').catch(() => undefined);
    throw e;
  }
}

export async function listAllGroups(): Promise<BpGroup[]> {
  const rows = await queryAllAsync<any>(
    'SELECT id, created_at, arm, note, avg_systolic, avg_diastolic, avg_pulse, count FROM bp_groups ORDER BY created_at DESC;'
  );

  return rows.map((r) => ({
    id: String(r.id),
    createdAt: Number(r.created_at),
    arm: (r.arm === 'right' ? 'right' : 'left') as Arm,
    note: r.note ?? null,
    avgSystolic: Number(r.avg_systolic),
    avgDiastolic: Number(r.avg_diastolic),
    avgPulse: r.avg_pulse === null || r.avg_pulse === undefined ? null : Number(r.avg_pulse),
    count: Number(r.count),
  }));
}

export async function deleteAllGroups(): Promise<void> {
  await execAsync('DELETE FROM bp_readings;');
  await execAsync('DELETE FROM bp_groups;');
}

export async function listGroupsInRange(params: {
  startAt: number;
  endAt: number;
  limit?: number;
}): Promise<BpGroup[]> {
  const { startAt, endAt, limit = 5000 } = params;
  const rows = await queryAllAsync<any>(
    'SELECT id, created_at, arm, note, avg_systolic, avg_diastolic, avg_pulse, count FROM bp_groups WHERE created_at >= ? AND created_at <= ? ORDER BY created_at ASC LIMIT ?;',
    [startAt, endAt, limit]
  );

  return rows.map((r) => ({
    id: String(r.id),
    createdAt: Number(r.created_at),
    arm: (r.arm === 'right' ? 'right' : 'left') as Arm,
    note: r.note ?? null,
    avgSystolic: Number(r.avg_systolic),
    avgDiastolic: Number(r.avg_diastolic),
    avgPulse: r.avg_pulse === null || r.avg_pulse === undefined ? null : Number(r.avg_pulse),
    count: Number(r.count),
  }));
}
