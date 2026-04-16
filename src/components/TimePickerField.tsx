import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { Platform, StyleProp, StyleSheet, Text, TouchableOpacity, View, ViewStyle } from 'react-native';
import DateTimePickerModal from 'react-native-modal-datetime-picker';

type Props = {
  value: Date;
  onChange: (next: Date) => void;
  style?: StyleProp<ViewStyle>;
};

export default function TimePickerField({ value, onChange, style }: Props) {
  const [open, setOpen] = useState(false);

  const label = useMemo(() => {
    return value.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  }, [value]);

  return (
    <View style={style}>
      <TouchableOpacity style={styles.button} onPress={() => setOpen(true)} activeOpacity={0.85}>
        <Text style={styles.text}>{label}</Text>
        <Ionicons name="time" size={16} color="#CBD5E1" />
      </TouchableOpacity>

      <DateTimePickerModal
        isVisible={open}
        mode="time"
        date={value}
        is24Hour
        display={Platform.OS === 'ios' ? 'spinner' : 'default'}
        themeVariant="dark"
        isDarkModeEnabled
        textColor="#F8FAFC"
        pickerContainerStyleIOS={styles.pickerContainerIOS as any}
        modalStyleIOS={styles.modalIOS as any}
        onConfirm={(selected: Date) => {
          setOpen(false);
          const next = new Date(value);
          next.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
          onChange(next);
        }}
        onCancel={() => setOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    flex: 1,
    backgroundColor: '#0B1220',
    borderColor: '#1E293B',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'space-between',
    flexDirection: 'row',
    gap: 12,
  },
  text: {
    color: '#F8FAFC',
    fontSize: 15,
    fontWeight: '700',
  },
  pickerContainerIOS: {
    backgroundColor: '#111B2E',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  modalIOS: {
    margin: 0,
    justifyContent: 'flex-end',
  },
});
