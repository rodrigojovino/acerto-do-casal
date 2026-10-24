/**
 * Foto do casal no cartão de saldo: enquadramento, escurecimento e a conta de
 * legibilidade. Lógica pura (quem lê os pixels é a tela, com canvas).
 *
 * A foto cobre o cartão inteiro (× aproximação) e é escurecida por um véu em
 * gradiente, mais forte embaixo. O escurecimento escolhido nunca fica abaixo
 * do mínimo calculado sobre os pixels atrás de cada texto, para que todos
 * tenham o contraste do WCAG AA (4,5:1 nos pequenos, 3:1 no valor grande).
 * Cada aparelho recalcula o mínimo para o próprio cartão.
 */

export const COVER_DARK_MIN = 0.4;
export const COVER_DARK_MAX = 0.9;
export const COVER_BLUR_MAX = 2;
export const COVER_ZOOM_MIN = 1;
export const COVER_ZOOM_MAX = 3;
/** Foto comprimida para caber com folga num documento do Firestore (base64 ≈ +33%). */
export const COVER_MAX_BYTES = 360 * 1024;

export interface CoverFraming {
  /** Posição da parte visível, 0 (esquerda/topo) a 1 (direita/base). */
  x: number;
  y: number;
  /** Aproximação, 1 a 3 (1 = a foto só cobre o cartão). */
  zoom: number;
  /** Escurecimento no topo do véu, 0,40 a 0,90. */
  dark: number;
  /** Desfoque, 0 a 2 px. */
  blur: number;
}

export const DEFAULT_FRAMING: CoverFraming = { x: 0.5, y: 0.5, zoom: 1, dark: 0.6, blur: 0 };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Valores dentro dos limites (os mesmos das regras). */
export function clampFraming(f: CoverFraming): CoverFraming {
  return {
    x: clamp(f.x, 0, 1),
    y: clamp(f.y, 0, 1),
    zoom: clamp(f.zoom, COVER_ZOOM_MIN, COVER_ZOOM_MAX),
    dark: clamp(f.dark, COVER_DARK_MIN, COVER_DARK_MAX),
    blur: clamp(Math.round(f.blur), 0, COVER_BLUR_MAX),
  };
}

/** Escurecimento do véu na altura t (0 = topo, 1 = base): mais forte embaixo. */
export function veilAlpha(dark: number, t: number): number {
  const bottom = Math.min(0.94, dark + 0.3);
  return dark + (bottom - dark) * clamp(t, 0, 1);
}

/** Gradiente CSS do véu. */
export function veilGradient(dark: number): string {
  return `linear-gradient(180deg, rgba(14,12,14,${dark.toFixed(2)}) 0%, rgba(14,12,14,${veilAlpha(dark, 1).toFixed(2)}) 100%)`;
}

/** Retângulo da foto no cartão (cw × ch): cobre o cartão × aproximação, deslocada por x/y. */
export function photoRect(img: { width: number; height: number }, cw: number, ch: number, f: Pick<CoverFraming, 'x' | 'y' | 'zoom'>) {
  const scale = Math.max(cw / img.width, ch / img.height) * f.zoom;
  const w = img.width * scale;
  const h = img.height * scale;
  return { left: (cw - w) * f.x, top: (ch - h) * f.y, width: w, height: h };
}

/**
 * Arrastar: novo x/y a partir do início do arrasto e do deslocamento em px.
 * Só há o que mover no sentido em que a foto sobra além do cartão.
 */
export function dragFraming(
  start: Pick<CoverFraming, 'x' | 'y'>,
  dx: number,
  dy: number,
  rect: { width: number; height: number },
  cw: number,
  ch: number,
): Pick<CoverFraming, 'x' | 'y'> {
  const slackX = cw - rect.width;
  const slackY = ch - rect.height;
  return {
    x: slackX < 0 ? clamp(start.x + dx / slackX, 0, 1) : start.x,
    y: slackY < 0 ? clamp(start.y + dy / slackY, 0, 1) : start.y,
  };
}

// ---- Contraste (WCAG) ----

const channel = (v: number) => {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

export const luminance = (r: number, g: number, b: number) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

export const contrastRatio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/**
 * Pixels atrás de um texto: a cor mais clara de cada linha (o pior caso para
 * texto claro) e a altura relativa da linha no cartão.
 */
export interface TextRegion {
  rows: ReadonlyArray<{ t: number; r: number; g: number; b: number }>;
  /** Luminância do texto (branco = 1). */
  textLuminance: number;
  /** Contraste exigido: 4,5 (texto pequeno) ou 3 (texto grande). */
  required: number;
}

/** Pior folga (contraste ÷ exigido) entre os textos, para um escurecimento; ≥ 1 = todos legíveis. */
export function worstMargin(regions: readonly TextRegion[], dark: number): number {
  let worst = Infinity;
  for (const reg of regions) {
    let brightest = 0;
    for (const row of reg.rows) {
      const k = 1 - veilAlpha(dark, row.t);
      brightest = Math.max(brightest, luminance(row.r * k, row.g * k, row.b * k));
    }
    worst = Math.min(worst, contrastRatio(reg.textLuminance, brightest) / reg.required);
  }
  return worst;
}

/** Menor escurecimento (centésimos, dentro dos limites) com todos os textos legíveis. */
export function minimumDark(regions: readonly TextRegion[]): number {
  if (regions.length === 0 || worstMargin(regions, COVER_DARK_MIN) >= 1) return COVER_DARK_MIN;
  let lo = COVER_DARK_MIN;
  let hi = COVER_DARK_MAX;
  if (worstMargin(regions, hi) < 1) return COVER_DARK_MAX;
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) / 2;
    if (worstMargin(regions, mid) >= 1) hi = mid;
    else lo = mid;
  }
  return Math.min(COVER_DARK_MAX, Math.ceil(hi * 100) / 100);
}

/** Escurecimento aplicado: o escolhido, nunca abaixo do mínimo deste cartão. */
export function effectiveDark(chosen: number, minimum: number): number {
  return clamp(Math.max(chosen, minimum), COVER_DARK_MIN, COVER_DARK_MAX);
}
