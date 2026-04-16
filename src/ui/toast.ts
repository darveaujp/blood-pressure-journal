import type { ToastType } from 'react-native-toast-notifications';

export type ToastKind = 'success' | 'error' | 'warning';

export function toastType(kind: ToastKind): ToastType {
  if (kind === 'warning') return 'warning' as unknown as ToastType;
  if (kind === 'success') return 'success' as unknown as ToastType;
  return 'danger' as unknown as ToastType;
}
