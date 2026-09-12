/**
 * Lógica pura de detección y extracción de cotizaciones, boletas y facturas.
 *
 * Trabaja sobre "grids" (filas de celdas de texto) que pueden provenir de un
 * Excel (SheetJS), de un PDF (pdf.js reconstruye las filas con las posiciones
 * x/y de cada token) o de una FOTO (Tesseract.js devuelve palabras con su
 * bounding box; ocrLinesToRows las agrupa). Al mantenerla libre de
 * dependencias pesadas, se puede testear en Node sin cargar xlsx, pdfjs ni
 * tesseract.
 */

export type QuoteLineItem = {
  descripcion: string;
  cantidad: number | null;
  valorUnitario: number | null;
  /** Impuesto de la línea (solo si la tabla trae columna IVA/impuesto). */
  impuesto: number | null;
  /** Total de la línea: columna total, o cantidad × valorUnitario. */
  total: number | null;
};

export type DocumentKind = "cotizacion" | "boleta" | "factura" | "cuenta" | null;

export type AnalyzeResult = {
  isQuote: boolean;
  reason?: string;
  items: QuoteLineItem[];
  subtotal: number | null;
  iva: number | null;
  total: number | null;
  currency?: string;
  quoteNumber?: string | null;
  /** Tipo de documento detectado (boleta/factura/cuenta/cotización). */
  docType?: DocumentKind;
  /** N° de documento (folio de boleta/factura) si se pudo leer. */
  documentNumber?: string | null;
  /** Advertencias de consistencia (ej. ítems no cuadran con el total). */
  warnings?: string[];
  keywordFound: boolean;
  headerFound: boolean;
};

export type PdfToken = { x: number; y: number; text: string };

/** Palabra OCR con posición (en px de la imagen ya rotada/normalizada). */
export type OcrWord = { text: string; x0: number; y0: number; x1: number; y1: number };

