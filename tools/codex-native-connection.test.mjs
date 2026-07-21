import assert from 'node:assert/strict';
import test from 'node:test';

class ListenerSet {
  listeners = new Set();
  addListener(listener) { this.listeners.add(listener); }
  emit(value) { for (const listener of this.listeners) listener(value); }
}

class NativePort {
  onMessage = new ListenerSet();
  onDisconnect = new ListenerSet();
  requests = [];
  postMessage(request) { this.requests.push(request); }
  disconnect() { this.onDisconnect.emit(); }
}

test('a late disconnect from an old native port cannot close a replacement connection', async () => {
  const ports = [];
  globalThis.browser = {
    runtime: {
      connectNative() {
        const port = new NativePort();
        ports.push(port);
        return port;
      }
    }
  };

  const bridge = await import(`../core/codexNative.js?stale-port=${Date.now()}`);
  const oldRequest = bridge.sendCodexNativeRequest('health', {}, { timeoutMs: 5_000 });
  assert.equal(ports.length, 1);
  bridge.disconnectCodexNative();
  await assert.rejects(oldRequest, error => error.code === 'CODEX_CONNECTION_RESET');

  const freshRequest = bridge.sendCodexNativeRequest('health', {}, { timeoutMs: 5_000 });
  assert.equal(ports.length, 2);
  const freshWireRequest = ports[1].requests[0];

  ports[0].onDisconnect.emit();
  ports[1].onMessage.emit({
    version: 2,
    id: freshWireRequest.id,
    ok: true,
    result: { sdkAvailable: true }
  });

  assert.deepEqual(await freshRequest, { sdkAvailable: true });

  const abortController = new AbortController();
  const cancelledRequest = bridge.sendCodexNativeRequest(
    'translateBatch',
    { items: [{ id: 'item-1', text: 'hello' }] },
    { timeoutMs: 5_000, signal: abortController.signal }
  );
  const translatedWireRequest = ports[1].requests.at(-1);
  abortController.abort();
  await assert.rejects(cancelledRequest, error => error.name === 'AbortError');
  const cancelWireRequest = ports[1].requests.at(-1);
  assert.equal(cancelWireRequest.method, 'cancel');
  assert.equal(cancelWireRequest.params.requestId, translatedWireRequest.id);

  const compatibleHealth = bridge.getCodexNativeHealth();
  const healthWireRequest = ports[1].requests.at(-1);
  ports[1].onMessage.emit({
    version: 2,
    id: healthWireRequest.id,
    ok: true,
    result: {
      protocolVersion: 2,
      securityProfile: 'isolated-chatgpt-v2'
    }
  });
  await compatibleHealth;

  const checkedRequest = bridge.sendCodexNativeRequest(
    'translateBatch',
    { items: [{ id: 'item-2', text: 'safe' }] },
    { timeoutMs: 5_000, requireCompatibleHealth: true }
  );
  const checkedWireRequest = ports[1].requests.at(-1);
  ports[1].onMessage.emit({
    version: 2,
    id: checkedWireRequest.id,
    ok: true,
    result: { translations: [{ id: 'item-2', text: 'sûr' }] }
  });
  await checkedRequest;

  const closing = bridge.closeCodexNativeSession('page-context-1');
  const closeWireRequest = ports[1].requests.at(-1);
  assert.equal(closeWireRequest.method, 'closeSession');
  assert.deepEqual(closeWireRequest.params, { sessionId: 'page-context-1' });
  ports[1].onMessage.emit({
    version: 2,
    id: closeWireRequest.id,
    ok: true,
    result: { sessionId: 'page-context-1', closed: true }
  });
  assert.equal(await closing, true);

  bridge.disconnectCodexNative();

  const unverifiedRequest = bridge.sendCodexNativeRequest(
    'translateBatch',
    { items: [{ id: 'item-3', text: 'must not send' }] },
    { timeoutMs: 5_000, requireCompatibleHealth: true }
  );
  const unverifiedPort = ports.at(-1);
  await assert.rejects(unverifiedRequest, error => error.code === 'CODEX_HEALTH_REQUIRED');
  assert.equal(unverifiedPort.requests.length, 0);
  bridge.disconnectCodexNative();

  const incompatibleOne = bridge.sendCodexNativeRequest('health', {}, { timeoutMs: 5_000 });
  const incompatibleTwo = bridge.sendCodexNativeRequest('status', {}, { timeoutMs: 5_000 });
  const incompatiblePort = ports.at(-1);
  incompatiblePort.onMessage.emit({
    version: 3,
    id: incompatiblePort.requests[0].id,
    ok: true,
    result: {}
  });
  await assert.rejects(incompatibleOne, error => error.code === 'CODEX_PROTOCOL_MISMATCH');
  await assert.rejects(incompatibleTwo, error => error.code === 'CODEX_PROTOCOL_MISMATCH');
});
