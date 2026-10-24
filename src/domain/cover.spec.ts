import { describe, expect, it } from 'vitest';
import {
  COVER_DARK_MAX,
  COVER_DARK_MIN,
  clampFraming,
  contrastRatio,
  dragFraming,
  effectiveDark,
  luminance,
  minimumDark,
  photoRect,
  veilAlpha,
  worstMargin,
  type TextRegion,
} from './cover';

const white = (t: number) => ({ t, r: 255, g: 255, b: 255 });
const black = (t: number) => ({ t, r: 0, g: 0, b: 0 });
const small = (rows: TextRegion['rows']): TextRegion => ({ rows, textLuminance: 1, required: 4.5 });
const large = (rows: TextRegion['rows']): TextRegion => ({ rows, textLuminance: 1, required: 3 });

describe('limites e véu', () => {
  it('mantém cada valor nos limites das regras', () => {
    expect(clampFraming({ x: -1, y: 2, zoom: 5, dark: 0.1, blur: 7 })).toEqual({ x: 0, y: 1, zoom: 3, dark: COVER_DARK_MIN, blur: 2 });
    expect(clampFraming({ x: 0.3, y: 0.7, zoom: 1.5, dark: 0.95, blur: 1.4 })).toEqual({ x: 0.3, y: 0.7, zoom: 1.5, dark: COVER_DARK_MAX, blur: 1 });
  });

  it('véu mais escuro embaixo do que em cima', () => {
    expect(veilAlpha(0.5, 0)).toBe(0.5);
    expect(veilAlpha(0.5, 1)).toBeCloseTo(0.8);
    expect(veilAlpha(0.8, 1)).toBeCloseTo(0.94);
  });
});

describe('enquadramento', () => {
  it('a foto cobre o cartão; com aproximação sobra nos dois sentidos', () => {
    expect(photoRect({ width: 1600, height: 1200 }, 400, 200, { x: 0.5, y: 0.5, zoom: 1 })).toEqual({ left: 0, top: -50, width: 400, height: 300 });
    const r = photoRect({ width: 1600, height: 1200 }, 400, 200, { x: 0, y: 1, zoom: 2 });
    expect({ ...r, left: r.left + 0 }).toEqual({ left: 0, top: -400, width: 800, height: 600 });
  });

  it('arrastar move nos dois sentidos quando há sobra, sem passar das bordas', () => {
    const rect = { width: 800, height: 600 };
    // Sobra de 400 px nos dois sentidos: arrastar 100 px para a esquerda/cima move 1/4.
    expect(dragFraming({ x: 0.5, y: 0.5 }, -100, -100, rect, 400, 200)).toEqual({ x: 0.75, y: 0.75 });
    expect(dragFraming({ x: 0.5, y: 0.5 }, -10000, 10000, rect, 400, 200)).toEqual({ x: 1, y: 0 });
    // Sem aproximação, a foto 4:3 num cartão 2:1 só sobra na vertical.
    expect(dragFraming({ x: 0.5, y: 0.5 }, -100, -25, { width: 400, height: 300 }, 400, 200)).toEqual({ x: 0.5, y: 0.75 });
  });
});

describe('legibilidade', () => {
  it('contraste WCAG: branco sobre preto é 21:1', () => {
    expect(contrastRatio(luminance(255, 255, 255), luminance(0, 0, 0))).toBeCloseTo(21);
  });

  it('foto escura: o mínimo é o piso de 40%', () => {
    expect(minimumDark([small([black(0.1)]), large([black(0.4)])])).toBe(COVER_DARK_MIN);
  });

  it('foto branca: o mínimo deixa todos os textos com o contraste exigido', () => {
    const regions = [small([white(0.1), white(0.12)]), large([white(0.35)])];
    const min = minimumDark(regions);
    expect(min).toBeGreaterThan(COVER_DARK_MIN);
    expect(worstMargin(regions, min)).toBeGreaterThanOrEqual(1);
    expect(worstMargin(regions, min - 0.02)).toBeLessThan(1);
  });

  it('texto embaixo precisa de menos, porque o véu é mais forte lá', () => {
    expect(minimumDark([small([white(0.9)])])).toBeLessThan(minimumDark([small([white(0.1)])]));
  });

  it('o aplicado nunca fica abaixo do mínimo do cartão', () => {
    expect(effectiveDark(0.45, 0.58)).toBe(0.58);
    expect(effectiveDark(0.7, 0.58)).toBe(0.7);
  });
});
