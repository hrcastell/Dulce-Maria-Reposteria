/**
 * UUID Validation Middleware
 * 
 * Valida que los parámetros de ruta sean UUIDs válidos antes de procesarlos.
 * Esto previene path traversal y otros ataques de manipulación de paths.
 */

const { z } = require("zod");

/**
 * Valida que un parámetro de ruta sea un UUID válido
 * @param {string} paramName - Nombre del parámetro a validar (ej: 'id', 'productId')
 */
function validateUuidParam(paramName) {
  return (req, res, next) => {
    const value = req.params[paramName];
    
    if (!value) {
      return res.status(400).json({
        ok: false,
        error: `Parameter ${paramName} is required`,
      });
    }

    const uuidSchema = z.string().uuid();
    const result = uuidSchema.safeParse(value);

    if (!result.success) {
      return res.status(400).json({
        ok: false,
        error: `Invalid ${paramName}: must be a valid UUID`,
      });
    }

    next();
  };
}

/**
 * Valida múltiples parámetros UUID en una sola llamada
 * @param {...string} paramNames - Nombres de los parámetros a validar
 */
function validateUuidParams(...paramNames) {
  return (req, res, next) => {
    const uuidSchema = z.string().uuid();
    
    for (const paramName of paramNames) {
      const value = req.params[paramName];
      
      if (!value) {
        return res.status(400).json({
          ok: false,
          error: `Parameter ${paramName} is required`,
        });
      }

      const result = uuidSchema.safeParse(value);
      if (!result.success) {
        return res.status(400).json({
          ok: false,
          error: `Invalid ${paramName}: must be a valid UUID`,
        });
      }
    }

    next();
  };
}

module.exports = {
  validateUuidParam,
  validateUuidParams,
};
