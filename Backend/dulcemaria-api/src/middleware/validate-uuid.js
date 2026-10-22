/**
 * UUID Validation Middleware
 *
 * Valida que los parámetros de ruta sean UUIDs válidos antes de procesarlos.
 * Esto previene path traversal y otros ataques de manipulación de paths.
 */

const { z } = require("zod");

const uuidSchema = z.string().uuid();

function checkUuidParam(req, res, paramName) {
  const value = req.params[paramName];
  if (!value) {
    res.status(400).json({ ok: false, error: `Falta el parámetro ${paramName}.` });
    return false;
  }
  if (!uuidSchema.safeParse(value).success) {
    res.status(400).json({ ok: false, error: `Parámetro ${paramName} inválido: debe ser un UUID.` });
    return false;
  }
  return true;
}

/**
 * Valida que un parámetro de ruta sea un UUID válido
 * @param {string} paramName - Nombre del parámetro a validar (ej: 'id', 'productId')
 */
function validateUuidParam(paramName) {
  return (req, res, next) => {
    if (checkUuidParam(req, res, paramName)) next();
  };
}

/**
 * Valida múltiples parámetros UUID en una sola llamada
 * @param {...string} paramNames - Nombres de los parámetros a validar
 */
function validateUuidParams(...paramNames) {
  return (req, res, next) => {
    for (const paramName of paramNames) {
      if (!checkUuidParam(req, res, paramName)) return;
    }
    next();
  };
}

module.exports = {
  validateUuidParam,
  validateUuidParams,
};
