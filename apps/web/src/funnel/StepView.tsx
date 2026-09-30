// Renders one funnel step by type. Navigation is left to the caller via onSubmit / onCta.
import { type AnswerValue, type Answers, renderTemplate, type ResolvedFunnel, type Step, validateAnswer } from '@funnel/shared';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { colors, radius } from '@/components/theme';
import { Button, Card, OptionCard, styles as ui } from '@/components/ui';

type SecondaryAction = { label: string; event: string; text?: string };

interface Props {
  step: Step;
  funnel: ResolvedFunnel;
  answers: Answers;
  onSubmit: (value: AnswerValue | undefined) => string | undefined; // returns an error message, if any
  onCta: (url: string) => Promise<void>;
  onSecondary: (action: SecondaryAction) => void;
}

export function StepView(props: Props) {
  const { step } = props;
  return (
    <View style={{ gap: 20 }}>
      <View style={{ gap: 8 }}>
        <Text style={ui.h1} accessibilityRole="header">
          {step.title}
        </Text>
        {step.subtitle ? <Text style={ui.subtitle}>{step.subtitle}</Text> : null}
      </View>
      {step.type === 'single' && <SingleStep {...props} step={step} />}
      {step.type === 'multi' && <MultiStep {...props} step={step} />}
      {step.type === 'number' && <NumberStep {...props} step={step} />}
      {step.type === 'info' && <InfoStep {...props} step={step} />}
      {step.type === 'result' && <ResultStep {...props} step={step} />}
    </View>
  );
}

type StepOf<T extends Step['type']> = Extract<Step, { type: T }>;

// Single choice submits on tap.
function SingleStep({ step, answers, onSubmit }: Props & { step: StepOf<'single'> }) {
  const [selected, setSelected] = useState<string | undefined>(
    typeof answers[step.id] === 'string' ? (answers[step.id] as string) : undefined,
  );
  const [error, setError] = useState<string>();
  return (
    <View style={{ gap: 10 }}>
      {step.options.map((o) => (
        <OptionCard
          key={o.value}
          label={o.label}
          selected={selected === o.value}
          onPress={() => {
            setSelected(o.value);
            setError(onSubmit(o.value));
          }}
        />
      ))}
      {error ? <Text style={ui.error}>{error}</Text> : null}
    </View>
  );
}

function MultiStep({ step, answers, onSubmit }: Props & { step: StepOf<'multi'> }) {
  const [selected, setSelected] = useState<string[]>(Array.isArray(answers[step.id]) ? (answers[step.id] as string[]) : []);
  const [touched, setTouched] = useState(false);
  const check = validateAnswer(step, selected);
  const atMax = !!step.maxSelected && selected.length >= step.maxSelected;
  const toggle = (value: string) => {
    setTouched(true);
    setSelected((cur) => (cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value]));
  };
  // Keep option order stable regardless of tap order.
  const ordered = step.options.map((o) => o.value).filter((v) => selected.includes(v));
  return (
    <View style={{ gap: 10 }}>
      {step.options.map((o) => {
        const on = selected.includes(o.value);
        return <OptionCard key={o.value} multi label={o.label} selected={on} disabled={!on && atMax} onPress={() => toggle(o.value)} />;
      })}
      {touched && !check.ok ? <Text style={ui.error}>{check.error}</Text> : null}
      {atMax ? <Text style={ui.muted}>Выбрано максимальное количество</Text> : null}
      <Button title="Продолжить" disabled={!check.ok} onPress={() => onSubmit(ordered)} style={{ marginTop: 8 }} />
    </View>
  );
}

