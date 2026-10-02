import { AppText, Button, Stack, TextField } from '@/components/atoms';
import { IssueList, SectionCard } from '@/components/molecules';
import type { FunnelAdmin } from '@/hooks/useFunnelAdmin';

export type PublishFormProps = Pick<
  FunnelAdmin,
  'files' | 'loadFile' | 'json' | 'setJson' | 'note' | 'setNote' | 'issues' | 'busy' | 'validate' | 'publish'
>;

export function PublishForm(props: PublishFormProps) {
  const { files, json, note, issues, busy } = props;
  const empty = !json.trim();
  return (
    <SectionCard title="Публикация новой версии">
      {files.length ? (
        <Stack direction="row" wrap>
          <AppText variant="muted">Из файла:</AppText>
          {files.map((name) => (
            <Button key={name} size="sm" variant="secondary" title={name} onPress={() => props.loadFile(name)} />
          ))}
        </Stack>
      ) : null}
      <TextField
        variant="code"
        multiline
        value={json}
        onChangeText={props.setJson}
        placeholder="Вставьте JSON конфига"
        autoCorrect={false}
        spellCheck={false}
      />
      <TextField value={note} onChangeText={props.setNote} placeholder="Заметка к версии (необязательно)" />
      <Stack direction="row" wrap>
        <Button size="sm" variant="secondary" title="Проверить" disabled={busy || empty} onPress={props.validate} />
        <Button size="sm" title="Опубликовать" disabled={busy || empty} onPress={props.publish} />
      </Stack>
      {issues ? <IssueList issues={issues} /> : null}
    </SectionCard>
  );
}
