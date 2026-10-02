import type { ConfigIssue } from '@funnel/shared';

import { AppText, Stack } from '@/components/atoms';

import { Notice } from './Notice';

export interface IssueListProps {
  issues: ConfigIssue[];
}

const describe = (i: ConfigIssue) =>
  `${i.level === 'error' ? 'Ошибка' : 'Предупреждение'}${i.variant ? ` [${i.variant}]` : ''}: ${i.message}`;

export function IssueList({ issues }: IssueListProps) {
  if (!issues.length) return <AppText color="success">Замечаний нет</AppText>;
  return (
    <Stack gap="sm">
      {issues.map((issue, k) => (
        <Notice key={k} tone={issue.level === 'error' ? 'danger' : 'warning'} message={describe(issue)} />
      ))}
    </Stack>
  );
}
