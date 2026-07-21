import { once } from 'node:events';

import { createCodexTranslator } from './src/codexTranslator.mjs';
import { asCompanionError } from './src/errors.mjs';
import { encodeNativeMessage, NativeMessageDecoder } from './src/protocol.mjs';
import { SerialTaskQueue } from './src/queue.mjs';
import { CompanionService, internalFailureResponse } from './src/service.mjs';
import { PROTOCOL_VERSION } from './src/constants.mjs';

const decoder = new NativeMessageDecoder();
const service = new CompanionService(createCodexTranslator(), {
  queue: new SerialTaskQueue({
    onFatal: () => {
      accepting = false;
      process.stdin.pause();
      setTimeout(() => process.exit(1), 250);
    }
  })
});
const pending = new Set();
let accepting = true;
let writeChain = Promise.resolve();

function protocolFailure(error) {
  const safe = asCompanionError(error);
  return {
    version: PROTOCOL_VERSION,
    id: null,
    ok: false,
    error: {
      code: safe.code,
      message: safe.message,
      retryable: safe.retryable
    }
  };
}

function send(response) {
  writeChain = writeChain.then(async () => {
    const frame = encodeNativeMessage(response);
    if (!process.stdout.write(frame)) {
      await once(process.stdout, 'drain');
    }
  });
  return writeChain;
}

function track(promise) {
  pending.add(promise);
  promise.then(
    () => pending.delete(promise),
    () => pending.delete(promise)
  );
}

function stop(errorResponse = null) {
  if (!accepting) {
    return;
  }
  accepting = false;
  process.stdin.pause();
  service.shutdown();
  if (errorResponse) {
    track(send(errorResponse));
    process.exitCode = 1;
  }
}

function finishAfterPending() {
  if (!accepting) {
    return;
  }
  accepting = false;
  process.stdin.pause();
  const operations = [...pending];
  Promise.allSettled(operations).finally(() => service.shutdown());
}

process.stdin.on('data', (chunk) => {
  if (!accepting) {
    return;
  }
  try {
    for (const message of decoder.push(chunk)) {
      const operation = service
        .handle(message)
        .then((response) => send(response))
        .catch(() => send(internalFailureResponse()));
      track(operation);
    }
  } catch (error) {
    stop(protocolFailure(error));
  }
});

// One-shot sendNativeMessage callers can close stdin as soon as their single
// request is written. Let already-decoded work finish before shutting down.
process.stdin.on('end', () => {
  try {
    decoder.finish();
    finishAfterPending();
  } catch (error) {
    stop(protocolFailure(error));
  }
});
process.stdin.on('error', () => stop(internalFailureResponse()));
process.stdout.on('error', () => stop());
process.stdin.resume();
