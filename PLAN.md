# Funnel Runtime — план реализации

Срок: 48 ч (включая вторую итерацию). Стек: TypeScript везде, Expo (React Native Web) + Node.js (Fastify) + SQLite (`node:sqlite`), один репозиторий, npm workspaces.

## 0. Допущения

- **Frontend — Expo Router с web-таргетом** (react-native-web подходит под «React или аналогичный»). Основная платформа — web: публичный URL, query-параметры (UTM, `?variant=`). Тот же код работает на iOS/Android.
- **Контент конфигов** — онбординг вымышленного приложения «Orthodox Bible» (цель чтения → опыт → время в день → план → результат + CTA «Начать план» на пейволл). Два исходных конфига ТЗ нам не передали, поэтому пишем свои: `configs/v1.json`, `configs/v2.json`.
- Никаких сторонних сервисов: без Firebase, AdMob и RevenueCat из privacy policy — события и аналитика только свои.
- Один процесс Node раздаёт API и статический web-экспорт → один публичный URL (Render/Fly/Railway с persistent disk для SQLite).

## 1. Структура репозитория

```
apps/web        Expo app: /f/[slug] (воронка), /admin (версии), /dashboard (аналитика)
apps/server     Fastify API + SQLite + генератор трафика + тесты
packages/shared zod-схемы конфига и событий, движок воронки (чистые функции)
configs/        JSON-конфиги (v1, v2 для второй итерации)
```

**Движок воронки в `shared`**: `resolveNext(config, answers, stepId)`, `reachablePath(config, answers)` для прогресса, `applyVariant(config, variant)`, `validateAnswer(step, value)`. Его используют и клиент, и сервер (валидация + генератор трафика), тестируется один раз.

## 2. Модель данных (SQLite)

| Таблица | Поля | Заметки |
|---|---|---|
| `funnel_versions` | id, slug, version, config_json, created_at, published_by | append-only, никогда не мутируется |
| `funnel_active` | slug PK, version_id, updated_at | указатель; publish/rollback = смена указателя |
| `version_log` | id, slug, action(publish/rollback), from_version, to_version, at | история для админки |
| `sessions` | id PK, slug, version_id, variant, utm_json, state_json, created_at, updated_at | версия и вариант фиксируются при создании |
| `events` | event_id PK, session_id, name, step_id, funnel_version, variant, utm_campaign, utm_json, props_json, client_ts, server_ts | `INSERT OR IGNORE` → идемпотентность |
| `schema_migrations` | version | миграции применяются кодом на старте |

- `name` у события — открытое множество (TEXT), поэтому новое событие во второй итерации не требует изменения схемы.
- Состояние сессии (ответы, история шагов) хранится на сервере (`state_json`) плюс `session_id` в localStorage — это и есть восстановление после refresh и повторного открытия. Шаг берётся из URL/истории, поэтому back работает.

## 3. API

```
POST /api/sessions            {slug, utm, variantOverride?, sessionId?} -> {session, config}
                              есть живая sessionId -> вернуть её (с её версией конфига)
GET  /api/sessions/:id        восстановление
PUT  /api/sessions/:id/state  {answers, history} (последний пишущий побеждает, с проверкой revision)
POST /api/events              {events:[...]} -> {accepted:[ids], duplicates:[ids], rejected:[{id,reason}]}
GET  /api/admin/versions?slug
POST /api/admin/versions      {slug, config} -> валидация zod + проверка графа -> publish
POST /api/admin/rollback      {slug, toVersion?}
GET  /api/analytics?slug&version&variant&utm_campaign
```

- **Назначение варианта**: на сервере, `hash(session_id + experiment.key) < splitB` → B; override `?variant=B` сохраняется в сессию. Стабилен, так как хранится в `sessions`.
- **Закрепление версии**: сессия всегда рендерится из `funnel_versions[session.version_id]`, а не из активной версии. Новые сессии получают активную.
- **Валидация публикации**: все `next.to` существуют, есть достижимый result, нет недостижимых шагов (warning), минимум 6 шагов, есть ветвление.

## 4. События

Поля: `event_id` (uuid, генерирует клиент), `session_id`, `name`, `step_id`, `funnel_version`, `variant`, `utm`, `client_ts`, `server_ts` (ставит сервер), `props`.

- Батчинг на клиенте: очередь в localStorage, flush по таймеру (2 с), по 10 событиям или на `pagehide` (`sendBeacon`). Ретрай с тем же `event_id` безопасен.
- Каждое событие валидируется отдельно; невалидное попадает в `rejected`, остальные записываются в одной транзакции.
- **Приватность**: `answer_submitted` несёт только `option_ids` для single/multi и **бакет** для числа (например, `10-20 мин`), а не сырое значение. Сырые ответы живут только в `sessions.state_json` для работы воронки.

