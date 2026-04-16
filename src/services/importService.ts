import * as DocumentPicker from 'expo-document-picker';
import { readAsStringAsync, EncodingType } from 'expo-file-system/legacy';

export type ImportRow = {
  date: string;
  time: string;
  arm: 'left' | 'right';
  systolic: number;
  diastolic: number;
  pulse: number | null;
  note: string | null;
};

export async function pickCsvFile(): Promise<string | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: 'text/csv',
    copyToCacheDirectory: true,
  });
  
  if (result.canceled || !result.assets?.length) return null;
  
  return result.assets[0].uri;
}

export async function parseCsvImport(uri: string): Promise<ImportRow[]> {
  const content = await readAsStringAsync(uri, {
    encoding: EncodingType.UTF8,
  });
  
  const lines = content.split('\n').filter(line => line.trim());
  if (lines.length < 2) {
    throw new Error('CSV file is empty or has no data rows');
  }
  
  // Skip header row
  const dataRows = lines.slice(1);
  const rows: ImportRow[] = [];
  
  for (let i = 0; i < dataRows.length; i++) {
    const line = dataRows[i];
    const columns = parseCsvLine(line);
    
    if (columns.length < 6) continue;
    
    const date = columns[0]?.trim();
    const time = columns[1]?.trim();
    const arm = columns[2]?.trim().toLowerCase();
    const bp = columns[3]?.trim();
    const pulseStr = columns[4]?.trim();
    const note = columns[5]?.trim();
    
    if (!date || !time || !bp) continue;
    
    const [systolicStr, diastolicStr] = bp.split('/');
    const systolic = parseInt(systolicStr, 10);
    const diastolic = parseInt(diastolicStr, 10);
    
    if (isNaN(systolic) || isNaN(diastolic)) continue;
    
    const pulseNum = pulseStr ? parseInt(pulseStr, 10) : null;
    const pulse = pulseNum !== null && !isNaN(pulseNum) ? pulseNum : null;
    const dateParts = date.split(/[-/]/);
    const timeParts = time.split(':');
    
    if (dateParts.length !== 3 || timeParts.length < 2) continue;
    
    const year = parseInt(dateParts[0], 10);
    const month = parseInt(dateParts[1], 10) - 1;
    const day = parseInt(dateParts[2], 10);
    const hour = parseInt(timeParts[0], 10);
    const minute = parseInt(timeParts[1], 10);
    
    if (isNaN(year) || isNaN(month) || isNaN(day) || isNaN(hour) || isNaN(minute)) continue;
    
    rows.push({
      date,
      time,
      arm: arm === 'right' ? 'right' : 'left',
      systolic,
      diastolic,
      pulse,
      note: note || null,
    });
  }
  
  return rows;
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  
  result.push(current.trim());
  return result;
}

export function groupImportRowsByDateTime(rows: ImportRow[]): Map<string, ImportRow[]> {
  const groups = new Map<string, ImportRow[]>();
  
  for (const row of rows) {
    const key = `${row.date}T${row.time}`;
    const existing = groups.get(key) || [];
    existing.push(row);
    groups.set(key, existing);
  }
  
  return groups;
}
