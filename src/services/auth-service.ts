import { requestUrl, RequestUrlParam } from 'obsidian';
import { errorMessage } from '../../../sbe-core/src/utils/errors';
import type {
  CreateNewsInput,
  DeviceInfo,
  NewsItem,
  NewsReadStatus,
  PresenceInfo,
} from '../../../sbe-core/src/types';

export interface AuthServiceConfig {
  apiUrl: string;
  email: string;
  deviceId: string;
}

export interface AuthSecretStore {
  getKey(): string | null;
  setKey(value: string): void;
  clearKey(): void;
}

/** Клиент серверного auth-service (паспортный стол SBE).
 *  Ключ хранит ЦУП в secretStorage; JWT кэшируется до истечения. */
export class AuthService {
  private config: AuthServiceConfig;
  private secrets: AuthSecretStore;
  private tokenCache = new Map<string, { jwt: string; expiresAt: number }>();

  constructor(config: AuthServiceConfig, secrets: AuthSecretStore) {
    this.config = config;
    this.secrets = secrets;
  }

  setConfig(config: AuthServiceConfig): void {
    this.config = config;
  }

  getStatus(): { authorized: boolean; email?: string } {
    const email = this.config.email.trim();
    return {
      authorized: !!email && !!this.secrets.getKey(),
      ...(email ? { email } : {}),
    };
  }

  get baseUrl(): string {
    return this.config.apiUrl.trim().replace(/\/+$/, '');
  }

  /** Шаг 2 потока авторизации: ключ отправляется на email. */
  async requestKey(email: string): Promise<void> {
    await this.post('/auth/request-key', {
      email: email.trim(),
      device_id: this.config.deviceId,
    });
  }

  /** Шаг 4: активировать ключ из письма и сохранить его. */
  async activateKey(key: string): Promise<void> {
    await this.post('/auth/activate-key', {
      email: this.config.email.trim(),
      device_id: this.config.deviceId,
      key: key.trim(),
    });
    this.secrets.setKey(key.trim());
    this.tokenCache.clear();
  }

