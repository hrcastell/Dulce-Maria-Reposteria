/**
 * Environment Variables Validation
 * 
 * Valida que todas las variables de entorno requeridas estén configuradas
 * y cumplan con requisitos mínimos de seguridad.
 */

function validateEnv() {
  const errors = [];

  // Variables requeridas
  const required = {
    DATABASE_URL: process.env.DATABASE_URL,
    JWT_SECRET: process.env.JWT_SECRET,
  };

  // Verificar variables requeridas
  Object.entries(required).forEach(([key, value]) => {
    if (!value || value.trim() === '') {
      errors.push(`Missing required environment variable: ${key}`);
    }
  });

  // Si faltan variables, no continuar con validaciones adicionales
  if (errors.length > 0) {
    throw new Error(`Environment validation failed:\n${errors.join('\n')}`);
  }

  // Validar JWT_SECRET fuerte
  const secret = process.env.JWT_SECRET;
  if (secret.length < 32) {
    errors.push('JWT_SECRET must be at least 32 characters long for security');
  }

  // Validar DATABASE_URL formato
  if (!process.env.DATABASE_URL.startsWith('postgres')) {
    errors.push('DATABASE_URL must start with postgresql:// or postgres://');
  }

  // Advertencias (no bloquean startup)
  const warnings = [];

  if (!process.env.NODE_ENV) {
    warnings.push('NODE_ENV not set, defaulting to development');
  }

  if (process.env.NODE_ENV === 'production' && !process.env.FRONTEND_URL) {
    warnings.push('FRONTEND_URL not set in production (CORS may not work correctly)');
  }

  // Si hay errores críticos, fallar
  if (errors.length > 0) {
    throw new Error(`Environment validation failed:\n${errors.join('\n')}`);
  }

  // Mostrar advertencias
  if (warnings.length > 0) {
    console.warn('⚠️  Environment warnings:');
    warnings.forEach(w => console.warn(`   ${w}`));
  }

  console.log('✅ Environment variables validated');
}

function getEnv(key, defaultValue = undefined) {
  const value = process.env[key];
  if (value === undefined) {
    if (defaultValue === undefined) {
      throw new Error(`Environment variable ${key} is required but not set`);
    }
    return defaultValue;
  }
  return value;
}

module.exports = {
  validateEnv,
  getEnv,
};