## 5. Правила агрегации (dashboard)

Всё считается по `COUNT(DISTINCT session_id)` и не зависит от числа или порядка событий:
- **Начали** = сессии с `session_started` ИЛИ любым событием (устойчиво к потере или переупорядочиванию).
- **Дошли до шага X** = distinct-сессии с `step_viewed(step_id=X)`; повторные просмотры и back не удваивают.
- **Конверсия шага** = завершили(X) / увидели(X); **отвал на X** = увидели X, но максимальный достигнутый шаг — X (без `step_completed` на X и без событий дальше).
- Порядок воронки для отчёта берётся из **конфига версии** (канонический путь + ветки), а не из порядка событий; `client_ts` не участвует в логике, только в отображении.
- **Результат** = distinct `result_viewed`; **CTR CTA** = distinct `cta_clicked` / distinct `result_viewed`.
- Срезы: variant, version, utm_campaign. Для A/B — основная метрика с доверительным интервалом (Wilson) и размерами выборок.

## 6. A/B-гипотеза (черновик)

> Если в варианте B убрать информационный экран «О приложении» и показать персональный план раньше (результат с конкретным планом «N минут в день, M недель»), доля сессий с кликом по CTA вырастет, потому что пользователь быстрее видит ценность.

**Основная метрика**: CTA-конверсия от начала = `distinct cta_clicked / distinct session_started`. Защитные метрики: доля дошедших до результата, отвал на первом экране.

## 7. Генератор трафика (`npm run traffic`)

Скрипт ходит в реальный HTTP API: ≥150 сессий, UTM-кампании (`tg_ads`, `vk_retarget`, `organic`), override A/B, случайные ветки через движок из `shared`, отвал с вероятностью по шагам, back-клики, дубликаты `event_id`, повторная отправка целой пачки, перемешанный порядок в части пачек. Плюс `--seed` для воспроизводимости и итоговая сводка «ожидаемых» чисел для сверки с dashboard.

## 8. Тесты (vitest)

1. Сессия, созданная на v1, после публикации v2 продолжает получать v1; новая сессия получает v2.
2. Вариант стабилен при повторном `POST /sessions` с тем же id; override работает.
3. Дубль `event_id` в одной пачке и между пачками → одна запись; невалидное событие не ломает пачку.
4. Publish → rollback → активна предыдущая; сессии, созданные на откаченной версии, продолжают работать.
5. Аналитика на фиксированном наборе событий (с дублями, back и перепутанным порядком) даёт ожидаемые числа.
6. Движок: ветвление, прогресс только по доступным шагам, валидация.

## 9. Этапы и таймлайн

| # | Этап | Часы | Параллелизм (агенты) |
|---|---|---|---|
| M0 | Каркас монорепо, Expo, сервер, SQLite ✅ | 1 | — |
| M1 | `shared`: схемы, движок, тесты; `configs/v1.json` | 4 | A: engine+tests, B: конфиг-контент |
| M2 | Сервер: миграции, versions/publish/rollback, sessions, events ingest + тесты | 6 | A: versions+sessions, B: events ingest |
| M3 | Web: FunnelRunner, 5 типов экранов, прогресс, восстановление, трекер событий | 7 | после M1 |
| M4 | Admin-страница (список, активная, publish JSON, rollback) | 2 | параллельно M3 |
| M5 | Аналитика: SQL-агрегаты + тесты + dashboard | 6 | A: SQL+tests, B: UI |
| M6 | Генератор трафика, сверка с dashboard | 3 | |
| M7 | Деплой, README (модель данных, event schema, агрегация, гипотеза, ограничения) | 3 | |
| M8 | **Итерация 2**: `v2.json` (новая ветка, минус экран для B, новое событие) → publish → проверка старых сессий → rollback | 3 | |
| — | Ревью кода агентов, регрессии, запас | 5 | |

**Процесс работы с агентами**: каждый этап — отдельная ветка; агентам даётся узкая задача с контрактом из `shared`; результат принимается только после прохождения тестов и ручного ревью диффа. В README ведём журнал: что делал агент и что правили руками.

## 10. Риски

- Старая сессия стоит на шаге, удалённом в новой версии → невозможно, потому что сессия закреплена на своей версии. Если конфиг версии отсутствует, используется graceful fallback на старт.
- SQLite на хостинге без persistent disk → выбрать платформу с volume (Fly/Railway/Render disk).
- `node:sqlite` требует Node ≥ 22.13 (зафиксировано в `engines`).
