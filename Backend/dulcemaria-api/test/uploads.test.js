const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const {
  detectImageType,
  resolveUploadPath,
  isServableUploadPath,
  mapUploadError,
} = require("../src/lib/uploads");

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const WEBP = Buffer.concat([
  Buffer.from("RIFF", "ascii"),
  Buffer.from([0x24, 0x00, 0x00, 0x00]),
  Buffer.from("WEBPVP8 ", "ascii"),
]);

test("detectImageType reconoce JPEG, PNG y WebP por su firma", () => {
  assert.deepEqual(detectImageType(JPEG), { mime: "image/jpeg", ext: ".jpg" });
  assert.deepEqual(detectImageType(PNG), { mime: "image/png", ext: ".png" });
  assert.deepEqual(detectImageType(WEBP), { mime: "image/webp", ext: ".webp" });
});

test("detectImageType rechaza HTML, SVG, JS y otros formatos aunque digan ser imagen", () => {
  const samples = [
    "<!DOCTYPE html><html><script>alert(1)</script></html>",
    '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><script>x()</script></svg>',
    "<svg onload=alert(1)>",
    "alert(document.cookie)",
    "GIF89a\u0001\u0000\u0001\u0000",
    "%PDF-1.7 ...",
  ];
  for (const sample of samples) {
    assert.equal(detectImageType(Buffer.from(sample, "utf8")), null, sample);
  }
});

test("detectImageType rechaza buffers vacíos o truncados", () => {
  assert.equal(detectImageType(Buffer.alloc(0)), null);
  assert.equal(detectImageType(Buffer.from([0xff, 0xd8])), null);
  assert.equal(detectImageType(Buffer.from("RIFF", "ascii")), null);
  assert.equal(detectImageType(null), null);
});

test("resolveUploadPath solo devuelve rutas dentro de uploads/", () => {
  const uploadsDir = path.resolve("/srv/app/uploads");
  assert.equal(
    resolveUploadPath(uploadsDir, "/uploads/hero/hero_1.jpg"),
    path.join(uploadsDir, "hero", "hero_1.jpg")
  );
  assert.equal(resolveUploadPath(uploadsDir, "/uploads/../server.js"), null);
  assert.equal(resolveUploadPath(uploadsDir, "/uploads/hero/../../.env"), null);
  assert.equal(resolveUploadPath(uploadsDir, "/otra/carpeta/x.jpg"), null);
  assert.equal(resolveUploadPath(uploadsDir, "uploads/hero/x.jpg"), null);
  assert.equal(resolveUploadPath(uploadsDir, "/uploads/"), null);
  assert.equal(resolveUploadPath(uploadsDir, "/uploads/hero/x\u0000.jpg"), null);
  assert.equal(resolveUploadPath(uploadsDir, null), null);
});

test("isServableUploadPath solo permite extensiones de imagen", () => {
  assert.equal(isServableUploadPath("/hero/a.jpg"), true);
  assert.equal(isServableUploadPath("/products/x/b.JPEG"), true);
  assert.equal(isServableUploadPath("/b.png"), true);
  assert.equal(isServableUploadPath("/b.webp"), true);
  // JPEG con extensiones alternativas que pueden existir en subidas antiguas del hero
  assert.equal(isServableUploadPath("/hero/vieja.jfif"), true);
  assert.equal(isServableUploadPath("/hero/vieja.jpe"), true);
  assert.equal(isServableUploadPath("/hero/x.html"), false);
  assert.equal(isServableUploadPath("/hero/x.svg"), false);
  assert.equal(isServableUploadPath("/hero/x.js"), false);
  assert.equal(isServableUploadPath("/hero/x.php"), false);
  assert.equal(isServableUploadPath("/hero/hero_1.tmp"), false);
  assert.equal(isServableUploadPath("/hero/"), false);
});

test("mapUploadError traduce errores de multer a 4xx con mensaje en español", () => {
  const limits = { field: "image", maxFiles: 1, maxFileSizeMb: 5 };
  assert.deepEqual(mapUploadError({ code: "LIMIT_FILE_SIZE" }, limits), {
    status: 413,
    error: "La imagen supera el límite de 5 MB.",
  });
  assert.equal(mapUploadError({ code: "LIMIT_FILE_COUNT" }, { ...limits, maxFiles: 8 }).status, 400);
  assert.match(mapUploadError({ code: "LIMIT_FILE_COUNT" }, { ...limits, maxFiles: 8 }).error, /8/);
  assert.match(mapUploadError({ code: "LIMIT_UNEXPECTED_FILE" }, limits).error, /'image'/);
  assert.equal(mapUploadError({ code: "LIMIT_PART_COUNT" }, limits).status, 400);
  // Códigos nuevos de multer 2.x
  for (const code of ["LIMIT_FIELD_NESTING", "LIMIT_FIELD_ARRAY_INDEX", "INVALID_FIELD_NAME", "STREAM_DESTROYED"]) {
    const mapped = mapUploadError({ code, message: "English text" }, limits);
    assert.equal(mapped.status, 400, code);
    assert.equal(mapped.error.includes("English"), false, code);
  }
  const filter = Object.assign(new Error("Formato no permitido. Usa JPG, PNG o WEBP."), { status: 400 });
  assert.deepEqual(mapUploadError(filter, limits), { status: 400, error: filter.message });
  assert.equal(mapUploadError(new Error("Multipart: Boundary not found"), limits).status, 400);
});

test("mapUploadError deja los errores de disco como 500", () => {
  const disk = Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" });
  assert.equal(mapUploadError(disk, { field: "image", maxFiles: 1, maxFileSizeMb: 5 }).status, 500);
});
