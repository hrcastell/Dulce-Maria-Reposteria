/**
 * Subida y entrega de imágenes (productos, hero, temáticas de torta).
 *
 * Reglas:
 *   - Solo JPEG, PNG y WebP. El tipo se decide por los bytes del archivo
 *     (firma/"magic bytes"), nunca por el nombre ni por el Content-Type que
 *     declara el cliente. SVG, HTML, JS y cualquier otro formato se rechazan.
 *   - El nombre en disco lo genera el servidor y la extensión sale del tipo
 *     detectado. Mientras se valida, el archivo usa la extensión `.part`, que
 *     nunca se sirve.
 *   - Los borrados solo actúan sobre rutas que resuelven DENTRO de uploads/.
 *   - Si la solicitud falla, se eliminan los archivos ya escritos.
 *   - /uploads solo entrega extensiones de imagen, con nosniff, una CSP que
 *     impide ejecutar nada y caché larga (los nombres son únicos).
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const multer = require("multer");

const { GENERIC_INTERNAL_ERROR } = require("./httpErrors");

const UPLOADS_DIR = path.join(__dirname, "..", "..", "uploads");
const ALLOWED_IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
// .jfif/.jpe: JPEG con extensiones alternativas que pueden existir en subidas
// antiguas del hero (antes se conservaba la extensión del cliente). Siempre se
// sirven como image/jpeg.
const SERVED_UPLOAD_EXTENSIONS = new Set([".jpg", ".jpeg", ".jpe", ".jfif", ".png", ".webp"]);
const ALLOWED_FORMATS_LABEL = "JPG, PNG o WEBP";
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const STAGING_SUFFIX = ".part";
const UPLOADS_CSP = "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox";

/** Tipo real de una imagen según su cabecera, o null si no es JPEG/PNG/WebP. */
function detectImageType(buffer) {
  if (!Buffer.isBuffer(buffer)) return null;
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mime: "image/jpeg", ext: ".jpg" };
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return { mime: "image/png", ext: ".png" };
  }
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
    return { mime: "image/webp", ext: ".webp" };
  }
  return null;
}

/** Ruta absoluta de una URL `/uploads/...` solo si queda dentro de `uploadsDir`. */
function resolveUploadPath(uploadsDir, imageUrl) {
  if (typeof imageUrl !== "string" || !imageUrl.startsWith("/uploads/") || imageUrl.includes("\0")) return null;
  const relative = imageUrl.slice("/uploads/".length);
  if (!relative) return null;
  const root = path.resolve(uploadsDir);
  const candidate = path.resolve(root, relative);
  return candidate.startsWith(root + path.sep) ? candidate : null;
}

function isServableUploadPath(requestPath) {
  return SERVED_UPLOAD_EXTENSIONS.has(path.posix.extname(String(requestPath || "")).toLowerCase());
}

/** Errores de multer/busboy → `{ status, error }` con mensaje en español. */
function mapUploadError(err, { field, maxFiles, maxFileSizeMb }) {
  switch (err?.code) {
    case "LIMIT_FILE_SIZE":
      return { status: 413, error: `La imagen supera el límite de ${maxFileSizeMb} MB.` };
    case "LIMIT_FILE_COUNT":
      return { status: 400, error: `Máximo ${maxFiles} ${maxFiles === 1 ? "imagen" : "imágenes"} por solicitud.` };
    case "LIMIT_UNEXPECTED_FILE":
      return { status: 400, error: `Campo de archivo inválido. Debe ser '${field}'.` };
    case "LIMIT_PART_COUNT":
    case "LIMIT_FIELD_COUNT":
    case "LIMIT_FIELD_KEY":
    case "LIMIT_FIELD_VALUE":
    case "LIMIT_FIELD_NESTING":
    case "LIMIT_FIELD_ARRAY_INDEX":
    case "MISSING_FIELD_NAME":
    case "INVALID_FIELD_NAME":
      return { status: 400, error: "El formulario tiene demasiados campos o campos demasiado grandes." };
    case "STREAM_DESTROYED":
      return { status: 400, error: "La subida se interrumpió antes de terminar." };
    default:
      break;
  }
  const status = Number(err?.status);
  if (Number.isInteger(status) && status >= 400 && status < 500) return { status, error: String(err.message) };
  // Errores del sistema de archivos (ENOSPC, EACCES, ...) son fallas del servidor.
  if (typeof err?.code === "string" && /^E[A-Z]+$/.test(err.code)) return { status: 500, error: GENERIC_INTERNAL_ERROR };
  return { status: 400, error: "Formulario multipart inválido." };
}

function uploadedFiles(req) {
  if (Array.isArray(req.files)) return req.files;
  if (req.files && typeof req.files === "object") return Object.values(req.files).flat();
  return req.file ? [req.file] : [];
}

