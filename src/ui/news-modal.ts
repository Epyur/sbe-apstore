import { App, Modal, Notice } from 'obsidian';
import { errorMessage } from '../../../sbe-core/src/utils/errors';
import type { NewsItem, NewsReadStatus } from '../../../sbe-core/src/types';
import type { AuthService } from '../services/auth-service';

interface CreateNewsFields {
  titleInput: HTMLInputElement;
  bodyArea: HTMLTextAreaElement;
  visSelect: HTMLSelectElement;
  mandatoryCb: HTMLInputElement;
  recipientsInput: HTMLInputElement;
  submitBtn: HTMLButtonElement;
}

/** Канал «Новости»: список сообщений + (для админа) форма публикации и
 *  просмотр, кто из адресатов уже прочитал «обязательное» сообщение. */
export class NewsModal extends Modal {
  private auth: AuthService;
  private isAdmin = false;
  private items: NewsItem[] = [];

  constructor(app: App, auth: AuthService) {
    super(app);
    this.auth = auth;
    this.modalEl.addClass('tn-apstore-news-modal');
  }

  onOpen(): void {
    this.titleEl.setText('Новости');
    this.contentEl.createDiv({ cls: 'tn-empty', text: 'Загрузка…' });
    void this.load();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private async load(): Promise<void> {
    try {
      const [items, presence] = await Promise.all([this.auth.listNews(), this.auth.getPresence()]);
      this.items = items;
      this.isAdmin = presence.isAdmin;
      this.render();
    } catch (e: unknown) {
      this.contentEl.empty();
      this.contentEl.createDiv({ cls: 'tn-lims-error', text: `Ошибка: ${errorMessage(e)}` });
    }
  }

  private render(): void {
    this.contentEl.empty();

    if (this.isAdmin) {
      this.renderCreateForm();
    }

    const card = this.contentEl.createDiv({ cls: 'tn-card' });
    card.createDiv({ cls: 'tn-card-head' }).createEl('h3', { text: `Сообщения (${this.items.length})` });
    if (this.items.length === 0) {
      card.createDiv({ cls: 'tn-empty', text: 'Сообщений нет' });
      return;
    }
    for (const item of this.items) {
      card.append(this.buildNewsRow(item));
    }
  }

  private buildNewsRow(item: NewsItem): HTMLElement {
    const el = document.createElement('div');
    el.className = 'tn-apstore-news-item';
    if (item.mandatory) el.addClass('tn-apstore-news-mandatory');

    const head = el.createDiv({ cls: 'tn-apstore-news-item-head' });
    head.createEl('strong', { text: item.title });
    const badges = head.createDiv({ cls: 'tn-apstore-news-badges' });
    if (item.mandatory) {
      badges.createEl('span', { cls: 'tn-badge tn-badge-warn', text: 'Обязательно к прочтению' });
    }
    if (item.visibility === 'restricted') {
      badges.createEl('span', { cls: 'tn-badge tn-badge-muted', text: 'Ограниченный доступ' });
    }

    el.createDiv({
      cls: 'tn-lims-meta',
      text: `${item.authorEmail} · ${new Date(item.createdAt).toLocaleString('ru-RU')}`,
    });
    el.createDiv({ cls: 'tn-apstore-news-body', text: item.body });

    const actions = el.createDiv({ cls: 'tn-plugin-actions' });
    if (!item.read) {
      const ackBtn = actions.createEl('button', { cls: 'tn-btn tn-btn-primary', text: '✔ Прочитано' });
      ackBtn.addEventListener('click', () => void this.ack(item.id));
    } else {
      actions.createSpan({ cls: 'tn-lims-meta', text: 'Прочитано' });
    }
    if (this.isAdmin) {
      const readsBtn = actions.createEl('button', { cls: 'tn-btn tn-btn-ghost', text: 'Кто прочитал' });
      readsBtn.addEventListener('click', () => void this.showReads(item));
    }

    return el;
  }

  private async ack(id: number): Promise<void> {
    try {
      await this.auth.ackNews(id);
      const item = this.items.find((n) => n.id === id);
      if (item) item.read = true;
      this.render();
    } catch (e: unknown) {
      new Notice(`ЦУП: ${errorMessage(e)}`);
    }
  }

  private async showReads(item: NewsItem): Promise<void> {
    try {
      const reads = await this.auth.getNewsReads(item.id);
      new NewsReadsModal(this.app, item, reads).open();
    } catch (e: unknown) {
      new Notice(`ЦУП: ${errorMessage(e)}`);
    }
  }

  private renderCreateForm(): void {
    const card = this.contentEl.createDiv({ cls: 'tn-card' });
    card.createDiv({ cls: 'tn-card-head' }).createEl('h3', { text: '➕ Создать новость' });

    const titleInput = card.createEl('input', {
      attr: { type: 'text', placeholder: 'Заголовок' },
      cls: 'tn-apstore-input',
    });
    const bodyArea = card.createEl('textarea', {
      attr: { placeholder: 'Текст сообщения', rows: '3' },
      cls: 'tn-apstore-input',
    });

    const visRow = card.createDiv({ cls: 'tn-apstore-flex' });
    const visSelect = visRow.createEl('select', { cls: 'tn-apstore-select' });
    visSelect.createEl('option', { attr: { value: 'all' }, text: 'Всем' });
    visSelect.createEl('option', { attr: { value: 'restricted' }, text: 'Ограниченный список' });

    const mandatoryLabel = visRow.createEl('label', { cls: 'tn-apstore-checkbox-label' });
    const mandatoryCb = mandatoryLabel.createEl('input', { attr: { type: 'checkbox' } });
    mandatoryLabel.createSpan({ text: ' Обязательно к прочтению' });

    const recipientsInput = card.createEl('input', {
      attr: { type: 'text', placeholder: 'Получатели (email через запятую)' },
      cls: 'tn-apstore-input',
    });
    recipientsInput.style.display = 'none';
    visSelect.addEventListener('change', () => {
      recipientsInput.style.display = visSelect.value === 'restricted' ? '' : 'none';
    });

    const submitBtn = card.createEl('button', {
      cls: 'tn-btn tn-btn-primary tn-btn-block',
      text: 'Опубликовать',
    });
    const fields: CreateNewsFields = { titleInput, bodyArea, visSelect, mandatoryCb, recipientsInput, submitBtn };
    submitBtn.addEventListener('click', () => void this.submit(fields));
  }

  private async submit(fields: CreateNewsFields): Promise<void> {
    const title = fields.titleInput.value.trim();
    if (!title) {
      new Notice('ЦУП: заголовок обязателен');
      return;
    }
    const visibility = fields.visSelect.value === 'restricted' ? 'restricted' : 'all';
    const recipients = fields.recipientsInput.value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (visibility === 'restricted' && recipients.length === 0) {
      new Notice('ЦУП: укажите получателей для ограниченного доступа');
      return;
    }
    fields.submitBtn.disabled = true;
    try {
      await this.auth.createNews({
        title,
        body: fields.bodyArea.value.trim(),
        visibility,
        recipients,
        mandatory: fields.mandatoryCb.checked,
      });
      new Notice('ЦУП: новость опубликована');
      await this.load();
    } catch (e: unknown) {
      new Notice(`ЦУП: ${errorMessage(e)}`);
    } finally {
      fields.submitBtn.disabled = false;
    }
  }
}

class NewsReadsModal extends Modal {
  private item: NewsItem;
  private reads: NewsReadStatus[];

