import { Plugin, Notice } from 'obsidian';
import { APSTORE_VIEW_TYPE, ApstoreView } from './ui/store-view';
import { ApstoreSettingsTab } from './ui/settings-tab';
import { StoreManager } from './services/store-manager';
import { publishService, unpublishService } from '../../sbe-core/src/bridge';
import { DEFAULT_REGISTRY_URL } from '../../sbe-core/src/registry';
import { errorMessage } from '../../sbe-core/src/utils/errors';
import type {
  InstalledPlugin,
  PluginState,
  SbeApstoreApi,
  UpdateSummary,
} from '../../sbe-core/src/types';

export interface ApstoreSettings {
  registryUrl: string;
  lastCheckAt: number;
}

const DEFAULT_SETTINGS: ApstoreSettings = {
  registryUrl: DEFAULT_REGISTRY_URL,
  lastCheckAt: 0,
};

export default class SbeApstorePlugin extends Plugin {
  settings!: ApstoreSettings;
  manager!: StoreManager;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.manager = new StoreManager(this.app);
    this.manager.setRegistryUrl(this.settings.registryUrl);

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
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
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
    };
  }
}
