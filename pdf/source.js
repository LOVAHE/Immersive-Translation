function abortError(reason) {
  if (reason instanceof Error) return reason;
  return new DOMException('The PDF download was cancelled.', 'AbortError');
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError(signal.reason);
}

function pdfSignature(bytes) {
  return String.fromCharCode(...bytes.subarray(0, Math.min(5, bytes.byteLength)));
}

/**
 * Read a fetch response incrementally so a missing or dishonest Content-Length
 * cannot make the extension buffer an arbitrarily large PDF first.
 */
export async function readPdfResponse(response, {
  maxBytes = 100 * 1024 * 1024,
  signal
} = {}) {
  if (!response?.ok) throw new Error(`PDF request failed (${response?.status || 0}).`);
  const byteLimit = Math.max(1, Number(maxBytes) || 1);
  const header = response.headers?.get?.('content-length');
  const contentLength = header == null || header === '' ? null : Number(header);
  if (Number.isFinite(contentLength) && contentLength > byteLimit) {
    try { await response.body?.cancel?.(); } catch { /* The size error remains authoritative. */ }
    throw new Error(`This PDF is larger than the ${Math.round(byteLimit / 1024 / 1024)} MB reader limit.`);
  }

  throwIfAborted(signal);
  if (!response.body?.getReader) {
    const arrayBuffer = await response.arrayBuffer();
    throwIfAborted(signal);
    if (arrayBuffer.byteLength > byteLimit) {
      throw new Error(`This PDF is larger than the ${Math.round(byteLimit / 1024 / 1024)} MB reader limit.`);
    }
    const bytes = new Uint8Array(arrayBuffer);
    if (pdfSignature(bytes) !== '%PDF-') throw new Error('The selected link did not return a PDF file.');
    return arrayBuffer;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  let leading = new Uint8Array(0);
  const cancel = () => reader.cancel(signal?.reason || abortError()).catch(() => {});
  signal?.addEventListener('abort', cancel, { once: true });

  try {
    while (true) {
      throwIfAborted(signal);
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value || 0);
      if (!chunk.byteLength) continue;
      total += chunk.byteLength;
      if (total > byteLimit) {
        await reader.cancel('PDF reader byte limit exceeded.').catch(() => {});
        throw new Error(`This PDF is larger than the ${Math.round(byteLimit / 1024 / 1024)} MB reader limit.`);
      }
      chunks.push(chunk);

      if (leading.byteLength < 5) {
        const take = chunk.subarray(0, Math.min(chunk.byteLength, 5 - leading.byteLength));
        const next = new Uint8Array(leading.byteLength + take.byteLength);
        next.set(leading);
        next.set(take, leading.byteLength);
        leading = next;
        if (leading.byteLength === 5 && pdfSignature(leading) !== '%PDF-') {
          await reader.cancel('The response is not a PDF.').catch(() => {});
          throw new Error('The selected link did not return a PDF file.');
        }
      }
    }
    throwIfAborted(signal);
    if (total < 5 || pdfSignature(leading) !== '%PDF-') {
      throw new Error('The selected link did not return a PDF file.');
    }

    const output = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return output.buffer;
  } catch (error) {
    if (signal?.aborted) throw abortError(signal.reason);
    throw error;
  } finally {
    signal?.removeEventListener('abort', cancel);
    try { reader.releaseLock(); } catch { /* The stream may already be cancelled. */ }
  }
}
