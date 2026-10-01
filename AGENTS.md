# AGENTS.md — Funnel Runtime

Руководство для агентов и разработчиков, которые меняют этот репозиторий. Пользовательская документация (модель данных, правила агрегации, A/B-гипотеза, допущения) — в `README.md`. Исходный план — в `PLAN.md` (исторический, формат конфига там устарел).

## Что это

Тестовое задание «Funnel Runtime» (fullstack TypeScript): платформа многошаговых веб-воронок.
- Экраны описываются JSON-конфигом; на фронтенде нет захардкоженных экранов.
- Версии конфига публикуются и откатываются без передеплоя; сессия закреплена за своей версией.
- A/B-вариант назначается на сервере и не меняется в рамках сессии.
- Собственный приём событий: пачками, идемпотентно.
- Dashboard считает показатели по уникальным сессиям.
- Генератор синтетического трафика сверяет свои ожидания с аналитикой сервера.

| | |
|---|---|
| Прод | https://web-production-eee72.up.railway.app (`/`, `/admin`, `/dashboard`) |
| Репозиторий | https://github.com/ssavl/test-saveliistepura, ветка `main` |
| Railway | проект `funnel-runtime`, сервис `web`, environment `production`, volume на `/data` |
| Воронка | `workstyle-planner`, конфиги `configs/funnel-v1.json`..`funnel-v3.json` (выданы HR) |

## Структура

```
packages/shared/src/        КОНТРАКТ: единственный источник типов и логики воронки
  config.ts                 zod-схема официального формата конфига (looseObject, неизвестные поля сохраняются)
  engine.ts                 чистые функции: applyVariant, walk, visibleSteps, nextStep, progress, stepPosition,
                            validateAnswer, resolveResult, validateConfig, deepMerge, evalCondition
  events.ts                 EventSchema (конверт события), STEP_EVENTS, MAX_BATCH, pickUtm
  api.ts                    HTTP-контракт (шапка-комментарий = все эндпоинты) + DTO + NO_CAMPAIGN
packages/shared/test/       тесты движка на реальных configs/funnel-v*.json

apps/server/src/
  index.ts                  точка входа: env, openDb, сид funnel-v1.json при пустой БД, listen
  app.ts                    buildApp(): все роуты Fastify, CORS, admin-токен, SPA-раздача apps/web/dist
  db.ts                     node:sqlite, список MIGRATIONS (только дописывать!), tx()
  versions.ts               publish/rollback/funnelAdmin, getVersionConfig/getFunnel (кэш), HttpError
  sessions.ts               create/resume (TTL, override), назначение варианта (FNV1a+веса), state PUT (rev), getResult
  ingest.ts                 POST /api/events: валидация, allowlist по закреплённой версии, INSERT OR IGNORE
  analytics.ts              SQL-агрегаты по уникальным сессиям, Wilson CI, z-test, порядок шагов
  traffic.ts, traffic/*     генератор трафика (simulate.ts — сессия, report.ts — сверка, rng.ts, http.ts)
apps/server/test/           vitest: versions, sessions, events, analytics, iteration2 (+ helpers.ts)

apps/web/src/               Expo SDK 57 + Expo Router, основной таргет — web (react-native-web)
  app/index.tsx             редирект на /f/workstyle-planner с сохранением query
  app/f/[slug]/_layout.tsx  FunnelProvider + Stack
  app/f/[slug]/index.tsx    бутстрап: replace на текущий шаг
  app/f/[slug]/[step].tsx   экран шага: сверка URL с историей на фокусе, Back, прогресс
  app/admin.tsx             версии: список, JSON, публикация файла/вставки, валидация, откат/активация (RU)
  app/dashboard.tsx         аналитика с фильтрами (RU)
  funnel/FunnelContext.tsx  владелец сессии: create/resume, answers/history, сериализованный writer, awaitPersist
  funnel/StepView.tsx       рендер типов шагов, экран результата (loading/error/CTA/recommendations)
  lib/tracker.ts            очередь событий в storage, батчи, sendBeacon, allowlist по конфигу
  lib/api.ts, lib/storage.ts, components/{ui,theme}.ts(x)
apps/web/AGENTS.md          правила Expo (читать перед изменениями Expo API)

configs/                    официальные конфиги HR — НЕ РЕДАКТИРОВАТЬ
Dockerfile                  node:24-slim, npm ci, expo export, npm start
```

## Команды

```bash
npm install
npm test                    # vitest во всех workspaces (shared + server)
npm run typecheck           # tsc --noEmit во всех workspaces
npm run build               # expo export → apps/web/dist (сервер раздаёт его)
npm start                   # сервер + web; PORT по умолчанию 3000
npm run dev:server          # tsx watch
EXPO_PUBLIC_API_URL=http://localhost:3100 npm run dev:web   # Expo dev server на :8081, API через CORS
npm run traffic -- --base-url http://localhost:3100 [--sessions 160] [--seed N] \
  [--publish configs/funnel-v2.json] [--admin-token T] [--clean] [--no-verify] [--help]
```

