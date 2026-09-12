// Copia el worker y los núcleos WASM de tesseract.js a public/tesseract/ para
// auto-hospedarlos (en vez de depender del CDN jsdelivr en tiempo de ejecución).
// Corre en cada `npm install` (ver "postinstall" en package.json) para quedar
// siempre en sync con la versión instalada del paquete.
//
// Solo se copian las variantes LSTM-only ("*-lstm.wasm.js") porque el motor de
// importación de boletas (Frontend/dulcemaria-web/lib/quote-parser.ts) siempre
// usa OEM=1 (lstmOnly). Se incluyen las 3 variantes de aceleración (sin SIMD,
// SIMD, relaxed-SIMD) para no depender de qué soporte tenga el navegador de
// quien use el panel — tesseract.js elige la correcta en runtime y no hay
// fallback automático si la elegida no está disponible.
import { copyFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const publicDir = join(root, 'public', 'tesseract')

const copies = [
  {
    from: join(root, 'node_modules', 'tesseract.js', 'dist', 'worker.min.js'),
    to: join(publicDir, 'worker.min.js'),
  },
  ...['tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js'].map((name) => ({
    from: join(root, 'node_modules', 'tesseract.js-core', name),
    to: join(publicDir, 'core', name),
  })),
]

let copied = 0
let skipped = 0
for (const { from, to } of copies) {
  if (!existsSync(from)) {
    console.warn(`[copy-tesseract-assets] Falta ${from} — ¿está instalado tesseract.js/tesseract.js-core? Se omite.`)
    skipped++
    continue
  }
  mkdirSync(dirname(to), { recursive: true })
  copyFileSync(from, to)
  copied++
}

console.log(`[copy-tesseract-assets] ${copied} archivo(s) copiados a public/tesseract/${skipped ? `, ${skipped} omitido(s)` : ''}.`)
