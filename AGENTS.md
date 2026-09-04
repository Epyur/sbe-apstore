# AGENTS.md — sbe-apstore (ЦУП СБЕ ПМиПИР)

Магазин плагинов компании: скачивает `registry.json` (реверс-проксируется через
`auth-service`, физически `epyur.fvds.ru/registry.json`), устанавливает и обновляет плагины
SBE. Файлы плагина (`manifest.json`/`main.js`/`styles.css`) берутся с `epyur.fvds.ru/plugins/
<dir>/*` (собственный сервер), если у записи реестра `selfHosted: true` — это единственный
путь для всех 17 плагинов реестра на 2026-09-03; GitHub-репозиторий плагина
(`raw.githubusercontent.com/<repo>/<branch>/*`) остаётся резервным путём для клиентов со
старым `sbe-core`, не понимающим поле `selfHosted` (см.
`docs/superpowers/specs/2026-08-29-sbe-plugin-file-upload-design.md`).

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

### 2026-09-04 — v0.3.16 (фикс `apply()`: обновление сверяло хэш со старым реестром)

- **Живая жалоба пользователя**, повторявшаяся несколько раз за сессию:
  обновление плагина через ЦУП периодически падало с «Контрольная сумма не
  совпадает» на полностью корректном файле — помогал только перезапуск
  Obsidian. Причина (`sbe-core/src/store-manager.ts`, `apply()`, общий код
  `install()`/`update()`): хэш для сверки брался из `this.registry` —
  реестра, загруженного в память при старте Obsidian/последнем открытии
  магазина, — а свежий `registry.json` подтягивался только ПОСЛЕ установки.
  Если хэши на сервере обновили (новый релиз) уже после того, как ЦУП
  загрузил реестр в память, — `installPlugin` скачивал новый файл, но
  сверял его со старым хэшем из памяти. Перезапуск «чинил» проблему только
  потому, что заново грузил реестр — сервер всё это время был консистентен
  (перепроверено напрямую: hash `registry.json` совпадал с реально
  отдаваемыми файлами при каждой проверке).
- **Фикс** (`sbe-core`, ветка `backend`, см. его `AGENTS.md`): `apply()`
  теперь зовёт `await this.refresh()` в начале, до чтения `entry.hashes`.
- `npx tsc --noEmit` EXIT=0, `npm run build` OK. Версия 0.3.15 → **0.3.16**.

### 2026-09-02 — v0.3.15 (фикс `isNewer()`: суффикс `b` ложно триггерил «доступно обновление»)
- **Баг** (`sbe-core/src/registry.ts:25`, `isNewer(remote, local)`): версия
  сравнивалась через `local.split('.').map(Number)` — сегмент с буквенным
  суффиксом backend-версии (например `"5b"` в `0.1.5b`, см. правило про
  суффикс `b` в корневом `AGENTS.md`) даёт `Number("5b") = NaN`, а
  `NaN || 0` в цикле сравнения тихо обнулял этот сегмент. Локальная версия
  `0.1.5b` (реально более новая) выглядела как `0.1.0` и проигрывала
  сравнение старой версии на `main` (`0.1.4`) — ЦУП ложно предлагал
  «обновление» до версии СТАРШЕ уже установленной, у любого плагина,
  версия которого хоть раз бампалась на `backend` без синхронизации с `main`
  (обнаружено на `sbe-llm`/`sbe-photobank` сразу после их v0.1.5b/v0.1.20b).
- **Фикс**: `parseVersionSegment()` — `parseInt(seg, 10) || 0` вместо
  `Number(seg)` — читает числовой префикс сегмента и отбрасывает буквенный
  хвост (`"5b"` → `5`), а не превращает его в `NaN`/`0`. Проверено node-скриптом
  на всех комбинациях (с суффиксом/без, реальное обновление/ложное) — см.
  историю сессии. `sbe-core` не версионируется отдельно — фикс учтён
  в его собственном `AGENTS.md`.
- Версия 0.3.14 → **0.3.15** (manifest + package.json). `npx tsc --noEmit`
  EXIT=0, `npm run build` OK. Реестр: hashes `manifest`/`main` обновлены
  (`styles.css` не менялся — хеш тот же).

### 2026-08-31 — фикс живого инцидента: «Контрольная сумма не совпадает» у тех, кто давно не обновлялся

По жалобе на повторную проблему установки ЦУП сверил хеши в трёх местах:
GitHub `Epyur/sbe-apstore` (main, raw) был на **0.3.13**, живой
`https://epyur.fvds.ru/registry.json` уже указывал на **0.3.14**
(`selfHosted: true`, самораздача через «Мои плагины» от 2026-08-29) с
хешами, которых на GitHub ещё не было. Локальная рабочая копия (незакоммиченные
правки v0.3.14 из предыдущей сессии) побайтово совпадала с самораздачей.

Клиенты со старым `sbe-core` (до 2026-08-29, не знающим про `selfHosted`) при
самообновлении всегда идут на `raw.githubusercontent.com` — получали там
**0.3.13** и падали на сверке с хешем реестра, рассчитанным под **0.3.14**:
«Контрольная сумма main.js не совпадает... Установка прервана.» Именно это
и видели те, кто давно не обновлялся.

