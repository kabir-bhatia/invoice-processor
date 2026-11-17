// In-browser photo check, run before upload so a bad photo is caught while the
// paper is still in hand. Same maths as the server-side check (backend/app/media.py):
//   sharpness = variance of the Laplacian, brightness = mean luma, glare = share of blown-out pixels,
//   document  = is there a page in the frame at all? Relative (Otsu split), so a dim photo still counts:
//     paper  = light-side, colourless pixels (the page)
//     edges  = pixels on a sharp edge (text strokes)
//     colour = strongly coloured pixels (skin, scenery) — a page is mostly colourless

export interface PhotoQuality {
  sharpness: number; // 0..1 (normalised)
  brightness: number; // 0..1
  glare: number; // 0..1 share of blown-out pixels
  paper: number; // 0..1
  edges: number; // 0..1
  colour: number; // 0..1
  issue: "no_document" | "blurry" | "dark" | "glare" | null;
  ok: boolean;
}

const BLUR_VARIANCE_MIN = 55; // below this the text edges are too soft to read reliably
const SHARP_VARIANCE_REF = 420; // variance that maps to a "100%" sharpness reading
const DARK_MIN = 0.2;
const GLARE_MAX = 0.25;
const PAPER_MIN = 0.12;
const EDGES_MIN = 0.02;
const COLOUR_MAX = 0.35;

function otsu(hist: Uint32Array, n: number): number {
  let sumAll = 0;
  for (let i = 0; i < 256; i++) sumAll += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let thr = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = n - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      thr = t;
    }
  }
  return thr;
}

export function checkPhoto(source: CanvasImageSource, srcW: number, srcH: number): PhotoQuality {
  const w = 420;
  const h = Math.max(1, Math.round((srcH / srcW) * w));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(source, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);

  const n = w * h;
  const g = new Float32Array(n);
  const chroma = new Uint8Array(n);
  const hist = new Uint32Array(256);
  let sum = 0;
  let blown = 0;
  let coloured = 0;
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const r = data[i];
    const gr = data[i + 1];
    const b = data[i + 2];
    const y = 0.299 * r + 0.587 * gr + 0.114 * b;
    const ch = Math.max(r, gr, b) - Math.min(r, gr, b);
    g[p] = y;
    chroma[p] = ch;
    hist[Math.min(255, Math.round(y))]++;
    sum += y;
    if (y >= 253) blown++;
    if (ch > 60) coloured++;
  }
  const split = Math.max(otsu(hist, n), 60);
  let paper = 0;
  for (let p = 0; p < n; p++) if (g[p] > split && chroma[p] < 45) paper++;

  // 4-neighbour Laplacian: its variance (sharpness) and the share of strong responses (text edges).
  let lsum = 0;
  let lsq = 0;
  let cnt = 0;
  let strong = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const l = g[i - w] + g[i + w] + g[i - 1] + g[i + 1] - 4 * g[i];
      lsum += l;
      lsq += l * l;
      cnt++;
      if (Math.abs(l) > 40) strong++;
    }
  }
  const variance = lsq / cnt - (lsum / cnt) ** 2;
  const brightness = sum / n / 255;
  const glare = blown / n;
  const paperShare = paper / n;
  const edges = strong / cnt;
  const colour = coloured / n;
  const isDocument = paperShare >= PAPER_MIN && edges >= EDGES_MIN && colour < COLOUR_MAX;

  const issue = !isDocument
    ? "no_document"
    : variance < BLUR_VARIANCE_MIN
      ? "blurry"
      : brightness < DARK_MIN
        ? "dark"
        : glare > GLARE_MAX
          ? "glare"
          : null;
  return {
    sharpness: Math.min(1, variance / SHARP_VARIANCE_REF),
    brightness,
    glare,
    paper: paperShare,
    edges,
    colour,
    issue,
    ok: issue === null,
  };
}
