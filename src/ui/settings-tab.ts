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

    // Группы свёрнуты по умолчанию; содержимое рендерится лениво при первом раскрытии.
    this.addCollapsibleSection(containerEl, 'Доступ к серверу', (body) => this.renderAuthSection(body));
    this.addCollapsibleSection(containerEl, 'Реестр плагинов', (body) => this.renderRegistrySection(body));
    this.addCollapsibleSection(containerEl, 'Сервисные ключи (service_secret)', (body) => this.renderSecretsSection(body));
    this.addCollapsibleSection(containerEl, 'Добавить плагин в реестр', (body) => this.renderRegistryAdminSection(body));
  }

  /** Сворачиваемая группа настроек: заголовок-переключатель + тело (ленивый рендер). */
  private addCollapsibleSection(
    parent: HTMLElement,
    title: string,
    renderBody: (body: HTMLElement) => void,
  ): void {
    const head = parent.createEl('div', { cls: 'tn-collapse-head', attr: { role: 'button', tabindex: '0' } });
    const chev = head.createSpan({ cls: 'tn-collapse-chevron', text: '▸' });
    head.createSpan({ text: title });
    const body = parent.createDiv({ cls: 'tn-collapse-body collapsed' });
    let open = false;
    const setOpen = (value: boolean): void => {
      open = value;
      body.toggleClass('collapsed', !open);
      chev.setText(open ? '▾' : '▸');
      if (open && !body.dataset.rendered) {
        body.dataset.rendered = '1';
        renderBody(body);
      }
    };
    const toggle = (): void => setOpen(!open);
    head.addEventListener('click', toggle);
    head.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        toggle();
      }
    });
    setOpen(false);
  }

  /** Раздел «Добавить плагин в реестр» (admin): репозиторий нового плагина попадает
   *  в общий реестр — появляется в магазине у всех устройств. Серверная часть
   *  (контейнер) при необходимости деплоится отдельно штатным процессом. */
  private renderRegistryAdminSection(containerEl: HTMLElement): void {
    containerEl.createEl('h3', { text: 'Добавить плагин в реестр' });
    const box = containerEl.createDiv();
    void this.renderRegistryAdmin(box);
  }

  private async renderRegistryAdmin(box: HTMLElement): Promise<void> {
    box.empty();
    const { plugin } = this;
    if (!plugin.auth.getStatus().authorized) {
      box.createEl('p', { cls: 'tn-muted', text: 'Не авторизован — управление реестром недоступно.' });
      return;
    }
    try {
      const presence = await plugin.auth.getPresence();
      if (!presence.isAdmin) {
        box.createEl('p', { cls: 'tn-muted', text: 'Добавление плагинов в реестр доступно только администратору.' });
        return;
      }
    } catch (e: unknown) {
      box.createEl('p', { cls: 'tn-muted', text: `Не удалось проверить права: ${errorMessage(e)}` });
      return;
    }
    this.renderRegistryAdminForm(box);
    const listBox = box.createDiv({ cls: 'tn-apstore-mt12' });
    void this.renderRegistryAdditions(listBox);
  }

  private renderRegistryAdminForm(box: HTMLElement): void {
    box.createEl('p', {
      cls: 'tn-muted',
      text: 'Новый плагин появится в магазине у всех устройств (реестр обновляется сразу). Если у плагина есть серверная часть, задеплойте её контейнер на сервер штатным процессом.',
    });

    let name = '';
    let id = '';
    let repo = '';
    let branch = 'main';
    let ownerEmail = '';
    let hasView = true;
    let description = '';

    new Setting(box)
      .setName('ID плагина')
      .setDesc('manifest id, напр. my-cool-plugin')
      .addText(t => t.setPlaceholder('my-cool-plugin').onChange(v => { id = v.trim(); }));
    new Setting(box)
      .setName('Название')
      .addText(t => t.setPlaceholder('Мой плагин').onChange(v => { name = v.trim(); }));
    new Setting(box)
      .setName('Репозиторий GitHub')
      .setDesc('В формате owner/repo; файлы main.js/styles.css/manifest.json берутся из ветки.')
      .addText(t => t.setPlaceholder('Epyur/my-cool-plugin').onChange(v => { repo = v.trim(); }));
    new Setting(box)
      .setName('Ветка')
      .addText(t => t.setPlaceholder('main').setValue(branch).onChange(v => { branch = v.trim() || 'main'; }));
    new Setting(box)
      .setName('Owner email')
      .setDesc('Первый администратор серверной части плагина (если есть).')
      .addText(t => t.setPlaceholder('user@tn.ru').onChange(v => { ownerEmail = v.trim(); }));
    new Setting(box)
      .setName('Описание')
      .addText(t => t.setPlaceholder('Что делает плагин').onChange(v => { description = v.trim(); }));
    new Setting(box)
      .setName('Есть открываемый интерфейс')
      .setDesc('Плагин открывается из ЦУП («Открыть»).')
      .addToggle(tgl => tgl.setValue(hasView).onChange(v => { hasView = v; }));

    new Setting(box)
      .setName('Добавить в реестр')
      .setDesc('Запись сохраняется на сервере и сразу видна всем устройствам.')
      .addButton(btn => btn
        .setButtonText('➕ Добавить')
        .setCta()
        .onClick(async () => {
          if (!id || !name || !repo) {
            new Notice('ЦУП: заполните ID, название и репозиторий');
            return;
          }
          try {
            await this.plugin.auth.addRegistryPlugin({
              id,
              name,
              repo,
              branch,
              hasView,
              ownerEmail,
              description,
            });
            new Notice(`ЦУП: плагин «${name}» добавлен в реестр`);
            this.display();
          } catch (e: unknown) {
            new Notice(`ЦУП: не удалось добавить: ${errorMessage(e)}`);
          }
        }));
  }

  private async renderRegistryAdditions(box: HTMLElement): Promise<void> {
    box.empty();
    try {
      const additions = await this.plugin.auth.listRegistryAdditions();
      if (additions.length === 0) return;
      box.createEl('h4', { text: 'Добавленные через ЦУП' });
      for (const item of additions) {
        const p = item.plugin;
        new Setting(box)
          .setName(`${p.name} (${p.id})`)
          .setDesc(`repo: ${p.repo}${p.branch ? ' · ' + p.branch : ''} · добавлено ${item.createdAt ? new Date(item.createdAt).toLocaleString('ru-RU') : '-'}`)
          .addButton(btn => btn
            .setButtonText('Удалить')
            .onClick(async () => {
              try {
                await this.plugin.auth.removeRegistryAddition(item.registryId);
                new Notice(`ЦУП: «${p.name}» удалён из реестра`);
                this.display();
              } catch (e: unknown) {
                new Notice(`ЦУП: не удалось удалить: ${errorMessage(e)}`);
              }
            }));
      }
    } catch (e: unknown) {
      box.createEl('p', { cls: 'tn-muted', text: `Не удалось загрузить список: ${errorMessage(e)}` });
    }
  }

  /** Центральный раздел «Сервисные ключи» — управление service_secret всех приложений (admin). */
  private renderSecretsSection(containerEl: HTMLElement): void {
    containerEl.createEl('p', {
      cls: 'tn-muted',
      text: 'Ключи регистрации приложений в auth-service. Значение хранится только на сервере; ротация применяется автоматически в течение минуты (обновление .env и перезапуск сервиса). Доступно администратору.',
    });
    const box = containerEl.createDiv();
    void this.renderSecretApps(box);
  }

  private async renderSecretApps(box: HTMLElement): Promise<void> {
    box.empty();
    const { plugin } = this;
    if (!plugin.auth.getStatus().authorized) {
      box.createEl('p', { cls: 'tn-muted', text: 'Не авторизован — сервисные ключи недоступны.' });
      return;
    }
    box.createEl('p', { cls: 'tn-muted', text: 'Загрузка…' });
    try {
      const presence = await plugin.auth.getPresence();
      if (!presence.isAdmin) {
        box.empty();
        box.createEl('p', { cls: 'tn-muted', text: 'Управление сервисными ключами доступно только администратору.' });
        return;
      }
      box.empty();
      // Динамический список приложений из реестра (записи с `appId` — серверные
      // плагины) + базовый `mailer`. Новый серверный плагин появляется здесь
      // автоматически при добавлении записи в registry.json.
      const entries = this.plugin.manager.getRegistry();
      const apps: Array<{ id: string; name: string }> = [
        { id: 'mailer', name: 'Письма' },
      ];
      const seen = new Set<string>(['mailer']);
      for (const e of entries) {
        if (e.appId && !seen.has(e.appId)) {
          seen.add(e.appId);
          apps.push({ id: e.appId, name: e.name });
        }
      }
      for (const app of apps) {
        const card = box.createDiv({ cls: 'tn-secret-app' });
        void this.renderSecretApp(card, app.id, app.name);
      }
    } catch (e: unknown) {
      box.empty();
      box.createEl('p', { cls: 'tn-muted', text: `Ошибка: ${errorMessage(e)}` });
    }
  }

  private async renderSecretApp(card: HTMLElement, appId: string, appName: string): Promise<void> {
    card.empty();
    try {
      const st = await this.plugin.auth.manageAppSecret({ appId, action: 'status' });
      card.createEl('div', { text: appName, cls: 'tn-secret-app-name' });
      const parts: string[] = [st.set ? 'ключ задан' : 'ключ не задан'];
      if (st.updatedAt) parts.push(`изменён ${new Date(st.updatedAt).toLocaleString('ru-RU')}`);
      if (st.pending) parts.push('⚠ ротация в очереди (применится в течение минуты)');
      card.createEl('div', { text: parts.join(' · '), cls: 'tn-muted' });

      const row = card.createDiv({ cls: 'tn-secret-app-actions' });
      const syncBtn = row.createEl('button', { text: '🔁 Синхронизировать', cls: 'tn-btn tn-btn-ghost' });
      syncBtn.addEventListener('click', async () => {
        try {
          await this.plugin.auth.manageAppSecret({ appId, action: 'sync' });
          new Notice(`ЦУП: ключ «${appName}» выровнен по значению на сервере`);
          this.renderSecretApp(card, appId, appName);
        } catch (e: unknown) {
          new Notice(`ЦУП: ${errorMessage(e)}`);
        }
      });
      const rotateBtn = row.createEl('button', { text: '🔄 Перевыпустить', cls: 'tn-btn tn-btn-ghost' });
      rotateBtn.addEventListener('click', async () => {
        try {
          const res = await this.plugin.auth.manageAppSecret({ appId, action: 'rotate' });
          if (res.newSecret) {
            card.createEl('div', { text: 'Новый ключ (показывается один раз, сохраните его):', cls: 'tn-muted tn-secret-new' });
            const input = card.createEl('input', { attr: { type: 'text', value: res.newSecret, readonly: 'true' }, cls: 'tn-secret-input' });
            const copyBtn = card.createEl('button', { text: '📋 Копировать', cls: 'tn-btn tn-btn-ghost' });
            copyBtn.addEventListener('click', async () => {
              await navigator.clipboard.writeText(res.newSecret || '');
              new Notice('Ключ скопирован в буфер обмена');
            });
            card.createEl('div', { text: 'Применится автоматически в течение минуты; до применения работает старый ключ.', cls: 'tn-muted' });
            new Notice(`ЦУП: новый ключ для «${appName}» сгенерирован`);
          }
          this.renderSecretApp(card, appId, appName);
        } catch (e: unknown) {
          new Notice(`ЦУП: ${errorMessage(e)}`);
        }
      });
    } catch (e: unknown) {
      card.empty();
      card.createEl('div', { text: `${appName}: ошибка — ${errorMessage(e)}`, cls: 'tn-muted' });
    }
  }

  private renderAuthSection(containerEl: HTMLElement): void {
    const { plugin } = this;
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