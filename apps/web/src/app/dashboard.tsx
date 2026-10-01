import type { AnalyticsResponse, GroupMetrics } from '@funnel/shared';
import { Link } from 'expo-router';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { colors } from '@/components/theme';
import { Button, Card, Screen, styles as ui } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { storage } from '@/lib/storage';

const pct = (v: number | null | undefined) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`);
const pp = (v: number | null | undefined) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)} п.п.`);
const ci = (c: [number, number] | null) => (c ? `${pct(c[0])} … ${pct(c[1])}` : '—');
const SLUG_KEY = 'funnel:dashboard:slug';
const DEFAULT_SLUG = 'workstyle-planner';

type Col<T> = { title: string; width: number; render: (row: T) => ReactNode; align?: 'left' | 'right' };

function Table<T>({ cols, rows, empty = 'Нет данных' }: { cols: Col<T>[]; rows: T[]; empty?: string }) {
  if (!rows.length) return <Text style={ui.muted}>{empty}</Text>;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator>
      <View>
        <View style={[s.tr, s.th]}>
          {cols.map((c, i) => (
            <Text key={i} style={[s.td, s.thText, { width: c.width, textAlign: c.align ?? 'right' }]}>
              {c.title}
            </Text>
          ))}
        </View>
        {rows.map((r, ri) => (
          <View key={ri} style={s.tr}>
            {cols.map((c, ci2) => {
              const content = c.render(r);
              return typeof content === 'string' || typeof content === 'number' ? (
                <Text key={ci2} style={[s.td, { width: c.width, textAlign: c.align ?? 'right' }]}>
                  {content}
                </Text>
              ) : (
                <View key={ci2} style={[s.td, { width: c.width }]}>
                  {content}
                </View>
              );
            })}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const groupCols = (keyTitle: string, keyFmt: (k: string) => string = (k) => k): Col<GroupMetrics>[] => [
  { title: keyTitle, width: 120, align: 'left', render: (g) => keyFmt(g.key) },
  { title: 'Начали', width: 80, render: (g) => g.started },
  { title: 'Результат', width: 90, render: (g) => g.resultViewed },
  { title: 'CTA', width: 70, render: (g) => g.ctaClicked },
  { title: 'До результата', width: 110, render: (g) => pct(g.resultRate) },
  { title: 'CTR CTA', width: 90, render: (g) => pct(g.ctr) },
  { title: 'CTA от старта', width: 110, render: (g) => pct(g.ctaConversion) },
  { title: '95% CI', width: 150, render: (g) => ci(g.ctaConversionCi) },
];

function Select({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={s.label}>{label}</Text>
      <View style={s.row}>
        {options.map((o) => (
          <Button key={o.value} small variant={o.value === value ? 'primary' : 'secondary'} title={o.label} onPress={() => onChange(o.value)} />
        ))}
      </View>
    </View>
  );
}

function Kpi({ title, value, sub, primary }: { title: string; value: string; sub?: string; primary?: boolean }) {
  return (
    <Card style={[s.kpi, primary && { borderColor: colors.accent, backgroundColor: colors.accentSoft }]}>
      <Text style={s.label}>{title}</Text>
      <Text style={s.kpiValue}>{value}</Text>
      {sub ? <Text style={s.kpiSub}>{sub}</Text> : null}
    </Card>
  );
}

export default function DashboardScreen() {
  const [slug, setSlug] = useState(() => storage.get(SLUG_KEY) ?? DEFAULT_SLUG);
  const [slugDraft, setSlugDraft] = useState(slug);
  const [version, setVersion] = useState('all');
  const [variant, setVariant] = useState('all');
  const [campaign, setCampaign] = useState('all');
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [auto, setAuto] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const reqId = useRef(0);

  const load = useCallback(async () => {
    const id = ++reqId.current;
    setLoading(true);
    const q = new URLSearchParams({ slug });
    if (version !== 'all') q.set('version', version);
    if (variant !== 'all') q.set('variant', variant);
    if (campaign !== 'all') q.set('utm_campaign', campaign);
    try {
      const res = await api<AnalyticsResponse>(`/api/analytics?${q}`, { admin: true });
      if (id !== reqId.current) return;
      setData(res);
      setError(undefined);
      setUpdatedAt(Date.now());
    } catch (e) {
      if (id === reqId.current) setError(errorMessage(e));
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [slug, version, variant, campaign]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!auto) return;
    const t = setInterval(() => void load(), 10000);
    return () => clearInterval(t);
  }, [auto, load]);

  const applySlug = () => {
    const v = slugDraft.trim();
    if (!v) return;
    storage.set(SLUG_KEY, v);
    setVersion('all');
    setCampaign('all');
    setSlug(v);
  };

  const t = data?.totals;
  const maxReach = Math.max(1, ...(data?.steps ?? []).map((st) => st.viewed));
  const ab = data?.abTest;

  return (
    <Screen maxWidth={1100}>
      <View style={s.row}>
        <Text style={[ui.h1, { flex: 1 }]}>Аналитика воронки</Text>
        {loading ? <ActivityIndicator color={colors.accent} /> : null}
      </View>
      <View style={s.row}>
        <Link href="/admin" style={ui.link}>
          Версии →
        </Link>
        <Link href={{ pathname: '/f/[slug]', params: { slug, reset: '1' } }} style={ui.link}>
          Открыть воронку →
        </Link>
      </View>

      <Card>
        <View style={{ gap: 6 }}>
          <Text style={s.label}>Воронка (slug)</Text>
          <View style={s.row}>
            <TextInput value={slugDraft} onChangeText={setSlugDraft} onSubmitEditing={applySlug} autoCapitalize="none" style={s.input} />
            <Button small variant="secondary" title="Применить" onPress={applySlug} />
          </View>
        </View>
        <Select
          label="Версия"
          value={version}
          onChange={setVersion}
          options={[{ value: 'all', label: 'Все' }, ...(data?.versions ?? []).map((v) => ({ value: String(v), label: `v${v}` }))]}
        />
        <Select
          label="Вариант"
          value={variant}
          onChange={setVariant}
          options={[
            { value: 'all', label: 'Все' },
            { value: 'A', label: 'A' },
            { value: 'B', label: 'B' },
          ]}
        />
        <Select
          label="utm_campaign"
          value={campaign}
          onChange={setCampaign}
          options={[{ value: 'all', label: 'Все' }, ...(data?.campaigns ?? []).map((c) => ({ value: c, label: c }))]}
        />
        <View style={s.row}>
          <Button small title="Обновить" onPress={() => void load()} disabled={loading} />
          <Switch value={auto} onValueChange={setAuto} />
          <Text style={ui.muted}>Автообновление каждые 10 с</Text>
          {updatedAt ? <Text style={s.kpiSub}>обновлено {new Date(updatedAt).toLocaleTimeString('ru-RU')}</Text> : null}
        </View>
      </Card>

      {error ? <Text style={[ui.error, s.banner]}>{error}</Text> : null}

      {data && t ? (
        <>
          <View style={s.kpis}>
            <Kpi title="Начали" value={String(t.started)} sub={`не дошли до 1-го шага: ${t.droppedBeforeFirstStep}`} />
            <Kpi title="Дошли до результата" value={pct(t.resultRate)} sub={`${t.resultViewed} сессий`} />
            <Kpi title="CTR CTA" value={pct(t.ctr)} sub={`${t.ctaClicked} кликов / ${t.resultViewed}`} />
            <Kpi primary title="CTA-конверсия от старта" value={pct(t.ctaConversion)} sub={`95% CI ${ci(t.ctaConversionCi)}`} />
          </View>

          <Card>
            <Text style={ui.h2}>Шаги</Text>
            <Table
              rows={data.steps}
              cols={[
                {
                  title: 'Шаг',
                  width: 170,
                  align: 'left',
                  render: (st) => (
                    <Text style={s.tdText}>
                      {st.stepId} <Text style={s.kpiSub}>{st.type ?? '?'}</Text>
                    </Text>
                  ),
                },
                { title: 'Увидели', width: 80, render: (st) => st.viewed },
                { title: 'Завершили', width: 90, render: (st) => st.completed },
                { title: 'Конв. шага', width: 90, render: (st) => pct(st.conversion) },
                {
                  title: 'Охват от старта',
                  width: 200,
                  align: 'left',
                  render: (st) => (
                    <View style={s.barRow}>
                      <View style={s.barTrack}>
                        <View style={[s.barFill, { width: `${Math.min(1, st.reach ?? st.viewed / maxReach) * 100}%` }]} />
                      </View>
                      <Text style={[s.tdText, { width: 56, textAlign: 'right' }]}>{pct(st.reach)}</Text>
                    </View>
                  ),
                },
                { title: 'Отвал', width: 70, render: (st) => st.dropped },
                { title: 'Назад', width: 70, render: (st) => st.backClicks },
              ]}
            />
          </Card>

          <Card>
            <Text style={ui.h2}>A/B</Text>
            <Table rows={data.byVariant} cols={groupCols('Вариант')} />
            <Text style={ui.body}>
              Лифт B − A: {pp(ab?.liftAbs)} ({ab?.liftRel == null ? '—' : `${ab.liftRel >= 0 ? '+' : ''}${(ab.liftRel * 100).toFixed(1)}%`}), p-value:{' '}
              {ab?.pValue == null ? '—' : ab.pValue < 0.001 ? '< 0.001' : ab.pValue.toFixed(3)}
              {ab?.pValue != null ? (ab.pValue < 0.05 ? ' — значимо (α = 0.05)' : ' — не значимо') : ''}
            </Text>
          </Card>

          <Card>
            <Text style={ui.h2}>Результаты</Text>
            <Table
              rows={data.byResult ?? []}
              cols={[
                { title: 'Результат', width: 180, align: 'left', render: (g) => g.key },
                { title: 'Увидели (сессии)', width: 130, render: (g) => g.started },
                { title: 'Клики CTA', width: 100, render: (g) => g.ctaClicked },
                { title: 'CTR', width: 90, render: (g) => pct(g.ctr) },
              ]}
            />
          </Card>

          <Card>
            <Text style={ui.h2}>Версии</Text>
            <Table rows={data.byVersion} cols={groupCols('Версия', (k) => `v${k}`)} />
          </Card>

          <Card>
            <Text style={ui.h2}>Кампании (utm_campaign)</Text>
            <Table rows={data.byCampaign} cols={groupCols('Кампания')} />
          </Card>

          <Card>
            <Text style={ui.h2}>Другие события</Text>
            <Table
              rows={data.otherEvents}
              empty="Событий из конфига пока нет"
              cols={[
                { title: 'Событие', width: 220, align: 'left', render: (e) => e.name },
                { title: 'Сессии', width: 90, render: (e) => e.sessions },
                { title: 'События', width: 90, render: (e) => e.events },
                { title: '% от старта', width: 100, render: (e) => pct(t.started ? e.sessions / t.started : null) },
              ]}
            />
          </Card>

          <Text style={s.kpiSub}>
            Все показатели — по уникальным сессиям; raw events: {data.eventCounts.raw} (сессий с событиями: {data.eventCounts.sessions}).
          </Text>
        </>
      ) : null}
    </Screen>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
  label: { fontSize: 13, color: colors.muted, fontWeight: '500' },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 15,
    backgroundColor: '#fff',
    minWidth: 160,
    color: colors.text,
  },
  banner: { padding: 12, borderRadius: 10, backgroundColor: colors.dangerSoft },
  kpis: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  kpi: { flexGrow: 1, flexBasis: 200, gap: 4 },
  kpiValue: { fontSize: 28, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  kpiSub: { fontSize: 12, color: colors.muted },
  tr: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderColor: colors.border },
  th: { backgroundColor: colors.bg },
  thText: { fontSize: 12, fontWeight: '600', color: colors.muted },
  td: { paddingHorizontal: 8, paddingVertical: 8, fontSize: 14, color: colors.text, fontVariant: ['tabular-nums'] },
  tdText: { fontSize: 14, color: colors.text },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  barTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: colors.border, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4, backgroundColor: colors.accent },
});
