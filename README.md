# Funnel Runtime

Мини-платформа для многошаговых веб-воронок:
- экраны описываются JSON-конфигом, на фронтенде нет захардкоженных экранов;
- конфиги версионируются, публикация и откат идут без передеплоя;
- A/B-вариант назначается на сервере;
- собственный идемпотентный приём событий;
- dashboard по уникальным сессиям;
- генератор синтетического трафика, который сверяет свои ожидания с аналитикой сервера.

| | |
|---|---|
| **Публичный URL** | https://web-production-eee72.up.railway.app |
| Воронка | https://web-production-eee72.up.railway.app/ → `/f/workstyle-planner` |
| Управление версиями | https://web-production-eee72.up.railway.app/admin (нужен `ADMIN_TOKEN`, передаётся отдельно) |
| Аналитика | https://web-production-eee72.up.railway.app/dashboard |
| **Репозиторий** | https://github.com/ssavl/test-saveliistepura |

Конфиги взяты из задания без изменений: `configs/funnel-v1.json`, `funnel-v2.json` и `funnel-v3.json` (вторая итерация), воронка `workstyle-planner`. Рантайм понимает их формат напрямую, без конвертации.

**Состояние прода:**
- v1, v2 и v3 опубликованы по очереди, на каждой версии по 160 синтетических сессий;
- после проверки v3 выполнен откат, **активна v2**.

---

## Содержание