Переменные окружения сервера: `PORT`, `DB_PATH` (по умолчанию `apps/server/data/funnel.sqlite`), `CONFIGS_DIR`, `SEED_CONFIG` (по умолчанию `configs/funnel-v1.json`), `WEB_DIR`, `ADMIN_TOKEN` (если задан, `/api/admin/*` требует `x-admin-token`), `LOG=0` (выключить логи Fastify).

Перед тем как объявить задачу готовой, нужно пройти:
1. `npm test` и `npm run typecheck`;
2. `npm run build`;
3. живой прогон: `npm start` на свободном порту с одноразовой БД, затем `npm run traffic` против него. Генератор должен закончить строкой `OK: server numbers match the generator.`

Vitest не ловит проблемы ESM-загрузки под `tsx` — однажды сервер не стартовал при зелёных тестах.

## Формат конфига (кратко)

Полностью — в `packages/shared/src/config.ts`.

- **Шаги** лежат в `steps`, типы: `info`, `single-select`, `multi-select`, `number`, `result`.
  - Тексты — в `content`, ограничения — в `input`, сообщения об ошибках — в `validation.messages`.
  - Ответ хранится под ключом `input.name` (`answerKey(step)`), а не под id шага.
- **Порядок и ветвление.**
  - `experiment.variants.{A,B}.stepSequence` — свой порядок шагов у каждого варианта; ровно один `result`, и он последний.
  - Ветвление делается через `visibleWhen`: условие над ответами, которые даются раньше в последовательности.
  - Операторы: `eq`, `neq`, `in`, `nin`, `contains`, `gt`, `gte`, `lt`, `lte`, `exists`; составные `all`/`any`/`not`. Если ответа нет, условие ложно.
- **Переопределения** накладываются глубоким слиянием: `stepOverrides` (тексты шагов) и `resultOverrides` (результаты).
- **Результат.** `resultRules` проверяются по порядку, срабатывает первое подходящее, иначе берётся `defaultResultId`. Проверка идёт только по эффективным ответам (`walk`): ответы скрытых шагов отбрасываются.
- **События.** `events.allowed` — разрешённые имена и свойства для этой версии; сервер это проверяет.
- **Прочее:**
  - `session.ttlHours` — срок жизни сессии; он сдвигается при каждой записи состояния;
  - `progress.excludeTypes` — какие типы шагов не входят в прогресс-бар;
  - `experiment.id` меняется от версии к версии и хранится в каждом событии;
  - `version` из файла — это номер версии на сервере.

## Инварианты (не ломать)

1. **Контракт сначала.** Любое изменение API, DTO, события или конфига начинается с `packages/shared`: типы, шапка `api.ts`, тесты движка. Клиент, сервер и генератор импортируют только из `@funnel/shared`.
2. **Версии неизменяемы.** Строки `funnel_versions` не обновляются и не удаляются. Публикация добавляет версию с номером `config.version` (повтор → 409). Откат или активация только двигают `funnel_active`. Пишется `version_log`.
3. **Закрепление.** Сессия навсегда привязана к своим `version`, `experiment_id` и `variant`, и сервер всегда отдаёт ей конфиг закреплённой версии. Новые сессии получают активную версию. Сессия старше TTL или с конфликтующим `?variant=` порождает новую сессию.
4. **Назначение варианта** детерминировано: `FNV1a(session_id:experiment.id)` против весов. Хранится в `sessions`, назначение никогда не пересчитывается.
5. **События идемпотентны.**
   - `event_id` — первичный ключ, вставка через `INSERT OR IGNORE`.
   - Каждое событие пачки валидируется отдельно; ответ `{accepted, duplicates, rejected[{index, reason}]}`. Битое событие не валит пачку.
   - Сервер перезаписывает `funnel_id/version/experiment_id/variant/utm_*` значениями из сессии.
   - Имя события должно быть в `events.allowed` закреплённой версии, лишние свойства отбрасываются.
   - `step_id` обязан существовать в версии и варианте сессии.
   - `session_started` пишет только сервер (seq 0); клиентский `seq` начинается с 1.
6. **Приватность.** Сырые ответы не попадают в события: `answer_submitted` несёт только `answer_kind`. Ответы живут только в `sessions.state_json`.
7. **Аналитика** — только `COUNT(DISTINCT session_id)`.
   - «Увидел шаг» — любое шаговое событие, кроме `back_clicked`.
   - «Завершил» — `step_completed`, для результата — `cta_clicked`.
   - Отвал — последний увиденный шаг по `seq` клиента (не по порядку прихода) у сессий без результата.
   - Тест держит инвариант `Σ dropped + droppedBeforeFirstStep + resultViewed = started`.
