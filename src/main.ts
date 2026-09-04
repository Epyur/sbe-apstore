import { Plugin, Notice } from 'obsidian';
import { APSTORE_VIEW_TYPE, ApstoreView } from './ui/store-view';
import { ApstoreSettingsTab } from './ui/settings-tab';
import { MandatoryNewsModal } from './ui/news-modal';
import { StoreManager } from '../../sbe-core/src/store-manager';
import { AuthService } from '../../sbe-core/src/auth-client';
import { publishService, unpublishService, getService } from '../../sbe-core/src/bridge';
import { DEFAULT_REGISTRY_URL } from '../../sbe-core/src/registry';
import { errorMessage } from '../../sbe-core/src/utils/errors';
import type {
  AnnounceUpdateInput,
  InstalledPlugin,
  PluginState,
  SbeApstoreApi,
  UpdateSummary,
} from '../../sbe-core/src/types';

/** Стабильный ID секрета: ключ доступа к серверу (перезаписывается, не плодится). */
export const AUTH_KEY_SECRET = 'sbe-auth-key';

export interface ApstoreSettings {
  registryUrl: string;
  lastCheckAt: number;
  /** Адрес серверного auth-service (база URL, например https://epyur.fvds.ru). */
  apiUrl: string;
  /** Email пользователя @tn.ru для доступа к серверу. */
  email: string;
  /** UUID устройства — генерируется один раз при первом запуске. */
  deviceId: string;
  /** Версия ЦУП, для которой уже опубликована новость в канал «Новости» (announceUpdate). */
  lastAnnouncedVersion: string;
}

const DEFAULT_SETTINGS: ApstoreSettings = {
  registryUrl: DEFAULT_REGISTRY_URL,
  lastCheckAt: 0,
  apiUrl: 'https://epyur.fvds.ru',
  email: '',
  deviceId: '',
  lastAnnouncedVersion: '',
};

function generateDeviceId(): string {
  const cryptoApi = window.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }
  const hex = '0123456789abcdef';
  let s = '';
  for (let i = 0; i < 36; i++) {
    const r = Math.floor(Math.random() * 16);
    if (i === 8 || i === 13 || i === 18 || i === 23) s += '-';
    else if (i === 14) s += '4';
    else if (i === 19) s += hex[(r & 0x3) | 0x8];
    else s += hex[r];
  }
  return s;
}

export default class SbeApstorePlugin extends Plugin {
  settings!: ApstoreSettings;
  manager!: StoreManager;
  auth!: AuthService;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.manager = new StoreManager(this.app);
    this.manager.setRegistryUrl(this.settings.registryUrl);
    this.auth = this.buildAuthService();

    this.registerView(APSTORE_VIEW_TYPE, leaf => new ApstoreView(leaf, this.manager, this.auth));

    this.addRibbonIcon('brain', 'ЦУП СБЕ ПМиПИР', () => {
      void this.activateView();
    });

    this.addCommand({
      id: 'open-apstore',
      name: 'Открыть ЦУП СБЕ ПМиПИР',
      callback: () => {
        void this.activateView();
      },
    });
    this.addCommand({
      id: 'check-sbe-updates',
      name: 'Проверить обновления SBE',
      callback: () => {
        void this.checkUpdates();
      },
    });

    this.addSettingTab(new ApstoreSettingsTab(this.app, this));

    publishService<SbeApstoreApi>('sbe-apstore', this.buildApi(), {
      version: this.manifest.version,
      name: this.manifest.name,
    });

