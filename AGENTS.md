# AGENTS.md — sbe-apstore (ЦУП СБЕ ПМиПИР)

Магазин плагинов компании: скачивает `registry.json` из `Epyur/sbe-apstore-registry`,
устанавливает и обновляет плагины SBE из их GitHub-репозиториев (`main`-ветка).

## Структура

- `src/main.ts` — `SbeApstorePlugin`: регистрирует view и ribbon, инициализирует store.
- `src/ui/store-view.ts` — вкладки «Пользовательские приложения / Магазин / Установленные / Обновления» (первая открывается по умолчанию).
- `src/ui/settings-tab.ts` — URL реестра, проверка доступности.
- `src/styles.css` — классы `tn-*` поверх design-системы sbe-core.
- `manifest.json` — author: Полищук Евгений (polishchuk@tn.ru).
- **Клиент магазина и авторизации — в sbe-core (с 2026-08-26)**: `StoreManager`
  (`sbe-core/src/store-manager.ts`) и `AuthService` (`sbe-core/src/auth-client.ts`) —
  общие для десктопного ЦУП и мобильного хаба `sbe-mobile`; локальные `src/services/*`
  удалены (v0.3.9).

## Ключевые решения

- Механика установки (из `updater/`): `requestUrl` → файлы реестра → запись адаптером → `delete require.cache` → `disablePlugin(id)`/`enablePlugin(id)` через `(app as any).plugins`.
- `required: true` в реестре — системный плагин без кнопки «Установить» (только «Обновить»).
- Реестр кэшируется; проверка обновлений по кнопке в view. UI на русском.
- Сборка: `npm run build` (esbuild + `build.onEnd` для склейки tokens/components sbe-core + собственных стилей). `npx tsc --noEmit` EXIT=0.

## История работ

### 2026-08-28 — v0.3.10 (Справка + Обратная связь)
- В шапке ЦУП (рядом с «Онлайн»/«Новости») добавлены две кнопки:
  - **«📖 Справка»** → `HelpModal` (`src/ui/help-modal.ts`) — подробная инструкция
    по работе с системой: что такое ЦУП, как установить плагин, как включить его
    после установки в настройках Obsidian («Сторонние плагины»), как получить
    доступ к серверу (email → ключ → активация), как обновлять плагины,
    пользовательские приложения, онлайн/новости.
  - **«✉ Обратная связь»** → `FeedbackModal` (`src/ui/feedback-modal.ts`) — форма
    из двух полей: выбор плагина по списку реестра (или «💡 Есть идея») + текст
    обращения + кнопка «Отправить». Отправка требует авторизации (Bearer
    <мастер-ключ>); без авторизации — экран с предложением открыть настройки ЦУП
    («Доступ к серверу»). Замечание уходит владельцу плагина, «идея» — собственнику ЦУП.
- `sbe-core`: в `AuthService` добавлен `sendFeedback(input: SendFeedbackInput)` +
  тип `SendFeedbackInput`; в `SbeAuthApi` добавлен `sendFeedback`. Серверная часть —
  `auth-service` (`POST /auth/feedback`, `feedback.go`), см. `sbe-core/auth-service/AGENTS.md`.
- Подключён механизм «Новости» ЦУП для самого ЦУП: `announceSelfUpdate()` в `onload()`
  публикует новость об обновлении один раз на версию (поле `lastAnnouncedVersion`
  в `data.json`), try/catch — недоступность ЦУП не мешает загрузке.
- Версия 0.3.9 → **0.3.10** (manifest + package.json). `npx tsc --noEmit` EXIT=0;
  `npm run build` OK; backend `go build`/`go vet`/`go test` — чисто.

