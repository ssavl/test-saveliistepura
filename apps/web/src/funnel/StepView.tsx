// Renders one funnel step by type. Navigation is left to the caller via onSubmit.
import {
  type AnswerValue,
  type Answers,
  answerKey,
  type Result,
  ResultSchema,
  type ResultResponse,
  type Step,
  validateAnswer,
} from '@funnel/shared';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native';

import { colors, radius } from '@/components/theme';
import { Button, Card, OptionCard, styles as ui } from '@/components/ui';
import { useFunnel } from '@/funnel/FunnelContext';
import { api } from '@/lib/api';
import { flushNow, track } from '@/lib/tracker';

interface Props {
  step: Step;
  answers: Answers;
  onSubmit: (value: AnswerValue | undefined) => string | undefined; // returns an error message, if any
}

type StepOf<T extends Step['type']> = Extract<Step, { type: T }>;

export function StepView(props: Props) {
  const { step } = props;
  switch (step.type) {
    case 'info':
      return <InfoStep {...props} step={step} />;
    case 'single-select':
      return <SingleStep {...props} step={step} />;
    case 'multi-select':
      return <MultiStep {...props} step={step} />;
    case 'number':
      return <NumberStep {...props} step={step} />;
    case 'result':
      return <ResultStep step={step} />;
  }
}

function Header({ title, helper, eyebrow }: { title?: string; helper?: string; eyebrow?: string }) {
  return (
    <View style={{ gap: 8 }}>
      {eyebrow ? <Text style={local.eyebrow}>{eyebrow}</Text> : null}
      {title ? (
        <Text style={ui.h1} accessibilityRole="header">
          {title}
        </Text>
      ) : null}
      {helper ? <Text style={ui.subtitle}>{helper}</Text> : null}
    </View>
  );
}

const initialAnswer = (step: Step, answers: Answers) => {
  const key = answerKey(step);
  return key ? answers[key] : undefined;
};

/**
 * Validation errors appear only after a continue attempt; from then on they follow the current value.
 */
function useSubmitWithErrors(step: Step, value: AnswerValue | undefined, onSubmit: Props['onSubmit']) {
  const [attempted, setAttempted] = useState(false);
  const [submitError, setSubmitError] = useState<string>();
  const check = validateAnswer(step, value);
  const error = attempted ? (check.ok ? submitError : check.error) : undefined;
  const submit = (v: AnswerValue | undefined = value) => {
    setAttempted(true);
    const c = validateAnswer(step, v);
    if (!c.ok) return;
    setSubmitError(onSubmit(v));
  };
  return { error, submit };
}

function InfoStep({ step, onSubmit }: Props & { step: StepOf<'info'> }) {
  const { eyebrow, title, body, primaryActionLabel } = step.content;
  return (
    <View style={{ gap: 20 }}>
      <Header eyebrow={eyebrow} title={title} />
      {body ? (
        <Card>
          <Text style={ui.body}>{body}</Text>
        </Card>
      ) : null}
      <Button title={primaryActionLabel || 'Continue'} onPress={() => onSubmit(undefined)} style={{ marginTop: 8 }} />
    </View>
  );
}

// Single choice submits on tap.
function SingleStep({ step, answers, onSubmit }: Props & { step: StepOf<'single-select'> }) {
  const init = initialAnswer(step, answers);
  const [selected, setSelected] = useState<string | undefined>(typeof init === 'string' ? init : undefined);
  const { error, submit } = useSubmitWithErrors(step, selected, onSubmit);
  return (
    <View style={{ gap: 20 }}>
      <Header title={step.content.title} helper={step.content.helperText} />
      <View style={{ gap: 10 }} accessibilityRole="radiogroup">
        {step.input.options.map((o) => (
          <OptionCard
            key={o.value}
            label={o.label}
            selected={selected === o.value}
            onPress={() => {
              setSelected(o.value);
              submit(o.value);
            }}
          />
        ))}
        {error ? <Text style={ui.error}>{error}</Text> : null}
      </View>
    </View>
  );
}

function MultiStep({ step, answers, onSubmit }: Props & { step: StepOf<'multi-select'> }) {
  const init = initialAnswer(step, answers);
  const [selected, setSelected] = useState<string[]>(Array.isArray(init) ? init : []);
  // Keep option order stable regardless of tap order.
  const ordered = step.input.options.map((o) => o.value).filter((v) => selected.includes(v));
  const { error, submit } = useSubmitWithErrors(step, ordered, onSubmit);
  const max = step.validation.maxSelections;
  const atMax = max !== undefined && selected.length >= max;
  const toggle = (value: string) =>
    setSelected((cur) => (cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value]));
  return (
    <View style={{ gap: 20 }}>
      <Header title={step.content.title} helper={step.content.helperText} />
      <View style={{ gap: 10 }}>
        {step.input.options.map((o) => {
          const on = selected.includes(o.value);
          return (
            <OptionCard key={o.value} multi label={o.label} selected={on} disabled={!on && atMax} onPress={() => toggle(o.value)} />
          );
        })}
        {error ? <Text style={ui.error}>{error}</Text> : null}
        <Button title="Continue" onPress={() => submit()} style={{ marginTop: 8 }} />
      </View>
    </View>
  );
}

