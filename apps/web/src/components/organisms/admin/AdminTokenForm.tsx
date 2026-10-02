import { Button, Stack, TextField } from '@/components/atoms';
import { SectionCard } from '@/components/molecules';
import type { FunnelAdmin } from '@/hooks/useFunnelAdmin';

export type AdminTokenFormProps = Pick<FunnelAdmin, 'token' | 'setToken' | 'saveToken'>;

export function AdminTokenForm({ token, setToken, saveToken }: AdminTokenFormProps) {
  return (
    <SectionCard title="Admin token">
      <Stack direction="row" wrap>
        <TextField
          value={token}
          onChangeText={setToken}
          onSubmitEditing={saveToken}
          placeholder="x-admin-token"
          secureTextEntry
          style={{ flex: 1 }}
        />
        <Button size="sm" title="Сохранить" onPress={saveToken} />
      </Stack>
    </SectionCard>
  );
}