### 2026-08-26 — v0.3.9 (рефактор: клиент авторизации и магазин — в sbe-core)
- `AuthService` (`src/services/auth-service.ts`) перенесён в `sbe-core/src/auth-client.ts`,
  `StoreManager` (`src/services/store-manager.ts`) — в `sbe-core/src/store-manager.ts`
  (общие для десктопного ЦУП и нового мобильного хаба `sbe-mobile`, см. его AGENTS.md).
  Локальные `src/services/*` удалены, импорты обновлены (main.ts, store-view.ts,
  news-modal.ts, presence-modal.ts). Функциональность не менялась.
- Версия 0.3.8 → **0.3.9** (manifest + package.json). `npx tsc --noEmit` EXIT=0;
  `npm run build` OK.

### 2026-08-26 — v0.3.8 (безопасность: белый список выдачи токенов; передача хешей целостности в установщик)
- **B4c (ревью безопасности, `plugins/secrev.md` 3.1)**: `auth.getToken(appId)` на мосту
  `window.SBE` выдаёт токены только для известных приложений
  (`mailer`/`documents`/`lab`/`ekn`/`contacts`/`agent`) — произвольные `app_id`
  отклоняются ошибкой до обращения к auth-service. Компрометация любого установленного
  плагина больше не даёт ему JWT за чужие сервисы.
- **B4b (связка)**: `store-manager.ts` передаёт `entry.hashes` из реестра в
  `installPlugin` — при установке/обновлении плагин проверяет SHA-256 скачанных файлов
  против хешей реестра ДО записи на диск (реализация — sbe-core `src/installer.ts`,
  коммит `8478cae`; без хешей — установка с предупреждением).
- Версия 0.3.7 → **0.3.8** (manifest + package.json). `npx tsc --noEmit` EXIT=0;
  `npm run build` OK.

### 2026-08-26 — v0.3.7 (мост: getAppEnvStatus/setAppEnv — admin-управление произвольными env-переменными приложений)
- Продолжение v0.3.6: `manageAppSecret` умел только один секрет на приложение
  (`{APP}_SERVICE_SECRET`, генерируется сервером). Понадобился generic-канал для
  admin-заданных значений ЛЮБЫХ разрешённых env-переменных (первый потребитель —
  учётка почты `LAB_MAIL_*` у sbe-lims, см. его `AGENTS.md`, 2026-08-26) — новый
  `POST/GET /auth/apps/env` на сервере (`env_admin.go`, белый список ключей на
  приложение, см. `sbe-core/auth-service/AGENTS.md`).
- `src/services/auth-service.ts`: `getAppEnvStatus(appId)` (статус по каждому
  разрешённому ключу — `set`/`pending`/`updatedAt`, значение никогда не
  возвращается) / `setAppEnv(appId, values)` (ставит в очередь, admin-only).
- `src/main.ts`: оба метода добавлены в `auth` на мосту `window.SBE` — **любой**
  установленный плагин может вызвать `getService('sbe-apstore').auth.setAppEnv(...)`
  для СВОЕГО приложения (сервер сам отклонит неразрешённые ключи/чужой app_id
  по белому списку — плагин ничего не обязан проверять сам). sbe-apstore
  своего UI для этого не получил — секции живут в настройках плагина-потребителя
  (sbe-lims), эта версия — чисто мост.
- `npx tsc --noEmit`/`npm run build` — чисто. Версия 0.3.6 → **0.3.7**.

### 2026-08-25 — v0.3.6 (управление секретами + динамический реестр)
- `src/services/auth-service.ts`: новые методы (admin, через мастер-ключ устройства):
  - `manageAppSecret({appId, action: 'status'|'sync'|'rotate'})` — управление
    `service_secret` приложений (статус маскирован; sync — выровнять `apps` по env
    сервера; rotate — новый ключ, показывается один раз);
  - `listRegistryAdditions()` / `addRegistryPlugin(plugin)` / `removeRegistryAddition(id)`
    — динамический реестр плагинов.