function NumberStep({ step, answers, onSubmit }: Props & { step: StepOf<'number'> }) {
  const init = initialAnswer(step, answers);
  const [text, setText] = useState(typeof init === 'number' ? String(init) : '');
  const normalized = text.trim().replace(',', '.');
  const value = normalized === '' ? undefined : Number(normalized);
  const { error, submit } = useSubmitWithErrors(step, value, onSubmit);
  const { min, max, unit } = step.input;
  return (
    <View style={{ gap: 20 }}>
      <Header title={step.content.title} helper={step.content.helperText} />
      <View style={{ gap: 10 }}>
        <View style={[local.inputRow, error ? { borderColor: colors.danger } : null]}>
          <TextInput
            value={text}
            onChangeText={(t) => setText(t.replace(/[^0-9.,]/g, ''))}
            keyboardType="numeric"
            inputMode="numeric"
            placeholderTextColor={colors.muted}
            style={local.input}
            autoFocus
            onSubmitEditing={() => submit()}
            accessibilityLabel={step.content.title}
          />
          {unit ? <Text style={local.unit}>{unit}</Text> : null}
        </View>
        {error ? (
          <Text style={ui.error}>{error}</Text>
        ) : min !== undefined && max !== undefined ? (
          <Text style={ui.muted}>
            From {min} to {max}
            {unit ? ` ${unit}` : ''}
          </Text>
        ) : null}
        <Button title="Continue" onPress={() => submit()} style={{ marginTop: 8 }} />
      </View>
    </View>
  );
}

type ResultState = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; result: Result };

function ResultStep({ step }: { step: StepOf<'result'> }) {
  const f = useFunnel();
  const [state, setState] = useState<ResultState>({ kind: 'loading' });
  const [expanded, setExpanded] = useState(false);
  const viewed = useRef<string | null>(null);
  const { loadingTitle, errorTitle, retryLabel } = step.content;

  const load = async () => {
    setState({ kind: 'loading' });
    const d = f.getData();
    if (!d) return;
    try {
      // The result is computed from stored answers, so the latest state must reach the server first.
      if (!(await f.awaitPersist())) throw new Error('state not saved');
      const res = await api<ResultResponse>(`/api/sessions/${d.session.id}/result`);
      setState({ kind: 'ready', result: ResultSchema.parse(res.result) });
    } catch (e) {
      console.warn('[funnel] result failed', e);
      setState({ kind: 'error' });
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const result = state.kind === 'ready' ? state.result : null;
  useEffect(() => {
    if (!result || viewed.current === result.id) return;
    viewed.current = result.id;
    track('result_viewed', step.id, { result_id: result.id });
  }, [result, step.id]);

  if (state.kind === 'loading') {
    return (
      <View style={local.center}>
        <ActivityIndicator color={colors.accent} size="large" />
        <Text style={[ui.h2, { textAlign: 'center' }]}>{loadingTitle || 'Loading…'}</Text>
      </View>
    );
  }
  if (state.kind === 'error' || !result) {
    return (
      <View style={local.center}>
        <Text style={[ui.h2, { textAlign: 'center' }]}>{errorTitle || 'Something went wrong'}</Text>
        <Button title={retryLabel || 'Try again'} onPress={() => void load()} style={{ alignSelf: 'stretch' }} />
      </View>
    );
  }

  const onCta = () => {
    const { action } = result.cta;
    track('cta_clicked', step.id, { result_id: result.id, action });
    if (action === 'expand_recommendation' && !expanded) {
      setExpanded(true);
      if (f.getData()?.funnel.events.recommendation_expanded) {
        track('recommendation_expanded', step.id, { result_id: result.id, action, source: 'cta' });
      }
    }
    void flushNow();
  };

  return (
    <View style={{ gap: 20 }}>
      <Header title={result.title} />
      {result.summary ? (
        <Card style={{ backgroundColor: colors.accentSoft, borderColor: colors.accentSoft }}>
          <Text style={[ui.body, { fontSize: 17 }]}>{result.summary}</Text>
        </Card>
      ) : null}
      <Button title={result.cta.label} onPress={onCta} />
      {expanded && result.recommendations.length ? (
        <View style={{ gap: 10 }} accessibilityRole="list">
          {result.recommendations.map((r, i) => (
            <View key={i} style={local.bullet}>
              <Text style={local.bulletMark}>{i + 1}.</Text>
              <Text style={[ui.body, { flex: 1 }]}>{r}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const local = StyleSheet.create({
  eyebrow: { color: colors.accent, fontSize: 14, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
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
  center: { alignItems: 'center', justifyContent: 'center', gap: 16, paddingVertical: 48 },
  bullet: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  bulletMark: { color: colors.accent, fontSize: 16, fontWeight: '700', lineHeight: 24, minWidth: 20 },
});
