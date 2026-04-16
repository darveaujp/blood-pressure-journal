export type BpReadingInput = {
  systolic: number;
  diastolic: number;
  pulse?: number | null;
  takenAt: number;
};

export type Arm = 'left' | 'right';

export type BpGroup = {
  id: string;
  createdAt: number;
  arm: Arm;
  note: string | null;
  avgSystolic: number;
  avgDiastolic: number;
  avgPulse: number | null;
  count: number;
};

export type BpGroupWithReadings = BpGroup & {
  readings: Array<{
    id: string;
    groupId: string;
    systolic: number;
    diastolic: number;
    pulse: number | null;
    takenAt: number;
  }>;
};
