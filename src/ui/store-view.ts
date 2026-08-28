import { ItemView, WorkspaceLeaf, Notice } from 'obsidian';
import { StoreManager } from '../../../sbe-core/src/store-manager';
import type { AuthService } from '../../../sbe-core/src/auth-client';
import { PresenceModal } from './presence-modal';
import { NewsModal } from './news-modal';
import { HelpModal } from './help-modal';
import { FeedbackModal } from './feedback-modal';
import { getService, isOpenable } from '../../../sbe-core/src/bridge';
import { errorMessage } from '../../../sbe-core/src/utils/errors';
import type { InstalledPlugin, PluginCard } from '../../../sbe-core/src/types';

export const APSTORE_VIEW_TYPE = 'sbe-apstore-view';

type Tab = 'apps' | 'store' | 'installed' | 'updates';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'apps', label: 'Пользовательские приложения' },
  { id: 'store', label: 'Магазин' },
  { id: 'installed', label: 'Установленные' },
  { id: 'updates', label: 'Обновления' },
];

export class ApstoreView extends ItemView {
  private manager: StoreManager;
  private auth: AuthService;
  private tab: Tab = 'apps';
  private navEl!: HTMLElement;
  private bodyEl!: HTMLElement;
  private busy = false;

  constructor(leaf: WorkspaceLeaf, manager: StoreManager, auth: AuthService) {
    super(leaf);
    this.manager = manager;
    this.auth = auth;
  }

  getViewType(): string {
    return APSTORE_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'ЦУП СБЕ ПМиПИР';
  }

