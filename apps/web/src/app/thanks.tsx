import { Link } from 'expo-router';
import { Text, View } from 'react-native';

import { Card, Screen, styles as ui } from '@/components/ui';

export default function ThanksScreen() {
  return (
    <Screen>
      <View style={{ flex: 1, justifyContent: 'center', gap: 16 }}>
        <Card style={{ alignItems: 'center', paddingVertical: 32 }}>
          <Text style={{ fontSize: 44 }}>✓</Text>
          <Text style={[ui.h1, { textAlign: 'center' }]}>Спасибо! План сохранён</Text>
          <Text style={[ui.subtitle, { textAlign: 'center' }]}>Первое чтение будет ждать вас в приложении.</Text>
        </Card>
        <Link href="/f/bible-plan" style={[ui.link, { textAlign: 'center' }]}>
          Вернуться к плану
        </Link>
      </View>
    </Screen>
  );
}