- `src/ui/settings-tab.ts`: настройки переведены на **сворачиваемые группы** (свёрнуты
  по умолчанию, ленивый рендер при первом раскрытии); новый раздел **«Сервисные ключи»**
  (список всех приложений: статус / Синхронизировать / Перевыпустить) и раздел
  **«Добавить плагин в реестр»** (форма id/название/репозиторий/ветка/owner/description +
  список добавленного с удалением). Изменения применяются ко всем устройствам сразу
  (общий `/registry.json` отдаётся динамически auth-service).
- `sbe-core`: `SbeAuthApi` расширен (`manageAppSecret`, `listRegistryAdditions`,
  `addRegistryPlugin`, `removeRegistryAddition`) + типы `ManageAppSecretInput`/
  `ManageAppSecretResult`/`RegistryAddition`/`RegistryPluginInput`. Реализация серверной
  части — auth-service (см. его AGENTS.md) + хост-скрипт `secret-applier.sh`.
- Версия 0.3.5 → **0.3.6** (manifest + package.json). `npx tsc --noEmit` EXIT=0;
  `npm run build` OK.

### 2026-08-22 — v0.3.5 (индикатор онлайна + канал «Новости»)
- Устранён баг «ошибка при отвязке устройства»: несовпадение camelCase/snake_case в
  `listDevices()` оставляло `deviceId` пустым — на сервер уходил буквальный `"undefined"`,
  Postgres отвергал его как невалидный UUID → 500. Фикс на клиенте (маппинг полей) +
  на сервере (`handleRevokeDevice` теперь проверяет формат UUID и отвечает 400).
- Две иконки над таблицей (`store-view.ts`, `renderHeader()`): `🟢 Онлайн` → `PresenceModal`
  (кто подключён — активность синхронизации за 30 мин; администратору сервер дополнительно
  отдаёт last-seen по всем пользователям), `📰 Новости` → `NewsModal` (список сообщений,
  «✔ Прочитано», для админа — форма публикации + «Кто прочитал»).
- `src/services/auth-service.ts`: новые методы `getPresence`/`listNews`/`createNews`/`ackNews`/
  `getNewsReads` через новый приватный `authorizedRequest()` (в отличие от старого `authorized()`
  не сбрасывает ключ на 403 — здесь 403 значит «не admin», а не «ключ недействителен»).
- `src/main.ts`: при старте (после `checkUpdates`) — `checkMandatoryNews()`, открывает
  `MandatoryNewsModal` для первого непрочитанного `mandatory`-сообщения; `announceUpdate()`
  добавлен в `buildApi()` (шлёт `POST /auth/news` с `visibility:'all', mandatory:false`).
- `sbe-core`: `SbeAuthApi`/`SbeApstoreApi` — новые методы и типы (см. `sbe-core/AGENTS.md`
  2026-08-22). Только этот плагин реализует/бампается — остальные SBE-плагины не тронуты
  (политика 2026-08-20: аддитивные изменения sbe-core не требуют пересборки потребителей).
- Backend: `server_back/auth-service` — новые таблицы/роуты, см. его собственный `AGENTS.md`.
  Деплой на VDS и значение `ADMIN_EMAILS` — отдельным подтверждённым шагом.
- Версия 0.3.4 → **0.3.5** (manifest + package.json). `npx tsc --noEmit` EXIT=0; `npm run build` OK.

### 2026-08-20 — v0.3.4 (пересборка за sbe-core: SbeContactsApi)
- `sbe-core`: добавлены `SbeContactsApi` и `'sbe-contacts'` в `SbeServiceMap` — пересборка `main.js`, исходники плагина не менялись. Версия 0.3.3 → **0.3.4** (manifest + package.json).
- `npx tsc --noEmit` EXIT=0; `npm run build` OK.

### 2026-08-18 — v0.3.3 (пересборка за sbe-core: sbe-lims в service-map)
- `sbe-core`: добавлены `SbeLimsApi` и `'sbe-lims'` в `SbeServiceMap` — пересборка `main.js`,
  исходники плагина не менялись. Версия 0.3.2 → **0.3.3** (manifest + package.json).
- `npx tsc --noEmit` EXIT=0; `npm run build` OK. Коммит и пуш сделаны.

