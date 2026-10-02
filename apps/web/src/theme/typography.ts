import type { TextStyle } from 'react-native';

import { colors } from './colors';

export const mono = 'Menlo, Consolas, monospace';

export const typography = {
  display: { fontSize: 38, lineHeight: 44, fontWeight: '600', letterSpacing: -1.4, color: colors.text },
  displayCompact: { fontSize: 30, lineHeight: 36, fontWeight: '600', letterSpacing: -0.9, color: colors.text },
  h1: { fontSize: 28, lineHeight: 34, fontWeight: '700', color: colors.text },
  h2: { fontSize: 20, fontWeight: '700', color: colors.text },
  h3: { fontSize: 17, fontWeight: '700', color: colors.text },
  metric: { fontSize: 28, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  subtitle: { fontSize: 17, lineHeight: 24, color: colors.muted },
  lead: { fontSize: 17, lineHeight: 28, color: colors.muted },
  body: { fontSize: 16, lineHeight: 24, color: colors.text },
  bodyStrong: { fontSize: 16, lineHeight: 24, fontWeight: '700', color: colors.text },
  option: { fontSize: 17, lineHeight: 25, fontWeight: '500', color: colors.text },
  muted: { fontSize: 15, color: colors.muted },
  cell: { fontSize: 14, color: colors.text, fontVariant: ['tabular-nums'] },
  label: { fontSize: 13, fontWeight: '500', color: colors.muted },
  hint: { fontSize: 13, lineHeight: 20, color: colors.muted },
  caption: { fontSize: 12, color: colors.muted },
  overline: { fontSize: 12, letterSpacing: 0.5, color: colors.muted, fontVariant: ['tabular-nums'] },
  eyebrow: { fontSize: 14, fontWeight: '600', letterSpacing: 0.5, textTransform: 'uppercase', color: colors.accent },
  error: { fontSize: 14, color: colors.danger },
  link: { fontSize: 15, fontWeight: '500', color: colors.accent },
  code: { fontFamily: mono, fontSize: 12, color: colors.text },
} satisfies Record<string, TextStyle>;

export type TextVariant = keyof typeof typography;
