import { CompanionError } from './errors.mjs';

export class SerialTaskQueue {
  #abortGraceMs;
  #active = null;
  #closed = false;
  #knownIds = new Set();
  #onFatal;
  #pending = [];

  constructor({ abortGraceMs = 2_000, onFatal = () => {} } = {}) {
    this.#abortGraceMs = Math.max(10, Number(abortGraceMs) || 2_000);
    this.#onFatal = onFatal;
  }

  enqueue(id, timeoutMs, task) {
    if (this.#closed) {
      return Promise.reject(new CompanionError('HOST_SHUTTING_DOWN'));
    }
    if (this.#knownIds.has(id)) {
      return Promise.reject(new CompanionError('DUPLICATE_REQUEST'));
    }

    this.#knownIds.add(id);
    const promise = new Promise((resolve, reject) => {
      this.#pending.push({
        id,
        timeoutMs,
        task,
        resolve,
        reject,
        abortReason: null,
        abort: null,
        controller: null
      });
    });
    this.#drain();
    return promise;
  }

  cancel(id) {
    if (this.#active?.id === id) {
      this.#active.abort('CANCELLED');
      return 'active';
    }

    const index = this.#pending.findIndex((job) => job.id === id);
    if (index >= 0) {
      const [job] = this.#pending.splice(index, 1);
      this.#knownIds.delete(id);
      job.reject(new CompanionError('CANCELLED'));
      return 'queued';
    }
    return 'not_found';
  }

  snapshot() {
    return {
      active: this.#active !== null,
      queued: this.#pending.length
    };
  }

  shutdown() {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    for (const job of this.#pending.splice(0)) {
      this.#knownIds.delete(job.id);
      job.reject(new CompanionError('HOST_SHUTTING_DOWN'));
    }
    if (this.#active) {
      this.#active.abort('HOST_SHUTTING_DOWN');
    }
  }

  async #drain() {
    if (this.#closed || this.#active || this.#pending.length === 0) {
      return;
    }

    const job = this.#pending.shift();
    this.#active = job;
    job.controller = new AbortController();
    let abortGraceTimer = null;
    let forceTimeout;
    const forcedTimeout = new Promise((_, reject) => { forceTimeout = reject; });
    job.abort = (reason) => {
      job.abortReason ??= reason;
      job.controller.abort();
      if (abortGraceTimer) {
        return;
      }
      abortGraceTimer = setTimeout(() => {
        this.#closed = true;
        for (const pendingJob of this.#pending.splice(0)) {
          this.#knownIds.delete(pendingJob.id);
          pendingJob.reject(new CompanionError('HOST_SHUTTING_DOWN'));
        }
        const fatalError = new CompanionError(job.abortReason);
        forceTimeout(fatalError);
        try { this.#onFatal(fatalError); } catch { }
      }, this.#abortGraceMs);
    };
    const timer = setTimeout(() => job.abort('TIMEOUT'), job.timeoutMs);

    try {
      const result = await Promise.race([
        Promise.resolve().then(() => job.task(job.controller.signal)),
        forcedTimeout
      ]);
      if (job.abortReason) {
        throw new CompanionError(job.abortReason);
      }
      job.resolve(result);
    } catch (error) {
      job.reject(job.abortReason ? new CompanionError(job.abortReason) : error);
    } finally {
      clearTimeout(timer);
      clearTimeout(abortGraceTimer);
      this.#knownIds.delete(job.id);
      this.#active = null;
      queueMicrotask(() => this.#drain());
    }
  }
}
