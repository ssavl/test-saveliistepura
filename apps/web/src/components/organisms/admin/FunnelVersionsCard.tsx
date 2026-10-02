import { AppText, Button, Stack } from '@/components/atoms';
import { CodeBlock, SectionCard, SegmentedControl } from '@/components/molecules';
import type { FunnelAdmin } from '@/hooks/useFunnelAdmin';

import { VersionLog } from './VersionLog';
import { VersionsTable } from './VersionsTable';

export type FunnelVersionsCardProps = Pick<
  FunnelAdmin,
  'funnels' | 'slug' | 'setSlug' | 'info' | 'busy' | 'shown' | 'rollback' | 'toggleJson' | 'refresh'
>;

export function FunnelVersionsCard(props: FunnelVersionsCardProps) {
  const { funnels, slug, setSlug, info, busy, shown, rollback, refresh } = props;
  const options = funnels.map((f) => ({ value: f.slug, label: `${f.slug} (v${f.activeVersion ?? '—'})` }));

  return (
    <SectionCard title="Воронка">
      {options.length ? (
        <SegmentedControl value={slug} options={options} onChange={setSlug} />
      ) : (
        <AppText variant="muted">Нет опубликованных воронок</AppText>
      )}
      {info ? (
        <>
          <Stack direction="row" wrap>
            <AppText>
              Активная версия: <AppText variant="bodyStrong">v{info.activeVersion ?? '—'}</AppText>
            </AppText>
            <Button size="sm" variant="danger" title="Откатить на предыдущую" disabled={busy} onPress={() => rollback()} />
            <Button size="sm" variant="ghost" title="Обновить" onPress={() => void refresh()} />
          </Stack>
          <VersionsTable versions={info.versions} busy={busy} shown={shown} rollback={rollback} toggleJson={props.toggleJson} />
          {shown ? <CodeBlock code={`v${shown.version}\n${shown.json}`} /> : null}
          <VersionLog entries={info.log} />
        </>
      ) : null}
    </SectionCard>
  );
}