function NumberStep({ step, answers, onSubmit }: Props & { step: StepOf<'number'> }) {
  const initial = answers[step.id];
  const [text, setText] = useState(typeof initial === 'number' ? String(initial) : '');
  const normalized = text.trim().replace(',', '.');
  const value = normalized === '' ? undefined : Number(normalized);
  const check = validateAnswer(step, value);
  return (
    <View style={{ gap: 10 }}>
      <View style={[local.inputRow, !check.ok && text !== '' && { borderColor: colors.danger }]}>
        <TextInput
          value={text}
          onChangeText={(t) => setText(t.replace(/[^0-9.,]/g, ''))}
          keyboardType="numeric"
          inputMode="decimal"
          placeholder={step.placeholder}
          placeholderTextColor={colors.muted}
          style={local.input}
          autoFocus
          onSubmitEditing={() => check.ok && onSubmit(value)}
          accessibilityLabel={step.title}
        />
        {step.unit ? <Text style={local.unit}>{step.unit}</Text> : null}
      </View>
      {text !== '' && !check.ok ? (
        <Text style={ui.error}>{check.error}</Text>
      ) : (
        <Text style={ui.muted}>
          От {step.min} до {step.max}
          {step.unit ? ` ${step.unit}` : ''}
        </Text>
      )}
      <Button title="Продолжить" disabled={!check.ok} onPress={() => onSubmit(value)} style={{ marginTop: 8 }} />
    </View>
  );
}

function SecondaryActionView({ action, onSecondary }: { action: SecondaryAction; onSecondary: Props['onSecondary'] }) {
  const [revealed, setRevealed] = useState(false);
  if (revealed) {
    return action.text ? (
      <Card style={{ backgroundColor: colors.accentSoft, borderColor: colors.accentSoft }}>
        <Text style={ui.body}>{action.text}</Text>
      </Card>
    ) : null;
  }
  return (
    <Button
      title={action.label}
      variant="ghost"
      onPress={() => {
        onSecondary(action);
        setRevealed(true);
      }}
    />
  );
}

function InfoStep({ step, onSubmit, onSecondary }: Props & { step: StepOf<'info'> }) {
  return (
    <View style={{ gap: 16 }}>
      {step.body ? (
        <Card>
          <Text style={ui.body}>{step.body}</Text>
        </Card>
      ) : null}
      <Button title={step.cta} onPress={() => onSubmit(undefined)} style={{ marginTop: 8 }} />
      {step.secondaryAction ? <SecondaryActionView action={step.secondaryAction} onSecondary={onSecondary} /> : null}
    </View>
  );
}

function ResultStep({ step, funnel, answers, onCta, onSecondary }: Props & { step: StepOf<'result'> }) {
  const [busy, setBusy] = useState(false);
  return (
    <View style={{ gap: 16 }}>
      {step.body ? (
        <Card style={{ backgroundColor: colors.accentSoft, borderColor: colors.accentSoft }}>
          <Text style={[ui.body, { fontSize: 17 }]}>{renderTemplate(step.body, funnel, answers)}</Text>
        </Card>
      ) : null}
      {step.bullets.length ? (
        <View style={{ gap: 10 }}>
          {step.bullets.map((b, i) => (
            <View key={i} style={local.bullet}>
              <Text style={local.bulletMark}>✓</Text>
              <Text style={[ui.body, { flex: 1 }]}>{renderTemplate(b, funnel, answers)}</Text>
            </View>
          ))}
        </View>
      ) : null}
      <Button
        title={step.cta.label}
        loading={busy}
        onPress={async () => {
          setBusy(true);
          try {
            await onCta(step.cta.url);
          } finally {
            setBusy(false);
          }
        }}
        style={{ marginTop: 8 }}
      />
      {step.secondaryAction ? <SecondaryActionView action={step.secondaryAction} onSecondary={onSecondary} /> : null}
    </View>
  );
}

const local = StyleSheet.create({
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius,
    paddingHorizontal: 16,
  },
  input: { flex: 1, fontSize: 24, paddingVertical: 14, color: colors.text, minWidth: 0 },
  unit: { fontSize: 18, color: colors.muted, marginLeft: 8 },
  bullet: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  bulletMark: { color: colors.accent, fontSize: 16, fontWeight: '700', lineHeight: 24 },
});
