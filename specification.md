# specification.md — sbe-apstore (SBE Apstore)

## 1. Идентификация

- `manifest.id`: `sbe-apstore`
- Имя: SBE Apstore
- Автор: Полищук Евгений (polishchuk@tn.ru)
- Зависимости: **runtime** — нет (потребляет GitHub raw и мост `window.SBE`); **build** — `sbe-core`.

## 2. Внешние эндпоинты

| Метод | URL | Назначение |
|---|---|---|
| GET | `https://raw.githubusercontent.com/Epyur/sbe-apstore-registry/main/registry.json` | Реестр плагинов (`RegistryData`, кэшируется) |
| GET | `https://raw.githubusercontent.com/Epyur/{repo}/main/{manifest.json\|main.js\|styles.css}` | Файлы устанавливаемого/обновляемого плагина |

Запросы через `requestUrl` (не `fetch`). Реестр-URL настраивается в settings (`registryUrl`).

## 3. Публикуемый сервис (мост `window.SBE`)

Идентификатор: `sbe-apstore` (тип `SbeApstoreApi` в `sbe-core/src/types.ts`).

| Метод | Сигнатура | Описание |
|---|---|---|
| `getRegistry` | `() => Promise<RegistryData>` | Актуальный реестр (сетевой, не кэш) |
| `getPluginState` | `(id: string) => PluginState` | `'installed'\|'updates'\|'not-installed'` по сравн. версий |
| `install` | `(id: string) => Promise<void>` | Скачать файлы + включить плагин |
| `update` | `(id: string) => Promise<void>` | Перезаписать файлы + перезапустить плагин |
| `updateAll` | `() => Promise<UpdateSummary>` | Обновить все доступные |
| `checkUpdates` | `() => Promise<UpdateSummary>` | Проверка без применения |
| `listInstalled` | `() => InstalledPlugin[]` | Список установленных плагинов |

## 4. Установка/обновление (механика)

1. Загрузить `manifest.json`/`main.js`/`styles.css` с `main`-ветки `Epyur/{repo}`.
2. Записать в папку `dir` плагина через vault adapter.
3. `delete require.cache[resolve(dir/main.js)]` — чтобы загружался новый код.
4. `(app as any).plugins.disablePlugin(id)` → `enablePlugin(id)`.
- `required: true` в реестре → плагин показан как системный (без «Установить», только «Обновить»).
- Неиспользуемые/битые плагины: файлы не удаляются, состояние определяется по версии.

## 5. Данные (`data.json`)

```ts
{
  "registryUrl": "https://raw.githubusercontent.com/Epyur/sbe-apstore-registry/main/registry.json",
  "lastCheckAt": 0
}
```

`data.json` исключён из git (`.gitignore`).

## 6. Ошибки

- Сеть/404 (напр. файл ещё не на `main`) → `errorMessage()`, Notice «реестр недоступен» с причиной; при автопроверке на старте (`silent`) — только console.warn.
- Частичная установка: если один из файлов не скачался — прервать, не перезаписывать остальные.

## 7. Сборка и проверка

- `npm install` → `npm run build` (esbuild + `build.onEnd`: tokens/components sbe-core + собственные `tn-*` стили) → `npx tsc --noEmit` (EXIT=0).
- Релизные файлы: `main.js`, `styles.css`, `manifest.json`, `README.md`.