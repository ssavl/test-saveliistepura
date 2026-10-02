export const colors = {
  bg: '#F7F6F2',
  card: '#FFFFFF',
  text: '#203D35',
  muted: '#68746D',
  border: '#DFE4DC',
  accent: '#24634E',
  accentSoft: '#EAF2E9',
  danger: '#C4320A',
  dangerSoft: '#FEF3F2',
  warning: '#B54708',
  warningSoft: '#FFFAEB',
  success: '#067647',
  successSoft: '#ECFDF3',
  onAccent: '#FFFFFF',
} as const;

export type ColorName = keyof typeof colors;

export type Tone = 'accent' | 'success' | 'warning' | 'danger';

export const toneColors: Record<Tone, { fg: string; bg: string }> = {
  accent: { fg: colors.accent, bg: colors.accentSoft },
  success: { fg: colors.success, bg: colors.successSoft },
  warning: { fg: colors.warning, bg: colors.warningSoft },
  danger: { fg: colors.danger, bg: colors.dangerSoft },
};
