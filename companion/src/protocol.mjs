import os from 'node:os';

import {
  MAX_NATIVE_INPUT_BYTES,
  MAX_NATIVE_OUTPUT_BYTES
} from './constants.mjs';
import { CompanionError } from './errors.mjs';

const IS_LITTLE_ENDIAN = os.endianness() === 'LE';

function readNativeUInt32(buffer, offset) {
  return IS_LITTLE_ENDIAN ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset);
}

function writeNativeUInt32(buffer, value, offset) {
  if (IS_LITTLE_ENDIAN) {
    buffer.writeUInt32LE(value, offset);
  } else {
    buffer.writeUInt32BE(value, offset);
  }
}

export function encodeNativeMessage(value, maxBytes = MAX_NATIVE_OUTPUT_BYTES) {
  let body;
  try {
    body = Buffer.from(JSON.stringify(value), 'utf8');
  } catch {
    throw new CompanionError('INTERNAL_ERROR');
  }

  if (body.length === 0 || body.length > maxBytes) {
    throw new CompanionError('MESSAGE_TOO_LARGE');
  }

  const frame = Buffer.allocUnsafe(4 + body.length);
  writeNativeUInt32(frame, body.length, 0);
  body.copy(frame, 4);
  return frame;
}

export class NativeMessageDecoder {
  #buffer = Buffer.alloc(0);
  #maxBytes;

  constructor(maxBytes = MAX_NATIVE_INPUT_BYTES) {
    this.#maxBytes = maxBytes;
  }

  push(chunk) {
    if (!(chunk instanceof Uint8Array)) {
      throw new CompanionError('INVALID_REQUEST');
    }

    const next = Buffer.from(chunk);
    this.#buffer = this.#buffer.length === 0 ? next : Buffer.concat([this.#buffer, next]);
    const messages = [];

    while (this.#buffer.length >= 4) {
      const bodyLength = readNativeUInt32(this.#buffer, 0);
      if (bodyLength === 0 || bodyLength > this.#maxBytes) {
        this.#buffer = Buffer.alloc(0);
        throw new CompanionError(bodyLength > this.#maxBytes ? 'MESSAGE_TOO_LARGE' : 'INVALID_REQUEST');
      }
      if (this.#buffer.length < 4 + bodyLength) {
        break;
      }

      const body = this.#buffer.subarray(4, 4 + bodyLength);
      this.#buffer = this.#buffer.subarray(4 + bodyLength);
      try {
        messages.push(JSON.parse(body.toString('utf8')));
      } catch {
        throw new CompanionError('INVALID_REQUEST');
      }
    }

    return messages;
  }

  finish() {
    if (this.#buffer.length !== 0) {
      this.#buffer = Buffer.alloc(0);
      throw new CompanionError('INVALID_REQUEST');
    }
  }
}
