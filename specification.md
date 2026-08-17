# specification.md — sbe-apstore (ЦУП СБЕ ПМиПИР)

## 1. Идентификация

- `manifest.id`: `sbe-apstore`
- Имя: ЦУП СБЕ ПМиПИР (центр управления плагинами СБЕ ПМиПИР)
- Автор: Полищук Евгений (polishchuk@tn.ru)
- Зависимости: **runtime** — нет (потребляет GitHub raw и мост `window.SBE`); **build** — `sbe-core`.

## 2. Внешние эндпоинты

| Метод | URL | Назначение |
|---|---|---|
| GET | `https://raw.githubusercontent.com/Epyur/sbe-apstore-registry/main/registry.json` | Реестр плагинов (`RegistryData`, кэшируется) |
| GET | `https://raw.githubusercontent.com/Epyur/{repo}/main/{manifest.json\|main.js\|styles.css}` | Файлы устанавливаемого/обновляемого плагина |

### Авторизация (auth-service, `apiUrl` в настройках, по умолчанию `https://epyur.fvds.ru`)

| Метод | URL | Назначение |
|---|---|---|
| POST | `{apiUrl}/auth/request-key` | `{email, device_id}` → ключ на email |
| POST | `{apiUrl}/auth/activate-key` | `{email, device_id, key}` → активация |
| POST | `{apiUrl}/auth/token` | `{key, app_id}` → JWT (кэшируется до истечения) |
| GET | `{apiUrl}/auth/devices` | список устройств (Bearer `<key>`) |
| DELETE | `{apiUrl}/auth/devices/{device_id}` | отзыв устройства (Bearer `<key>`) |

Запросы через `requestUrl` (не `fetch`), клиентский таймаут 15 с. Реестр-URL настраивается в settings (`registryUrl`).

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
| `auth` | `SbeAuthApi` | Серверная авторизация (ключ + JWT), см. ниже |

### Подсервис `auth` (тип `SbeAuthApi` в sbe-core)

| Метод | Сигнатура | Описание |
|---|---|---|
| `getStatus` | `() => { authorized: boolean; email?: string }` | Авторизован ли ключ для текущего email |
| `requestKey` | `(email: string) => Promise<void>` | Шаг 2: ключ на email |
| `activateKey` | `(key: string) => Promise<void>` | Шаг 4: активация + сохранение в secretStorage |
| `getToken` | `(appId: string) => Promise<string>` | Шаг 5: JWT для plugin-service (кэш до истечения) |
| `listDevices` | `() => Promise<DeviceInfo[]>` | Список устройств владельца |
| `revokeDevice` | `(deviceId: string) => Promise<void>` | Отзыв устройства (своё — снимает и ключ) |

Ключ хранится в secretStorage Obsidian (стабильный секрет `sbe-auth-key`); `deviceId` — UUID в `data.json`.
При 401/403 ключ очищается и выдаётся понятная ошибка.

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
  "lastCheckAt": 0,
  "apiUrl": "https://epyur.fvds.ru",
  "email": "user@tn.ru",
  "deviceId": "uuid-v4 (генерируется один раз при первом запуске)"
}
```

`data.json` исключён из git (`.gitignore`). `deviceId` генерируется автоматически (UUID v4),
если отсутствует. Email вводит пользователь в настройках.

## 6. Ошибки

- Сеть/404 (напр. файл ещё не на `main`) → `errorMessage()`, Notice «реестр недоступен» с причиной; при автопроверке на старте (`silent`) — только console.warn.
- Частичная установка: если один из файлов не скачался — прервать, не перезаписывать остальные.

## 7. Сборка и проверка

- `npm install` → `npm run build` (esbuild + `build.onEnd`: tokens/components sbe-core + собственные `tn-*` стили) → `npx tsc --noEmit` (EXIT=0).
- Релизные файлы: `main.js`, `styles.css`, `manifest.json`, `README.md`.