### 2026-08-18 — v0.3.2 (пересборка за sbe-core: SbeEknApi)
- `sbe-core`: добавлены `SbeEknApi` и `'sbe-ekn'` в `SbeServiceMap` — пересборка `main.js`,
  исходники плагина не менялись. Версия 0.3.1 → **0.3.2** (manifest + package.json).

### 2026-08-17 — v0.3.1 (источник реестра)
- `sbe-core`: `DEFAULT_REGISTRY_URL` → `https://epyur.fvds.ru/registry.json`
  (raw.githubusercontent.com отдавал 429 Too Many Requests, реестр в ЦУП пропадал;
  реестр теперь отдаёт наш Caddy, файл — статика стека на сервере).
- `data.json`: `registryUrl` → `https://epyur.fvds.ru/registry.json`.
- Пересборка `main.js`. Версия 0.3.0 → **0.3.1** (manifest + package.json).
- `npx tsc --noEmit` EXIT=0; `npm run build` OK.

### 2026-08-17 — v0.3.0 (блок «Доступ к серверу», SbeAuthApi)
- **sbe-core**: в `SbeApstoreApi` добавлен подсервис `auth: SbeAuthApi`; новые типы
  `DeviceInfo`, `SbeAuthApi`; в `RegistryPluginEntry` добавлено поле `ownerEmail`.
- **ЦУП**: новый клиент `src/services/auth-service.ts` (`AuthService`) — requestKey /
  activateKey / getToken / listDevices / revokeDevice через `requestUrl` + клиентский
  таймаут 15 с; JWT кэшируется до истечения (`expires_at`); при 401/403 ключ очищается
  (secretStorage) и выдаётся понятная ошибка.
- `deviceId` (UUID v4) генерируется один раз и хранится в `data.json`; ключ доступа —
  в secretStorage Obsidian (стабильный секрет `sbe-auth-key`, перезаписывается).
- Настройки: блок «Доступ к серверу» (apiUrl, email, «Получить ключ», «Активировать»,
  статус, список устройств с отзывом) + блок «Реестр плагинов» (как раньше).
- Версия 0.2.5 → **0.3.0** (manifest + package.json). `npx tsc --noEmit` EXIT=0, `npm run build` OK.
- Проверка E2E в Obsidian (цикл request → email → activate → token) — вручную, см. specification.md.

### 2026-08-15 — v0.2.5 (шестерёнка настроек)
- В карточке вкладки «Пользовательские приложения» добавлена кнопка «⚙» —
  открывает настройки плагина через недокументированное API
  `app.setting`: сначала `open()`, затем `openTabById(id)` (без `open()` модалка
  не показывается — подтверждено по `app.js` Obsidian); проверка наличия вкладки —
  по массиву `pluginTabs`; для плагинов без настроек — Notice.
- Вкладка **«Установленные»**: между колонками «Плагин» и «ID» добавлена колонка
  «Настройки» с кнопкой «⚙» для каждого установленного плагина (в т.ч. системных —
  sbe-llm, sbe-yougile, sbe-apstore), открытие через `openPluginSettings()`.
- Версия 0.2.4 → **0.2.5** (manifest + package.json).
- `npx tsc --noEmit` EXIT=0; `npm run build` OK.

### 2026-08-15 — v0.2.4 (required-плагины + вкладка «Пользовательские приложения»)
- `store-manager.ts` `computeState()`: для `required`-плагинов теперь учитывается факт
  установки — не установленный системный плагин (sbe-llm, sbe-yougile) получает
  состояние `'not-installed'` и кнопку «Установить» в магазине. Раньше такой плагин
  показывался «Системный» с заблокированной кнопкой «Установлен», и на чистом ПК
  LLM нельзя было скачать.
- `store-view.ts` `renderApps()`: вкладка «Пользовательские приложения» показывает
  только фактически установленные плагины (`hasView && local`); из `buildAppCard()`
  убрана ставшая мёртвой ветка «Установить».
