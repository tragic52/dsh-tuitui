function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function createTuituiBridgeStatus() {
  return {
    messagesReceived: 0,
    messagesReplied: 0,
    messagesRejected: 0,
    lastMessageAt: null,
    lastReplyAt: null,
    lastRejectedAt: null,
    lastError: null,
  };
}

/**
 * 把推推入站消息转发给 Harness agent，并把回答发回推推。
 * bot 接口：{ sendText(target, text) }，target 为推推 ToTarget。
 */
export class TuituiHarnessBridge {
  #bot;
  #harness;
  #state;
  #status;
  #logger;
  #replyTimeoutMs;
  #queues = new Map();

  constructor({
    bot,
    harness,
    state,
    status = createTuituiBridgeStatus(),
    logger = console,
    replyTimeoutMs = 600_000,
  }) {
    if (!bot || typeof bot.sendText !== 'function') throw new TypeError('A bot client is required');
    if (!harness || !state) throw new TypeError('Harness client and state store are required');
    this.#bot = bot;
    this.#harness = harness;
    this.#state = state;
    this.#status = status;
    this.#logger = logger;
    this.#replyTimeoutMs = replyTimeoutMs;
  }

  get status() {
    return structuredClone(this.#status);
  }

  accept(message) {
    const conversationId = cleanText(message?.conversationId);
    const kind = message?.kind === 'group' ? 'group' : 'direct';
    const key = `${kind}:${conversationId}`;
    const previous = this.#queues.get(key) ?? Promise.resolve();
    const current = previous
      .catch(() => undefined)
      .then(() => this.#process({ ...message, kind, conversationId }))
      .finally(() => {
        if (this.#queues.get(key) === current) this.#queues.delete(key);
      });
    this.#queues.set(key, current);
    return current;
  }

  async waitForIdle() {
    await Promise.allSettled([...this.#queues.values()]);
  }

  async #process(message) {
    const messageId = cleanText(message.messageId);
    const senderId = cleanText(message.senderId);
    if (!messageId || !senderId || !message.conversationId || message.senderIsBot === true) return;
    if (this.#state.hasSeen(messageId)) return;

    this.#status.messagesReceived += 1;
    this.#status.lastMessageAt = new Date().toISOString();
    if (message.kind === 'group' && message.addressed !== true) {
      this.#status.messagesRejected += 1;
      this.#status.lastRejectedAt = new Date().toISOString();
      return;
    }

    const target = message.replyTarget;
    const text = cleanText(message.content);
    try {
      if (!text) {
        await this.#bot.sendText(target, '目前只支持文字消息。');
        await this.#state.markSeen(messageId);
        return;
      }
      const command = text.toLowerCase();
      if (command === '/help') {
        await this.#bot.sendText(target, [
          '推推机器人已连接 DeepSeek Harness。',
          '',
          '直接发送文字即可继续当前会话。',
          '/new  开启一个全新会话',
          '/status  检查连接状态',
          '/help  显示本帮助',
        ].join('\n'));
        await this.#state.markSeen(messageId);
        return;
      }
      if (command === '/status') {
        await this.#harness.ensureRunning();
        await this.#bot.sendText(target, '推推机器人与 DeepSeek Harness 连接正常。');
        await this.#state.markSeen(messageId);
        return;
      }
      const conversationKey = `${message.kind}:${message.conversationId}`;
      if (command === '/new') {
        await this.#state.clearSession(conversationKey);
        await this.#bot.sendText(target, '已开启新会话。请发送你的问题。');
        await this.#state.markSeen(messageId);
        return;
      }

      let sessionId = this.#state.sessionFor(conversationKey);
      if (!sessionId || !(await this.#harness.sessionExists(sessionId))) {
        sessionId = await this.#harness.createSession();
        await this.#state.setSession(conversationKey, sessionId);
      }

      const answer = await this.#harness.ask(sessionId, text, {
        timeoutMs: this.#replyTimeoutMs,
      });
      await this.#bot.sendText(target, answer);
      await this.#state.markSeen(messageId);
      this.#status.messagesReplied += 1;
      this.#status.lastReplyAt = new Date().toISOString();
      this.#status.lastError = null;
    } catch (error) {
      this.#status.lastError = error?.message ?? String(error);
      this.#logger.error?.('[dsh-tuitui] failed to process a message:', error);
      try {
        await this.#bot.sendText(target, '消息处理失败，请稍后重试。');
        await this.#state.markSeen(messageId);
      } catch (sendError) {
        this.#logger.error?.('[dsh-tuitui] failed to send the safe error reply:', sendError);
      }
    }
  }
}
