/**
 * Conta do visualizador de fotos (como a galeria do celular), sem DOM.
 *
 * A foto é desenhada com o tamanho "inteira na tela" (`fit`) e um zoom `scale`
 * a partir do canto superior esquerdo, deslocada por (`x`, `y`) em pixels da
 * tela. Em cada dimensão: se a foto ampliada cabe na tela, fica centralizada;
 * se não cabe, o deslocamento fica entre "borda direita/inferior encostada" e
 * "borda esquerda/superior encostada", sem nunca passar das bordas.
 */

export const MIN_SCALE = 1;
export const MAX_SCALE = 5;
export const DOUBLE_TAP_SCALE = 2.5;

export interface Size {
  width: number;
  height: number;
}

export interface ZoomState {
  scale: number;
  x: number;
  y: number;
}

/** Tamanho da foto inteira ajustada à tela (sem cortar e sem ampliar além do encaixe). */
export function fitSize(photo: Size, view: Size): Size {
  if (photo.width <= 0 || photo.height <= 0) return { width: view.width, height: view.height };
  const ratio = Math.min(view.width / photo.width, view.height / photo.height);
  return { width: photo.width * ratio, height: photo.height * ratio };
}

const clampNumber = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

function clampAxis(offset: number, size: number, view: number): number {
  if (size <= view) return (view - size) / 2;
  return clampNumber(offset, view - size, 0);
}

/** Mantém o zoom entre 1x e 5x e a foto dentro das bordas (centralizada onde cabe). */
export function clampState(state: ZoomState, fit: Size, view: Size): ZoomState {
  const scale = clampNumber(state.scale, MIN_SCALE, MAX_SCALE);
  return {
    scale,
    x: clampAxis(state.x, fit.width * scale, view.width),
    y: clampAxis(state.y, fit.height * scale, view.height),
  };
}

/** Foto inteira, centralizada. */
export function initialState(fit: Size, view: Size): ZoomState {
  return clampState({ scale: 1, x: 0, y: 0 }, fit, view);
}

/**
 * Zoom para `scale` mantendo parado o ponto da foto que está sob (`px`, `py`)
 * (os dedos ou o toque), e depois os limites.
 */
export function zoomAt(state: ZoomState, scale: number, px: number, py: number, fit: Size, view: Size): ZoomState {
  const target = clampNumber(scale, MIN_SCALE, MAX_SCALE);
  const u = (px - state.x) / state.scale;
  const v = (py - state.y) / state.scale;
  return clampState({ scale: target, x: px - u * target, y: py - v * target }, fit, view);
}

/** Arrastar com um dedo, sem passar das bordas. */
export function pan(state: ZoomState, dx: number, dy: number, fit: Size, view: Size): ZoomState {
  return clampState({ ...state, x: state.x + dx, y: state.y + dy }, fit, view);
}

/** Toque duplo: ampliada volta para a foto inteira; inteira vai para 2,5x no ponto tocado. */
export function doubleTap(state: ZoomState, px: number, py: number, fit: Size, view: Size): ZoomState {
  if (state.scale > MIN_SCALE + 0.01) return initialState(fit, view);
  return zoomAt(state, DOUBLE_TAP_SCALE, px, py, fit, view);
}

export interface PinchStart {
  state: ZoomState;
  distance: number;
  midX: number;
  midY: number;
}

/**
 * Pinça: o zoom acompanha a abertura dos dedos e o ponto da foto que estava
 * entre eles no começo acompanha o meio dos dedos (aproxima, afasta e arrasta
 * ao mesmo tempo).
 */
export function pinch(start: PinchStart, distance: number, midX: number, midY: number, fit: Size, view: Size): ZoomState {
  const scale = clampNumber(start.state.scale * (distance / Math.max(start.distance, 1)), MIN_SCALE, MAX_SCALE);
  const u = (start.midX - start.state.x) / start.state.scale;
  const v = (start.midY - start.state.y) / start.state.scale;
  return clampState({ scale, x: midX - u * scale, y: midY - v * scale }, fit, view);
}