  /** Шаг 5: JWT для plugin-service. Кэшируется до истечения срока. */
  async getToken(appId: string): Promise<string> {
    const cached = this.tokenCache.get(appId);
    if (cached && cached.expiresAt > Date.now()) return cached.jwt;

    const key = this.requireKey();
    const res = await this.request({
      url: `${this.baseUrl}/auth/token`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, app_id: appId }),
    });
    if (res.status === 401 || res.status === 403) {
      this.invalidateKey(res);
      throw new Error(this.errorText(res) || 'Ключ недействителен. Запросите новый ключ.');
    }
    if (res.status !== 200) throw new Error(this.errorText(res) || `HTTP ${res.status}`);

    const data = JSON.parse(res.text) as { jwt: string; expires_at?: string };
    const expiresAt = data.expires_at
      ? new Date(data.expires_at).getTime()
      : Date.now() + 60 * 60 * 1000;
    this.tokenCache.set(appId, { jwt: data.jwt, expiresAt });
    return data.jwt;
  }

  async listDevices(): Promise<DeviceInfo[]> {
    const res = await this.authorized('/auth/devices');
    // Сервер отдаёт snake_case (device_id/created_at/key_status) — раньше здесь
    // был прямой каст без переименования полей, из-за чего deviceId/createdAt/
    // keyStatus всегда оказывались undefined (совпадало только "label"). UI
    // показывал "-"/"-" вместо статуса/даты, а кнопка "Отозвать" отправляла на
    // сервер device_id="undefined" (строкой) — Postgres отвергал его как
    // невалидный UUID, что и давало ошибку 500 при попытке отвязать устройство
    // (обнаружено пользователем, 2026-08-22).
    type RawDevice = { device_id?: string; label?: string; created_at?: string; key_status?: string };
    const data = JSON.parse(res.text) as { devices?: RawDevice[] };
    return (data.devices ?? []).map((d) => ({
      deviceId: d.device_id ?? '',
      label: d.label ?? '',
      createdAt: d.created_at ?? '',
      keyStatus: d.key_status ?? '',
    }));
  }

  async revokeDevice(deviceId: string): Promise<void> {
    const key = this.requireKey();
    const res = await this.request({
      url: `${this.baseUrl}/auth/devices/${encodeURIComponent(deviceId)}`,
      method: 'DELETE',
      headers: { Authorization: `Bearer ${key}` },
    });
    if (res.status === 401 || res.status === 403) {
      this.invalidateKey(res);
      throw new Error(this.errorText(res) || 'Ключ недействителен. Запросите новый ключ.');
    }
    if (res.status !== 200) throw new Error(this.errorText(res) || `HTTP ${res.status}`);
    if (deviceId === this.config.deviceId) {
      this.secrets.clearKey();
      this.tokenCache.clear();
    }
  }

  async getPresence(): Promise<PresenceInfo> {
    const res = await this.authorizedRequest('GET', '/auth/presence');
    type Raw = {
      online?: string[];
      is_admin?: boolean;
      all_users?: Array<{ email: string; last_seen_at: string | null }>;
    };
    const data = JSON.parse(res.text) as Raw;
    return {
      online: data.online ?? [],
      isAdmin: data.is_admin ?? false,
      ...(data.all_users
        ? { allUsers: data.all_users.map((u) => ({ email: u.email, lastSeenAt: u.last_seen_at ?? null })) }
        : {}),
    };
  }

  async listNews(): Promise<NewsItem[]> {
    const res = await this.authorizedRequest('GET', '/auth/news');
    type RawNews = {
      id: number;
      author_email: string;
      title: string;
      body: string;
      visibility: 'all' | 'restricted';
      mandatory: boolean;
      created_at: string;
      read: boolean;
    };
    const data = JSON.parse(res.text) as { news?: RawNews[] };
    return (data.news ?? []).map((n) => ({
      id: n.id,
      authorEmail: n.author_email,
      title: n.title,
      body: n.body,
      visibility: n.visibility,
      mandatory: n.mandatory,
      createdAt: n.created_at,
      read: n.read,
    }));
  }

  async createNews(input: CreateNewsInput): Promise<{ id: number }> {
    const res = await this.authorizedRequest('POST', '/auth/news', {
      title: input.title,
      body: input.body,
      visibility: input.visibility,
      recipients: input.recipients ?? [],
      mandatory: input.mandatory,
    });
    const data = JSON.parse(res.text) as { id: number };
    return { id: data.id };
  }

  async ackNews(id: number): Promise<void> {
    await this.authorizedRequest('POST', `/auth/news/${id}/ack`);
  }

  async getNewsReads(id: number): Promise<NewsReadStatus[]> {
    const res = await this.authorizedRequest('GET', `/auth/news/${id}/reads`);
    type RawRead = { email: string; read: boolean; read_at?: string };
    const data = JSON.parse(res.text) as { reads?: RawRead[] };
    return (data.reads ?? []).map((r) => ({ email: r.email, read: r.read, readAt: r.read_at }));
  }

  /** Как authorized(), но 403 здесь означает не «ключ недействителен», а
   *  «недостаточно прав» (эндпоинты /auth/presence и /auth/news идут через тот
   *  же requireKey, который отдаёт 401 на плохой ключ; 403 — только от
   *  admin-проверки внутри самого хендлера) — поэтому ключ не сбрасываем. */
  private async authorizedRequest(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; text: string }> {
    const key = this.requireKey();
    const headers: Record<string, string> = { Authorization: `Bearer ${key}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await this.request({
      url: `${this.baseUrl}${path}`,
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) {
      this.invalidateKey(res);
      throw new Error(this.errorText(res) || 'Ключ недействителен. Запросите новый ключ.');
    }
    if (res.status === 403) {
      throw new Error(this.errorText(res) || 'Недостаточно прав');
    }
    if (res.status < 200 || res.status >= 300) {
      throw new Error(this.errorText(res) || `HTTP ${res.status}`);
    }
    return res;
  }

  private requireKey(): string {
    const key = this.secrets.getKey();
    if (!key) throw new Error('Нет ключа доступа. Запросите ключ и активируйте устройство.');
    return key;
  }

  private invalidateKey(res: { status: number; text: string }): void {
    this.secrets.clearKey();
    this.tokenCache.clear();
    console.warn('ЦУП: ключ доступа отклонён сервером:', this.errorText(res) || `HTTP ${res.status}`);
  }

  private async authorized(path: string): Promise<{ status: number; text: string }> {
    const key = this.requireKey();
    const res = await this.request({
      url: `${this.baseUrl}${path}`,
      method: 'GET',
      headers: { Authorization: `Bearer ${key}` },
    });
    if (res.status === 401 || res.status === 403) {
      this.invalidateKey(res);
      throw new Error(this.errorText(res) || 'Ключ недействителен. Запросите новый ключ.');
    }
    if (res.status !== 200) throw new Error(this.errorText(res) || `HTTP ${res.status}`);
    return res;
  }

  private async post(path: string, body: unknown): Promise<{ status: number; text: string }> {
    const res = await this.request({
      url: `${this.baseUrl}${path}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(this.errorText(res) || `HTTP ${res.status}`);
    }
    return res;
  }

  private errorText(res: { status: number; text: string }): string {
    if (!res.text) return '';
    try {
      const data = JSON.parse(res.text) as { error?: string };
      return data.error || '';
    } catch (e: unknown) {
      console.warn('ЦУП: ответ сервера не JSON:', errorMessage(e));
      return '';
    }
  }

  /** requestUrl в Obsidian не имеет таймаута — без обёртки зависший сервер не даст ответа никогда. */
  private async request(
    param: RequestUrlParam,
    timeoutMs = 15000,
  ): Promise<{ status: number; text: string }> {
    let timer: number | undefined;
    try {
      const response = await Promise.race([
        requestUrl({ ...param, throw: false }),
        new Promise<never>((_, reject) => {
          timer = window.setTimeout(
            () => reject(new Error(`Сервер не ответил за ${Math.round(timeoutMs / 1000)} сек`)),
            timeoutMs,
          );
        }),
      ]);
      return { status: response.status, text: response.text };
    } finally {
      if (timer !== undefined) window.clearTimeout(timer);
    }
  }
}