    this.app.workspace.onLayoutReady(() => {
      void this.checkUpdates(true);
      void this.checkMandatoryNews();
      void this.announceSelfUpdate();
    });
  }

  onunload(): void {
    unpublishService('sbe-apstore');
    this.app.workspace.detachLeavesOfType(APSTORE_VIEW_TYPE);
  }

  async loadSettings(): Promise<void> {
    const data = (await this.loadData() as Partial<ApstoreSettings>) || {};
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
    if (!this.settings.deviceId) {
      this.settings.deviceId = generateDeviceId();
      await this.saveSettings();
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    if (this.auth) {
      this.auth.setConfig({
        apiUrl: this.settings.apiUrl,
        email: this.settings.email,
        deviceId: this.settings.deviceId,
      });
    }
  }

  getSecretValue(secretName: string): string | null {
    try {
      const value = this.app.secretStorage?.getSecret(secretName) ?? null;
      return value && value.trim() ? value : null;
    } catch (e: unknown) {
      console.error('ЦУП: не удалось прочитать секрет:', errorMessage(e));
      return null;
    }
  }

  saveSecret(secretName: string, value: string): void {
    try {
      this.app.secretStorage?.setSecret(secretName, value);
    } catch (e: unknown) {
      console.error('ЦУП: не удалось сохранить секрет:', errorMessage(e));
    }
  }

  clearSecret(secretName: string): void {
    try {
      this.app.secretStorage?.setSecret(secretName, '');
    } catch (e: unknown) {
      console.error('ЦУП: не удалось очистить секрет:', errorMessage(e));
    }
  }

  private buildAuthService(): AuthService {
    return new AuthService(
      {
        apiUrl: this.settings.apiUrl,
        email: this.settings.email,
        deviceId: this.settings.deviceId,
      },
      {
        getKey: () => this.getSecretValue(AUTH_KEY_SECRET),
        setKey: (value) => this.saveSecret(AUTH_KEY_SECRET, value),
        clearKey: () => this.clearSecret(AUTH_KEY_SECRET),
      },
    );
  }

  async activateView(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(APSTORE_VIEW_TYPE).first();
    if (!leaf) {
      leaf = workspace.getRightLeaf(false) ?? undefined;
      if (leaf) {
        await leaf.setViewState({ type: APSTORE_VIEW_TYPE, active: true });
      }
    }
    if (leaf) {
      workspace.revealLeaf(leaf);
    }
  }

  /**
   * Проверка обновлений с уведомлением.
   * @param silent при silent=true уведомление показывается только если обновления есть
   *               (используется при автопроверке на старте Obsidian).
   */
  async checkUpdates(silent = false): Promise<UpdateSummary | null> {
    try {
      const summary = await this.manager.checkUpdates();
      this.settings.lastCheckAt = summary.checkedAt;
      await this.saveSettings();
      if (summary.updates.length > 0) {
        new Notice(
          `ЦУП: доступно обновлений: ${summary.updates.length}. Откройте ЦУП СБЕ ПМиПИР → Обновления.`,
        );
      } else if (!silent) {
        new Notice('ЦУП: обновлений нет');
      }
      return summary;
    } catch (e: unknown) {
      const msg = errorMessage(e);
      if (!silent) new Notice(`ЦУП: ошибка проверки: ${msg}`);
      console.warn('ЦУП: проверка обновлений не удалась:', msg);
      return null;
    }
  }

  /** При старте (после checkUpdates) ищет первое непрочитанное "обязательное"
   *  сообщение и открывает его модалкой — тихо, без Notice при ошибке/незалогиненности
   *  (та же логика уместна и до того, как пользователь впервые ввёл email/ключ). */
  private async checkMandatoryNews(): Promise<void> {
    if (!this.auth.getStatus().authorized) return;
    try {
      const items = await this.auth.listNews();
      const pending = items.find(n => n.mandatory && !n.read);
      if (pending) {
        new MandatoryNewsModal(this.app, this.auth, pending, () => undefined).open();
      }
    } catch (e: unknown) {
      console.warn('ЦУП: проверка обязательных новостей не удалась:', errorMessage(e));
    }
  }

  /** Публикует в канал «Новости» сообщение об обновлении самого ЦУП — один раз
   *  на версию (сравнивает с lastAnnouncedVersion). Недоступность ЦУП не должна
   *  мешать загрузке плагина — всё в try/catch. */
  private async announceSelfUpdate(): Promise<void> {
    const version = this.manifest.version;
    if (this.settings.lastAnnouncedVersion === version) return;
    try {
      const apstore = await getService('sbe-apstore');
      await apstore.announceUpdate({
        appId: this.manifest.id,
        appName: this.manifest.name,
        version,
        summary:
          'Исправлена ошибка: после обновления плагина через ЦУП без предварительного ' +
          'переоткрытия магазина иногда появлялось сообщение о несовпадении контрольной ' +
          'суммы файла, хотя файл был исправным — помогал только перезапуск Obsidian. ' +
          'Теперь этого не требуется.',
      });
      this.settings.lastAnnouncedVersion = version;
      await this.saveSettings();
    } catch (e: unknown) {
      console.warn('ЦУП: не удалось опубликовать новость об обновлении:', errorMessage(e));
    }
  }

  private buildApi(): SbeApstoreApi {
    return {
      getRegistry: async () => this.manager.getRegistry(),
      getPluginState: (id: string): PluginState => this.manager.getPluginState(id),
      install: async (id: string) => {
        await this.manager.install(id);
      },
      update: async (id: string) => {
        await this.manager.update(id);
      },
      updateAll: async () => this.manager.updateAll(),
      checkUpdates: async () => this.manager.checkUpdates(),
      listInstalled: (): InstalledPlugin[] => this.manager.listInstalled(),
      auth: {
        getStatus: () => this.auth.getStatus(),
        requestKey: async (email: string) => {
          await this.auth.requestKey(email);
        },
        activateKey: async (key: string) => {
          await this.auth.activateKey(key);
        },
        getToken: async (appId: string) => {
          // Динамический белый список выдачи токенов (ревью B4c, но из реестра,
          // не из кода): разрешены app_id серверных плагинов, помеченных `appId`
          // в registry.json, + базовый `mailer`. Если реестр ещё не загружен —
          // не блокируем (финальный страж — auth-service: /auth/token не выдаст
          // токен неизвестному приложению).
          const registryEntries = this.manager.getRegistry();
          const hasAppIdMarkers = registryEntries.some(e => !!e.appId);
          if (hasAppIdMarkers) {
            const allowed = new Set(['mailer']);
            for (const e of registryEntries) {
              if (e.appId) allowed.add(e.appId);
            }
            if (!allowed.has(appId)) {
              throw new Error(`ЦУП: приложение «${appId}» не входит в список разрешённых для выдачи токенов.`);
            }
          }
          return this.auth.getToken(appId);
        },
        listDevices: async () => this.auth.listDevices(),
        revokeDevice: async (deviceId: string) => {
          await this.auth.revokeDevice(deviceId);
        },
        getPresence: async () => this.auth.getPresence(),
        listNews: async () => this.auth.listNews(),
        createNews: async (input) => this.auth.createNews(input),
        ackNews: async (id: number) => {
          await this.auth.ackNews(id);
        },
        getNewsReads: async (id: number) => this.auth.getNewsReads(id),
        manageAppSecret: async (input) => this.auth.manageAppSecret(input),
        getAppEnvStatus: async (appId: string) => this.auth.getAppEnvStatus(appId),
        setAppEnv: async (appId: string, values: Record<string, string>) => this.auth.setAppEnv(appId, values),
        listRegistryAdditions: async () => this.auth.listRegistryAdditions(),
        addRegistryPlugin: async (plugin) => this.auth.addRegistryPlugin(plugin),
        removeRegistryAddition: async (registryId) => {
          await this.auth.removeRegistryAddition(registryId);
        },
        sendFeedback: async (input) => {
          await this.auth.sendFeedback(input);
        },
      },
      announceUpdate: async (input: AnnounceUpdateInput) => {
        await this.auth.createNews({
          title: `Обновление: ${input.appName} → v${input.version}`,
          body: input.summary,
          visibility: 'all',
          mandatory: false,
        });
      },
    };
  }
}
