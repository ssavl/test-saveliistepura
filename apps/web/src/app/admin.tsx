import type { Href } from 'expo-router';

import { Notice } from '@/components/molecules';
import { AdminTokenForm, FunnelVersionsCard, PublishForm } from '@/components/organisms';
import { PageTemplate } from '@/components/templates';
import { useFunnelAdmin } from '@/hooks/useFunnelAdmin';

export default function AdminScreen() {
  const admin = useFunnelAdmin();
  const links = [
    { href: '/dashboard' as Href, label: 'Дашборд →' },
    { href: `/f/${admin.slug}?reset=1` as Href, label: 'Открыть воронку (новая сессия) →' },
  ];

  return (
    <PageTemplate title="Версии воронок" links={links} loading={admin.busy}>
      <AdminTokenForm token={admin.token} setToken={admin.setToken} saveToken={admin.saveToken} />
      {admin.error ? <Notice tone="danger" message={admin.error} /> : null}
      {admin.message ? <Notice tone="success" message={admin.message} /> : null}
      <FunnelVersionsCard {...admin} />
      <PublishForm {...admin} />
    </PageTemplate>
  );
}
