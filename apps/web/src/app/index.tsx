import { Redirect, useLocalSearchParams } from 'expo-router';

// Default entry: the demo funnel. Query params (utm_*, variant, reset) are forwarded.
export default function Index() {
  const params = useLocalSearchParams<Record<string, string>>();
  return <Redirect href={{ pathname: '/f/[slug]', params: { ...params, slug: 'bible-plan' } }} />;
}
