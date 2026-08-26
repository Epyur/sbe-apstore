import { App, Modal } from 'obsidian';
import { errorMessage } from '../../../sbe-core/src/utils/errors';
import type { PresenceInfo } from '../../../sbe-core/src/types';
import type { AuthService } from '../../../sbe-core/src/auth-client';

/** «Кто сейчас онлайн» — активность синхронизации за последние 30 минут.
 *  Администратору (ADMIN_EMAILS в auth-service) сервер дополнительно отдаёт
 *  last-seen по всем пользователям — показываем второй таблицей. */
export class PresenceModal extends Modal {
  private auth: AuthService;

  constructor(app: App, auth: AuthService) {
    super(app);
    this.auth = auth;
    this.modalEl.addClass('tn-apstore-presence-modal');
  }

  onOpen(): void {
    this.titleEl.setText('Кто сейчас онлайн');
    this.contentEl.createDiv({ cls: 'tn-empty', text: 'Загрузка…' });
    void this.load();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private async load(): Promise<void> {
    try {
      const presence = await this.auth.getPresence();
      this.render(presence);
    } catch (e: unknown) {
      this.contentEl.empty();
      this.contentEl.createDiv({ cls: 'tn-lims-error', text: `Ошибка: ${errorMessage(e)}` });
    }
  }

  private render(presence: PresenceInfo): void {
    this.contentEl.empty();

    const onlineCard = this.contentEl.createDiv({ cls: 'tn-card' });
    onlineCard.createDiv({ cls: 'tn-card-head' })
      .createEl('h3', { text: `Онлайн (${presence.online.length})` });
    if (presence.online.length === 0) {
      onlineCard.createDiv({ cls: 'tn-empty', text: 'Сейчас никто не подключён' });
    } else {
      const list = onlineCard.createEl('ul', { cls: 'tn-apstore-presence-list' });
      for (const email of presence.online) {
        list.createEl('li', { text: email });
      }
    }

    if (presence.isAdmin && presence.allUsers) {
      const card = this.contentEl.createDiv({ cls: 'tn-card' });
      card.createDiv({ cls: 'tn-card-head' }).createEl('h3', { text: 'Все пользователи' });
      const wrap = card.createDiv({ cls: 'tn-table-wrap' });
      const table = wrap.createEl('table', { cls: 'tn-table' });
      const headRow = table.createEl('thead').createEl('tr');
      for (const th of ['Email', 'Последний визит']) headRow.createEl('th', { text: th });
      const tbody = table.createEl('tbody');
      for (const u of presence.allUsers) {
        const row = tbody.createEl('tr');
        row.createEl('td', { text: u.email });
        row.createEl('td', {
          text: u.lastSeenAt ? new Date(u.lastSeenAt).toLocaleString('ru-RU') : 'никогда',
        });
      }
    }
  }
}
