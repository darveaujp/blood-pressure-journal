import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { useUiStore } from '../state/uiStore';

export function LoadingOverlay() {
  const loadingCount = useUiStore((s) => s.loadingCount);
  if (loadingCount <= 0) return null;

  return (
    <View style={styles.backdrop} pointerEvents="auto">
      <View style={styles.card}>
        <ActivityIndicator size="large" color="#60A5FA" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
  },
  card: {
    width: 88,
    height: 88,
    borderRadius: 18,
    backgroundColor: '#111B2E',
    borderWidth: 1,
    borderColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