  getIcon(): string {
    return 'brain';
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass('sbe-apstore');
    this.renderHeader();
    this.renderNav();
    this.bodyEl = this.contentEl.createDiv();
    this.bodyEl.createDiv({ cls: 'tn-empty', text: 'Загрузка…' });
    await this.manager.refresh();
    this.render();
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  /** Иконки над таблицей: кто онлайн, канал «Новости» (обе — модалки поверх текущей вкладки). */
  private renderHeader(): void {
    const header = this.contentEl.createDiv({ cls: 'tn-apstore-header' });

    const presenceBtn = header.createEl('button', {
      cls: 'tn-btn tn-btn-ghost',
      text: '🟢 Онлайн',
      attr: { title: 'Кто сейчас подключён к ЦУП' },
    });
    presenceBtn.addEventListener('click', () => new PresenceModal(this.app, this.auth).open());

    const newsBtn = header.createEl('button', {
      cls: 'tn-btn tn-btn-ghost',
      text: '📰 Новости',
      attr: { title: 'Сообщения от администрации и об обновлениях плагинов' },
    });
    newsBtn.addEventListener('click', () => new NewsModal(this.app, this.auth).open());

    const helpBtn = header.createEl('button', {
      cls: 'tn-btn tn-btn-ghost',
      text: '📖 Справка',
      attr: { title: 'Инструкция по работе с системой' },
    });
    helpBtn.addEventListener('click', () => new HelpModal(this.app).open());

    const feedbackBtn = header.createEl('button', {
      cls: 'tn-btn tn-btn-ghost',
      text: '✉ Обратная связь',
      attr: { title: 'Предложения и замечания по работе плагинов' },
    });
    feedbackBtn.addEventListener('click', () => new FeedbackModal(this.app, this.manager, this.auth).open());
  }

  private renderNav(): void {
    this.navEl = this.contentEl.createDiv({ cls: 'tn-nav' });
    for (const { id, label } of TABS) {
      const btn = this.navEl.createEl('button', { cls: 'tn-nav-item', text: label });
      if (id === this.tab) btn.addClass('active');
      btn.addEventListener('click', () => {
        this.tab = id;
        this.setActiveNav();
        this.render();
      });
    }
  }

  private setActiveNav(): void {
    const buttons = Array.from(this.navEl.querySelectorAll<HTMLElement>('.tn-nav-item'));
    buttons.forEach((btn, i) => btn.toggleClass('active', TABS[i]?.id === this.tab));
  }

  private render(): void {
    this.bodyEl.empty();
    switch (this.tab) {
      case 'apps':
        this.renderApps();
        break;
      case 'store':
        this.renderStore();
        break;
      case 'installed':
        this.renderInstalled();
        break;
      case 'updates':
        this.renderUpdates();
        break;
    }
  }

  /** Вкладка «Пользовательские приложения»: только фактически установленные плагины с открываемым UI (hasView). */
  private renderApps(): void {
    const cards = this.manager.getCards().filter(c => c.entry.hasView && c.local);
    const card = this.bodyEl.createDiv({ cls: 'tn-card' });
    card.createDiv({ cls: 'tn-card-head' })
      .createEl('h3', { text: 'Пользовательские приложения' });

    const grid = this.bodyEl.createDiv({ cls: 'tn-store-grid' });
    if (cards.length === 0) {
      grid.createDiv({ cls: 'tn-empty', text: 'Открываемых приложений нет' });
      return;
    }
    for (const cardData of cards) {
      grid.append(this.buildAppCard(cardData));
    }
  }

  private renderStore(): void {
    const cards = this.manager.getCards();
    const updatesCount = cards.filter(c => c.state === 'update-available').length;

    const card = this.bodyEl.createDiv({ cls: 'tn-card' });
    card.createDiv({ cls: 'tn-card-head' })
      .createEl('h3', { text: 'Магазин плагинов' });
    const info = card.createDiv({ cls: 'tn-plugin-meta' });
    info.setText(
      `Плагинов в реестре: ${cards.length} · Обновлений: ${updatesCount} · `,
    );
    const checkBtn = info.createEl('button', { cls: 'tn-btn tn-btn-ghost', text: 'Проверить обновления' });
    checkBtn.addEventListener('click', () => void this.runCheck());

    const grid = this.bodyEl.createDiv({ cls: 'tn-store-grid' });
    if (cards.length === 0) {
      grid.createDiv({ cls: 'tn-empty', text: 'Реестр недоступен. Проверьте настройки.' });
      return;
    }
    for (const cardData of cards) {
      grid.append(this.buildPluginCard(cardData));
    }
  }

  private buildPluginCard(card: PluginCard): HTMLElement {
    const el = document.createElement('div');
    el.className = 'tn-plugin-card';
    el.setAttribute('data-id', card.entry.id);

    const head = el.createDiv({ cls: 'tn-plugin-head' });
    head.createEl('h4', { text: card.entry.name });
    head.append(this.stateBadge(card));

    const desc = card.remote?.description || card.local?.description || 'Нет описания';
    el.createDiv({ cls: 'tn-plugin-desc', text: desc });

    const meta = el.createDiv({ cls: 'tn-plugin-meta' });
    const remoteV = card.remote ? `репозиторий: v${card.remote.version}` : 'репозиторий недоступен';
    const localV = card.local ? `локально: v${card.local.version}` : 'не установлен';
    meta.setText(`${remoteV} · ${localV} · ${card.entry.repo}`);

    const actions = el.createDiv({ cls: 'tn-plugin-actions' });
    actions.append(this.actionButton(card));

    return el;
  }

  /** Карточка приложения: кнопка «Открыть» и «Обновить» (только при доступном обновлении). */
  private buildAppCard(card: PluginCard): HTMLElement {
    const el = document.createElement('div');
    el.className = 'tn-plugin-card';
    el.setAttribute('data-id', card.entry.id);

    const head = el.createDiv({ cls: 'tn-plugin-head' });
    head.createEl('h4', { text: card.entry.name });
    head.append(this.stateBadge(card));

    const desc = card.remote?.description || card.local?.description || 'Нет описания';
    el.createDiv({ cls: 'tn-plugin-desc', text: desc });

    const meta = el.createDiv({ cls: 'tn-plugin-meta' });
    const remoteV = card.remote ? `репозиторий: v${card.remote.version}` : 'репозиторий недоступен';
    const localV = card.local ? `локально: v${card.local.version}` : 'не установлен';
    meta.setText(`${remoteV} · ${localV} · ${card.entry.repo}`);

    const actions = el.createDiv({ cls: 'tn-plugin-actions' });

    const openBtn = document.createElement('button');
    openBtn.className = 'tn-btn tn-btn-primary';
    openBtn.setText('Открыть');
    openBtn.addEventListener('click', () => void this.openPlugin({
      id: card.entry.id,
      dir: card.entry.dir,
      name: card.local?.name || card.entry.name,
      version: card.local?.version || '',
      description: card.local?.description,
      hasView: true,
    }));
    actions.append(openBtn);

    if (card.state === 'update-available' && card.local && card.remote) {
      const updateBtn = document.createElement('button');
      updateBtn.className = 'tn-btn tn-btn-ghost';
      updateBtn.setText(`Обновить: v${card.local.version} → v${card.remote.version}`);
      updateBtn.addEventListener('click', () => void this.install(card, true));
      actions.append(updateBtn);
    }

    const settingsBtn = document.createElement('button');
    settingsBtn.className = 'tn-btn tn-btn-ghost';
    settingsBtn.setText('⚙');
    settingsBtn.setAttr('title', `Настройки «${card.entry.name}»`);
    settingsBtn.addEventListener('click', () => this.openPluginSettings(card.entry.id, card.entry.name));
    actions.append(settingsBtn);

    return el;
  }

  private stateBadge(card: PluginCard): HTMLElement {
    const badge = document.createElement('span');
    badge.className = 'tn-badge';
    switch (card.state) {
      case 'required':
        badge.addClass('tn-badge-brand');
        badge.setText('Системный');
        break;
      case 'installed':
        badge.addClass('tn-badge-ok');
        badge.setText('Установлен');
        break;
      case 'update-available':
        badge.addClass('tn-badge-warn');
        badge.setText('Есть обновление');
        break;
      default:
        badge.addClass('tn-badge-muted');
        badge.setText('Не установлен');
    }
    return badge;
  }

  private actionButton(card: PluginCard): HTMLElement {
    const btn = document.createElement('button');
    btn.className = 'tn-btn';
    switch (card.state) {
      case 'not-installed':
        btn.addClass('tn-btn-primary');
        btn.setText('Установить');
        btn.addEventListener('click', () => void this.install(card, false));
        break;
      case 'update-available':
        btn.addClass('tn-btn-primary');
        btn.setText(`Обновить: v${card.local?.version} → v${card.remote?.version}`);
        btn.addEventListener('click', () => void this.install(card, true));
        break;
      default:
        if (card.entry.hasView) {
          btn.setText('Открыть');
          btn.addEventListener('click', () => void this.openPlugin({
            id: card.entry.id,
            dir: card.entry.dir,
            name: card.local?.name || card.entry.name,
            version: card.local?.version || '',
            description: card.local?.description,
            hasView: true,
          }));
          break;
        }
        btn.disabled = true;
        btn.classList.add('tn-btn-ghost');
        btn.setText('Установлен');
    }
    return btn;
  }

  private renderInstalled(): void {
    const installed = this.manager.listInstalled();
    const card = this.bodyEl.createDiv({ cls: 'tn-card' });
    card.createDiv({ cls: 'tn-card-head' }).createEl('h3', { text: 'Установленные плагины' });

    const wrap = card.createDiv({ cls: 'tn-table-wrap' });
    const table = wrap.createEl('table', { cls: 'tn-table' });
    const thead = table.createEl('thead');
    const headRow = thead.createEl('tr');
    for (const th of ['Плагин', 'Настройки', 'ID', 'Версия', 'Описание']) {
      headRow.createEl('th', { text: th });
    }
    const tbody = table.createEl('tbody');
    for (const p of installed) {
      const row = tbody.createEl('tr');
      const nameCell = row.createEl('td');
      if (p.hasView) {
        const nameBtn = nameCell.createEl('button', {
          cls: 'tn-btn tn-btn-link',
          text: p.name,
          attr: { title: 'Открыть' },
        });
        nameBtn.addEventListener('click', () => void this.openPlugin(p));
      } else {
        nameCell.createSpan({ text: p.name });
      }
      const settingsCell = row.createEl('td');
      const settingsBtn = settingsCell.createEl('button', {
        cls: 'tn-btn tn-btn-ghost',
        text: '⚙',
        attr: { title: `Настройки «${p.name}»` },
      });
      settingsBtn.addEventListener('click', () => this.openPluginSettings(p.id, p.name));
      row.createEl('td', { text: p.id });
      row.createEl('td', { text: `v${p.version}` });
      row.createEl('td', { text: p.description || '—' });
    }
    if (installed.length === 0) {
      tbody.createEl('tr').createEl('td', {
        cls: 'tn-empty',
        text: 'Установленных плагинов из реестра нет',
      }).colSpan = 5;
    }
  }

  /** Открывает UI плагина (hasView) через его опубликованный сервис. */
  private async openPlugin(p: InstalledPlugin): Promise<void> {
    try {
      const service = await getService(p.id as keyof import('../../../sbe-core/src/types').SbeServiceMap);
      if (!isOpenable(service)) {
        new Notice(`ЦУП: у плагина «${p.name}» нет открываемого UI`);
        return;
      }
      await service.open();
    } catch (e: unknown) {
      new Notice(`ЦУП: ${errorMessage(e)}`);
    }
  }

  /** Открывает настройки плагина через недокументированное API app.setting.openTabById. */
  private openPluginSettings(id: string, name: string): void {
    try {
      const appSetting = (this.app as unknown as { setting?: unknown }).setting;
      if (!appSetting) throw new Error('Настройки Obsidian недоступны');
      const settingModal = appSetting as {
        open?: () => void;
        openTabById?: (tabId: string) => unknown;
        pluginTabs?: Array<{ id?: string }>;
      };
      if (settingModal.pluginTabs && !settingModal.pluginTabs.some(t => t.id === id)) {
        new Notice(`ЦУП: у плагина «${name}» нет настроек`);
        return;
      }
      settingModal.open?.();
      settingModal.openTabById?.(id);
    } catch (e: unknown) {
      new Notice(`ЦУП: не удалось открыть настройки «${name}» — ${errorMessage(e)}`);
    }
  }

  private renderUpdates(): void {
    const updates = this.manager
      .getCards()
      .filter(c => c.state === 'update-available' && c.local && c.remote);

    const card = this.bodyEl.createDiv({ cls: 'tn-card' });
    const head = card.createDiv({ cls: 'tn-card-head' });
    head.createEl('h3', { text: `Доступные обновления (${updates.length})` });

    if (updates.length > 0) {
      const btn = head.createEl('button', { cls: 'tn-btn tn-btn-primary', text: 'Обновить все' });
      btn.addEventListener('click', () => void this.updateAll());
    }

    if (updates.length === 0) {
      card.createDiv({ cls: 'tn-empty', text: 'Обновлений нет. Все плагины актуальны.' });
      return;
    }

    const wrap = card.createDiv({ cls: 'tn-table-wrap' });
    const table = wrap.createEl('table', { cls: 'tn-table' });
    const headRow = table.createEl('thead').createEl('tr');
    for (const th of ['Плагин', 'Текущая', 'Доступна', '']) {
      headRow.createEl('th', { text: th });
    }
    const tbody = table.createEl('tbody');
    for (const c of updates) {
      const row = tbody.createEl('tr');
      row.createEl('td', { text: c.entry.name });
      row.createEl('td', { text: `v${c.local?.version}` });
      row.createEl('td', { text: `v${c.remote?.version}` });
      const actionCell = row.createEl('td');
      const btn = actionCell.createEl('button', { cls: 'tn-btn tn-btn-ghost', text: 'Обновить' });
      btn.addEventListener('click', () => void this.install(c, true));
    }
  }

  private async runCheck(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const summary = await this.manager.checkUpdates();
      this.render();
      new Notice(
        summary.updates.length > 0
          ? `ЦУП: доступно обновлений: ${summary.updates.length}`
          : 'ЦУП: обновлений нет',
      );
    } catch (e: unknown) {
      new Notice(`ЦУП: ошибка проверки: ${errorMessage(e)}`);
    } finally {
      this.busy = false;
    }
  }

  private async install(card: PluginCard, update: boolean): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      if (update) {
        await this.manager.update(card.entry.id);
        new Notice(`ЦУП: «${card.entry.name}» обновлён`);
      } else {
        await this.manager.install(card.entry.id);
        new Notice(`ЦУП: «${card.entry.name}» установлен`);
      }
      this.render();
    } catch (e: unknown) {
      new Notice(`ЦУП: ${errorMessage(e)}`);
    } finally {
      this.busy = false;
    }
  }

  private async updateAll(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const res = await this.manager.updateAll();
      this.render();
      new Notice(
        res.failed.length === 0
          ? `ЦУП: обновлено: ${res.updated.length}`
          : `ЦУП: обновлено ${res.updated.length}, ошибок: ${res.failed.length}`,
      );
    } catch (e: unknown) {
      new Notice(`ЦУП: ${errorMessage(e)}`);
    } finally {
      this.busy = false;
    }
  }
}
