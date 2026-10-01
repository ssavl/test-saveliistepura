import type { ConfigIssue, FunnelAdminDto } from '@funnel/shared';
import { type Href, Link } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { colors, mono } from '@/components/theme';
import { Button, Card, Screen, styles as ui } from '@/components/ui';
import { ADMIN_TOKEN_KEY, api, ApiError, errorMessage } from '@/lib/api';
import { storage } from '@/lib/storage';

const fmtDate = (ts: number) => new Date(ts).toLocaleString('ru-RU');
const DEFAULT_SLUG = 'workstyle-planner';

export default function AdminScreen() {
  const [token, setToken] = useState(() => storage.get(ADMIN_TOKEN_KEY) ?? '');
  const [funnels, setFunnels] = useState<{ slug: string; activeVersion: number | null }[]>([]);
  const [slug, setSlug] = useState(DEFAULT_SLUG);
  const [info, setInfo] = useState<FunnelAdminDto | null>(null);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState<{ version: number; json: string } | null>(null);

  const [files, setFiles] = useState<string[]>([]);
  const [json, setJson] = useState('');
  const [note, setNote] = useState('');
  const [issues, setIssues] = useState<ConfigIssue[] | null>(null);

  const loadFunnels = useCallback(async () => {
    setError(undefined);
    try {
      const list = await api<{ slug: string; activeVersion: number | null }[]>('/api/admin/funnels', { admin: true });
      setFunnels(list);
      setSlug((cur) => cur || list[0]?.slug || '');
      const f = await api<{ files: string[] }>('/api/admin/config-files', { admin: true }).catch(() => ({ files: [] }));
      setFiles(f.files);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  const loadFunnel = useCallback(async (s: string) => {
    if (!s) return;
    try {
      setInfo(await api<FunnelAdminDto>(`/api/admin/funnels/${encodeURIComponent(s)}`, { admin: true }));
    } catch (e) {
      setInfo(null);
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    void loadFunnels();
  }, [loadFunnels]);
  useEffect(() => {
    setShown(null);
    void loadFunnel(slug);
  }, [slug, loadFunnel]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    setMessage(undefined);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const saveToken = () => {
    storage.set(ADMIN_TOKEN_KEY, token.trim());
    void loadFunnels();
  };

  const rollback = (toVersion?: number) =>
    run(async () => {
      const res = await api<FunnelAdminDto>(`/api/admin/funnels/${encodeURIComponent(slug)}/rollback`, {
        admin: true,
        body: toVersion === undefined ? {} : { toVersion },
      });
      setInfo(res);
      setMessage(`Активная версия: v${res.activeVersion}`);
      void loadFunnels();
    });

  const showJson = (version: number) =>
    run(async () => {
      if (shown?.version === version) return setShown(null);
      const res = await api<{ version: number; config: unknown }>(
        `/api/admin/funnels/${encodeURIComponent(slug)}/versions/${version}`,
        { admin: true },
      );
      setShown({ version, json: JSON.stringify(res.config, null, 2) });
    });

  const loadFile = (name: string) =>
    run(async () => {
      const raw = await api<unknown>(`/api/admin/config-files/${encodeURIComponent(name)}`, { admin: true });
      setJson(JSON.stringify(raw, null, 2));
      setIssues(null);
      setMessage(`Загружен ${name}`);
    });

  const parseJson = (): { config: unknown; slug: string } | null => {
    try {
      const config = JSON.parse(json) as { funnelId?: unknown };
      return { config, slug: typeof config?.funnelId === 'string' ? config.funnelId : slug };
    } catch (e) {
      setIssues([{ level: 'error', message: `Невалидный JSON: ${(e as Error).message}` }]);
      return null;
    }
  };

  const validate = () =>
    run(async () => {
      const p = parseJson();
      if (!p) return;
      const res = await api<{ issues: ConfigIssue[] }>('/api/admin/validate', { admin: true, body: { config: p.config } });
      setIssues(res.issues);
    });

  const publish = () =>
    run(async () => {
      const p = parseJson();
      if (!p) return;
      try {
        const res = await api<{ version: number; issues: ConfigIssue[] }>(
          `/api/admin/funnels/${encodeURIComponent(p.slug)}/versions`,
          { admin: true, body: { config: p.config, note: note.trim() || undefined } },
        );
        setIssues(res.issues ?? []);
        setMessage(`Опубликована версия v${res.version} (${p.slug})`);
        setNote('');
        if (p.slug !== slug) setSlug(p.slug);
        else void loadFunnel(p.slug);
        void loadFunnels();
      } catch (e) {
        if (e instanceof ApiError && e.status === 400 && e.body && typeof e.body === 'object' && 'issues' in e.body) {
          setIssues((e.body as { issues: ConfigIssue[] }).issues);
          throw new Error('Публикация отклонена: исправьте ошибки');
        }
        if (e instanceof ApiError && e.status === 409) throw new Error(`Публикация отклонена: ${e.message}`);
        throw e;
      }
    });

  return (
    <Screen maxWidth={960}>
      <View style={s.row}>
        <Text style={ui.h1}>Версии воронок</Text>
      </View>
      <View style={s.row}>
        <Link href="/dashboard" style={ui.link}>
          Дашборд →
        </Link>
        {slug ? (
          <Link href={`/f/${slug}?reset=1` as Href} style={ui.link}>
            Открыть воронку (новая сессия) →
          </Link>
        ) : null}
      </View>

      <Card>
        <Text style={ui.h2}>Admin token</Text>
        <View style={s.row}>
          <TextInput
            value={token}
            onChangeText={setToken}
            placeholder="x-admin-token"
            secureTextEntry
            autoCapitalize="none"
            style={[s.input, { flex: 1, minWidth: 180 }]}
            onSubmitEditing={saveToken}
          />
          <Button small title="Сохранить" onPress={saveToken} />
        </View>
      </Card>

      {error ? <Text style={[ui.error, s.banner, { backgroundColor: colors.dangerSoft }]}>{error}</Text> : null}
      {message ? <Text style={[s.banner, { color: colors.success, backgroundColor: colors.successSoft }]}>{message}</Text> : null}

      <Card>
        <Text style={ui.h2}>Воронка</Text>
        <View style={s.row}>
          {funnels.map((f) => (
            <Button
              key={f.slug}
              small
              variant={f.slug === slug ? 'primary' : 'secondary'}
              title={`${f.slug} (v${f.activeVersion ?? '—'})`}
              onPress={() => setSlug(f.slug)}
            />
          ))}
          {!funnels.length ? <Text style={ui.muted}>Нет опубликованных воронок</Text> : null}
        </View>
        {info ? (
          <>
            <View style={s.row}>
              <Text style={ui.body}>
                Активная версия: <Text style={{ fontWeight: '700' }}>v{info.activeVersion ?? '—'}</Text>
              </Text>
              <Button small variant="danger" title="Откатить на предыдущую" disabled={busy} onPress={() => rollback()} />
              <Button small variant="ghost" title="Обновить" onPress={() => loadFunnel(slug)} />
            </View>
            <ScrollView horizontal>
              <View>
                <View style={[s.tr, s.th]}>
                  <Text style={[s.td, { width: 70 }]}>Версия</Text>
                  <Text style={[s.td, { width: 170 }]}>Создана</Text>
                  <Text style={[s.td, { width: 90 }]}>Статус</Text>
                  <Text style={[s.td, { width: 260 }]}>Release note</Text>
                  <Text style={[s.td, { width: 180 }]}>Заметка</Text>
                  <Text style={[s.td, { width: 80 }]}>Сессии</Text>
                  <Text style={[s.td, { width: 330 }]} />
                </View>
                {info.versions.map((v) => (
                  <View key={v.version} style={s.tr}>
                    <Text style={[s.td, { width: 70, fontWeight: '600' }]}>v{v.version}</Text>
                    <Text style={[s.td, { width: 170 }]}>{fmtDate(v.createdAt)}</Text>
                    <Text style={[s.td, { width: 90 }]}>{v.status ?? '—'}</Text>
                    <Text style={[s.td, { width: 260 }]}>{v.releaseNote ?? '—'}</Text>
                    <Text style={[s.td, { width: 180 }]}>{v.note ?? '—'}</Text>
                    <Text style={[s.td, { width: 80 }]}>{v.sessions}</Text>
                    <View style={[s.td, s.row, { width: 330 }]}>
                      {v.active ? (
                        <Text style={s.badge}>активна</Text>
                      ) : (
                        <Button small variant="secondary" title="Сделать активной" disabled={busy} onPress={() => rollback(v.version)} />
                      )}
                      <Button
                        small
                        variant="ghost"
                        title={shown?.version === v.version ? 'Скрыть JSON' : 'Показать JSON'}
                        onPress={() => showJson(v.version)}
                      />
                    </View>
                  </View>
                ))}
              </View>
            </ScrollView>
            {shown ? (
              <ScrollView style={s.codeBox} nestedScrollEnabled>
                <Text selectable style={s.code}>
                  {`// v${shown.version}\n${shown.json}`}
                </Text>
              </ScrollView>
            ) : null}
            <Text style={[ui.h2, { fontSize: 17, marginTop: 8 }]}>Журнал</Text>
            {info.log.length ? (
              info.log.map((l, i) => (
                <Text key={i} style={s.logLine}>
                  {fmtDate(l.at)} · {l.action} · {l.fromVersion != null ? `v${l.fromVersion}` : '—'} → v{l.toVersion}
                </Text>
              ))
            ) : (
              <Text style={ui.muted}>Пусто</Text>
            )}
          </>
        ) : null}
      </Card>

      <Card>
        <Text style={ui.h2}>Публикация новой версии</Text>
        {files.length ? (
          <View style={s.row}>
            <Text style={ui.muted}>Из файла:</Text>
            {files.map((name) => (
              <Button key={name} small variant="secondary" title={name} onPress={() => loadFile(name)} />
            ))}
          </View>
        ) : null}
        <TextInput
          value={json}
          onChangeText={(t) => {
            setJson(t);
            setIssues(null);
          }}
          multiline
          placeholder="Вставьте JSON конфига"
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          style={[s.input, s.code, { minHeight: 280, textAlignVertical: 'top' }]}
        />
        <TextInput value={note} onChangeText={setNote} placeholder="Заметка к версии (необязательно)" style={s.input} />
        <View style={s.row}>
          <Button small variant="secondary" title="Проверить" disabled={busy || !json.trim()} onPress={validate} />
          <Button small title="Опубликовать" disabled={busy || !json.trim()} onPress={publish} />
        </View>
        {issues ? (
          issues.length ? (
            <View style={{ gap: 6 }}>
              {issues.map((i, k) => (
                <Text
                  key={k}
                  style={[
                    s.issue,
                    i.level === 'error'
                      ? { color: colors.danger, backgroundColor: colors.dangerSoft }
                      : { color: colors.warning, backgroundColor: colors.warningSoft },
                  ]}>
                  {i.level === 'error' ? 'Ошибка' : 'Предупреждение'}
                  {i.variant ? ` [${i.variant}]` : ''}: {i.message}
                </Text>
              ))}
            </View>
          ) : (
            <Text style={{ color: colors.success }}>Замечаний нет</Text>
          )
        ) : null}
      </Card>
    </Screen>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    backgroundColor: '#fff',
    color: colors.text,
  },
  banner: { padding: 12, borderRadius: 10, fontSize: 14 },
  tr: { flexDirection: 'row', borderBottomWidth: 1, borderColor: colors.border, alignItems: 'center' },
  th: { backgroundColor: colors.bg },
  td: { paddingHorizontal: 8, paddingVertical: 8, fontSize: 14, color: colors.text },
  badge: {
    color: colors.success,
    backgroundColor: colors.successSoft,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    fontSize: 13,
    fontWeight: '600',
  },
  codeBox: { maxHeight: 420, backgroundColor: colors.bg, borderRadius: 10, padding: 12 },
  code: { fontFamily: mono, fontSize: 12, color: colors.text },
  logLine: { fontSize: 13, color: colors.muted },
  issue: { padding: 8, borderRadius: 8, fontSize: 13 },
});
