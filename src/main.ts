import { Plugin, Notice } from 'obsidian';
import { APSTORE_VIEW_TYPE, ApstoreView } from './ui/store-view';
import { ApstoreSettingsTab } from './ui/settings-tab';
import { StoreManager } from './services/store-manager';
import { AuthService } from './services/auth-service';
import { publishService, unpublishService } from '../../sbe-core/src/bridge';
import { DEFAULT_REGISTRY_URL } from '../../sbe-core/src/registry';
import { errorMessage } from '../../sbe-core/src/utils/errors';
import type {
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
}

const DEFAULT_SETTINGS: ApstoreSettings = {
  registryUrl: DEFAULT_REGISTRY_URL,
  lastCheckAt: 0,
  apiUrl: 'https://epyur.fvds.ru',
  email: '',
  deviceId: '',
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

    this.registerView(APSTORE_VIEW_TYPE, leaf => new ApstoreView(leaf, this.manager));

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
        getToken: async (appId: string) => this.auth.getToken(appId),
        listDevices: async () => this.auth.listDevices(),
        revokeDevice: async (deviceId: string) => {
          await this.auth.revokeDevice(deviceId);
        },
      },
    };
  }
}