/** Elimina los archivos subidos en esta solicitud (para respuestas de error). */
async function removeUploadedFiles(req) {
  await Promise.all(uploadedFiles(req).map((file) => fs.promises.unlink(file.path).catch(() => {})));
}

/** Borra el archivo de una URL `/uploads/...` guardada en la BD, solo si está dentro de uploads/. */
async function deleteUploadByUrl(imageUrl) {
  const absolute = resolveUploadPath(UPLOADS_DIR, imageUrl);
  if (!absolute) return false;
  try {
    await fs.promises.unlink(absolute);
    return true;
  } catch {
    return false;
  }
}

async function readFileHeader(filePath, length) {
  const handle = await fs.promises.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/** Verifica el contenido real y fija el nombre definitivo con la extensión detectada. */
async function finalizeUploadedImages(req) {
  for (const file of uploadedFiles(req)) {
    const type = detectImageType(await readFileHeader(file.path, 16));
    if (!type) {
      const err = new Error(`Uno de los archivos no es una imagen ${ALLOWED_FORMATS_LABEL} válida.`);
      err.status = 400;
      throw err;
    }
    const finalName = file.filename.slice(0, -STAGING_SUFFIX.length) + type.ext;
    const finalPath = path.join(path.dirname(file.path), finalName);
    await fs.promises.rename(file.path, finalPath);
    file.filename = finalName;
    file.path = finalPath;
    file.mimetype = type.mime;
  }
}

/**
 * Middleware de subida de imágenes.
 * @param {object} options
 * @param {string} options.field            nombre del campo multipart
 * @param {number} [options.maxFiles=1]     >1 usa .array(), 1 usa .single()
 * @param {number} options.maxFileSizeMb
 * @param {(req) => string} options.directory  carpeta absoluta de destino (dentro de UPLOADS_DIR)
 * @param {string} options.filenamePrefix
 */
function createImageUpload({ field, maxFiles = 1, maxFileSizeMb, directory, filenamePrefix }) {
  const limits = { field, maxFiles, maxFileSizeMb };
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      try {
        const dir = directory(req);
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      } catch (e) {
        cb(e);
      }
    },
    filename: (req, file, cb) => {
      cb(null, `${filenamePrefix}${Date.now()}_${crypto.randomBytes(8).toString("hex")}${STAGING_SUFFIX}`);
    },
  });

  const upload = multer({
    storage,
    limits: {
      fileSize: maxFileSizeMb * 1024 * 1024,
      files: maxFiles,
      fields: 20,
      fieldSize: 16 * 1024,
      parts: maxFiles + 20,
    },
    fileFilter: (req, file, cb) => {
      if (!ALLOWED_IMAGE_MIME.has(file.mimetype)) {
        const err = new Error(`Formato no permitido. Usa ${ALLOWED_FORMATS_LABEL}.`);
        err.status = 400;
        return cb(err);
      }
      return cb(null, true);
    },
  });

  const handler = maxFiles > 1 ? upload.array(field, maxFiles) : upload.single(field);

  return function imageUploadMiddleware(req, res, next) {
    handler(req, res, async (err) => {
      if (err) {
        await removeUploadedFiles(req);
        const mapped = mapUploadError(err, limits);
        if (mapped.status >= 500) return next(err);
        return res.status(mapped.status).json({ ok: false, error: mapped.error });
      }
      try {
        await finalizeUploadedImages(req);
        return next();
      } catch (e) {
        await removeUploadedFiles(req);
        if (e && e.status === 400) return res.status(400).json({ ok: false, error: e.message });
        return next(e);
      }
    });
  };
}

/** Handler de /uploads: solo imágenes, sin ejecución posible y con caché larga. */
function serveUploads() {
  const serveStatic = express.static(UPLOADS_DIR, {
    index: false,
    redirect: false,
    dotfiles: "deny",
    fallthrough: true,
    maxAge: "30d",
    immutable: true,
    setHeaders: (res, filePath) => {
      if (/\.(jfif|jpe)$/i.test(filePath)) res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      res.setHeader("Content-Security-Policy", UPLOADS_CSP);
      res.setHeader("X-Content-Type-Options", "nosniff");
    },
  });
  return function uploadsHandler(req, res, next) {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (!isServableUploadPath(req.path)) {
      res.setHeader("Cache-Control", "no-store");
      return res.status(404).json({ ok: false, error: "Archivo no encontrado." });
    }
    return serveStatic(req, res, next);
  };
}

module.exports = {
  UPLOADS_DIR,
  ALLOWED_IMAGE_MIME,
  detectImageType,
  resolveUploadPath,
  isServableUploadPath,
  mapUploadError,
  removeUploadedFiles,
  deleteUploadByUrl,
  createImageUpload,
  serveUploads,
};
