import { describe, expect, it } from 'vitest';
import { MAX_RECEIPT_BYTES, compressToLimit, fitWithin, receiptPhotoPath, type JpegEncoder, type Size } from './image';

/** Codificador falso: bytes proporcionais à área e à qualidade. */
function fakeEncoder(bytesPerPixelAtFullQuality: number): { encode: JpegEncoder; calls: Array<[Size, number]> } {
  const calls: Array<[Size, number]> = [];
  const encode: JpegEncoder = async (size, quality) => {
    calls.push([size, quality]);
    const bytes = Math.round(size.width * size.height * bytesPerPixelAtFullQuality * quality);
    return { bytes, data: new Blob([new Uint8Array(1)]) };
  };
  return { encode, calls };
}

describe('fitWithin', () => {
  it('reduz pelo lado maior mantendo a proporção', () => {
    expect(fitWithin({ width: 4000, height: 3000 }, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin({ width: 3000, height: 4000 }, 1600)).toEqual({ width: 1200, height: 1600 });
  });

  it('nunca amplia', () => {
    expect(fitWithin({ width: 800, height: 600 }, 1600)).toEqual({ width: 800, height: 600 });
  });
});

describe('compressToLimit', () => {
  it('foto leve sai na primeira qualidade, já reduzida a 1600px', async () => {
    const { encode, calls } = fakeEncoder(0.1);
    const result = await compressToLimit({ width: 4000, height: 3000 }, encode);
    expect(result.size).toEqual({ width: 1600, height: 1200 });
    expect(result.quality).toBe(0.82);
    expect(result.bytes).toBeLessThanOrEqual(MAX_RECEIPT_BYTES);
    expect(calls).toHaveLength(1);
  });

  it('baixa a qualidade antes de baixar a resolução', async () => {
    const { encode } = fakeEncoder(0.35);
    const result = await compressToLimit({ width: 4000, height: 3000 }, encode);
    expect(result.size).toEqual({ width: 1600, height: 1200 });
    expect(result.quality).toBeLessThan(0.82);
    expect(result.bytes).toBeLessThanOrEqual(MAX_RECEIPT_BYTES);
  });

  it('reduz a resolução quando nem a qualidade mínima cabe', async () => {
    const { encode } = fakeEncoder(1);
    const result = await compressToLimit({ width: 4000, height: 3000 }, encode);
    expect(result.size.width).toBeLessThan(1600);
    expect(result.bytes).toBeLessThanOrEqual(MAX_RECEIPT_BYTES);
  });

  it('desiste se nem 640px na qualidade mínima couber', async () => {
    const { encode } = fakeEncoder(50);
    await expect(compressToLimit({ width: 4000, height: 3000 }, encode)).rejects.toThrow(RangeError);
  });
});

describe('receiptPhotoPath', () => {
  it('segue o caminho do CLAUDE.md', () => {
    expect(receiptPhotoPath('g1', 'e1')).toBe('groups/g1/receipts/e1.jpg');
  });
});
