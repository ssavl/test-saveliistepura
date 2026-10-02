import { Stack, useLocalSearchParams } from 'expo-router';

import { FunnelProvider } from '@/context/FunnelContext';

export default function FunnelLayout() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  return (
    <FunnelProvider key={slug} slug={slug}>
      <Stack screenOptions={{ headerShown: false }} />
    </FunnelProvider>
  );
}
