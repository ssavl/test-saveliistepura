type Maybe<T> = T | null | undefined;

export const pct = (v: Maybe<number>) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`);

export const signedPct = (v: Maybe<number>) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`);

export const pp = (v: Maybe<number>) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)} п.п.`);

export const interval = (c: Maybe<[number, number]>) => (c ? `${pct(c[0])} … ${pct(c[1])}` : '—');

export const pValue = (p: Maybe<number>) => (p == null ? '—' : p < 0.001 ? '< 0.001' : p.toFixed(3));

export const dateTime = (ts: number) => new Date(ts).toLocaleString('ru-RU');

export const time = (ts: number) => new Date(ts).toLocaleTimeString('ru-RU');

export const orDash = (v: Maybe<string | number>) => (v == null || v === '' ? '—' : String(v));
