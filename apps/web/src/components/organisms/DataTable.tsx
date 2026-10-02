import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/atoms';
import { colors } from '@/theme';

export interface DataTableColumn<T> {
  title: string;
  width: number;
  render: (row: T) => ReactNode;
  align?: 'left' | 'right';
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: readonly T[];
  rowKey: (row: T, index: number) => string;
  empty?: string;
}

const isPrimitive = (v: ReactNode): v is string | number => typeof v === 'string' || typeof v === 'number';

export function DataTable<T>({ columns, rows, rowKey, empty = 'Нет данных' }: DataTableProps<T>) {
  if (!rows.length) return <AppText variant="muted">{empty}</AppText>;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator>
      <View>
        <View style={[s.row, s.head]}>
          {columns.map((c) => (
            <AppText key={c.title} variant="caption" style={[s.cell, s.headText, { width: c.width, textAlign: c.align ?? 'right' }]}>
              {c.title}
            </AppText>
          ))}
        </View>
        {rows.map((row, i) => (
          <View key={rowKey(row, i)} style={s.row}>
            {columns.map((c) => {
              const content = c.render(row);
              return isPrimitive(content) ? (
                <AppText key={c.title} variant="cell" style={[s.cell, { width: c.width, textAlign: c.align ?? 'right' }]}>
                  {content}
                </AppText>
              ) : (
                <View key={c.title} style={[s.cell, { width: c.width }]}>
                  {content}
                </View>
              );
            })}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderColor: colors.border },
  head: { backgroundColor: colors.bg },
  headText: { fontWeight: '600' },
  cell: { paddingHorizontal: 8, paddingVertical: 8 },
});
