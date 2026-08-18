import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

async function atomicWrite(path, text) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, text, 'utf8');
  await rename(tmp, path);
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined;
    throw error;
  }
}

/** 机器人配置清单：~/.dsh/integrations/dsh-tuitui/config.json */
export class TuituiConfigStore {
  #path;
  #bots = [];

  constructor(path) {
    this.#path = path;
  }

  async load() {
    const raw = await readJson(this.#path);
    this.#bots = Array.isArray(raw?.bots) ? raw.bots : [];
    return this;
  }

  list() {
    return this.#bots.map((bot) => ({ ...bot }));
  }

  get(botId) {
    const bot = this.#bots.find((entry) => entry.botId === botId);
    return bot ? { ...bot } : null;
  }

  getByAppId(appId) {
    const bot = this.#bots.find((entry) => entry.appId === appId);
    return bot ? { ...bot } : null;
  }

  async save(config) {
    const index = this.#bots.findIndex((entry) => entry.botId === config.botId);
    if (index >= 0) this.#bots[index] = { ...config };
    else this.#bots.push({ ...config });
    await this.#persist();
  }

  async remove(botId) {
    this.#bots = this.#bots.filter((entry) => entry.botId !== botId);
    await this.#persist();
  }

  async #persist() {
    await atomicWrite(this.#path, JSON.stringify({ schemaVersion: 1, bots: this.#bots }, null, 2));
  }
}

/**
 * 单个机器人的会话状态：推推会话 -> Harness sessionId 的映射、
 * 已处理消息去重集合与消息计数。
 */
export class TuituiStateStore {
  #path;
  #seenLimit;
  #sessions = {};
  #seen = [];
  #seenSet = new Set();

  constructor(path, { seenLimit = 1_000 } = {}) {
    this.#path = path;
    this.#seenLimit = seenLimit;
  }

  async load() {
    const raw = await readJson(this.#path);
    this.#sessions = raw?.sessions && typeof raw.sessions === 'object' ? raw.sessions : {};
    this.#seen = Array.isArray(raw?.seen) ? raw.seen : [];
    this.#seenSet = new Set(this.#seen);
    return this;
  }

  sessionFor(conversationKey) {
    const sessionId = this.#sessions[conversationKey];
    return typeof sessionId === 'string' && sessionId ? sessionId : null;
  }

  async setSession(conversationKey, sessionId) {
    this.#sessions[conversationKey] = sessionId;
    await this.#persist();
  }

  async clearSession(conversationKey) {
    delete this.#sessions[conversationKey];
    await this.#persist();
  }

  hasSeen(messageId) {
    return this.#seenSet.has(messageId);
  }

  async markSeen(messageId) {
    if (!messageId || this.#seenSet.has(messageId)) return;
    this.#seenSet.add(messageId);
    this.#seen.push(messageId);
    if (this.#seen.length > this.#seenLimit) {
      const dropped = this.#seen.splice(0, this.#seen.length - this.#seenLimit);
      for (const id of dropped) this.#seenSet.delete(id);
    }
    await this.#persist();
  }

  async remove() {
    try {
      await unlink(this.#path);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }

  async #persist() {
    await atomicWrite(this.#path, JSON.stringify({
      schemaVersion: 1,
      sessions: this.#sessions,
      seen: this.#seen,
    }));
  }
}