8. **Схема БД меняется только новой записью в конце `MIGRATIONS`** в `db.ts`; применённые записи не редактируются. Новые шаги, результаты и события схему не трогают.
9. **`configs/funnel-v*.json` не редактировать.** Это входные данные от HR. Для тестов модифицируйте копию (`structuredClone`, см. `v1As` в `apps/server/test/helpers.ts`).
10. **Клиент сам не решает, какой шаг показать.**
    - Текущий шаг — последний в `history`. URL-параметр шага сверяется с историей только на фокусе экрана.
    - Шаг из истории, но не последний, — это back: история обрезается, уходит `back_clicked`.
    - Шага нет в истории — `replace` на текущий шаг.
    - Состояние пишется одним сериализованным writer'ом с `rev`; на 409 принимается серверное состояние.
    - Результат запрашивается только после `awaitPersist()`.

## Как сделать типовые изменения

| Задача | Где |
|---|---|
| Новый оператор условия | `OPERATORS` в `config.ts` + `evalLeaf` в `engine.ts` + тест движка |
| Новый тип шага | `StepSchema` → `validateAnswer`/`answerKind` → `StepView.tsx` → генератор (`simulate.ts`, генерация ответа) → тесты |
| Новое событие | Достаточно конфига (`events.allowed`). Если его шлёт клиент — триггер в `StepView`/`FunnelContext`, отправка только при `funnel.events[name]`; генератор — так же |
| Новое поле в БД | Новая миграция в конце `MIGRATIONS`, затем ingest/sessions/analytics |
| Новый эндпоинт | Шапка и DTO в `shared/api.ts` → роут в `app.ts` → функция в модуле → тест через `app.inject` (`helpers.ts`) |
| Новая метрика | `analytics.ts` (SQL над CTE `ev`) + `AnalyticsResponse` + тест в `analytics.test.ts` + `dashboard.tsx` + сверка в `traffic/report.ts` |
| Публикация новой версии | `/admin` или `POST /api/admin/funnels/:slug/versions {config}`, или `npm run traffic -- --publish <file> --admin-token T` |

## Тесты

- Серверные тесты используют `openDb(':memory:')` и `app.inject`, сеть не нужна. Хелперы — `setup()`, `makeEvent()`, `loadConfig(v)`, `v1As(version)` в `apps/server/test/helpers.ts`.
- `iteration2.test.ts` фиксирует сценарий второй итерации: v1 → v2 → v3 → откат. Старая B-сессия на удалённом шаге `tool_count` должна продолжить работу.
- Генератор (`npm run traffic`) — e2e-проверка аналитики. Он шлёт грязные данные: дубли, повторы пачек, события не по порядку, битые события, back. Затем сравнивает дельты `/api/analytics` до и после прогона.

## Деплой (Railway)

- Сборка из `Dockerfile` через `railway up --ci -s web`. Деплой идёт с локальной папки (с учётом `.gitignore`); **автодеплоя из GitHub нет**.
- Переменные сервиса: `PORT=3000` (обязательно — домен смотрит на 3000), `DB_PATH=/data/workstyle.sqlite`, `ADMIN_TOKEN` (секрет, только в Railway, в репозиторий не писать), `LOG=0`.
- Volume примонтирован в `/data`. Там же лежит старая несовместимая БД `funnel.sqlite` от первой версии формата — не используется.
- Проверка после деплоя: `curl $URL/api/health`, затем `npm run traffic -- --base-url $URL --admin-token $T`.
- Состояние прода: v1, v2 и v3 опубликованы, на каждой по 160 синтетических сессий; после проверки v3 сделан откат, **активна v2**.

## Подводные камни

- `packages/shared/package.json` обязан иметь `"type": "module"`: без него `tsx` грузит shared как CJS, и сервер падает на именованных импортах. Vitest это скрывает.
- Локально порт 3000 занят посторонним приложением — используйте 3100 и выше.
- `@fastify/static` зарегистрирован с wildcard, поэтому пересобранный `dist` подхватывается без рестарта. Неизвестные GET-пути вне `/api/` отдают `index.html` (SPA).
- `node:sqlite` требует Node ≥ 22.13 (используется 24).
- Expo SDK 57: перед использованием Expo API сверяйтесь с `apps/web/AGENTS.md` и docs.expo.dev для v57; зависимости ставьте через `npx expo install`.
- В zsh переменная с пробелами не разбивается на аргументы: `cmd $FLAGS` передаст одну строку. Пишите флаги явно.
- `?variant=` читается до загрузки конфига, поэтому имя параметра фиксировано (оно совпадает с `overrideQueryParam` во всех конфигах).
- Язык интерфейса: воронка — английский (locale конфига `en-AU`), `/admin` и `/dashboard` — русский. README — русский; комментарии в коде — английские и редкие.

## Стиль

- TypeScript strict. Никаких новых зависимостей без необходимости: только open-source, никаких сторонних сервисов (аналитика, БД и прочее — свои).
- Пишите код в стиле соседнего: чистые функции в shared, тонкие роуты, SQL с параметрами.
- Ошибки HTTP бросаются через `HttpError(status, message, body?)`.
