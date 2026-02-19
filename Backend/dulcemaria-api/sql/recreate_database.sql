-- =============================================================================
-- SCRIPT DE RECREACIÓN COMPLETA - DULCE MARÍA REPOSTERÍA
-- =============================================================================
-- Fecha: 2026-02-17
-- Descripción: Script completo para crear una nueva base de datos con:
--   - Usuario y permisos correctos
--   - Todas las tablas actuales
--   - Columna permissions incluida desde el inicio
--   - Usuario SUPERADMIN inicial
-- =============================================================================

-- PASO 1: CONECTARSE COMO USUARIO POSTGRES (superusuario de PostgreSQL)
-- En psql o pgAdmin, ejecutar como postgres:

-- Crear el nuevo usuario/role si no existe
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'dulcemaria_owner') THEN
    CREATE ROLE dulcemaria_owner WITH LOGIN PASSWORD 'TuPasswordSegura123!';
  END IF;
END
$$;

-- Dar permisos para crear bases de datos
ALTER ROLE dulcemaria_owner CREATEDB;

-- Terminar conexiones existentes a la base de datos (si existe)
-- SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'dulcemaria_db_v2';

-- Eliminar la base de datos si existe (CUIDADO: esto borra todo)
-- DROP DATABASE IF EXISTS dulcemaria_db_v2;

-- Crear la nueva base de datos con el owner correcto
CREATE DATABASE dulcemaria_db_v2
  WITH 
  OWNER = dulcemaria_owner
  ENCODING = 'UTF8'
  LC_COLLATE = 'en_US.UTF-8'
  LC_CTYPE = 'en_US.UTF-8'
  TABLESPACE = pg_default
  CONNECTION LIMIT = -1;

-- Dar todos los privilegios al owner
GRANT ALL PRIVILEGES ON DATABASE dulcemaria_db_v2 TO dulcemaria_owner;

-- =============================================================================
-- PASO 2: CONECTARSE A LA NUEVA BASE DE DATOS COMO dulcemaria_owner
-- En psql: \c dulcemaria_db_v2 dulcemaria_owner
-- =============================================================================

-- Conectar a la nueva base de datos
\c dulcemaria_db_v2 dulcemaria_owner

-- Crear extensiones necesarias
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================================
-- TABLA: users
-- =============================================================================
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT,
  role TEXT NOT NULL DEFAULT 'STAFF' CHECK (role IN ('SUPERADMIN','ADMIN','STAFF')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  permissions JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);

COMMENT ON TABLE users IS 'Usuarios del sistema con roles y permisos granulares';
COMMENT ON COLUMN users.permissions IS 'Permisos JSON por módulo: products, customers, orders';

-- =============================================================================
-- TABLA: customers
-- =============================================================================
CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  full_name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_customers_full_name ON customers(full_name);
CREATE INDEX idx_customers_email ON customers(email);

COMMENT ON TABLE customers IS 'Clientes de la repostería';

-- =============================================================================
-- TABLA: products
-- =============================================================================
CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  price_clp INTEGER NOT NULL CHECK (price_clp >= 0),
  stock_qty INTEGER NOT NULL DEFAULT 0 CHECK (stock_qty >= 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_products_slug ON products(slug);
CREATE INDEX idx_products_is_active ON products(is_active);
CREATE INDEX idx_products_name ON products(name);

COMMENT ON TABLE products IS 'Catálogo de productos';

-- =============================================================================
-- TABLA: product_images
-- =============================================================================
CREATE TABLE product_images (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  url_original TEXT NOT NULL,
  url_large TEXT NOT NULL,
  url_thumb TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_product_images_product_id ON product_images(product_id);
CREATE INDEX idx_product_images_is_primary ON product_images(is_primary);

COMMENT ON TABLE product_images IS 'Imágenes de productos con múltiples resoluciones';

-- =============================================================================
-- TABLA: orders
-- =============================================================================
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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

CREATE INDEX idx_orders_order_code ON orders(order_code);
CREATE INDEX idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_customer_id ON orders(customer_id);
CREATE INDEX idx_orders_created_by_user_id ON orders(created_by_user_id);

COMMENT ON TABLE orders IS 'Órdenes de compra';

-- =============================================================================
-- TABLA: order_items
-- =============================================================================
CREATE TABLE order_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id),
  product_name_snapshot TEXT NOT NULL,
  unit_price_clp INTEGER NOT NULL CHECK (unit_price_clp >= 0),
  qty INTEGER NOT NULL CHECK (qty > 0),
  line_total_clp INTEGER NOT NULL CHECK (line_total_clp >= 0)
);

CREATE INDEX idx_order_items_order_id ON order_items(order_id);
CREATE INDEX idx_order_items_product_id ON order_items(product_id);

COMMENT ON TABLE order_items IS 'Items/líneas de cada orden';

-- =============================================================================
-- TABLA: payments
-- =============================================================================
CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('WEBPAY','MERCADOPAGO','TRANSFER','CASH')),
  status TEXT NOT NULL DEFAULT 'INITIATED' CHECK (status IN ('INITIATED','AUTHORIZED','FAILED','REFUNDED')),
  provider_ref TEXT,
  amount_clp INTEGER NOT NULL CHECK (amount_clp >= 0),
  raw_response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payments_order_id ON payments(order_id);
CREATE INDEX idx_payments_provider ON payments(provider);
CREATE INDEX idx_payments_status ON payments(status);

COMMENT ON TABLE payments IS 'Pagos asociados a órdenes';

-- =============================================================================
-- DATOS INICIALES: Usuario SUPERADMIN
-- =============================================================================

-- Insertar usuario SUPERADMIN principal
-- IMPORTANTE: Cambia el password hash por uno generado con bcrypt
-- Para generar: node -e "console.log(require('bcrypt').hashSync('TuPasswordAqui', 10))"

INSERT INTO users (id, email, password_hash, full_name, role, is_active, permissions, created_at, updated_at)
VALUES (
  uuid_generate_v4(),
  'hernan.castellanos@hrcastell.com',
  '$2b$10$YourBcryptHashHere', -- REEMPLAZAR con hash real
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
  }'::jsonb,
  NOW(),
  NOW()
)
ON CONFLICT (email) DO NOTHING;

-- =============================================================================
-- VERIFICACIÓN
-- =============================================================================

-- Verificar que todo se creó correctamente
SELECT 
  schemaname,
  tablename,
  tableowner
FROM pg_tables 
WHERE schemaname = 'public'
ORDER BY tablename;

-- Verificar usuario creado
SELECT id, email, role, is_active, permissions FROM users;

-- Mostrar resumen
SELECT 
  'users' as tabla, count(*) as registros FROM users
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
-- INFORMACIÓN DE CONEXIÓN
-- =============================================================================

/*
CONFIGURACIÓN PARA .env DEL BACKEND:

DATABASE_URL=postgresql://dulcemaria_owner:TuPasswordSegura123!@localhost:5432/dulcemaria_db_v2

O variables separadas:
DB_HOST=localhost
DB_PORT=5432
DB_USER=dulcemaria_owner
DB_PASSWORD=TuPasswordSegura123!
DB_NAME=dulcemaria_db_v2

IMPORTANTE:
1. Cambia 'TuPasswordSegura123!' por tu password real
2. Cambia 'localhost' por tu host de cPanel si aplica
3. Genera un hash bcrypt real para el usuario SUPERADMIN
4. Guarda estas credenciales de forma segura
*/
