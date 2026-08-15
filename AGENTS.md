# AGENTS.md — sbe-apstore (ЦУП СБЕ ПМиПИР)

Магазин плагинов компании: скачивает `registry.json` из `Epyur/sbe-apstore-registry`,
устанавливает и обновляет плагины SBE из их GitHub-репозиториев (`main`-ветка).

## Структура

- `src/main.ts` — `SbeApstorePlugin`: регистрирует view и ribbon, инициализирует store.
- `src/services/store-manager.ts` — загрузка реестра (`requestUrl`, кэш `registryUrl`/`lastCheckAt` в `data.json`), установка/обновление плагинов.
- `src/ui/store-view.ts` — вкладки «Пользовательские приложения / Магазин / Установленные / Обновления» (первая открывается по умолчанию).
- `src/ui/settings-tab.ts` — URL реестра, проверка доступности.
- `src/styles.css` — классы `tn-*` поверх design-системы sbe-core.
- `manifest.json` — author: Полищук Евгений (polishchuk@tn.ru).

## Ключевые решения

- Механика установки (из `updater/`): `requestUrl` → файлы реестра → запись адаптером → `delete require.cache` → `disablePlugin(id)`/`enablePlugin(id)` через `(app as any).plugins`.
- `required: true` в реестре — системный плагин без кнопки «Установить» (только «Обновить»).
- Реестр кэшируется; проверка обновлений по кнопке в view. UI на русском.
- Сборка: `npm run build` (esbuild + `build.onEnd` для склейки tokens/components sbe-core + собственных стилей). `npx tsc --noEmit` EXIT=0.

## История работ

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