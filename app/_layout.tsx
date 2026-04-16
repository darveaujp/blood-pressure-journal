import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ToastProvider } from 'react-native-toast-notifications';
import { LogBox, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useBpStore } from '../src/state/bpStore';
import { LoadingOverlay } from '../src/components/LoadingOverlay';

export default function RootLayout() {
  const init = useBpStore((s) => s.init);

  useEffect(() => {
    LogBox.ignoreLogs([
      'SafeAreaView has been deprecated and will be removed in a future release.',
    ]);
    void init();
  }, [init]);

  return (
    <SafeAreaProvider>
      <StatusBar style="light" backgroundColor="#0B1220" />
      <ToastProvider
        placement="top"
        duration={2500}
        animationType="slide-in"
        offsetTop={54}
        renderToast={(toast) => {
          const type = toast.type;
          const theme =
            type === 'success'
              ? { bg: '#86EFAC', fg: '#052E16' }
              : type === 'warning'
                ? { bg: '#FDE68A', fg: '#451A03' }
                : type === 'danger'
                  ? { bg: '#FCA5A5', fg: '#450A0A' }
                  : { bg: '#E2E8F0', fg: '#0F172A' };

          const iconName =
            type === 'success'
              ? 'checkmark'
              : type === 'warning'
                ? 'alert'
                : type === 'danger'
                  ? 'close'
                  : 'information';

          return (
            <View style={[styles.toast, { backgroundColor: theme.bg }]}>
              <View style={[styles.toastIcon, { backgroundColor: theme.fg }]}>
                <Ionicons name={iconName as any} size={16} color={theme.bg} />
              </View>
              <Text style={[styles.toastText, { color: theme.fg }]} numberOfLines={3}>
                {String(toast.message)}
              </Text>
            </View>
          );
        }}
      >
        <Stack screenOptions={{ headerShown: false }} />
        <LoadingOverlay />
      </ToastProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  toast: {
    marginHorizontal: 16,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  toastIcon: {
    width: 28,
    height: 28,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toastText: {
    fontSize: 14,
    fontWeight: '800',
    flex: 1,
  },
});