const HEADER_RE = {
  descripcion: /descripcion|detalle|concepto|producto|servicio|trabajo|item/i,
  cantidad: /(^|\s)cant|^cantidad$|^qty$|unid|^uds$/i,
  unitario: /unitario|precio unit|valor unit/i,
  iva: /^iva$|impuesto|imp\.?$|^tax$|^iva\s*\(/i,
  total: /total|importe|monto/i,
};

// Etiquetas típicas de fila de total, con tolerancia a errores de OCR frecuentes
// en tickets impresos («tork», «totai», «10tal», «tota1»...).
const TOTAL_LABEL_RE = /^(subtotal|neto|iva|impuesto|total|gran total|total general|total consumo|total pagado|total palado|monto|a pagar|que pagar|pagar|tork|totai|lotai|10tal|1otal|tolal|tota1)\b/i;

/** Detección del tipo de documento: cotización, boleta, factura o cuenta. */
export const DOC_RE: Record<Exclude<DocumentKind, null>, RegExp> = {
  cotizacion: /cotizaci[oó]n|cotizacion/i,
  boleta: /boleta/i,
  factura: /factura/i,
  cuenta: /\bcuenta\b|total\s+consumo|consumo\s+total|propina/i,
};

/** Folio de boleta/factura («Boleta Electrónica: 3.922.031», «BOLETA N° 0011113798»). */
const FOLIO_RE =
  /(?:boleta|factura|documento)[^\n\d$]{0,24}(?:electr[oó]nica?\s*)?(?:n(?:[°ºor]|ro)?\.?\s*)?[#:]?\s*(\d[\d.]{4,}(?:-\d)?)|\b(\d{1,3}(?:\.\d{3}){2,}-?\d?)\s*(?:\n|$)/i;

/** «El IVA de esta boleta es $7.984» (recibo impreso chileno; IVR = OCR de IVA). */
const IVA_SENTENCE_RE = /(?:iva|ivr)[^\n$]{0,40}?\$\s?([\d.,]+)/i;

/** Etiquetas de pago: no son ítems ni totales del documento. */
const PAYMENT_RE = /^(t\.?debito|t\.?credito|debito|credito|efectivo|transbank|cheque|transferencia|vuelto|cambio|efect|tarjeta|pago|pagos|total pagos|recibido|medio de pago)\b/i;

/** Normaliza: minúsculas, sin tildes, espacios colapsados. */
export function norm(s: unknown): string {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parsea un número en formato es-CL/es-CO: "$ 1.845.000", "1.845.000,50",
 * "85000000", "19%" o un número nativo.
 */
export function parseNumber(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  let s = String(raw).trim();
  if (!s) return null;
  s = s.replace(/[$€£\s]/g, "");
  if (s.endsWith("%")) {
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : null;
  }
  if (/^\d{1,3}(,\d{3})+$/.test(s)) {
    // "2,950" o "1,845,000" → comas de miles (tickets impresos).
    s = s.replace(/,/g, "");
  } else if (s.includes(",")) {
    // es-CL/es-CO: la coma es decimal y el punto separa miles.
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    // "85.000" o "1.845.000" → puntos de miles.
    s = s.replace(/\./g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

type ColumnMap = { desc: number; cant: number; unit: number; iva: number | null; total: number };

/** Busca la fila de encabezados (Descripción + Cantidad + Unitario/Total). */
export function detectHeader(rows: string[][]): { headerRow: number; cols: ColumnMap } | null {
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const row = rows[r];
    let desc = -1;
    let cant = -1;
    let unit = -1;
    let iva = -1;
    let total = -1;
    row.forEach((cell, i) => {
      const n = norm(cell);
      if (!n) return;
      if (desc === -1 && HEADER_RE.descripcion.test(n)) desc = i;
      if (cant === -1 && HEADER_RE.cantidad.test(n)) cant = i;
      if (unit === -1 && HEADER_RE.unitario.test(n)) unit = i;
      if (iva === -1 && HEADER_RE.iva.test(n)) iva = i;
      if (total === -1 && HEADER_RE.total.test(n)) total = i;
    });
    if (desc !== -1 && cant !== -1 && (unit !== -1 || total !== -1)) {
      return { headerRow: r, cols: { desc, cant, unit, iva: iva !== -1 ? iva : null, total } };
    }
  }
  return null;
}

function cell(row: string[], i: number): string {
  return String(row[i] ?? "").trim();
}

/** Cuenta las celdas con valor numérico de una fila. */
function numericCellCount(row: string[]): number {
  return row.filter((c) => parseNumber(c) != null).length;
}

/** Extrae los ítems entre el encabezado y las filas de totales. */
export function extractItems(rows: string[][], headerRow: number, cols: ColumnMap): QuoteLineItem[] {
  const items: QuoteLineItem[] = [];
  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r];
    const descripcion = cell(row, cols.desc);
    const firstLabel = norm(row.find((c) => String(c ?? "").trim()) ?? "");
    // Fila de totales: etiqueta típica y a lo sumo un valor numérico (el total).
    if (TOTAL_LABEL_RE.test(firstLabel) && numericCellCount(row) <= 1) continue;
    if (!descripcion) continue;
    const cantidad = parseNumber(cell(row, cols.cant));
    const valorUnitario = parseNumber(cell(row, cols.unit));
    const impuesto = cols.iva != null ? parseNumber(cell(row, cols.iva)) : null;
    const total = parseNumber(cell(row, cols.total));
    if (cantidad == null && valorUnitario == null && total == null && impuesto == null) continue; // texto suelto (footer, condiciones)
    items.push({
      descripcion,
      cantidad,
      valorUnitario,
      impuesto,
      total: total ?? (cantidad != null && valorUnitario != null ? cantidad * valorUnitario : null),
    });
  }
  return items;
}

/** Detecta subtotal, IVA e impuesto total en las filas posteriores al encabezado. */
export function extractTotals(rows: string[][], headerRow: number): { subtotal: number | null; iva: number | null; total: number | null } {
  let subtotal: number | null = null;
  let iva: number | null = null;
  let total: number | null = null;
  let grand: number | null = null;
  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r];
    const label = norm(row.find((c) => String(c ?? "").trim()) ?? "");
    if (!label) continue;
    // Etiquetas de pago (T.Debito, Transbank, vuelto…): no son totales del documento.
    if (PAYMENT_RE.test(label)) continue;
    const numbers = row.map((c) => parseNumber(c)).filter((n): n is number => n != null);
    const last = numbers.length ? numbers[numbers.length - 1] : null;
    if (/^(subtotal|neto)/i.test(label)) subtotal = last;
    else if (/^(iva|impuesto)/i.test(label)) iva = last;
    else if (/^(gran total|total general)/i.test(label)) grand = last;
    // «total» a secas gana: es el último y el más confiable. Variantes OCR
    // frecuentes en tickets: tork/lotat/10tal/1otal/tolal/tota1.
    else if (/^(total|tork|totai|lotai|10tal|1otal|totai|tolal|tota1|total consumo|total a pagar|total que pagar)/i.test(label)) total = last;
  }
  if (grand != null) total = grand;
  return { subtotal, iva, total };
}

const CURRENCY_RE = /\b(?:COP|CLP|USD|EUR|MXN)\b|[$€]/i;
const QUOTE_CODE_RE = /\bCOT[-_.\s]?\d{2,6}([-_.\s]?\d{2,6})?/i;
const QUOTE_NUMBER_RE = /(?:cotizaci[oó]n|cotizacion)\s*(?:n[°ºo]?\.?\s*)?[#:]?\s*([a-z0-9-]+)/i;

/** Detecta el tipo de documento por palabras clave (gana el match más específico). */
export function detectDocType(allText: string): DocumentKind {
  const found = (Object.keys(DOC_RE) as Exclude<DocumentKind, null>[]).filter((k) => DOC_RE[k].test(allText));
  if (found.includes("cotizacion")) return "cotizacion";
  if (found.includes("factura")) return "factura";
  if (found.includes("boleta")) return "boleta";
  if (found.includes("cuenta")) return "cuenta";
  return null;
}

/** Extrae el folio de boleta/factura del texto OCR. */
export function detectFolio(allText: string): string | null {
  const m = allText.match(FOLIO_RE);
  if (!m) return null;
  return (m[1] ?? m[2] ?? "").replace(/[.,]$/, "").trim() || null;
}

function detectMeta(allText: string): { currency?: string; quoteNumber?: string | null } {
  const currencyMatch = allText.match(CURRENCY_RE);
  // Preferimos un código tipo COT-2026-0142; si no, el número tras «Cotización N°».
  const codeMatch = allText.match(QUOTE_CODE_RE);
  const numberMatch = allText.match(QUOTE_NUMBER_RE);
  return {
    currency: currencyMatch?.[0] ?? undefined,
    quoteNumber: codeMatch?.[0] ?? numberMatch?.[1] ?? null,
  };
}

/**
 * Analiza un grid de filas (Excel directo, o PDF ya reconstruido).
 * `allText` permite inyectar texto adicional (p. ej. títulos del PDF) para la
 * detección por palabra clave; por defecto usa todo el grid.
 */
export function analyzeGrid(rows: string[][], opts?: { allText?: string; cols?: ColumnMap }): AnalyzeResult {
  const gridText = rows.map((r) => r.join(" ")).join(" ");
  const allText = opts?.allText ? `${opts.allText} ${gridText}` : gridText;
  const keywordFound = /cotizaci[oó]n|cotizacion/i.test(allText);
  // En el PDF las columnas ya vienen mapeadas por posición x/y; en Excel se detectan por encabezado.
  const header = opts?.cols ? { headerRow: 0, cols: opts.cols } : detectHeader(rows);
  const headerFound = header != null;
  const isQuote = keywordFound || headerFound;

  let items: QuoteLineItem[] = [];
  let subtotal: number | null = null;
  let iva: number | null = null;
  let total: number | null = null;
  if (header) {
    items = extractItems(rows, header.headerRow, header.cols);
    const totals = extractTotals(rows, header.headerRow);
    subtotal = totals.subtotal;
    iva = totals.iva;
    total = totals.total;
  }

  if (total == null && subtotal != null && iva != null) total = subtotal + iva;
  if (total == null && items.length) {
    const sum = items.reduce((acc, it) => acc + (it.total ?? 0), 0);
    if (sum > 0) total = sum;
  }

  // Tipo de documento y advertencias de consistencia (numéricas, no bloqueantes).
  const docType = detectDocType(allText);
  const documentNumber = docType === "cotizacion" ? null : detectFolio(allText);
  const warnings: string[] = [];
  const sumItems = items.reduce((acc, it) => acc + (it.total ?? 0), 0);
  if (total != null && sumItems > 0 && Math.abs(sumItems - total) > Math.max(1, total * 0.02)) {
    warnings.push(
      `La suma de ítems ($${Math.round(sumItems).toLocaleString("es-CL")}) no coincide con el total leído ($${Math.round(total).toLocaleString("es-CL")}); revisá cantidades o montos.`
    );
  }
  if (iva == null && docType === "boleta" && total != null) {
    warnings.push("No se leyó el IVA del documento.");
  }

  const reason = !isQuote
    ? "No se encontró un documento reconocible: buscamos cotizaciones, boletas, facturas o cuentas con sus ítems y totales."
    : keywordFound && !headerFound && !items.length
      ? `Se detectó una ${docType ?? "cotización"}, pero no se encontró una tabla de ítems legible.`
      : undefined;

  return { isQuote, reason, items, subtotal, iva, total, ...detectMeta(allText), docType, documentNumber, warnings, keywordFound, headerFound };
}

/**
 * Reconstruye filas de una página de PDF a partir de los tokens de texto
 * extraídos por pdf.js (cada token con su posición x/y). Detecta el encabezado
 * por línea y reparte cada token a su columna según la x del encabezado.
 */
const PDF_COLS: ColumnMap = { desc: 0, cant: 1, unit: 2, iva: 3, total: 4 };

export function pdfTokensToRows(tokens: PdfToken[]): { rows: string[][]; allText: string; cols: ColumnMap } {
  const lines: PdfToken[][] = [];
  for (const token of tokens) {
    if (!token.text.trim()) continue;
    const line = lines.find((l) => Math.abs(l[0].y - token.y) < 2);
    if (line) line.push(token);
    else lines.push([token]);
  }
  for (const l of lines) l.sort((a, b) => a.x - b.x);
  lines.sort((a, b) => b[0].y - a[0].y); // de arriba hacia abajo

  const allText = lines.map((l) => l.map((t) => t.text).join(" ")).join(" ");

  // Encabezado de la página
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const toks = lines[i].map((t) => norm(t.text));
    const hasDesc = toks.some((t) => HEADER_RE.descripcion.test(t));
    const hasCant = toks.some((t) => HEADER_RE.cantidad.test(t));
    const hasUnit = toks.some((t) => HEADER_RE.unitario.test(t));
    const hasTotal = toks.some((t) => HEADER_RE.total.test(t));
    if (hasDesc && hasCant && (hasUnit || hasTotal)) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) return { rows: [], allText, cols: PDF_COLS };

  const headerTokens = lines[headerIdx];
  const xDesc = headerTokens.find((t) => HEADER_RE.descripcion.test(norm(t.text)))?.x;
  const xCant = headerTokens.find((t) => HEADER_RE.cantidad.test(norm(t.text)))?.x;
  const xUnit = headerTokens.find((t) => HEADER_RE.unitario.test(norm(t.text)))?.x;
  const xIva = headerTokens.find((t) => HEADER_RE.iva.test(norm(t.text)))?.x;
  const xTotal = headerTokens.find((t) => HEADER_RE.total.test(norm(t.text)))?.x;
  if (xCant == null || xTotal == null) return { rows: [], allText, cols: PDF_COLS };

  // Columna de índice (#) si el encabezado la declara antes de la descripción.
  const xIdx = headerTokens.find((t) => /^#|^n[°ºo]?$|^num$|^item$/i.test(norm(t.text)))?.x;

  // Anclas ordenadas: a cada token se le asigna la última ancla con x <= token.x
  const anchors: { name: "idx" | "desc" | "cant" | "unit" | "iva" | "total"; x: number }[] = [];
  if (xIdx != null && xIdx < xCant) anchors.push({ name: "idx", x: xIdx });
  // La descripción empieza en la x de su encabezado (o a la izquierda de Cant. si no se detectó).
  anchors.push({ name: "desc", x: xDesc != null ? xDesc : xIdx != null ? xIdx : -Infinity });
  anchors.push({ name: "cant", x: xCant });
  if (xUnit != null) anchors.push({ name: "unit", x: xUnit });
  if (xIva != null) anchors.push({ name: "iva", x: xIva });
  anchors.push({ name: "total", x: xTotal });

  const rows: string[][] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const buckets: Record<string, string> = { desc: "", cant: "", unit: "", iva: "", total: "" };
    for (const t of lines[i]) {
      let col: string = "desc";
      for (const a of anchors) if (t.x >= a.x - 1) col = a.name;
      if (col === "idx") continue; // el número de fila no aporta datos
      buckets[col] += t.text;
    }
    rows.push([
      buckets.desc.trim(),
      buckets.cant,
      buckets.unit,
      buckets.iva,
      buckets.total,
    ]);
  }
  return { rows, allText, cols: PDF_COLS };
}

/** Analiza un PDF a partir de los tokens de cada página. */
export function analyzePdfPages(pages: PdfToken[][]): AnalyzeResult {
  const rows: string[][] = [];
  const texts: string[] = [];
  let sawHeader = false;
  for (const tokens of pages) {
    const { rows: pageRows, allText, cols } = pdfTokensToRows(tokens);
    if (pageRows.length) {
      // Fila de encabezado sintética para que analyzeGrid sepa el mapeo de columnas.
      rows.push(["Descripción", "Cantidad", "Val. Unitario", "Impuesto", "Val. Total"]);
      rows.push(...pageRows);
      sawHeader = true;
    }
    texts.push(allText);
    void cols;
  }
  if (!rows.length && !texts.some((t) => /cotizaci[oó]n|cotizacion/i.test(t))) {
    return {
      isQuote: false,
      reason: "No se pudo extraer texto del PDF (¿está escaneado?).",
      items: [],
      subtotal: null,
      iva: null,
      total: null,
      keywordFound: false,
      headerFound: false,
    };
  }
  return analyzeGrid(rows, { allText: texts.join(" "), cols: sawHeader ? PDF_COLS : undefined });
}

/* ------------------------------------------------------------------ */
/* FOTOS (OCR): agrupación de palabras en líneas y extracción sin      */
/* encabezados — el formato típico de boletas y cuentas de restaurant. */
/* ------------------------------------------------------------------ */

/**
 * Agrupa palabras OCR en líneas de texto usando su posición vertical
 * (bounding boxes de Tesseract). Dos palabras van juntas si sus cajas se
 * solapan verticalmente o la separación entre ellas es menor que la altura
 * media de línea (tolerante a tickets fotografíaos en ángulo).
 */
export function ocrWordsToLines(words: OcrWord[]): string[][] {
  const clean = words
    .map((w) => ({ ...w, text: String(w.text ?? "").replace(/\s+/g, " ").trim() }))
    .filter((w) => w.text.length > 0)
    .sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  if (!clean.length) return [];

  const h = clean.reduce((acc, w) => acc + (w.y1 - w.y0), 0) / clean.length;
  const tol = Math.max(6, h * 0.6);

  const lines: OcrWord[][] = [];
  for (const w of clean) {
    const line = lines.find((l) => {
      const top = Math.min(...l.map((t) => t.y0));
      const bottom = Math.max(...l.map((t) => t.y1));
      const overlap = Math.min(bottom, w.y1) - Math.max(top, w.y0);
      // Cerca por abajo (misma línea) o por arriba (toca la línea anterior).
      const nearBelow = w.y0 >= bottom && w.y0 - bottom < tol;
      const nearAbove = w.y1 <= top && top - w.y1 < tol;
      return overlap > 0 || nearBelow || nearAbove;
    });
    if (line) line.push(w);
    else lines.push([w]);
  }

  return lines
    .map((l) => l.sort((a, b) => a.x0 - b.x0).map((w) => w.text))
    .filter((l) => l.length > 0);
}

/** Normaliza ruido OCR común: «$» pegado o suelto, «$=» y separadores de miles rotos. */
function cleanReceiptLine(line: string[]): string[] {
  const out: string[] = [];
  for (const raw of line) {
    let t = raw.replace(/\u00a0/g, " ").trim();
    if (!t) continue;
    // «$=890», «$890», «$ 890» → quitamos el «$» y dejamos el número aparte.
    if (/^\$[=\s]*[\d.,]+$/.test(t)) t = t.replace(/^\$[=\s]*/, "");
    else if (t === "$") continue;
    else if (/^\$/.test(t)) t = t.slice(1);
    // Códigos alfanuméricos con puntos («1656.LATA», «730.») no son montos.
    if (/^[a-z]{2,}/i.test(t) && /\d/.test(t) && /^[a-z]+\./i.test(t)) t = t.replace(/^[a-z]+\./i, "");
    if (t) out.push(t);
  }
  return out;
}

/** true si la línea parece contener datos (letras + números o guiones de corte). */
function hasReceiptData(line: string[]): boolean {
  const j = line.join(" ");
  return /[a-z]{2,}/i.test(j) || /\d/.test(j) || /^[-=_.*]{4,}$/.test(j);
}

/**
 * Extrae ítems de líneas de boleta/factura SIN encabezados de tabla:
 * «REIMENTON VERDE $ 890», «HAMBURGUESA 1 5.990», «TOTAL $ 79.750».
 * Heurística: texto con letras a la izquierda + ≥1 número a la derecha,
 * con el ÚLTIMO número como monto (total de la línea).
 */
export function extractReceiptLines(lines: string[][]): QuoteLineItem[] {
  const items: QuoteLineItem[] = [];
  for (const rawLine of lines) {
    const line = cleanReceiptLine(rawLine);
    if (!hasReceiptData(line)) continue;
    const joined = norm(line.join(" "));
    if (!joined) continue;
    if (TOTAL_LABEL_RE.test(joined) || PAYMENT_RE.test(joined) || /^(iva\b|impuesto\b|exento|exentos|timbre|sello|caja|cajero|cliente|vendedor| direccion|direccion|fono|comuna|ciudad|fecha|hora|autorizac|rut\b|nro\.?\b|n[°º]\b|boleta\b|factura\b|documento\b)/i.test(joined)) continue;

    const nums: { v: number; idx: number }[] = [];
    line.forEach((tok, idx) => {
      const v = parseNumber(tok);
      if (v != null) nums.push({ v, idx });
    });
    if (!nums.length) continue;
    const last = nums[nums.length - 1];

    const textWords = line.filter((t) => parseNumber(t) == null && /[a-z]/i.test(t) && !/^[x×*]$/i.test(t));
    const desc = textWords.join(" ").replace(/[|\[\]{}«»]/g, "").trim();
    if (!desc) continue;
    // Exigimos al menos 3 letras acumuladas: evita filas de ruido puro.
    if (desc.replace(/[^a-záéíóúñ]/gi, "").length < 3) continue;
    // Descripciones con números largos (códigos de producto OCR) o montos $0
    // (descuentos) no son ítems vendibles.
    if (/\d{3,}/.test(desc) || last.v === 0) continue;

    const lastNumIdx = last.idx;
    const amountTok = line[lastNumIdx];
    const prevNum = nums.length >= 2 ? nums[nums.length - 2] : null;
    let cantidad: number | null = null;
    let valorUnitario: number | null = null;
    // Patrón típico de boleta: CANT x PRECIO (p.ej. «2 x 5.980» o «2,00 x $ 5.980»).
    const between = prevNum ? norm(line.slice(prevNum.idx + 1, lastNumIdx).join("")) : "";
    if (prevNum && /^[x×*]$/.test(between)) {
      cantidad = prevNum.v;
      valorUnitario = last.v;
    } else if (prevNum && prevNum.idx <= 3 && last.v > prevNum.v) {
      // CANT (corta, a la izquierda) + MONTO mayor a la derecha.
      cantidad = prevNum.v;
      valorUnitario = last.v;
    }

    items.push({
      descripcion: desc,
      cantidad,
      valorUnitario,
      impuesto: null,
      total: last.v,
    });
    // El «x PRECIO» suelto queda cubierto por valorUnitario; evitamos duplicarlo.
    void amountTok;
  }
  return items;
}

/** Extrae subtotal/IVA/total de líneas de recibo (sin encabezados). */
function extractReceiptTotals(lines: string[][]): { subtotal: number | null; iva: number | null; total: number | null } {
  let subtotal: number | null = null;
  let iva: number | null = null;
  let total: number | null = null;
  for (const line of lines) {
    const label = norm(line.join(" "));
    if (!label) continue;
    const numbers = line.map((t) => parseNumber(t)).filter((n): n is number => n != null);
    const last = numbers.length ? numbers[numbers.length - 1] : null;
    const ivaSentence = label.match(IVA_SENTENCE_RE);
    if (ivaSentence) {
      const v = parseNumber(ivaSentence[1]);
      if (v != null) iva = v;
      continue;
    }
    if (PAYMENT_RE.test(label)) continue;
    if (/^(subtotal|neto)/i.test(label)) subtotal = last;
    else if (/^(iva|impuesto)\b/i.test(label)) iva = last;
    else if (/^(total|tork|totai|lotai|10tal|1otal|tolal|tota1)/i.test(label)) total = last;
  }
  return { subtotal, iva, total };
}

/**
 * Analiza las líneas de una FOTO (Tesseract) — boletas, facturas y cuentas
 * suelen no traer encabezados de tabla, así que primero probamos la vía
 * clásica (detectHeader) y si no hay, usamos la heurística de recibos.
 */
export function analyzeOcrLines(lines: string[][], opts?: { allText?: string }): AnalyzeResult {
  const joined = lines.map((l) => l.join(" ")).join("\n");
  const allText = opts?.allText ? `${opts.allText}\n${joined}` : joined;
  // Vía clásica: si la foto trae una tabla con encabezados, usamos el mismo
  // camino del Excel/PDF; si no rinde ítems, caemos a la heurística de recibos.
  const singleCol = lines.map((l) => [l.join(" ")]);
  const header = detectHeader(singleCol);
  if (header) {
    const viaGrid = analyzeGrid(singleCol, { allText });
    if (viaGrid.items.length) return viaGrid;
  }

  const keywordFound = /cotizaci[oó]n|cotizacion|boleta|factura|cuenta|consumo|propina/i.test(allText);
  const items = extractReceiptLines(lines);
  const totals = extractReceiptTotals(lines);
  if (totals.iva == null) {
    const m = allText.match(IVA_SENTENCE_RE);
    if (m) {
      const v = parseNumber(m[1]);
      if (v != null) totals.iva = v;
    }
  }
  const subtotal = totals.subtotal;
  const iva = totals.iva;
  let total = totals.total;
  if (total == null && subtotal != null && iva != null) total = subtotal + iva;
  if (total == null && items.length) {
    const sum = items.reduce((acc, it) => acc + (it.total ?? 0), 0);
    if (sum > 0) total = sum;
  }

  const docType = detectDocType(allText);
  const documentNumber = docType === "cotizacion" ? null : detectFolio(allText);
  const warnings: string[] = [];
  const sumItems = items.reduce((acc, it) => acc + (it.total ?? 0), 0);
  if (total != null && sumItems > 0 && Math.abs(sumItems - total) > Math.max(1, total * 0.02)) {
    warnings.push(
      `La suma de ítems ($${Math.round(sumItems).toLocaleString("es-CL")}) no coincide con el total leído ($${Math.round(total).toLocaleString("es-CL")}); revisá cantidades o montos.`
    );
  }

  const isQuote = keywordFound || items.length > 0;
  const reason = !isQuote
    ? "No se reconoció un documento con datos legibles (ítems con montos, totales, folio…). Probá con una foto más nítida y sin recortes."
    : undefined;

  return {
    isQuote,
    reason,
    items,
    subtotal,
    iva,
    total,
    ...detectMeta(allText),
    docType,
    documentNumber,
    warnings,
    keywordFound: /cotizaci[oó]n|cotizacion/i.test(allText),
    headerFound: false,
  };
}