- Версия 0.2.3 → **0.2.4** (manifest + package.json).
- `npx tsc --noEmit` EXIT=0; `npm run build` OK.

### 2026-08-15 — v0.2.3 (кэш-бастер реестра)
- `sbe-core/src/registry.ts`: `fetchJson` добавляет к запросу параметр `_t=Date.now()` —
  `requestUrl` в Obsidian отдавал закэшированный старый `registry.json` (ETag/
  `max-age=300`), из-за чего новый плагин не появлялся в магазине при обновлении
  реестра. Теперь каждый запрос уникальный (реестр и удалённые манифесты).
- Пересборка `main.js`; исходники apstore не менялись.
- `npx tsc --noEmit` EXIT=0; `npm run build` OK.
- Версия 0.2.2 → **0.2.3** (manifest + package.json).

### 2026-08-15 — v0.2.2 (sbe-tasks)
- Пересборка `main.js` после расширения sbe-core (`SbeYougileApi.client`,
  `SbeTasksApi`). Исходники не менялись.
- Версия 0.2.1 → **0.2.2** (manifest + package.json).
- `npx tsc --noEmit` EXIT=0; `npm run build` OK.

### 2026-08-15 — v0.2.1 (переименование + вкладка «Пользовательские приложения»)
- Магазин переименован в **«ЦУП СБЕ ПМиПИР»** (центр управления плагинами СБЕ ПМиПИР):
  manifest name, заголовок вьюхи, ribbon-tooltip, команды, Notices и console-строки.
- Добавлена вкладка **«Пользовательские приложения»** (первая, открывается по умолчанию):
  только плагины с `hasView`, карточки в стиле магазина с кнопками «Открыть» и «Обновить»
  (кнопка «Обновить» появляется только при доступном обновлении).
- Класс `.tn-plugin-actions` добавлен в `src/styles.css` (вместо инлайн-стиля `marginTop`).
- Версия 0.2.0 → **0.2.1** (manifest + package.json).
- `sbe-core`: строки «SBE Apstore» заменены на «ЦУП СБЕ ПМиПИР» в `bridge.ts`/`installer.ts`/`types.ts`;
  пересобраны все 4 SBE-плагина (sbe-llm, sbe-presentations, sbe-yougile, sbe-apstore).
- `npx tsc --noEmit` EXIT=0 во всех плагинах; `npm run build` OK.

### 2026-08-14 — v0.1.0 (создание)
- Плагин создан по дизайну `docs/superpowers/specs/2026-08-14-sbe-plugin-system-design.md`; встроен и включён в vault (`community-plugins.json`).
- Исправление сборки: `ctx.onEnd` — не функция → сборка styles через плагин-хук `build.onEnd`.
- Код-ревью: инлайн-стили в store-view заменены на классы `.tn-plugin-head`/`.tn-plugin-actions` (коммит `bc678ac`).
- Репозиторий: `Epyur/sbe-apstore` (public), ветка `main` (master переименована), основная ветка `main`.
- После внедрения `sbe-llm`/`sbe-presentations` в реестр апстор показывает их в магазине.
- **Примечание конвенции**: с 2026-08-14 каждая папка плагина ведёт свой `AGENTS.md` (история) + `specification.md`. Этот файл создан задним числом по конвенции.

## Статистика ошибок и отступлений

- Нарушений правил нет: 0 `any`, 0 `fetch`, 0 bare `setTimeout`, 0 инлайн-стилей,
  все `catch(e: unknown)` + `errorMessage()`. (Исключение: `(app as any).plugins`
  в механиках установки — задокументированное использование недокументированного
  API Obsidian.)
- Сборка и типы — без ошибок и предупреждений.

## Правила

- `catch(e: unknown)` + `errorMessage()` (sbe-core); `requestUrl()`; `window.setTimeout()`; без `any`; CSS-классы `tn-*`; UI на русском; автор — Полищук Евгений (polishchuk@tn.ru).