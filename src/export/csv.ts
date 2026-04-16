import { format } from 'date-fns';

import type { BpGroup } from '../types/bp';

function escapeCsv(value: string) {
  if (value.includes('"') || value.includes(',') || value.includes('\n') || value.includes('\r')) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

export function groupsToCsv(groups: BpGroup[]) {
  const header = ['date', 'time', 'right_arm', 'left_arm', 'notes'].join(',');

  const lines = groups.map((g) => {
    const dt = new Date(g.createdAt);
    const date = format(dt, 'yyyy-MM-dd');
    const time = format(dt, 'HH:mm');
    const avg = `${Math.round(g.avgSystolic)}/${Math.round(g.avgDiastolic)}`;

    const rightArm = g.arm === 'right' ? avg : '';
    const leftArm = g.arm === 'left' ? avg : '';

    return [
      escapeCsv(date),
      escapeCsv(time),
      escapeCsv(rightArm),
      escapeCsv(leftArm),
      escapeCsv(g.note ?? ''),
    ].join(',');
  });

  return [header, ...lines].join('\n');
}
