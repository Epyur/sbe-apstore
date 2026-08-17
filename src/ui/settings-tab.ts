import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type SbeApstorePlugin from '../main';
import { errorMessage } from '../../../sbe-core/src/utils/errors';

export class ApstoreSettingsTab extends PluginSettingTab {
  private plugin: SbeApstorePlugin;

  constructor(app: App, plugin: SbeApstorePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'ЦУП СБЕ ПМиПИР' });

    this.renderAuthSection(containerEl);
    this.renderRegistrySection(containerEl);
  }

  private renderAuthSection(containerEl: HTMLElement): void {
    const { plugin } = this;
    containerEl.createEl('h3', { text: 'Доступ к серверу' });
    containerEl.createEl('p', {
      cls: 'tn-muted',
      text: 'Авторизация на сервере SBE: ключ на пару «email + устройство», JWT выдаётся по требованию для серверных плагинов.',
    });

    new Setting(containerEl)
      .setName('Адрес сервера')
      .setDesc('Базовый URL серверного auth-service (без слэша в конце).')
      .addText(text => text
        .setPlaceholder('https://epyur.fvds.ru')
        .setValue(plugin.settings.apiUrl)
        .onChange(async (value) => {
          plugin.settings.apiUrl = value.trim();
          await plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Email')
      .setDesc('Корпоративный адрес @tn.ru — на него придёт ключ доступа.')
      .addText(text => text
        .setPlaceholder('user@tn.ru')
        .setValue(plugin.settings.email)
        .onChange(async (value) => {
          plugin.settings.email = value.trim();
          await plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Получить ключ')
      .setDesc('Ключ придёт письмом на email. Вставьте его в поле ниже и нажмите «Активировать».')
      .addButton(btn => btn
        .setButtonText('Получить ключ')
        .setCta()
        .onClick(() => {
          void this.requestKey();
        }));

    let keyInput = '';
    new Setting(containerEl)
      .setName('Активировать ключ')
      .setDesc('Ключ из письма. Хранится защищённо (secretStorage).')
      .addText(text => {
        text.inputEl.type = 'password';
        text.setPlaceholder('ключ из письма');
        text.onChange((value) => {
          keyInput = value.trim();
        });
        return text;
      })
      .addButton(btn => btn
        .setButtonText('Активировать')
        .setCta()
        .onClick(() => {
          void this.activateKey(keyInput);
        }));

    const status = plugin.auth.getStatus();
    new Setting(containerEl)
      .setName('Статус')
      .setDesc(
        status.authorized
          ? `Авторизован: ${status.email ?? ''} · устройство ${plugin.settings.deviceId}`
          : `Не авторизован · устройство ${plugin.settings.deviceId}. Запросите ключ и активируйте устройство.`,
      )
      .addButton(btn => btn
        .setButtonText('Обновить')
        .onClick(() => {
          this.display();
        }));

    containerEl.createEl('h4', { text: 'Устройства' });
    void this.renderDevices(containerEl);
  }

  private renderRegistrySection(containerEl: HTMLElement): void {
    const { plugin } = this;
    containerEl.createEl('h3', { text: 'Реестр плагинов' });

    new Setting(containerEl)
      .setName('URL реестра')
      .setDesc('Адрес registry.json на GitHub (raw.githubusercontent.com).')
      .addText(text => text
        .setPlaceholder('https://raw.githubusercontent.com/.../registry.json')
        .setValue(this.plugin.settings.registryUrl)
        .onChange(async (value) => {
          this.plugin.settings.registryUrl = value.trim();
          this.plugin.manager.setRegistryUrl(this.plugin.settings.registryUrl);
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Проверить обновления')
      .setDesc('Скачать реестр и сравнить версии всех плагинов.')
      .addButton(btn => btn
        .setButtonText('Проверить')
        .setCta()
        .onClick(() => {
          void this.plugin.checkUpdates();
        }));

    new Setting(containerEl)
      .setName('Последняя проверка')
      .setDesc(
        this.plugin.settings.lastCheckAt > 0
          ? new Date(this.plugin.settings.lastCheckAt).toLocaleString('ru-RU')
          : 'Проверок ещё не было',
      );
  }

  private async requestKey(): Promise<void> {
    const { plugin } = this;
    const email = plugin.settings.email.trim();
    if (!email) {
      new Notice('ЦУП: укажите email в настройках');
      return;
    }
    try {
      await plugin.auth.requestKey(email);
      new Notice(`ЦУП: ключ отправлен на ${email}. Проверьте почту.`);
      this.display();
    } catch (e: unknown) {
      new Notice(`ЦУП: не удалось получить ключ: ${errorMessage(e)}`);
    }
  }

  private async activateKey(key: string): Promise<void> {
    const { plugin } = this;
    if (!plugin.settings.email.trim()) {
      new Notice('ЦУП: укажите email в настройках');
      return;
    }
    if (!key) {
      new Notice('ЦУП: вставьте ключ из письма');
      return;
    }
    try {
      await plugin.auth.activateKey(key);
      new Notice('ЦУП: устройство активировано');
      this.display();
    } catch (e: unknown) {
      new Notice(`ЦУП: активация не удалась: ${errorMessage(e)}`);
    }
  }

  private async renderDevices(containerEl: HTMLElement): Promise<void> {
    const { plugin } = this;
    const listEl = containerEl.createDiv({ cls: 'tn-devices' });
    if (!plugin.auth.getStatus().authorized) {
      listEl.createEl('p', { cls: 'tn-muted', text: 'Нет ключа — список устройств недоступен.' });
      return;
    }
    listEl.createEl('p', { cls: 'tn-muted', text: 'Загрузка…' });
    try {
      const devices = await plugin.auth.listDevices();
      listEl.empty();
      if (devices.length === 0) {
        listEl.createEl('p', { cls: 'tn-muted', text: 'Устройств нет.' });
        return;
      }
      for (const device of devices) {
        new Setting(listEl)
          .setName(device.label || device.deviceId)
          .setDesc(
            `статус: ${device.keyStatus || '-'} · создано: ${
              device.createdAt ? new Date(device.createdAt).toLocaleString('ru-RU') : '-'
            }`,
          )
          .addButton(btn => btn
            .setButtonText('Отозвать')
            .onClick(() => {
              void this.revokeDevice(device.deviceId);
            }));
      }
    } catch (e: unknown) {
      listEl.empty();
      listEl.createEl('p', { cls: 'tn-muted', text: `Ошибка загрузки устройств: ${errorMessage(e)}` });
    }
  }

  private async revokeDevice(deviceId: string): Promise<void> {
    try {
      await this.plugin.auth.revokeDevice(deviceId);
      new Notice(`ЦУП: устройство ${deviceId} отозвано`);
      this.display();
    } catch (e: unknown) {
      new Notice(`ЦУП: не удалось отозвать устройство: ${errorMessage(e)}`);
    }
  }
}