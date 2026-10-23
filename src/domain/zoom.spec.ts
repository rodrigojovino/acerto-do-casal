import { describe, expect, it } from 'vitest';
import { clampState, doubleTap, fitSize, initialState, pan, pinch, zoomAt, type Size } from './zoom';

// Tela de celular na vertical; uma foto vertical (recibo) e uma horizontal.
const VIEW: Size = { width: 400, height: 700 };
const VERTICAL: Size = { width: 1200, height: 2400 };
const HORIZONTAL: Size = { width: 2000, height: 1000 };

describe('fitSize e initialState: abre com a foto inteira', () => {
  it('vertical: encaixa pela altura, centralizada na largura', () => {
    const fit = fitSize(VERTICAL, VIEW);
    expect(fit).toEqual({ width: 350, height: 700 });
    expect(initialState(fit, VIEW)).toEqual({ scale: 1, x: 25, y: 0 });
  });

  it('horizontal: encaixa pela largura, centralizada na altura', () => {
    const fit = fitSize(HORIZONTAL, VIEW);
    expect(fit).toEqual({ width: 400, height: 200 });
    expect(initialState(fit, VIEW)).toEqual({ scale: 1, x: 0, y: 250 });
  });
});

describe('limites', () => {
  const fit = fitSize(HORIZONTAL, VIEW); // 400 × 200

  it('zoom fica entre 1x e 5x', () => {
    expect(clampState({ scale: 9, x: 0, y: 0 }, fit, VIEW).scale).toBe(5);
    expect(clampState({ scale: 0.3, x: 0, y: 0 }, fit, VIEW).scale).toBe(1);
  });

  it('ampliada, o arraste alcança as quatro bordas e não passa delas', () => {
    // 4x: 1600 × 800, maior que a tela nas duas dimensões.
    const s = { scale: 4, x: -600, y: -50 };
    // Borda esquerda e de cima: x = 0, y = 0.
    expect(pan(s, 10_000, 10_000, fit, VIEW)).toEqual({ scale: 4, x: 0, y: 0 });
    // Borda direita e de baixo: x = 400 − 1600, y = 700 − 800.
    expect(pan(s, -10_000, -10_000, fit, VIEW)).toEqual({ scale: 4, x: -1200, y: -100 });
  });

  it('na dimensão em que a foto ampliada ainda cabe, ela fica centralizada', () => {
    // 2x: 800 × 400 — passa da largura, cabe na altura (700).
    expect(pan({ scale: 2, x: -100, y: 0 }, 0, 999, fit, VIEW)).toEqual({ scale: 2, x: -100, y: 150 });
  });
});

describe('zoom centrado no ponto', () => {
  it('o ponto da foto sob os dedos não sai do lugar', () => {
    const fit = fitSize(VERTICAL, VIEW); // 350 × 700
    const start = initialState(fit, VIEW); // x 25
    const r = zoomAt(start, 2, 200, 350, fit, VIEW);
    // Ponto da foto sob (200, 350) antes e depois.
    const before = { u: (200 - start.x) / start.scale, v: (350 - start.y) / start.scale };
    const after = { u: (200 - r.x) / r.scale, v: (350 - r.y) / r.scale };
    expect(after.u).toBeCloseTo(before.u);
    expect(after.v).toBeCloseTo(before.v);
    expect(r.scale).toBe(2);
  });

  it('perto da borda, o zoom respeita o limite (a borda não descola)', () => {
    const fit = fitSize(VERTICAL, VIEW);
    // Toque na margem à direita da foto e na borda de cima.
    const r = zoomAt(initialState(fit, VIEW), 3, 390, 0, fit, VIEW);
    expect(r.x).toBe(VIEW.width - fit.width * 3);
    expect(r.y).toBe(0);
  });
});

describe('toque duplo', () => {
  const fit = fitSize(HORIZONTAL, VIEW);

  it('inteira → 2,5x no ponto tocado; ampliada → inteira', () => {
    const start = initialState(fit, VIEW);
    const zoomed = doubleTap(start, 100, 350, fit, VIEW);
    expect(zoomed.scale).toBe(2.5);
    expect((100 - zoomed.x) / zoomed.scale).toBeCloseTo((100 - start.x) / start.scale);
    expect(doubleTap(zoomed, 300, 300, fit, VIEW)).toEqual(start);
  });
});

describe('pinça', () => {
  const fit = fitSize(VERTICAL, VIEW);
  const start = { state: initialState(fit, VIEW), distance: 100, midX: 200, midY: 350 };

  it('abrir os dedos amplia na proporção, centrado no meio deles', () => {
    const r = pinch(start, 300, 200, 350, fit, VIEW);
    expect(r.scale).toBe(3);
    expect((200 - r.x) / r.scale).toBeCloseTo((200 - start.state.x) / start.state.scale);
  });

  it('para em 5x e em 1x', () => {
    expect(pinch(start, 10_000, 200, 350, fit, VIEW).scale).toBe(5);
    expect(pinch(start, 10, 200, 350, fit, VIEW)).toEqual(initialState(fit, VIEW));
  });

  it('mover os dedos juntos também arrasta a foto ampliada', () => {
    const a = pinch(start, 200, 200, 350, fit, VIEW);
    const b = pinch(start, 200, 150, 300, fit, VIEW);
    expect(b.x - a.x).toBeCloseTo(-50);
    expect(b.y - a.y).toBeCloseTo(-50);
  });
});
