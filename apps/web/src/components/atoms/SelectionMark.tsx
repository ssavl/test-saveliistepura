import { StyleSheet, View } from 'react-native';

import { colors } from '@/theme';

import { AppText } from './AppText';

export interface SelectionMarkProps {
  selected: boolean;
  shape: 'radio' | 'checkbox';
}

export function SelectionMark({ selected, shape }: SelectionMarkProps) {
  return (
    <View style={[s.mark, shape === 'radio' ? s.round : s.square, selected && s.on]}>
      {selected ? <AppText style={s.tick}>✓</AppText> : null}
    </View>
  );
}

const s = StyleSheet.create({
  mark: {
    width: 22,
    height: 22,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  round: { borderRadius: 11 },
  square: { borderRadius: 6 },
  on: { backgroundColor: colors.accent, borderColor: colors.accent },
  tick: { color: colors.onAccent, fontSize: 13, fontWeight: '700' },
});
