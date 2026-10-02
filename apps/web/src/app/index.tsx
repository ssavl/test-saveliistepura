import { Redirect, useLocalSearchParams } from 'expo-router';

export default function Index() {
  const params = useLocalSearchParams<Record<string, string>>();
  return <Redirect href={{ pathname: '/f/[slug]', params: { ...params, slug: 'workstyle-planner' } }} />;
}
