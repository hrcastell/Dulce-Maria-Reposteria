/**
 * Parser de comprobantes: recibe un archivo (PDF / Excel / CSV / FOTO) y devuelve
 * los ítems (descripción, cantidad, valor unitario, impuesto, total) junto con
 * los totales del documento.
 *
 * Todo se procesa en el navegador (sin llamadas al servidor):
 * - Excel/CSV  → SheetJS (xlsx)
 * - PDF        → pdf.js, reconstruyendo la tabla con posiciones x/y
 * - FOTO       → canvas (EXIF + recorte de márgenes + binarización) y
 *                Tesseract.js (OCR spa+eng, WASM) → palabras con posición →
 *                lib/quote-grid.ts (ocrWordsToLines + analyzeOcrLines)
 * La detección ("¿es un documento cargable?") y la extracción viven en lib/quote-grid.ts.
 */

import {
  analyzeGrid,
  analyzeOcrLines,
  analyzePdfPages,
  ocrWordsToLines,
  type AnalyzeResult,
  type OcrWord,
  type PdfToken,
} from "./quote-grid";

export type QuoteParseResult = AnalyzeResult & {
  ok: boolean;
  error?: string;
  source: "excel" | "pdf" | "foto";
  fileName: string;
  /** Confianza media del OCR (0–1), solo para fotos. */
  ocrConfidence?: number;
};

const MAX_FILE_BYTES = 15 * 1024 * 1024;
/** Lado mayor máximo al re-escalar la foto antes del OCR. */
const MAX_IMAGE_SIDE = 1600;
/** Binarización adaptativa: ventana (en px) para el umbral local. */
const BINARIZE_WINDOW = 24;

/** Detecta la extensión real del archivo a partir de su nombre. */
function fileSource(fileName: string): "excel" | "pdf" | "foto" | null {
  const name = fileName.toLowerCase();
  if (name.endsWith(".pdf")) return "pdf";
  if (/\.(xlsx|xls|csv)$/.test(name)) return "excel";
  if (/\.(jpe?g|png|webp|heic|heif|bmp|gif)$/.test(name)) return "foto";
  return null;
}

function fail(fileName: string, error: string): QuoteParseResult {
  return {
    ok: false,
    error,
    source: "excel",
    fileName,
    isQuote: false,
    items: [],
    subtotal: null,
    iva: null,
    total: null,
    keywordFound: false,
    headerFound: false,
  };
}

/** Lee un Excel/CSV con SheetJS y analiza la primera hoja con encabezados. */
async function parseExcel(file: File): Promise<QuoteParseResult> {
  const XLSX = await import("xlsx");
  let workbook;
  if (/\.csv$/i.test(file.name)) {
    workbook = XLSX.read(await file.text(), { type: "string" });
  } else {
    workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
  }

  let best: AnalyzeResult | null = null;
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" }) as unknown[][];
    const grid: string[][] = rows.map((r) => r.map((c) => String(c ?? "")));
    const result = analyzeGrid(grid);
    if (result.isQuote && result.items.length) return { ...result, ok: true, source: "excel", fileName: file.name };
    if (!best || (result.isQuote && !best.isQuote)) best = result;
  }

  if (best) return { ...best, ok: true, source: "excel", fileName: file.name };
  return fail(file.name, "El archivo Excel no contenía una hoja con datos legibles.");
}

/** Extrae el texto de un PDF con pdf.js y reconstruye la tabla por posiciones. */
async function parsePdf(file: File): Promise<QuoteParseResult> {
  const pdfjs = await import("pdfjs-dist");
  // El worker se sirve como asset local (patrón compatible con Vite/Webpack).
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url
  ).toString();

  const data = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjs.getDocument({ data });
  const doc = await loadingTask.promise;
  try {
    const pages: PdfToken[][] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const tokens: PdfToken[] = [];
      for (const item of content.items) {
        if (!("str" in item) || !item.str.trim()) continue;
        const [, , , , x, y] = item.transform as number[];
        tokens.push({ x, y, text: item.str });
      }
      pages.push(tokens);
    }
    const result = analyzePdfPages(pages);
    return { ...result, ok: true, source: "pdf", fileName: file.name };
  } finally {
    void loadingTask.destroy();
  }
}

