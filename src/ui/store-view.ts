import { ItemView, WorkspaceLeaf, Notice } from 'obsidian';
import { StoreManager } from '../services/store-manager';
import { getService, isOpenable } from '../../../sbe-core/src/bridge';
import { errorMessage } from '../../../sbe-core/src/utils/errors';
import type { InstalledPlugin, PluginCard } from '../../../sbe-core/src/types';

export const APSTORE_VIEW_TYPE = 'sbe-apstore-view';

type Tab = 'store' | 'installed' | 'updates';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'store', label: 'Магазин' },
  { id: 'installed', label: 'Установленные' },
  { id: 'updates', label: 'Обновления' },
];

export class ApstoreView extends ItemView {
  private manager: StoreManager;
  private tab: Tab = 'store';
  private navEl!: HTMLElement;
  private bodyEl!: HTMLElement;
  private loaded = false;
  private busy = false;

  constructor(leaf: WorkspaceLeaf, manager: StoreManager) {
    super(leaf);
    this.manager = manager;
  }

  getViewType(): string {
    return APSTORE_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'SBE Apstore';
  }

  getIcon(): string {
    return 'store';
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass('sbe-apstore');
    this.renderNav();
    this.bodyEl = this.contentEl.createDiv();
    this.bodyEl.createDiv({ cls: 'tn-empty', text: 'Загрузка…' });
    if (!this.loaded) {
      await this.manager.refresh();
      this.loaded = true;
    }
    this.render();
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
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

    const actions = el.createDiv();
    actions.style.marginTop = '8px';
    actions.append(this.actionButton(card));

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
    for (const th of ['Плагин', 'ID', 'Версия', 'Описание', '']) {
      headRow.createEl('th', { text: th });
    }
    const tbody = table.createEl('tbody');
    for (const p of installed) {
      const row = tbody.createEl('tr');
      row.createEl('td', { text: p.name });
      row.createEl('td', { text: p.id });
      row.createEl('td', { text: `v${p.version}` });
      row.createEl('td', { text: p.description || '—' });
      const actionCell = row.createEl('td');
      if (p.hasView) {
        const openBtn = actionCell.createEl('button', { cls: 'tn-btn tn-btn-ghost', text: 'Открыть' });
        openBtn.addEventListener('click', () => void this.openPlugin(p));
      } else {
        actionCell.setText('—');
      }
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
        new Notice(`SBE Apstore: у плагина «${p.name}» нет открываемого UI`);
        return;
      }
      await service.open();
    } catch (e: unknown) {
      new Notice(`SBE Apstore: ${errorMessage(e)}`);
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
          ? `SBE Apstore: доступно обновлений: ${summary.updates.length}`
          : 'SBE Apstore: обновлений нет',
      );
    } catch (e: unknown) {
      new Notice(`SBE Apstore: ошибка проверки: ${errorMessage(e)}`);
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
        new Notice(`SBE Apstore: «${card.entry.name}» обновлён`);
      } else {
        await this.manager.install(card.entry.id);
        new Notice(`SBE Apstore: «${card.entry.name}» установлен`);
      }
      this.render();
    } catch (e: unknown) {
      new Notice(`SBE Apstore: ${errorMessage(e)}`);
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
          ? `SBE Apstore: обновлено: ${res.updated.length}`
          : `SBE Apstore: обновлено ${res.updated.length}, ошибок: ${res.failed.length}`,
      );
    } catch (e: unknown) {
      new Notice(`SBE Apstore: ${errorMessage(e)}`);
    } finally {
      this.busy = false;
    }
  }
}
