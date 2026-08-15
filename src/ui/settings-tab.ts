import { App, PluginSettingTab, Setting } from 'obsidian';
import type SbeApstorePlugin from '../main';

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
}