1. [Быстрый старт](#быстрый-старт)
2. [Стек и структура](#стек-и-структура)
3. [Запуск и конфигурация](#запуск-и-конфигурация)
4. [Страницы веб-приложения](#страницы-веб-приложения)
5. [HTTP API](#http-api)
6. [Формат конфига воронки](#формат-конфига-воронки)
7. [Сессии, версии и A/B](#сессии-версии-и-ab)
8. [События](#события)
9. [Аналитика и правила агрегации](#аналитика-и-правила-агрегации)
10. [База данных](#база-данных)
11. [Генератор трафика](#генератор-трафика)
12. [Вторая итерация](#вторая-итерация-funnel-v3json)
13. [Тесты](#тесты)
14. [Деплой](#деплой)
15. [Допущения и ограничения](#допущения-и-ограничения)
16. [Таймлайн и работа с агентами](#таймлайн-и-работа-с-агентами)

---

## Быстрый старт

Нужен Node.js ≥ 22.13 (используется 24).

```bash
npm install
npm test                 # 40 тестов: движок + сервер
npm run build            # web-экспорт в apps/web/dist
npm start                # http://localhost:3000 — API + web; при первом старте публикуется funnel-v1.json
npm run traffic          # 160 синтетических сессий → откройте http://localhost:3000/dashboard
```

Прогнать всю историю версий на одном сервере:

```bash
npm run traffic -- --seed 1                                      # трафик на v1
npm run traffic -- --seed 2 --publish configs/funnel-v2.json     # публикует v2 и даёт трафик на неё
npm run traffic -- --seed 3 --publish configs/funnel-v3.json     # вторая итерация
curl -X POST localhost:3000/api/admin/funnels/workstyle-planner/rollback \
  -H 'content-type: application/json' -d '{}'                    # откат на v2
```

---

## Стек и структура

| Слой | Технологии |
|---|---|
| Frontend | Expo SDK 57 + Expo Router, web-таргет (react-native-web), SPA-экспорт |
| Backend | Node.js, Fastify 5, TypeScript через `tsx` (без шага сборки) |
| Хранилище | SQLite через встроенный модуль `node:sqlite` (без нативных зависимостей) |
| Общий код | `packages/shared`: zod-схема конфига, движок воронки, схема событий, HTTP-контракт |
| Тесты | Vitest |

```
packages/shared/src/
  config.ts       zod-схема официального формата конфига
  engine.ts       чистые функции: варианты, видимость шагов, переходы, прогресс, валидация, результат,
                  проверка конфига
  events.ts       схема события (конверт), список шаговых событий, лимит пачки
  api.ts          HTTP-контракт: все эндпоинты в шапке-комментарии + типы запросов и ответов
apps/server/src/
  index.ts        точка входа: переменные окружения, открытие БД, публикация funnel-v1 при пустой БД
  app.ts          все HTTP-роуты, CORS, проверка admin-токена, раздача веб-сборки
  db.ts           SQLite, миграции, транзакции
  versions.ts     публикация, откат, кэш конфигов версий
  sessions.ts     создание и восстановление сессий, A/B, TTL, сохранение состояния, результат
  ingest.ts       приём событий
  analytics.ts    расчёт метрик
  traffic.ts, traffic/   генератор трафика
apps/web/src/
  app/            маршруты Expo Router: /, /f/[slug]/[step], /admin, /dashboard
  funnel/         FunnelContext (владелец сессии) и StepView (рендер шагов)
  lib/            api-клиент, storage, трекер событий
configs/          funnel-v1.json, funnel-v2.json, funnel-v3.json (не редактируются)
```

Один процесс Node раздаёт и API, и собранный web-клиент, поэтому всё работает на одном URL.

---

## Запуск и конфигурация

### Скрипты (корень репозитория)

| Команда | Что делает |
|---|---|
| `npm start` | сервер (`tsx apps/server/src/index.ts`) + раздача `apps/web/dist` |
| `npm run build` | `expo export --platform web` → `apps/web/dist` |
| `npm test` | vitest в `packages/shared` и `apps/server` |
| `npm run typecheck` | `tsc --noEmit` во всех пакетах |
| `npm run dev:server` | сервер с перезапуском при изменениях |
| `npm run dev:web` | Expo dev server (порт 8081) с hot reload |
| `npm run traffic -- …` | генератор трафика (см. [ниже](#генератор-трафика)) |

Разработка web с hot reload: `npm run dev:server` в одном терминале и `EXPO_PUBLIC_API_URL=http://localhost:3000 npm run dev:web` в другом. Сервер отвечает с CORS-заголовками, поэтому dev-клиент на :8081 может к нему обращаться.

### Переменные окружения сервера

| Переменная | По умолчанию | Назначение |
|---|---|---|
| `PORT` | `3000` | порт HTTP |
| `DB_PATH` | `apps/server/data/funnel.sqlite` | файл SQLite (создаётся автоматически) |
| `CONFIGS_DIR` | `configs` | папка с JSON-конфигами (для админки и сида) |
| `SEED_CONFIG` | `configs/funnel-v1.json` | что публиковать при первом старте с пустой БД |
| `WEB_DIR` | `apps/web/dist` | собранный web-клиент |
| `ADMIN_TOKEN` | — | если задан, `/api/admin/*` требует заголовок `x-admin-token` |
| `LOG` | — | `0` выключает логи запросов |

Клиентская переменная: `EXPO_PUBLIC_API_URL`, базовый URL API для dev-режима. В продакшене пусто, то есть тот же origin.

---

## Страницы веб-приложения

| Путь | Описание |
|---|---|
| `/` | редирект на `/f/workstyle-planner` с сохранением query-параметров |
| `/f/:slug` | загрузка или создание сессии, переход на текущий шаг |
| `/f/:slug/:stepId` | экран шага. URL отражает текущий шаг, поэтому refresh и кнопка «Назад» в браузере работают |
| `/admin` | версии: список, активная версия, просмотр JSON, проверка и публикация, откат и активация, журнал |
| `/dashboard` | аналитика с фильтрами по версии, варианту и `utm_campaign` |

Query-параметры воронки (на первом заходе):

| Параметр | Пример | Эффект |
|---|---|---|
| `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term` | `?utm_campaign=q4_launch` | сохраняются в сессии и попадают в каждое событие |
| `variant` | `?variant=B` | override A/B для проверки (см. [A/B](#ab-эксперимент)) |
| `reset` | `?reset=1` | забыть сохранённую сессию и начать новую |

Язык интерфейса: воронка на английском (locale конфига `en-AU`), `/admin` и `/dashboard` — на русском (внутренние инструменты).

---

## HTTP API

Общие правила:
- **Формат.** Все тела запросов и ответов — JSON. `POST /api/events` также принимает `text/plain` с JSON внутри: так приходят данные от `navigator.sendBeacon`.
- **Ошибки:** `{"error": "сообщение"}`. Ошибка валидации тела запроса отдаёт `400 {"error": "Bad request", "issues": [...]}` — это zod issues.
- **CORS** открыт (`*`), это нужно для dev-клиента на другом порту.
- **Admin-эндпоинты** (`/api/admin/*`) требуют заголовок `x-admin-token: <ADMIN_TOKEN>`, если переменная задана на сервере. Без токена ответ `401 {"error": "Admin token required"}`.
- **`slug`** в путях и телах — это `funnelId` из конфига (`workstyle-planner`).
- Типы запросов и ответов описаны в `packages/shared/src/api.ts`.

### Сводка эндпоинтов

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/api/health` | проверка живости |
| POST | `/api/sessions` | создать или восстановить сессию |
| GET | `/api/sessions/:id` | получить сессию и её закреплённый конфиг |
| PUT | `/api/sessions/:id/state` | сохранить ответы и историю шагов |
| GET | `/api/sessions/:id/result` | вычислить результат по сохранённым ответам |
| POST | `/api/events` | принять пачку событий |
| GET | `/api/analytics` | метрики воронки |
| GET | `/api/admin/funnels` | список воронок и активных версий |
| GET | `/api/admin/funnels/:slug` | версии, активная версия, журнал |
| GET | `/api/admin/funnels/:slug/versions/:version` | конфиг конкретной версии |
| POST | `/api/admin/validate` | проверить конфиг без публикации |
| POST | `/api/admin/funnels/:slug/versions` | опубликовать новую версию |
| POST | `/api/admin/funnels/:slug/rollback` | откатить или активировать версию |
| GET | `/api/admin/config-files` | список JSON-файлов в `configs/` |
| GET | `/api/admin/config-files/:name` | содержимое файла конфига |

### `GET /api/health`

```json
{ "ok": true }
```

### `POST /api/sessions` — создать или восстановить сессию

Тело:

```json
{
  "slug": "workstyle-planner",
  "sessionId": "b7b09b3f-5d2d-4c96-872e-487518867a67",
  "utm": { "utm_source": "linkedin", "utm_medium": "cpc", "utm_campaign": "q4_launch" },
  "variantOverride": "B"
}
```

| Поле | Обяз. | Описание |
|---|---|---|
| `slug` | да | id воронки |
| `sessionId` | нет | сохранённый на клиенте id сессии; если сессия жива, она восстанавливается |
| `utm` | нет | UTM-метки (до 200 символов на значение) |
| `variantOverride` | нет | `"A"` или `"B"` — принудительный вариант |

Логика:
- `sessionId` существует, относится к этому `slug`, не истёк по TTL и не противоречит `variantOverride` → **восстановление** (`resumed: true`), конфиг закреплённой версии.
- Иначе создаётся **новая** сессия на **активной** версии:
  - вариант равен `variantOverride` или назначается сервером по хэшу;
  - сервер сам записывает событие `session_started` (seq 0).

Ответ `200`:

```json
{
  "session": {
    "id": "b7b09b3f-5d2d-4c96-872e-487518867a67",
    "slug": "workstyle-planner",
    "version": 1,
    "experimentId": "question-order-and-result-framing-v1",
    "variant": "B",
    "utm": { "utm_source": "linkedin", "utm_medium": "cpc", "utm_campaign": "q4_launch" },
    "state": { "answers": {}, "history": [] },
    "rev": 0,
    "createdAt": 1790847074125,
    "expiresAt": 1791106274125
  },
  "config": { "...": "полный JSON закреплённой версии (funnel-v1.json)" },
  "resumed": false
}
```

Ошибки: `400` — нет `slug`; `404 {"error": "Funnel \"x\" not found"}` — нет активной версии.

### `GET /api/sessions/:id`

Ответ в том же формате, что у `POST /api/sessions` (`resumed: true`). Если сессии нет, `404 {"error": "Session not found"}`.

### `PUT /api/sessions/:id/state` — сохранить состояние

Тело:

```json
{
  "state": {
    "answers": { "work_mode": "hybrid", "timezone_span": "same", "team_size": 12, "async_maturity": "low" },
    "history": ["intro", "work_mode", "timezone_span", "team_size", "async_maturity"]
  },
  "rev": 0
}
```

- `answers` — ответы по ключу `input.name`. Значение — строка, массив строк, число или `null`.
- `history` — стек посещённых шагов, последний элемент — текущий шаг.
- `rev` — версия состояния, которую видел клиент (оптимистичная блокировка).

| Ответ | Когда |
|---|---|
| `200 {"rev": 1}` | сохранено, новый `rev` |
| `409` + тело как у `GET /api/sessions/:id` | `rev` устарел (запись из другой вкладки); клиент принимает серверное состояние |
| `400 {"error": "Step \"meeting_hours\" is not part of version 1/B"}` | в истории шаг, которого нет в закреплённой версии и варианте |
| `404` | сессии нет |

Каждая запись продлевает срок жизни сессии на `session.ttlHours`.

### `GET /api/sessions/:id/result` — результат

Сервер вычисляет результат по сохранённым ответам: правила `resultRules` закреплённой версии, переопределения варианта и только ответы видимых шагов. Клиент вызывает его после того, как последнее состояние сохранено.

```json
{
  "result": {
    "id": "hybrid_structured",
    "title": "Your hybrid model needs clearer rules",
    "summary": "Your team needs a clear reason for office days and equal access to decisions for remote participants.",
    "recommendations": [
      "Give each office day a defined purpose.",
      "Document decisions before the end of the day.",
      "Avoid meetings where only part of the team can participate."
    ],
    "cta": { "label": "See the 30-day action list", "action": "expand_recommendation" }
  }
}
```

### `POST /api/events` — приём событий

Тело: `{"events": [ ... ]}`, не больше 500 событий за запрос. Формат события — в разделе [События](#события).

```json
{
  "events": [
    {
      "event_id": "af2e5dd6-d9d2-479e-be23-5d21f4d36297",
      "session_id": "b7b09b3f-5d2d-4c96-872e-487518867a67",
      "name": "step_viewed",
      "client_timestamp": 1790800000000,
      "seq": 1,
      "funnel_id": "workstyle-planner",
      "funnel_version": 1,
      "experiment_id": "question-order-and-result-framing-v1",
      "variant": "B",
      "step_id": "intro",
      "utm_source": "linkedin",
      "utm_medium": "cpc",
      "utm_campaign": "q4_launch",
      "properties": { "step_type": "info", "visible_step_index": 1, "visible_step_count": 8 }
    }
  ]
}
```

Ответ **всегда `200`** с разбором по каждому событию. Пример: пачка из 4 событий — новое, его дубль, мусор и событие, не разрешённое в v1:

```json
{
  "accepted":   ["af2e5dd6-d9d2-479e-be23-5d21f4d36297"],
  "duplicates": ["af2e5dd6-d9d2-479e-be23-5d21f4d36297"],
  "rejected": [
    { "index": 2, "reason": "event_id: Invalid input: expected string, received undefined; ..." },
    { "index": 3, "event_id": "9475440f-…", "reason": "event \"recommendation_expanded\" is not allowed in version 1" }
  ]
}
```

- `accepted` — записаны впервые.
- `duplicates` — такой `event_id` уже есть. Повтор безопасен, клиент считает их доставленными.
- `rejected` — не записаны, с указанием позиции в пачке (`index`) и причины. Остальные события пачки при этом записаны.

Ошибки целого запроса: `400` — `events` не массив; `413` — больше 500 событий.

### `GET /api/analytics` — метрики

Query-параметры (все необязательные):

| Параметр | Описание |
|---|---|
| `slug` | id воронки, по умолчанию `workstyle-planner` |
| `version` | только сессии этой версии |
| `variant` | `A` или `B` |
| `utm_campaign` | кампания; `(none)` — сессии без кампании |

Ответ (структура реальная, массивы сокращены, числа иллюстративные; все счётчики — уникальные сессии):

```json
{
  "slug": "workstyle-planner",
  "filters": {},
  "totals": {
    "key": "all", "started": 480, "resultViewed": 270, "ctaClicked": 140,
    "resultRate": 0.5625, "ctr": 0.5185, "ctaConversion": 0.2917, "ctaConversionCi": [0.25, 0.33],
    "droppedBeforeFirstStep": 7
  },
  "steps": [
    { "stepId": "intro", "type": "info", "viewed": 470, "completed": 430, "conversion": 0.91,
      "reach": 0.98, "dropped": 40, "backClicks": 0 }
  ],
  "byVariant":  [ { "key": "A", "...": "GroupMetrics" }, { "key": "B", "...": "GroupMetrics" } ],
  "abTest":     { "pValue": 0.005, "liftAbs": 0.18, "liftRel": 0.85 },
  "byVersion":  [ { "key": "1", "...": "GroupMetrics" } ],
  "byCampaign": [ { "key": "(none)", "...": "GroupMetrics" } ],
  "byResult":   [ { "key": "async_native", "...": "GroupMetrics" } ],
  "otherEvents": [ { "name": "recommendation_expanded", "sessions": 32, "events": 32 } ],
  "campaigns": ["(none)", "q4_launch"],
  "versions": [1, 2, 3],
  "eventCounts": { "raw": 9120, "sessions": 480 }
}
```

`GroupMetrics` — `{key, started, resultViewed, ctaClicked, resultRate, ctr, ctaConversion, ctaConversionCi}`. Смысл полей — в разделе [Аналитика](#аналитика-и-правила-агрегации). Если знаменатель равен 0, значение `null`.

### Admin API

Все запросы — с заголовком `x-admin-token`, если сервер запущен с `ADMIN_TOKEN`.

**`GET /api/admin/funnels`**

```json
[{ "slug": "workstyle-planner", "activeVersion": 2 }]
```

**`GET /api/admin/funnels/:slug`** — версии (новые сверху), активная версия, журнал (последние 50 действий):

```json
{
  "slug": "workstyle-planner",
  "title": "Find your team's operating style",
  "activeVersion": 1,
  "versions": [
    { "version": 2, "createdAt": 1790847074269, "note": "meeting load", "sessions": 0,
      "status": "draft", "releaseNote": "Adds meeting-load input and a meeting-heavy result while preserving the v1 schema.",
      "active": false },
    { "version": 1, "createdAt": 1790847069523, "note": "seed", "sessions": 1,
      "status": "published", "releaseNote": null, "active": true }
  ],
  "log": [
    { "action": "rollback", "fromVersion": 2, "toVersion": 1, "at": 1790847074298 },
    { "action": "publish",  "fromVersion": 1, "toVersion": 2, "at": 1790847074269 },
    { "action": "publish",  "fromVersion": null, "toVersion": 1, "at": 1790847069523 }
  ]
}
```

- `sessions` — сколько сессий закреплено за версией.
- `status` и `releaseNote` берутся из файла конфига (информационные поля).
- `note` — комментарий при публикации.

**`GET /api/admin/funnels/:slug/versions/:version`** → `{"version": 2, "config": {...}}`. Если версии нет, `404`.

**`POST /api/admin/validate`** — проверка без публикации. Тело `{"config": {...}}`.

```json
{ "issues": [
  { "level": "error", "message": "schemaVersion: Invalid input: expected string, received undefined" },
  { "level": "warning", "variant": "B", "message": "Result rule \"…\" uses \"tool_count\", which this variant never asks" }
] }
```

**`POST /api/admin/funnels/:slug/versions`** — публикация. Тело `{"config": {...}, "note": "необязательный комментарий"}`.

| Ответ | Когда |
|---|---|
| `200 {"version": 2, "issues": []}` | опубликовано и сразу активно; в `issues` могут быть предупреждения |
| `400 {"issues": [...]}` | есть ошибки валидации или `funnelId` не совпадает со `slug` |
| `409 {"error": "Version 2 is already published; activate it with rollback instead"}` | номер `config.version` уже опубликован |

Номер версии всегда берётся из `config.version` в файле.

**`POST /api/admin/funnels/:slug/rollback`** — тело `{}` или `{"toVersion": 3}`.
- Без `toVersion` активируется ближайшая версия ниже активной (откат).
- С `toVersion` активируется указанная версия, в том числе более новая (в журнале это `activate`).

Ответ — как у `GET /api/admin/funnels/:slug`. Ошибки: `409 {"error": "No previous version to roll back to"}`; `404` — версии нет.

**`GET /api/admin/config-files`** → `{"files": ["funnel-v1.json", "funnel-v2.json", "funnel-v3.json"]}`
**`GET /api/admin/config-files/:name`** → содержимое файла, как есть.

---

## Формат конфига воронки

Формат задан в выданных конфигах (`schemaVersion: "1.0"`), схема описана в `packages/shared/src/config.ts`. Неизвестные поля сохраняются, поэтому новые метаданные в будущих версиях не ломают валидацию.

| Раздел | Что делает рантайм |
|---|---|
| `funnelId`, `version`, `title`, `locale`, `status`, `releaseNote` | id воронки (= `slug`), номер версии на сервере, заголовки; `status` — информационное поле |
| `session.ttlHours` | срок жизни сессии с последней активности (72 ч) |
| `session.pinVersion`, `pinExperimentVariant` | сессия закрепляется за версией и вариантом |
| `session.persistAnswers` | хранить ли ответы в состоянии сессии на сервере |
| `progress.countVisibleOnly`, `excludeTypes` | прогресс-бар считает только видимые шаги, без `info` и `result` |
| `experiment.id` | ключ хэша назначения варианта; пишется в каждое событие |
| `experiment.variants.{A,B}.weight` | доли вариантов |
| `experiment.variants.{A,B}.stepSequence` | порядок шагов варианта; ровно один `result`, и он последний |
| `experiment.variants.{A,B}.stepOverrides` | глубокое слияние с шагом (тексты) |
| `experiment.variants.{A,B}.resultOverrides` | глубокое слияние с результатом (заголовок, CTA) |
| `steps.<id>` | `type`: `info`, `single-select`, `multi-select`, `number`, `result`; `content` — тексты; `input` — опции, `min`/`max`/`step`/`unit`, ключ ответа `input.name`; `validation` — `required`, `minSelections`/`maxSelections`, сообщения |
| `steps.<id>.visibleWhen` | условие видимости шага — механизм ветвления |
| `resultRules`, `defaultResultId`, `results` | первое подходящее правило задаёт результат; иначе берётся результат по умолчанию |
| `events.allowed` | разрешённые события и их свойства для этой версии (сервер проверяет) |
| `events.privacy.storeRawAnswers` | `false`: сырые ответы не попадают в события |

**Условия** (`visibleWhen`, `resultRules[].when`): лист `{answer, operator, value}` или составные `{all: [...]}`, `{any: [...]}`, `{not: ...}`.

| Оператор | Значение |
|---|---|
| `eq` / `neq` | равно / не равно |
| `in` / `nin` | значение ответа входит / не входит в список; для multi-select — хотя бы одно из выбранных |
| `contains` | multi-select содержит значение (или одно из значений списка) |
| `gt`, `gte`, `lt`, `lte` | числовые сравнения |
| `exists` | ответ есть (`value: false` — ответа нет) |

Если ответа нет, условие ложно (кроме `exists: false`).

**Видимость и устаревшие ответы.** Движок проходит `stepSequence` по порядку. Шаг виден, если его `visibleWhen` выполняется на ответах **видимых** шагов до него. Ответы шагов, ставших скрытыми, не учитываются ни для видимости, ни для результата. Пример: выбрали hybrid, ответили на `office_days`, вернулись и выбрали remote — `office_days` больше ни на что не влияет.

**Проверки при публикации** (`validateConfig`, для каждого варианта):

| Уровень | Проверка |
|---|---|
| ошибка | схема конфига |
| ошибка | все шаги последовательности существуют и не повторяются |
| ошибка | ровно один result-шаг, и он последний |
| ошибка | `visibleWhen` ссылается только на ответы, которые даются раньше |
| ошибка | имена ответов уникальны |
| ошибка | результаты из правил и `defaultResultId` существуют |
| ошибка | `resultOverrides` ссылаются на существующие результаты |
| ошибка | после переопределений шаги остаются валидными |
| ошибка | `min`/`max` и `minSelections`/`maxSelections` согласованы |
| ошибка | сумма весов вариантов больше 0 |
| предупреждение | правило результата использует ответ, который вариант не спрашивает |
| предупреждение | `stepOverrides` для шага вне последовательности |
| предупреждение | нет базового события в `allowed` |
| предупреждение | нет ни одного ветвления |

Ошибки блокируют публикацию, предупреждения — нет.

---

## Сессии, версии и A/B

### Состояние сессии

- **Где хранится.** `session_id` лежит в localStorage (`funnel:<slug>:sid`). Ответы и история шагов — на сервере (`sessions.state_json`), запись с оптимистичной блокировкой по `rev`.
- **Текущий шаг** — последний элемент `history`, он же виден в URL.
  - **Refresh или повторное открытие:** клиент восстанавливает сессию и возвращает пользователя на тот же шаг с теми же ответами.
  - **«Назад» в браузере или в приложении:** история обрезается до предыдущего шага, отправляется `back_clicked`.
  - **URL с шагом не из истории** (ручной ввод, «вперёд» после возврата): клиент перенаправляет на текущий шаг.
- **Запись состояния.** Клиент пишет состояние последовательно, по одному запросу за раз, всегда отправляя последнюю версию. При `409` он принимает серверное состояние. Сетевые ошибки повторяются.
- **Срок жизни** — `session.ttlHours` (72 ч) с последней записи. После него создаётся новая сессия на активной версии.

### Версии и откат

- **Версия неизменяема**: строка `(slug, version, config_json)` не меняется и не удаляется.
- **Номер версии = `config.version` из файла**, поэтому `funnel_version` в событиях совпадает с файлом. Повторная публикация того же номера — `409`.
- **Активная версия** — указатель в `funnel_active`. Публикация добавляет версию и переключает указатель; откат и активация только переключают указатель. Все действия пишутся в `version_log`.
- **Закрепление.** При создании сессия запоминает `version`, `experiment_id` и `variant`. Сервер всегда отдаёт ей конфиг **её** версии:
  - старые сессии продолжают работать после публикации и отката, даже если их шаг удалён в новой версии;
  - новые сессии получают только активную версию.

### A/B-эксперимент

**Назначение** на сервере, детерминированное и по весам:

```
hash = FNV1a(session_id + ":" + experiment.id) / 2^32
variant = hash < weightB / (weightA + weightB) ? "B" : "A"
```

- Вариант сохраняется в сессии и не меняется после refresh.
- `?variant=A|B` — override для проверки. Если override расходится с вариантом текущей сессии, создаётся **новая** сессия: внутри одной сессии вариант не меняется никогда.
- Вариант меняет порядок шагов (`stepSequence`), тексты (`stepOverrides`) и экран результата (`resultOverrides`).
- Все события содержат `funnel_version`, `experiment_id` и `variant`.

**Эксперимент `question-order-and-result-framing`.** Вариант B:
1. начинает с контекстных вопросов (режим работы, часовые пояса) вместо числового ввода размера команды;
2. использует более «цепляющий» интро-экран;
3. формулирует результат как вывод о проблеме команды («Your hybrid model needs clearer rules») с конкретным CTA («See the 30-day action list»).

**Гипотеза.** Лёгкие вопросы «о себе» в начале снижают ранний отвал, а результат, сформулированный как проблема с понятным следующим шагом, повышает интерес к рекомендациям. Значит, в B доля сессий, раскрывших action list, будет выше.

**Основная метрика:** `уникальные сессии с cta_clicked / уникальные начатые сессии` (CTA-конверсия от старта). На dashboard для неё есть 95% интервал Уилсона, абсолютный и относительный lift и p-value двустороннего z-теста для двух долей.

**Защитные метрики:**
- доля дошедших до результата;
- отвал на первом вопросе;
- распределение результатов — переформулировка не должна менять, какой результат получает пользователь.

`experiment.id` меняется между версиями (`…-v1`, `-v2`, `-v3`), поэтому A и B сравниваются внутри одной версии: на dashboard есть фильтр по версии.

---

## События

### Конверт события

Поля конверта совпадают с `events.baseProperties` из конфига, плюс служебные.

| Поле | Тип | Описание |
|---|---|---|
| `event_id` | uuid | генерирует клиент; первичный ключ, основа идемпотентности |
| `session_id` | uuid | сессия |
| `name` | string | имя события (`^[a-z][a-z0-9_]{2,47}$`) |
| `client_timestamp` | int, мс | время на клиенте |
| `seq` | int | наше дополнение: монотонный номер события в сессии на клиенте (1, 2, …; у `session_started` — 0); задаёт порядок независимо от прихода |
| `funnel_id`, `funnel_version`, `experiment_id`, `variant` | | **перезаписываются сервером из сессии** |
| `utm_source`, `utm_medium`, `utm_campaign` | string \| null | **перезаписываются сервером из сессии** |
| `step_id` | string \| null | обязателен для шаговых событий и должен существовать в закреплённой версии и варианте |
| `properties` | object | свойства события (см. ниже) |
| `server_ts` | int, мс | ставит сервер при приёме |

### Каталог событий

Набор задаётся `events.allowed` закреплённой версии.

| Событие | Кто и когда шлёт | `properties` |
|---|---|---|
| `session_started` | **сервер**, при создании сессии | — |
| `step_viewed` | показан шаг (в том числе повторно — после back или refresh) | `step_type`, `visible_step_index`, `visible_step_count` |
| `answer_submitted` | отправлен валидный ответ | `answer_kind` (тип шага) |
| `step_completed` | переход вперёд (в том числе с info-шагов) | `next_step_id` |
| `back_clicked` | возврат назад (кнопка или браузер), `step_id` — шаг, с которого ушли | `destination_step_id` |
| `result_viewed` | результат загружен и показан | `result_id` |
| `cta_clicked` | клик по основному CTA результата | `result_id`, `action` |
| `recommendation_expanded` | **только v3**: после CTA раскрыт список рекомендаций | `result_id`, `action`, `source` |

### Гарантии приёма

- **Идемпотентность:** `INSERT OR IGNORE` по `event_id`. Дубль внутри пачки, между пачками или повтор после timeout ничего не меняет.
- **Пакетная обработка:** до 500 событий за запрос, одна транзакция на пачку, каждое событие валидируется отдельно.
- **Изоляция ошибок:** битое событие попадает в `rejected` с причиной и не мешает остальным.
- **Allowlist по версии:** событие, которого нет в `events.allowed` закреплённой версии, отклоняется; свойства не из списка отбрасываются.
- **Источник правды:** версия, эксперимент, вариант и UTM всегда берутся из сессии, а не из события.
- **Приватность:**
  - сырые ответы (числа, выбранные опции) в события не попадают: `answer_submitted` несёт только `answer_kind`;
  - ответы живут только в состоянии сессии и нужны для работы воронки.

### Клиентский трекер (`apps/web/src/lib/tracker.ts`)

- **Очередь.** События копятся в localStorage и переживают refresh.
- **Отправка:** каждые 2 секунды, сразу при 10 событиях в очереди, после клика по CTA и при закрытии страницы (`pagehide`, `visibilitychange`) через `sendBeacon`. Одновременно идёт не больше одной отправки.
- **Подтверждение.** Из очереди удаляются только события из `accepted`, `duplicates` и `rejected`. После сетевой ошибки отправляются те же `event_id`, сервер их дедуплицирует.

---

## Аналитика и правила агрегации

Все показатели — `COUNT(DISTINCT session_id)` по событиям с учётом фильтров. Поэтому повторные просмотры, возвраты, дубли и порядок прихода не влияют на числа.

| Показатель | Определение |
|---|---|
| **Начали** (`started`) | сессии с любым событием, в том числе `session_started` |
| **Увидели шаг X** (`viewed`) | сессии с `step_viewed`, `answer_submitted`, `step_completed`, `result_viewed` или `cta_clicked` на X. Потерянное или опоздавшее событие не делает конверсию больше 100% |
| **Завершили шаг X** (`completed`) | `step_completed` на X; для result-шага — `cta_clicked` |
| **Конверсия шага** (`conversion`) | завершили / увидели |
| **Reach** | увидели X / начали |
| **Отвал на X** (`dropped`) | сессии без результата, у которых последний увиденный шаг **по `seq`** — X |
| `droppedBeforeFirstStep` | сессии без единого шагового события |
| **Возвраты** (`backClicks`) | сессии с `back_clicked` на X |
| **Дошли до результата** (`resultViewed`) | `result_viewed` или `cta_clicked` |
| **CTR CTA** (`ctr`) | `cta_clicked` / дошедшие до результата |
| **CTA-конверсия** (`ctaConversion`) | `cta_clicked` / начали — основная метрика A/B |
| **По результатам** (`byResult`) | сессии, увидевшие `result_id`, и их CTA |
| **Прочие события** (`otherEvents`) | события вне базового набора (например, `recommendation_expanded`): сессии и количество |

Инвариант, закреплённый тестом: `Σ dropped + droppedBeforeFirstStep + resultViewed = started`.

**Порядок шагов** в таблице — объединение `stepSequence` выбранных версий и вариантов, новые версии первыми. Новые шаги встают рядом с предшественником, результат — последним.

**Срезы:** вариант (с A/B-тестом), версия, `utm_campaign` (включая `(none)`), результат. Фильтры комбинируются.

**Статистика:**
- 95% интервал Уилсона для CTA-конверсии;
- двусторонний z-тест для двух долей (B против A), p-value;
- абсолютный и относительный lift.

---

## База данных

**SQLite**: один файл, доступ через встроенный в Node модуль `node:sqlite`. Режим WAL, внешние ключи включены, `busy_timeout` 5 с.

| Окружение | Файл |
|---|---|
| Прод (Railway) | `/data/workstyle.sqlite` на volume `web-volume` (переживает передеплой) |
| Локально | `apps/server/data/funnel.sqlite` (в `.gitignore`, в git не попадает) |
| Тесты | `:memory:`, новая база на каждый тест |

### Схема

```
funnel_versions(slug, version, config_json, note, created_at)
    PK (slug, version). Неизменяемая: строки не обновляются и не удаляются.
funnel_active(slug PK, version, updated_at)
    Указатель на активную версию.
version_log(id PK, slug, action, from_version, to_version, at)
    action: publish | rollback | activate.
sessions(id PK, slug, version, experiment_id, variant, utm_json, state_json, rev,
         created_at, updated_at, expires_at)
    FK (slug, version) → funnel_versions.
events(event_id PK, session_id, slug, name, step_id, funnel_version, experiment_id, variant,
       utm_source, utm_medium, utm_campaign, utm_json, props_json, client_ts, seq, server_ts)
    Индексы: (session_id, seq), (slug, name, step_id), (slug, funnel_version, variant).
schema_migrations(version PK, applied_at)
```

### Миграции

Список `MIGRATIONS` в `apps/server/src/db.ts` применяется при старте, применённые записываются в `schema_migrations`. Записи только **добавляются** в конец, применённые не редактируются.
- Миграция 1 — исходная схема.
- Миграция 2 добавила `experiment_id`, `expires_at`, `utm_source` и `utm_medium` под официальный формат. Это пример изменения схемы без ручных действий: на проде она применилась сама при деплое.

Шаги, варианты, результаты и события живут в JSON-конфиге и в `events.name`, поэтому **новая версия конфига схему не меняет**.

### Как посмотреть данные

- Через API: `/api/admin/*`, `/api/analytics`.
- Локально: `sqlite3 apps/server/data/funnel.sqlite`.
- На проде:
  - `railway volume browse` — файлы на volume;
  - `railway ssh` — консоль контейнера. Утилиты `sqlite3` в образе `node:24-slim` нет, запросы делаются скриптом на `node:sqlite`.

---

## Генератор трафика

```bash
npm run traffic -- [options]
```

| Опция | По умолчанию | Описание |
|---|---|---|
| `--sessions N` | 160 | число сессий |
| `--base-url URL` | `$BASE_URL` или `http://localhost:3000` | сервер |
| `--slug SLUG` | `workstyle-planner` | воронка |
| `--publish FILE` | — | перед генерацией опубликовать конфиг; если версия уже есть (409) и не активна — активировать её |
| `--admin-token TOK` | `$ADMIN_TOKEN` | токен для admin-вызовов |
| `--seed N` | случайный (печатается) | воспроизводимость |
| `--concurrency N` | 8 | параллельные сессии |
| `--days N` | 7 | разброс `client_timestamp` по последним N дням |
| `--cta-a P` / `--cta-b P` | 0.45 / 0.6 | вероятность клика по CTA для A и B |
| `--override-rate P` | 0.1 | доля сессий с `variantOverride` |
| `--clean` | — | без грязных данных |
| `--no-verify` | — | без сверки с аналитикой |

Генератор ходит в **реальный HTTP API** как настоящий клиент и проходит воронку движком из `shared` по закреплённому конфигу. Что он генерирует:
- **UTM:** несколько кампаний с разными весами, плюс трафик без кампании.
- **A/B:** вариант в основном назначает сервер, примерно 10% сессий идут через override.
- **Ветки и результаты:** все режимы работы (remote, hybrid, office — от них зависит `office_days`), `meeting_hours ≥ 15`, compliance-ветка (v3). Каждый ответ проверяется `validateAnswer`. Результат сверяется с `GET /api/sessions/:id/result`.
- **Отвал** на разных шагах и **возвраты назад** со сменой ответа, в том числе на другую ветку.
- **Грязная доставка:**
  - дубли `event_id` внутри пачки;
  - повторная отправка целой пачки;
  - пачки в обратном порядке и перемешанные события;
  - битые события, в том числе с неразрешённым именем.
- **Только допустимые события:** шлются события и свойства, разрешённые закреплённой версией.

**Сверка.** Генератор снимает `/api/analytics` до и после прогона и сравнивает разницу со своими ожиданиями: итоги, варианты, версии, кампании, результаты, шаги (просмотры, завершения, возвраты, отвалы) и прочие события. Сверка по разнице позволяет запускать его на непустой базе. При успехе он печатает `OK: server numbers match the generator.`

Коды выхода: `0` — успех; `1` — сервер недоступен, ошибка публикации, запросов или сверки; `2` — неверные аргументы.

---

## Вторая итерация (funnel-v3.json)

Изменения v3 по сравнению с v2:
- **новая условная ветка:** при выборе `compliance` в `priorities` показывается `security_constraints`, появляется результат `regulated_scale`;
- **экран удалён для B:** `tool_count` убран из последовательности варианта B;
- **новое событие:** `recommendation_expanded`. Клиент шлёт его, только если закреплённая версия его разрешает;
- новый `experiment.id` и новые формулировки результата в B.

Порядок проверки (так сделано на проде):
1. Опубликовать v3: `/admin` → файл `funnel-v3.json` → «Проверить» → «Опубликовать» (или `npm run traffic -- --publish configs/funnel-v3.json`).
2. Убедиться, что старая сессия на v2 (в том числе B-сессия, стоящая на `tool_count`) продолжает работать на v2, а новая сессия получает v3.
3. Откатить: «Откатить на предыдущую» → новые сессии получают v2, сессии на v3 доживают на v3.

Схема БД при этом не менялась вручную, аналитика всех версий сохраняется: срез «по версиям» на dashboard. Сценарий закреплён тестом `apps/server/test/iteration2.test.ts`.

---

## Тесты

```bash
npm test     # 17 тестов движка + 23 серверных
```

| Файл | Что проверяет |
|---|---|
| `packages/shared/test/engine.test.ts` | на выданных конфигах: v1–v3 валидны; порядок и тексты варианта B; `visibleWhen`; отбрасывание устаревших ответов; прогресс по видимым шагам; сообщения валидации из конфига; правила результата (`any`/`all`, meeting-heavy, compliance); отказ на битых конфигах |
| `apps/server/test/versions.test.ts` | публикация с номером из файла, 409 на повтор, отказ на невалидном конфиге, откат и активация, **закрепление версии за сессией**, конфликт `rev` |
| `apps/server/test/sessions.test.ts` | **стабильность A/B** при refresh, детерминизм и веса, override, единственный `session_started`, TTL, результат на сервере |
| `apps/server/test/events.test.ts` | **дедупликация** (в пачке, между пачками, повтор), изоляция битых событий, allowlist событий и свойств по версии, перезапись полей из сессии, лимит пачки |
| `apps/server/test/analytics.test.ts` | **расчёт показателей** на сценарии с дублями, back, событиями не по порядку; срезы по варианту, версии, кампании, результату; инвариант отвалов |
| `apps/server/test/iteration2.test.ts` | v1 → v2 → v3 → откат: старые сессии, удалённый шаг, новое событие, сохранность аналитики |

Серверные тесты работают через `app.inject` на базе `:memory:` и не требуют сети. Сквозная проверка — `npm start` + `npm run traffic`.

---

## Деплой

**Docker:**

```bash
docker build -t funnel . && docker run -p 3000:3000 -v funnel-data:/data funnel
```

**Railway** (так развёрнут прод: сборка из `Dockerfile`, SQLite на volume):

```bash
railway init --name funnel-runtime
railway add --service web --variables "ADMIN_TOKEN=…" --variables "DB_PATH=/data/workstyle.sqlite" --variables "PORT=3000"
railway link -s web && railway volume add --mount-path /data
railway up --ci                      # сборка и деплой из локальной папки
railway domain --port 3000           # публичный домен
npm run traffic -- --base-url https://<domain> --admin-token …   # наполнить dashboard
```

- Выкладка идёт командой `railway up` из локальной папки, автодеплоя из GitHub нет.
- `PORT=3000` обязателен: домен смотрит на этот порт.

---

## Допущения и ограничения

- **`visible_step_index` / `visible_step_count`** в `step_viewed` — позиция среди всех видимых шагов, включая info и result. Прогресс-бар следует `progress.excludeTypes` и показывает только вопросы.
- **`answer_kind`** — тип шага (`number`, `single-select`, …), без значений ответа.
- **Имя параметра override фиксировано.** `?variant=` читается до загрузки конфига, поэтому имя параметра не берётся из `overrideQueryParam`. Во всех выданных конфигах оно совпадает.
- **`status: draft`** в файлах v2 и v3 — информационное поле: публикует администратор.
- **Отвал** включает и незавершённые сессии: отдельного тайм-аута для аналитики нет.
- **Версии одной воронки:** активна одна версия, в версии один эксперимент.
- **Доступ к админке** защищён только `ADMIN_TOKEN`, без пользователей и ролей.
- **Аналитика** считается SQL-запросами на лету, без предагрегации. Для тестового объёма этого достаточно, для миллионов событий понадобились бы материализованные агрегаты.
- **Масштабирование:** SQLite — один файл на одном диске, поэтому сервис нельзя запустить в нескольких экземплярах.
- **Не проверено вручную:** отправка событий при закрытии вкладки и нативные платформы (iOS, Android). Код кроссплатформенный, но целевая платформа — web.

---

## Таймлайн и работа с агентами

| Этап | Кто | Результат |
|---|---|---|
| План, каркас монорепо (Expo SDK 57, Fastify, `node:sqlite`) | я | `PLAN.md`, структура workspaces |
| Контракт `shared`: схемы, движок, HTTP-контракт, тесты движка | я | единая точка правды для всех частей |
| Сервер: миграции, версии, сессии, приём событий, аналитика, тесты | я | параллельно с агентами |
| Web-клиент: воронка, трекер, `/admin`, `/dashboard` | агент 1 | работал только по контракту `shared`, прогон в headless Chrome |
| Генератор трафика со сверкой с `/api/analytics` | агент 2 | прогон на реальном сервере |
| Ревью и интеграция | я | агент 2 нашёл, что сервер не стартует под `tsx` (ESM-флаг `shared`): исправлено, обходной shim удалён |
| Деплой на Railway, публичный URL | я | Dockerfile, volume для SQLite |
| **Получены официальные конфиги v1–v3** | я | формат отличался от нашего. Решение: сделать его родным (без адаптера), переписать контракт и движок под `stepSequence` / `visibleWhen` / `resultRules` / `events.allowed` |
| Сервер под новый формат: миграция 2, версия из файла, allowlist событий, результат на сервере, TTL | я | 23 серверных и 17 тестов движка |
| Клиент и генератор под новый формат | агенты 1 и 2 | параллельно с сервером, по тому же контракту; клиент — 39 проверок в headless Chrome |
| Вторая итерация на проде: v1 → v2 → v3 → откат | я | генератор сошёлся с сервером на каждой версии; активна v2 |

**Как работал с агентами:**
- Сначала я фиксировал контракт в `packages/shared`, затем давал агентам узкие задачи по непересекающимся файлам с запретом менять чужой код.
- Предложения по контракту агенты возвращали в отчёте, а не правили сами.
- Каждый результат я принимал только после проверки типов, тестов, чтения диффа и живого прогона.

Документация для агентов, которые будут работать с репозиторием, — в `AGENTS.md` и `CLAUDE.md`.