  constructor(app: App, item: NewsItem, reads: NewsReadStatus[]) {
    super(app);
    this.item = item;
    this.reads = reads;
  }

  onOpen(): void {
    this.titleEl.setText(`Прочитано: ${this.item.title}`);
    const wrap = this.contentEl.createDiv({ cls: 'tn-table-wrap' });
    const table = wrap.createEl('table', { cls: 'tn-table' });
    const headRow = table.createEl('thead').createEl('tr');
    for (const th of ['Email', 'Статус', 'Когда']) headRow.createEl('th', { text: th });
    const tbody = table.createEl('tbody');
    for (const r of this.reads) {
      const row = tbody.createEl('tr');
      row.createEl('td', { text: r.email });
      row.createEl('td', { text: r.read ? 'Прочитано' : 'Не прочитано' });
      row.createEl('td', { text: r.readAt ? new Date(r.readAt).toLocaleString('ru-RU') : '—' });
    }
    if (this.reads.length === 0) {
      tbody.createEl('tr').createEl('td', { cls: 'tn-empty', text: 'Нет адресатов' }).colSpan = 3;
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/** Модалка одного «обязательного» непрочитанного сообщения — открывается
 *  автоматически при входе (main.ts onload). Закрытие без ack (Esc/клик вне)
 *  не считается прочтением — сообщение всплывёт снова при следующей проверке. */
export class MandatoryNewsModal extends Modal {
  private auth: AuthService;
  private item: NewsItem;
  private onAcked: () => void;

  constructor(app: App, auth: AuthService, item: NewsItem, onAcked: () => void) {
    super(app);
    this.auth = auth;
    this.item = item;
    this.onAcked = onAcked;
    this.modalEl.addClass('tn-apstore-mandatory-news-modal');
  }

  onOpen(): void {
    this.titleEl.setText(`⚠ Обязательно к прочтению: ${this.item.title}`);
    this.contentEl.createDiv({
      cls: 'tn-lims-meta',
      text: `${this.item.authorEmail} · ${new Date(this.item.createdAt).toLocaleString('ru-RU')}`,
    });
    this.contentEl.createDiv({ cls: 'tn-apstore-news-body', text: this.item.body });
    const btn = this.contentEl.createEl('button', {
      cls: 'tn-btn tn-btn-primary tn-btn-block',
      text: 'Прочитано',
    });
    btn.addEventListener('click', () => void this.ack());
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private async ack(): Promise<void> {
    try {
      await this.auth.ackNews(this.item.id);
      this.onAcked();
      this.close();
    } catch (e: unknown) {
      new Notice(`ЦУП: ${errorMessage(e)}`);
    }
  }
}