/* ------------------------------------------------------------------ */
/* FOTOS: pre-procesamiento en canvas + OCR con Tesseract.js           */
/* ------------------------------------------------------------------ */

/**
 * Worker de Tesseract en caché: crearlo descarga ~15 MB de WASM + idiomas la
 * primera vez, así que lo reutilizamos durante toda la vida de la página.
 * `progressCb` se puede cambiar por llamada (el logger es global al worker).
 */
type OcrProgress = { status: string; progress: number };
let workerPromise: Promise<{ recognize: (img: HTMLCanvasElement, onProgress?: (p: OcrProgress) => void) => Promise<{ words: OcrWord[]; text: string; confidence: number }> }> | null = null;

async function getOcrWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import("tesseract.js");
      let cb: ((p: OcrProgress) => void) | undefined;
      const worker = await createWorker("spa+eng", 1, {
        // Los tickets chilenos mezclan montos y texto; spa+eng da mejores números.
        logger: (m: { status: string; progress: number }) => cb?.({ status: m.status, progress: m.progress }),
        // Auto-hospedado en public/tesseract/ (ver scripts/copy-tesseract-assets.mjs)
        // en vez del CDN jsdelivr por defecto — no depende de la conexión del
        // usuario ni de que el CDN esté disponible al sacar la foto de la boleta.
        workerPath: "/tesseract/worker.min.js",
        corePath: "/tesseract/core",
        langPath: "/tesseract/lang-data",
        gzip: true,
      });
      return {
        recognize: async (img: HTMLCanvasElement, onProgress?: (p: OcrProgress) => void) => {
          cb = onProgress;
          const { data } = await worker.recognize(img, {}, { text: true, blocks: true });
          const words: OcrWord[] = [];
          for (const block of data.blocks ?? []) {
            for (const par of block.paragraphs ?? []) {
              for (const line of par.lines ?? []) {
                for (const w of line.words ?? []) {
                  if (!w.text.trim()) continue;
                  words.push({
                    text: w.text,
                    x0: Math.round(w.bbox.x0),
                    y0: Math.round(w.bbox.y0),
                    x1: Math.round(w.bbox.x1),
                    y1: Math.round(w.bbox.y1),
                  });
                }
              }
            }
          }
          return { words, text: data.text, confidence: data.confidence ?? 0 };
        },
      };
    })().catch((err) => {
      workerPromise = null; // permitir reintento si la descarga del WASM falla
      throw err;
    });
  }
  return workerPromise;
}

/**
 * Decodifica la foto aplicando la orientación EXIF y la re-escala para que el
 * lado mayor quede en ~1600 px (OCR más rápido y letras de tamaño uniforme).
 */