Исправление:
1. Закоммичены и запушены в GitHub локальные правки v0.3.14 (коммит `7f709f6`).
2. Обнаружена вторая часть проблемы: обычный `git commit` на Windows
   (`core.autocrlf=true`) нормализовал `\r\n` → `\n` в `manifest.json`,
   меняя его SHA-256 относительно того, что реально захэшировано на
   самораздаче (`main.js`/`styles.css` — эсбилд-вывод, уже LF, не пострадали).
   Добавлен `.gitattributes` (`-text` на все три файла из `INSTALL_FILES`),
   `manifest.json` renormalize, коммит `b8cc651` — хеши блобов в git теперь
   побайтово совпадают с самораздачей.
3. `raw.githubusercontent.com` после пуша перепроверен — отдаёт 0.3.14,
   все три хеша сошлись.
4. `sbe-apstore-registry` (git) обновлён под факт живого сервера
   (`selfHosted`, новые хеши, `uploadedAt`/`uploadedBy`) — был рассинхронизирован
   с боевым реестром; подробности и обязательный порядок для будущих
   `selfHosted`-загрузок — в его собственном `AGENTS.md`.

Заодно найден (но не исправлен — вне текущего запроса) такой же рассинхрон
у `sbe-photobank` (self-hosted upload 2026-08-30) — тому же классу клиентов
грозит та же ошибка при обновлении фотобанка.

### 2026-08-30 — v0.3.14 (фикс — карточка плагина показывала GitHub repo даже при selfHosted)

Живая находка сразу после первого реального использования «Мои плагины»: карточка
в `store-view.ts` (`buildPluginCard`/`buildAppCard`) в строке meta всегда показывала
`card.entry.repo`, даже когда запись уже `selfHosted: true` (файлы реально раздаются
с `epyur.fvds.ru/plugins/<dir>`, а не с GitHub). Не влияло на установку/обновление
(те уже используют `pluginFileUrl` с учётом `selfHosted`) — чисто отображение вводило
в заблуждение. Теперь meta показывает `файлы: ЦУП (epyur.fvds.ru)` вместо repo, когда
`selfHosted` — та же формулировка, что уже была в `renderMyPluginsSection` (settings-tab).

- `npx tsc --noEmit`, `npm run build` — чисто. Версия 0.3.13 → **0.3.14**.

### 2026-08-29 — v0.3.13 (раздел «Мои плагины» — ручная загрузка файлов)

Новый раздел настроек «Мои плагины» — владелец плагина (`ownerEmail` записи реестра
совпадает с текущим email) или admin (видит все) заливает собранные
`main.js`/`manifest.json`/`styles.css` через форму, без доступа к серверу по SSH.
Полная история (бэкенд, хранение, клиент) — `sbe-core/AGENTS.md`. Только загрузка
файлов для УЖЕ существующей записи — регистрация нового плагина остаётся в разделе
«Добавить плагин в реестр» (`handleRegistryAdd`, не тронут).

- `npx tsc --noEmit`, `npm run build` — чисто. Версия 0.3.12 → **0.3.13**.

### 2026-08-28 — v0.3.12 (динамический список приложений в «Сервисных ключах»)
- Список приложений в разделе «Сервисные ключи» (settings-tab `renderSecretApps`)
  переведён с хардкода на **динамический из реестра**: базовый `mailer` + записи
  `registry.json` с `appId` (по имени из реестра). Новый серверный плагин появляется
  здесь автоматически при добавлении записи в реестр — без бампа ЦУП.
- Связано с v0.3.11: без этого «LogicTEAM.Фотобанк» (`appId=photo`) не был виден
  в списке приложений, получивших сервисный ключ.
- Версия 0.3.11 → **0.3.12** (manifest + package.json). `npx tsc --noEmit` EXIT=0;
  `npm run build` OK. Реестр: hashes sbe-apstore обновлены, синхронизированы на сервер.

### 2026-08-28 — v0.3.11 (токены для `photo` + динамический белый список из реестра)
- **Проблема**: `photo` не был в белом списке выдачи токенов (ревью B4c, v0.3.8) —
  плагин «LogicTEAM.Фотобанк» падал `ЦУП: приложение «photo» не входит в список
  разрешённых для выдачи токенов` на кнопках «Загрузить»/«Импорт папки».
- **Решение**: (1) `photo` добавлен в выдачу; (2) белый список переведён с хардкода
  в коде на **динамический из реестра** — `getToken` строит `Set` из записей
  `registry.json` с полем `appId` (+ базовый `mailer`); реестр ещё не загружен —
  не блокируем (финальный страж — auth-service `/auth/token` не выдаст токен
  неизвестному приложению). Теперь новый серверный плагин = запись в реестре
  с `appId`, без бампа ЦУП.
- `sbe-core`: `RegistryPluginEntry.appId?: string` (маркер «есть серверная часть»).
  Реестр: `appId` добавлен серверным плагинам (photo/agent/contacts/lab/ekn/lab/
  documents/mailer), hashes sbe-apstore обновлены, синхронизированы на сервер.
- Версия 0.3.10 → **0.3.11** (manifest + package.json). `npx tsc --noEmit` EXIT=0;
  `npm run build` OK.

### 2026-08-28 — v0.3.10 (Справка + Обратная связь)
- В белый список выдачи токенов (`ALLOWED_TOKEN_APPS` в `src/main.ts:276`, ревью B4c)
  добавлен `photo` — без этого плагин «LogicTEAM.Фотобанк» не мог получить JWT
  (`ЦУП: приложение «photo» не входит в список разрешённых для выдачи токенов`),
  кнопки «Загрузить»/«Импорт папки» падали с этой ошибкой.
- Версия 0.3.10 → **0.3.11** (manifest + package.json). `npx tsc --noEmit` EXIT=0;
  `npm run build` OK. Реестр: hashes sbe-apstore обновлены, синхронизированы на сервер.

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