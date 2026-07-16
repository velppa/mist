import { describe, it, expect } from "vitest";
import * as decoding from "lib0/decoding";
import {
  MSG_CHUNK,
  CHUNK_PAYLOAD_BYTES,
  ChunkAssembler,
  toWireFrames,
} from "~/shared/ws-chunks";

/** Big buffer with sentinel bytes at the seams — fast to build. */
function bigMessage(size: number): Uint8Array {
  const msg = new Uint8Array(size);
  msg[0] = 7;
  msg[CHUNK_PAYLOAD_BYTES - 1] = 11;
  msg[CHUNK_PAYLOAD_BYTES] = 13;
  msg[size - 1] = 17;
  return msg;
}

function reassemble(frames: Uint8Array[]): Uint8Array | null {
  const assembler = new ChunkAssembler();
  let result: Uint8Array | null = null;
  for (const frame of frames) {
    const decoder = decoding.createDecoder(frame);
    expect(decoding.readVarUint(decoder)).toBe(MSG_CHUNK);
    result = assembler.push(decoder);
  }
  return result;
}

describe("toWireFrames", () => {
  it("passes small messages through untouched", () => {
    const msg = new Uint8Array([1, 2, 3]);
    const frames = toWireFrames(msg);
    expect(frames).toEqual([msg]);
  });

  it("splits oversized messages and each frame stays under the cap", () => {
    const msg = bigMessage(CHUNK_PAYLOAD_BYTES * 2 + 17);
    const frames = toWireFrames(msg);
    expect(frames.length).toBe(3);
    for (const frame of frames) {
      expect(frame.byteLength).toBeLessThan(1024 * 1024);
    }
  });
});

describe("ChunkAssembler", () => {
  it("round-trips a large message", () => {
    const msg = bigMessage(CHUNK_PAYLOAD_BYTES * 2 + 17);
    const out = reassemble(toWireFrames(msg));
    expect(out).not.toBeNull();
    expect(out!.byteLength).toBe(msg.byteLength);
    expect(out).toEqual(msg);
  });

  it("returns null until the final chunk", () => {
    const msg = new Uint8Array(CHUNK_PAYLOAD_BYTES + 1);
    const frames = toWireFrames(msg);
    const assembler = new ChunkAssembler();
    const first = decoding.createDecoder(frames[0]);
    decoding.readVarUint(first);
    expect(assembler.push(first)).toBeNull();
  });

  it("resets on an out-of-sequence chunk instead of corrupting", () => {
    const msg = bigMessage(CHUNK_PAYLOAD_BYTES * 2 + 5);
    const frames = toWireFrames(msg);
    const assembler = new ChunkAssembler();

    // Drop the first frame: the middle chunk arrives out of sequence
    const middle = decoding.createDecoder(frames[1]);
    decoding.readVarUint(middle);
    expect(assembler.push(middle)).toBeNull();

    // A complete retransmission still reassembles cleanly
    let out: Uint8Array | null = null;
    for (const frame of frames) {
      const decoder = decoding.createDecoder(frame);
      decoding.readVarUint(decoder);
      out = assembler.push(decoder);
    }
    expect(out).toEqual(msg);
  });
});
