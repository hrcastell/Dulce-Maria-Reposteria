-- Migración: Agregar columna permissions a tabla users
-- Fecha: 2026-02-17
-- Descripción: Añade soporte para permisos granulares por módulo

-- Agregar columna permissions como JSONB
ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT '{}';

-- Actualizar permisos por defecto para usuarios existentes
UPDATE users 
SET permissions = '{
  "products": {
    "canView": true,
    "canCreate": false,
    "canEdit": false,
    "canDelete": false
  },
  "customers": {
    "canView": true,
    "canCreate": false,
    "canEdit": false,
    "canDelete": false
  },
  "orders": {
    "canView": true,
    "canCreate": true,
    "canEdit": false,
    "canDelete": false,
    "canUpdateStatus": false
  }
}'::jsonb
WHERE permissions = '{}'::jsonb OR permissions IS NULL;

-- Dar todos los permisos al SUPERADMIN principal
UPDATE users 
SET permissions = '{
  "products": {
    "canView": true,
    "canCreate": true,
    "canEdit": true,
    "canDelete": true
  },
  "customers": {
    "canView": true,
    "canCreate": true,
    "canEdit": true,
    "canDelete": true
  },
  "orders": {
    "canView": true,
    "canCreate": true,
    "canEdit": true,
    "canDelete": true,
    "canUpdateStatus": true
  }
}'::jsonb
WHERE email = 'hernan.castellanos@hrcastell.com';

-- Verificar la migración
SELECT id, email, role, permissions 
FROM users 
ORDER BY created_at;
