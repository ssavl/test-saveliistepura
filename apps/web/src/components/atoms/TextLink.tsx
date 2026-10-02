import { type Href, Link } from 'expo-router';

import { typography } from '@/theme';

export interface TextLinkProps {
  href: Href;
  label: string;
}

export function TextLink({ href, label }: TextLinkProps) {
  return (
    <Link href={href} style={typography.link}>
      {label}
    </Link>
  );
}