async function loadScaledBitmap(file: File): Promise<ImageBitmap> {
  try {
    // "from-image" respeta la rotación EXIF (fotos de celular verticales).
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bmp.width, bmp.height));
    if (scale >= 1) return bmp;
    const side = Math.round(Math.max(bmp.width, bmp.height) * scale);
    const w = bmp.width >= bmp.height ? side : Math.round((bmp.width * side) / bmp.height);
    const h = bmp.height > bmp.width ? side : Math.round((bmp.height * side) / bmp.width);
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    return await createImageBitmap(c);
  } catch {
    // Fallback sin createImageBitmap (navegadores viejos): <img> + decode.
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas");
      c.width = Math.round(img.naturalWidth * scale);
      c.height = Math.round(img.naturalHeight * scale);
      const ctx = c.getContext("2d")!;
      ctx.drawImage(img, 0, 0, c.width, c.height);
      return await createImageBitmap(c);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

/**
 * Pre-proceso clásico de OCR sobre la foto: recorte de márgenes, escala de
 * grises, estiramiento de contraste y binarización adaptativa (umbral local
 * por media con imagen integral). Devuelve el canvas con el resultado ya
 * pintado — worker.recognize() de tesseract.js no acepta un ImageData suelto
 * (su tipo ImageLike es string/HTMLImageElement/HTMLCanvasElement/.../Blob/
 * OffscreenCanvas), pasarle ImageData directo hace fallar la lectura interna
 * de Leptonica ("truncated file" / "Image file /input cannot be read!").
 */
function preprocessImage(bmp: ImageBitmap): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = bmp.width;
  c.height = bmp.height;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;

  // 1) Grises + percentiles 2/98 para estirar contraste (fotos lavadas u oscuras).
  const gray = new Uint8ClampedArray(c.width * c.height);
  const hist = new Uint32Array(256);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const g = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
    gray[p] = g;
    hist[g | 0]++;
  }
  const total = gray.length;
  let acc = 0;
  let lo = 0;
  let hi = 255;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= total * 0.02) {
      lo = v;
      break;
    }
  }
  acc = 0;
  for (let v = 255; v >= 0; v--) {
    acc += hist[v];
    if (acc >= total * 0.02) {
      hi = v;
      break;
    }
  }
  const range = Math.max(1, hi - lo);

  // 2) Imagen integral para el umbral local (binarización adaptativa).
  const W = c.width;
  const H = c.height;
  const integral = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let rowSum = 0;
    for (let x = 0; x < W; x++) {
      rowSum += gray[y * W + x];
      integral[(y + 1) * (W + 1) + (x + 1)] = integral[y * (W + 1) + (x + 1)] + rowSum;
    }
  }

  const half = BINARIZE_WINDOW >> 1;
  const out = ctx.createImageData(W, H);
  const od = out.data;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      // Estiramiento de contraste antes de umbralizar.
      const stretched = ((gray[p] - lo) * 255) / range;
      const x0 = Math.max(0, x - half);
      const y0 = Math.max(0, y - half);
      const x1 = Math.min(W - 1, x + half);
      const y1 = Math.min(H - 1, y + half);
      const area = (x1 - x0 + 1) * (y1 - y0 + 1);
      const sum =
        integral[(y1 + 1) * (W + 1) + (x1 + 1)] -
        integral[y0 * (W + 1) + (x1 + 1)] -
        integral[(y1 + 1) * (W + 1) + x0] +
        integral[y0 * (W + 1) + x0];
      const mean = sum / area;
      const v = stretched < mean * 0.88 ? 0 : 255; // tinta más oscura que su entorno
      const o = p * 4;
      od[o] = od[o + 1] = od[o + 2] = v;
      od[o + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
  return c;
}

/** Pipeline completo de una foto: EXIF → escala → binariza → OCR → análisis. */
async function parseImage(file: File, onProgress?: (p: OcrProgress) => void): Promise<QuoteParseResult> {
  const bitmap = await loadScaledBitmap(file);
  try {
    // El aviso de progreso se dispara ANTES del preprocesamiento (que es síncrono
    // y puede tomar 1-2s en imágenes grandes) y con un yield al event loop, para
    // que el navegador alcance a pintarlo antes del bloqueo — si no, el usuario
    // ve la UI trabada sin ningún feedback previo.
    onProgress?.({ status: "preparando imagen", progress: 0.05 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const processedCanvas = preprocessImage(bitmap);
    const ocr = await getOcrWorker();
    const { words, confidence } = await ocr.recognize(processedCanvas, (p) => onProgress?.(p));
    const result = analyzeOcrLines(ocrWordsToLines(words));
    return { ...result, ok: true, source: "foto", fileName: file.name, ocrConfidence: confidence / 100 };
  } finally {
    bitmap.close();
  }
}

/** Punto de entrada: analiza el archivo subido y devuelve el resultado. */
export async function parseQuoteFile(
  file: File,
  onProgress?: (p: OcrProgress) => void
): Promise<QuoteParseResult> {
  if (file.size > MAX_FILE_BYTES) {
    return fail(file.name, "El archivo supera los 15 MB. Probá con un archivo más liviano.");
  }
  const source = fileSource(file.name);
  if (!source) {
    return fail(
      file.name,
      "Formato no soportado. Subí un PDF, Excel (.xlsx/.xls), CSV o una foto (JPG/PNG/WebP)."
    );
  }
  try {
    if (source === "excel") return await parseExcel(file);
    if (source === "pdf") return await parsePdf(file);
    return await parseImage(file, onProgress);
  } catch (err) {
    return fail(
      file.name,
      `No se pudo leer el archivo: ${err instanceof Error ? err.message : "error desconocido"}`
    );
  }
}
