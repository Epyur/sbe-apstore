import { App, Modal, Notice } from 'obsidian';
import { errorMessage } from '../../../sbe-core/src/utils/errors';
import type { AuthService } from '../../../sbe-core/src/auth-client';
import type { StoreManager } from '../../../sbe-core/src/store-manager';

/** Значение первого пункта выпадающего списка — «Есть идея» (не привязано к плагину). */
export const FEEDBACK_IDEA = '';

/** Модалка «Обратная связь»: выбор плагина (или «Есть идея») + текст обращения.
 *  Отправка требует авторизации — сервер принимает только валидный мастер-ключ. */
export class FeedbackModal extends Modal {
  private auth: AuthService;
  private manager: StoreManager;

  constructor(app: App, manager: StoreManager, auth: AuthService) {
    super(app);
    this.auth = auth;
    this.manager = manager;
    this.modalEl.addClass('tn-apstore-feedback-modal');
  }

  onOpen(): void {
    this.titleEl.setText('Обратная связь');
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private render(): void {
    this.contentEl.empty();
    if (!this.auth.getStatus().authorized) {
      this.renderNotAuthorized();
      return;
    }
    this.renderForm();
  }

  /** Пользователь не авторизован — форма недоступна, предлагаем открыть настройки
   *  ЦУП (раздел «Доступ к серверу»). */
  private renderNotAuthorized(): void {
    const card = this.contentEl.createDiv({ cls: 'tn-card' });
    card.createDiv({
      cls: 'tn-apstore-feedback-error',
      text: 'Для отправки обратной связи необходима авторизация на сервере ЦУП.',
    });
    card.createDiv({
      cls: 'tn-lims-meta',
      text: 'Авторизуйтесь в настройках ЦУП (раздел «Доступ к серверу»): укажите рабочий email и активируйте ключ доступа.',
    });
    const btn = card.createEl('button', { cls: 'tn-btn tn-btn-primary', text: 'Открыть настройки ЦУП' });
    btn.addEventListener('click', () => this.openApstoreSettings());
  }

  /** Открывает настройки ЦУП через недокументированное API app.setting.openTabById. */
  private openApstoreSettings(): void {
    try {
      const appSetting = (this.app as unknown as { setting?: unknown }).setting;
      if (!appSetting) throw new Error('Настройки Obsidian недоступны');
      const settingModal = appSetting as { open?: () => void; openTabById?: (tabId: string) => unknown };
      settingModal.open?.();
      settingModal.openTabById?.('sbe-apstore');
      this.close();
    } catch (e: unknown) {
      new Notice(`ЦУП: не удалось открыть настройки — ${errorMessage(e)}`);
    }
  }

  private renderForm(): void {
    const card = this.contentEl.createDiv({ cls: 'tn-card' });
    card.createDiv({ cls: 'tn-card-head' }).createEl('h3', { text: 'Предложения и замечания' });

    const select = card.createEl('select', { cls: 'tn-apstore-select' });
    select.createEl('option', { attr: { value: FEEDBACK_IDEA }, text: '💡 Есть идея' });
    const plugins = [...this.manager.getCards()]
      .sort((a, b) => a.entry.name.localeCompare(b.entry.name, 'ru'))
      .map(c => c.entry);
    for (const entry of plugins) {
      select.createEl('option', { attr: { value: entry.id }, text: entry.name });
    }

    const textArea = card.createEl('textarea', {
      attr: { placeholder: 'Опишите предложение или замечание…', rows: '5' },
      cls: 'tn-apstore-input',
    });

    card.createDiv({
      cls: 'tn-lims-meta',
      text: 'Замечание уйдёт владельцу выбранного плагина, «Есть идея» — собственнику ЦУП.',
    });

    const submitBtn = card.createEl('button', {
      cls: 'tn-btn tn-btn-primary tn-btn-block',
      text: 'Отправить',
    });
    submitBtn.addEventListener('click', () => void this.submit(select, textArea, submitBtn));
  }

  private async submit(
    select: HTMLSelectElement,
    textArea: HTMLTextAreaElement,
    submitBtn: HTMLButtonElement,
  ): Promise<void> {
    const text = textArea.value.trim();
    if (!text) {
      new Notice('ЦУП: введите текст предложения или замечания');
      return;
    }
    submitBtn.disabled = true;
    try {
      await this.auth.sendFeedback({ pluginId: select.value, text });
      new Notice('ЦУП: обратная связь отправлена');
      this.close();
    } catch (e: unknown) {
      new Notice(`ЦУП: ${errorMessage(e)}`);
    } finally {
      submitBtn.disabled = false;
    }
  }
}
