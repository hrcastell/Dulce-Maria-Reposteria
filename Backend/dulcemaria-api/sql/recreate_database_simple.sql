-- =============================================================================
-- SCRIPT DE RECREACIÓN SIMPLIFICADO - DULCE MARÍA REPOSTERÍA
-- =============================================================================
-- Para hosting compartido SIN extensiones y SIN terminal
-- Ejecutar en phpPgAdmin paso a paso
-- =============================================================================

-- =============================================================================
-- PARTE 1: CREAR USUARIO (Ejecutar primero, si tienes permisos)
-- =============================================================================
-- Si no tienes permisos para crear usuarios, salta a PARTE 2
-- Usa el usuario que te proporcionó tu hosting

-- Descomenta si puedes crear usuarios:
-- CREATE ROLE dulcemaria_owner WITH LOGIN PASSWORD 'TuPasswordSegura123!';
-- ALTER ROLE dulcemaria_owner CREATEDB;

-- =============================================================================
-- PARTE 2: CREAR BASE DE DATOS (Desde el panel de PostgreSQL del hosting)
-- =============================================================================
-- En tu panel de hosting:
-- 1. Ve a "PostgreSQL Databases"
-- 2. Crea una nueva base de datos: dulcemaria_db_v2
-- 3. Asigna el usuario que usarás (el que te dio el hosting)
-- 4. Copia el nombre de usuario y password para el .env

-- =============================================================================
-- PARTE 3: EJECUTAR EN phpPgAdmin (conectado a dulcemaria_db_v2)
-- =============================================================================

-- Verificar versión de PostgreSQL (debe ser 13+)
SELECT version();

-- =============================================================================
-- TABLA: users (con permissions desde el inicio)
-- =============================================================================
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT,
  role TEXT NOT NULL DEFAULT 'STAFF' CHECK (role IN ('SUPERADMIN','ADMIN','STAFF')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  permissions JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- =============================================================================
-- TABLA: customers
-- =============================================================================
CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customers_full_name ON customers(full_name);
CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);

-- =============================================================================
-- TABLA: products
-- =============================================================================
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  price_clp INTEGER NOT NULL CHECK (price_clp >= 0),
  stock_qty INTEGER NOT NULL DEFAULT 0 CHECK (stock_qty >= 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_slug ON products(slug);
CREATE INDEX IF NOT EXISTS idx_products_is_active ON products(is_active);
CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);

-- =============================================================================
-- TABLA: product_images
-- =============================================================================
CREATE TABLE IF NOT EXISTS product_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  url_original TEXT NOT NULL,
  url_large TEXT NOT NULL,
  url_thumb TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_images_product_id ON product_images(product_id);
CREATE INDEX IF NOT EXISTS idx_product_images_is_primary ON product_images(is_primary);

-- =============================================================================
-- TABLA: orders
-- =============================================================================
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_code TEXT NOT NULL UNIQUE,
  channel TEXT NOT NULL DEFAULT 'WEB' CHECK (channel IN ('WEB','ADMIN')),
  status TEXT NOT NULL DEFAULT 'PENDING_PAYMENT' CHECK (status IN ('PENDING_PAYMENT','PAID','PREPARING','READY','DELIVERED','CANCELLED')),
  customer_id UUID REFERENCES customers(id),
  subtotal_clp INTEGER NOT NULL DEFAULT 0,
  shipping_clp INTEGER NOT NULL DEFAULT 0,
  discount_clp INTEGER NOT NULL DEFAULT 0,
  total_clp INTEGER NOT NULL DEFAULT 0,
  created_by_user_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_order_code ON orders(order_code);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_created_by_user_id ON orders(created_by_user_id);

-- =============================================================================
-- TABLA: order_items
-- =============================================================================
CREATE TABLE IF NOT EXISTS order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id),
  product_name_snapshot TEXT NOT NULL,
  unit_price_clp INTEGER NOT NULL CHECK (unit_price_clp >= 0),
  qty INTEGER NOT NULL CHECK (qty > 0),
  line_total_clp INTEGER NOT NULL CHECK (line_total_clp >= 0)
);

CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product_id ON order_items(product_id);

-- =============================================================================
-- TABLA: payments
-- =============================================================================
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('WEBPAY','MERCADOPAGO','TRANSFER','CASH')),
  status TEXT NOT NULL DEFAULT 'INITIATED' CHECK (status IN ('INITIATED','AUTHORIZED','FAILED','REFUNDED')),
  provider_ref TEXT,
  amount_clp INTEGER NOT NULL CHECK (amount_clp >= 0),
  raw_response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_order_id ON payments(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_provider ON payments(provider);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);

-- =============================================================================
-- INSERTAR USUARIO SUPERADMIN INICIAL
-- =============================================================================
-- IMPORTANTE: Reemplaza el hash con el generado por generate_password_hash.js
-- Ejecuta: node sql/generate_password_hash.js

INSERT INTO users (email, password_hash, full_name, role, is_active, permissions)
VALUES (
  'hernan.castellanos@hrcastell.com',
  '$2b$10$REEMPLAZAR_CON_HASH_REAL', -- CAMBIAR ESTO
  'Hernán Ricardo Castellanos',
  'SUPERADMIN',
  TRUE,
  '{
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
)
ON CONFLICT (email) DO NOTHING;

-- =============================================================================
-- VERIFICACIÓN FINAL
-- =============================================================================

-- Ver tablas creadas
SELECT 
  tablename,
  schemaname
FROM pg_tables 
WHERE schemaname = 'public'
ORDER BY tablename;

-- Ver usuario creado
SELECT id, email, role, is_active FROM users;

-- Resumen de registros
SELECT 'users' as tabla, count(*) as registros FROM users
UNION ALL
SELECT 'customers', count(*) FROM customers
UNION ALL
SELECT 'products', count(*) FROM products
UNION ALL
SELECT 'product_images', count(*) FROM product_images
UNION ALL
SELECT 'orders', count(*) FROM orders
UNION ALL
SELECT 'order_items', count(*) FROM order_items
UNION ALL
SELECT 'payments', count(*) FROM payments;

-- =============================================================================
-- ✅ SI TODO SE VE BIEN, ACTUALIZA EL .env:
-- =============================================================================
/*
DATABASE_URL=postgresql://usuario_hosting:password_hosting@host_hosting:5432/dulcemaria_db_v2

Donde:
- usuario_hosting: El usuario que te dio tu proveedor de hosting
- password_hosting: El password de ese usuario
- host_hosting: Generalmente es 'localhost' en hosting compartido
- dulcemaria_db_v2: El nombre de la BD que creaste

Ejemplo:
DATABASE_URL=postgresql://dulcemxxx_user:abc123@localhost:5432/dulcemxxx_db_v2
*/
