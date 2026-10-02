import { Button, Stack } from '@/components/atoms';

import { LabeledField } from './LabeledField';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedControlProps<T extends string> {
  value: T;
  options: readonly SegmentOption<T>[];
  onChange: (value: T) => void;
  label?: string;
}

export function SegmentedControl<T extends string>({ value, options, onChange, label }: SegmentedControlProps<T>) {
  const buttons = (
    <Stack direction="row" wrap>
      {options.map((o) => (
        <Button
          key={o.value}
          size="sm"
          variant={o.value === value ? 'primary' : 'secondary'}
          title={o.label}
          onPress={() => onChange(o.value)}
        />
      ))}
    </Stack>
  );
  return label ? <LabeledField label={label}>{buttons}</LabeledField> : buttons;
}
