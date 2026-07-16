import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";

/**
 * Cloudflare drops WebSocket messages over 1 MiB, which a large
 * document's SyncStep2 easily exceeds. Oversized protocol messages are
 * split into MSG_CHUNK frames — `[MSG_CHUNK, index, total, payload]` —
 * and reassembled on the other side. WebSocket messages arrive in
 * order, so one in-progress assembly per connection suffices.
 */
export const MSG_CHUNK = 4;

export const CHUNK_PAYLOAD_BYTES = 800 * 1024;

/** Split a protocol message into sendable frames (itself when small). */
export function toWireFrames(message: Uint8Array): Uint8Array[] {
  if (message.byteLength <= CHUNK_PAYLOAD_BYTES) return [message];
  const total = Math.ceil(message.byteLength / CHUNK_PAYLOAD_BYTES);
  const frames: Uint8Array[] = [];
  for (let i = 0; i < total; i++) {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG_CHUNK);
    encoding.writeVarUint(encoder, i);
    encoding.writeVarUint(encoder, total);
    encoding.writeVarUint8Array(
      encoder,
      message.subarray(i * CHUNK_PAYLOAD_BYTES, (i + 1) * CHUNK_PAYLOAD_BYTES),
    );
    frames.push(encoding.toUint8Array(encoder));
  }
  return frames;
}

/** Reassembles MSG_CHUNK frames back into whole protocol messages. */
export class ChunkAssembler {
  private parts: Uint8Array[] = [];
  private expected = 0;

  /**
   * Consume one chunk frame (decoder positioned after the MSG_CHUNK
   * type). Returns the reassembled message on the final chunk, null
   * while more are pending. Out-of-sequence chunks reset the assembly —
   * a dropped frame must not corrupt the next message.
   */
  push(decoder: decoding.Decoder): Uint8Array | null {
    const index = decoding.readVarUint(decoder);
    const total = decoding.readVarUint(decoder);
    const payload = decoding.readVarUint8Array(decoder);

    if (index === 0) {
      this.parts = [];
      this.expected = total;
    } else if (index !== this.parts.length || total !== this.expected) {
      this.parts = [];
      this.expected = 0;
      return null;
    }
    this.parts.push(payload);

    if (this.parts.length < this.expected) return null;

    const size = this.parts.reduce((n, p) => n + p.byteLength, 0);
    const message = new Uint8Array(size);
    let offset = 0;
    for (const part of this.parts) {
      message.set(part, offset);
      offset += part.byteLength;
    }
    this.parts = [];
    this.expected = 0;
    return message;
  }
}
