/**
 * Complete Database Migration (Canonical Schema)
 *
 * Ejecuta migraciones completas e idempotentes para:
 * - Crear todas las tablas si no existen
 * - Agregar columnas faltantes
 * - Crear índices
 * - Crear triggers updated_at
 * - Fix UNIQUE constraint en customers.email
 *
 * Compatible con PostgreSQL 10.23
 * Seguro ejecutar múltiples veces (idempotente)
 *
 * Política de ejecución (ver runCompleteMigrations al final del archivo):
 * - Huella del esquema: si la huella guardada en schema_migration_state
 *   coincide con la de estas sentencias, el arranque NO ejecuta DDL (un solo
 *   SELECT). Evita tomar bloqueos fuertes en cada arranque en frío de Passenger.
 * - Cuando hay que aplicar: una transacción, serializada entre procesos con
 *   pg_advisory_xact_lock, con lock_timeout para no encolar el tráfico vivo.
 * - Fallos: cada sentencia corre en su SAVEPOINT. En modo estricto (por
 *   defecto en development/test) el primer fallo revierte todo y aborta el
 *   arranque. En producción (modo tolerante) un fallo NUNCA impide arrancar:
 *   se registra como ERROR con su id y SQLSTATE, se persiste en
 *   schema_migration_state.failures, se repite en el log de cada arranque y lo
 *   informa `npm run db:validate`. Así una base heredada desconocida no deja
 *   el sitio caído tras un deploy, pero la divergencia nunca es silenciosa.
 */

const { getPool } = require("../db");
const { isProductionMode } = require("../config/runtime");
const { describeStatement, computeSchemaFingerprint, isTransientDbError } = require("./schemaTools");
const {
  ORDER_STATUSES,
  STOCK_RESERVATION_STATUSES,
  CANCELLATION_SOURCES,
  legacyOrderStatusCaseSql,
  sqlStatusList,
} = require("../lib/orderStatus");
const { CAKE_ORDER_STATUSES, legacyCakeStatusCaseSql } = require("../lib/cakeOrderStatus");
const { ORDER_EVENT_SOURCES } = require("../lib/orderEvents");
const { DEFAULT_SALES_SETTINGS, SALES_SETTINGS_KEYS } = require("../lib/salesSettings");
const { PAYMENT_PROVIDERS, PAYMENT_EVENT_SOURCES } = require("../lib/payments/constants");
const { ATTEMPT_STATUSES, OPEN_STATUSES, SUCCESS_STATUSES } = require("../lib/payments/stateMachine");
const { CAKE_DEPOSIT_STATUSES, CAKE_BALANCE_STATUSES } = require("../lib/payments/cakePayments");

/**
 * CHECK agregado como NOT VALID (protege desde ya las filas nuevas) y luego
 * validado en una sentencia aparte: si datos antiguos lo violan, la
 * validación falla y queda registrada, pero la restricción sigue vigente para
 * escrituras nuevas.
 */
function guardedCheckConstraint(table, name, expression) {
  return [
    `DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = '${name}' AND conrelid = '${table}'::regclass
      ) THEN
        ALTER TABLE ${table} ADD CONSTRAINT ${name} CHECK (${expression}) NOT VALID;
      END IF;
    END $$;`,
    `DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = '${name}' AND conrelid = '${table}'::regclass AND NOT convalidated
      ) THEN
        ALTER TABLE ${table} VALIDATE CONSTRAINT ${name};
      END IF;
    END $$;`,
  ];
}

/** Valida una restricción agregada como NOT VALID (mismo bloque que guardedCheckConstraint). */
function validateConstraintStatement(table, name) {
  return `DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = '${name}' AND conrelid = '${table}'::regclass AND NOT convalidated
      ) THEN
        ALTER TABLE ${table} VALIDATE CONSTRAINT ${name};
      END IF;
    END $$;`;
}

/**
 * Agrega una columna y ejecuta su relleno inicial UNA sola vez: solo cuando
 * la columna todavía no existe (el relleno nunca se repite en arranques
 * futuros, aunque cambie la huella del esquema).
 */
function addColumnWithBackfill(table, column, definition, backfillSql) {
  return `DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = '${table}' AND column_name = '${column}'
      ) THEN
        ALTER TABLE ${table} ADD COLUMN ${column} ${definition};
        ${backfillSql}
      END IF;
    END $$;`;
}

function sqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * Elimina un índice redundante solo si existe la restricción UNIQUE que ya
 * indexa esa columna (en una base heredada sin la UNIQUE, el índice se conserva).
 */
function dropRedundantIndex(table, indexName, uniqueConstraintName) {
  return `DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = '${uniqueConstraintName}' AND conrelid = '${table}'::regclass AND contype = 'u'
      ) THEN
        DROP INDEX IF EXISTS ${indexName};
      END IF;
    END $$;`;
}

/** Sentencias del esquema canónico, en orden de ejecución. */
function buildMigrationStatements() {
  const statements = [
    // search_path solo para esta transacción: no queda pegado a la conexión del pool.
    `SET LOCAL search_path TO public;`,

    // Estado de la última aplicación del esquema (huella y fallos persistentes).
    // Fila única (id = 1); la escribe runCompleteMigrations, nunca la app.
    `CREATE TABLE IF NOT EXISTS schema_migration_state (
      id INT PRIMARY KEY CHECK (id = 1),
      fingerprint TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      statements_total INT NOT NULL DEFAULT 0,
      failures JSONB NOT NULL DEFAULT '[]'
    );`,

    // ============================================
    // TABLAS BASE
    // ============================================

    // Tabla: users
    `CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      full_name TEXT,
      role TEXT NOT NULL DEFAULT 'STAFF' CHECK (role IN ('SUPERADMIN','ADMIN','STAFF')),
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`,

    // Tabla: products
    `CREATE TABLE IF NOT EXISTS products (
      id UUID PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      description TEXT,
      price_clp INT NOT NULL CHECK (price_clp >= 0),
      stock_qty INT NOT NULL DEFAULT 0 CHECK (stock_qty >= 0),
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`,

    // Tabla: customers
    `CREATE TABLE IF NOT EXISTS customers (
      id UUID PRIMARY KEY,
      email TEXT,
      full_name TEXT NOT NULL,
      phone TEXT,
      address TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`,

    // Tabla: orders
    `CREATE TABLE IF NOT EXISTS orders (
      id UUID PRIMARY KEY,
      order_no BIGINT GENERATED BY DEFAULT AS IDENTITY UNIQUE,
      customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
      
      status TEXT NOT NULL DEFAULT 'DELIVERED'
        CHECK (status IN ('PENDING_CONFIRMATION','CONFIRMED','PREPARING','READY','DELIVERED','CANCELLED')),
      
      payment_status TEXT NOT NULL DEFAULT 'PAID'
        CHECK (payment_status IN ('PENDING','PAID','FAILED','REFUNDED')),
      
      payment_method TEXT NOT NULL DEFAULT 'CASH'
        CHECK (payment_method IN ('TRANSFER','CASH','ONLINE')),
      
      delivery_method TEXT NOT NULL DEFAULT 'PICKUP'
        CHECK (delivery_method IN ('PICKUP','DELIVERY')),
      
      subtotal_clp INT NOT NULL DEFAULT 0,
      delivery_fee_clp INT NOT NULL DEFAULT 0,
      total_clp INT NOT NULL DEFAULT 0,
      
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`,

    // Tabla: order_items
    `CREATE TABLE IF NOT EXISTS order_items (
      id UUID PRIMARY KEY,
      order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
      
      product_name_snapshot TEXT NOT NULL,
      unit_price_clp INT NOT NULL,
      qty INT NOT NULL CHECK (qty > 0),
      line_total_clp INT NOT NULL,
      
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`,

    // Tabla: product_images
    `CREATE TABLE IF NOT EXISTS product_images (
      id UUID PRIMARY KEY,
      product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      url_original TEXT NOT NULL,
      url_large TEXT NOT NULL,
      url_thumb TEXT NOT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      is_primary BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`,

    // ============================================
    // COLUMNAS FALTANTES (ADD IF NOT EXISTS)
    // ============================================

    // customers
    `ALTER TABLE customers ADD COLUMN IF NOT EXISTS address TEXT;`,
    `ALTER TABLE customers ADD COLUMN IF NOT EXISTS notes TEXT;`,
    `ALTER TABLE customers ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`,
    `ALTER TABLE customers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`,

    // orders
    `ALTER TABLE orders ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`,
    `ALTER TABLE orders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`,

    // order_items
    `ALTER TABLE order_items ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`,

    // users
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`,
    // users.permissions — requerido por GET /auth/me y admin.users.js.
    // Esta línea es la que crea la columna (el antiguo .sql suelto se eliminó).
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT '{}';`,
    // users.session_version — versión de sesión: el JWT lleva este número
    // (claim `sv`) y requireAuth exige que coincida. Incrementarlo cierra todas
    // las sesiones del usuario (cambio de contraseña, rol, desactivación,
    // "cerrar sesión en todos lados", CLI de recuperación).
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS session_version INT NOT NULL DEFAULT 0;`,

    // products
    `ALTER TABLE products ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`,
    // products.cost_price_clp — costo del producto, usado para calcular el
    // margen de ganancia en el formulario (precio - costo). Nullable: no
    // todos los productos necesitan costo registrado.
    `ALTER TABLE products ADD COLUMN IF NOT EXISTS cost_price_clp INT;`,

    // ============================================
    // ÍNDICES
    // ============================================

    // Users (users.email ya está indexado por su UNIQUE; ver dropRedundantIndex al final)
    `CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);`,
    `CREATE INDEX IF NOT EXISTS idx_users_is_active ON users(is_active);`,

    // Products (products.slug ya está indexado por su UNIQUE)
    `CREATE INDEX IF NOT EXISTS idx_products_is_active ON products(is_active);`,
    `CREATE INDEX IF NOT EXISTS idx_products_created_at ON products(created_at);`,

    // Product Images
    `CREATE INDEX IF NOT EXISTS idx_product_images_product_id ON product_images(product_id);`,
    `CREATE INDEX IF NOT EXISTS idx_product_images_primary ON product_images(product_id, is_primary);`,

    // Customers - índice parcial para email (permite múltiples NULL)
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_email_unique ON customers(email) WHERE email IS NOT NULL;`,

    // Orders
    `CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);`,
    `CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);`,
    `CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);`,
    `CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON orders(payment_status);`,

    // Order Items
    `CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);`,
    `CREATE INDEX IF NOT EXISTS idx_order_items_product ON order_items(product_id);`,

    // ============================================
    // TRIGGERS updated_at
    // ============================================

    // Función para actualizar updated_at (compatible PostgreSQL 10)
    `CREATE OR REPLACE FUNCTION set_updated_at()
    RETURNS trigger AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;`,

    // Trigger: users
    `DROP TRIGGER IF EXISTS trg_users_updated_at ON users;`,
    `CREATE TRIGGER trg_users_updated_at
      BEFORE UPDATE ON users
      FOR EACH ROW EXECUTE PROCEDURE set_updated_at();`,

    // Trigger: products
    `DROP TRIGGER IF EXISTS trg_products_updated_at ON products;`,
    `CREATE TRIGGER trg_products_updated_at
      BEFORE UPDATE ON products
      FOR EACH ROW EXECUTE PROCEDURE set_updated_at();`,

    // Trigger: customers
    `DROP TRIGGER IF EXISTS trg_customers_updated_at ON customers;`,
    `CREATE TRIGGER trg_customers_updated_at
      BEFORE UPDATE ON customers
      FOR EACH ROW EXECUTE PROCEDURE set_updated_at();`,

    // Trigger: orders
    `DROP TRIGGER IF EXISTS trg_orders_updated_at ON orders;`,
    `CREATE TRIGGER trg_orders_updated_at
      BEFORE UPDATE ON orders
      FOR EACH ROW EXECUTE PROCEDURE set_updated_at();`,

    // ============================================
    // Tabla: product_variants
    // ============================================
    `CREATE TABLE IF NOT EXISTS product_variants (
      id UUID PRIMARY KEY,
      product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      name VARCHAR(100) NOT NULL,
      price_override_clp INT,
      stock_qty INT NOT NULL DEFAULT 0 CHECK (stock_qty >= 0),
      is_active BOOLEAN NOT NULL DEFAULT true,
      sort_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`,
    `CREATE INDEX IF NOT EXISTS idx_product_variants_product_id ON product_variants(product_id);`,
    `DROP TRIGGER IF EXISTS trg_product_variants_updated_at ON product_variants;`,
    `CREATE TRIGGER trg_product_variants_updated_at
      BEFORE UPDATE ON product_variants
      FOR EACH ROW EXECUTE PROCEDURE set_updated_at();`,

    // ============================================
    // Tabla: supplies (insumos)
    // ============================================
    `CREATE TABLE IF NOT EXISTS supplies (
      id UUID PRIMARY KEY,
      name VARCHAR(200) NOT NULL,
      unit VARCHAR(50),
      last_price_clp INT,
      last_updated TIMESTAMPTZ,
      notes TEXT,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`,
    `CREATE INDEX IF NOT EXISTS idx_supplies_name ON supplies(name);`,
    `DROP TRIGGER IF EXISTS trg_supplies_updated_at ON supplies;`,
    `CREATE TRIGGER trg_supplies_updated_at
      BEFORE UPDATE ON supplies
      FOR EACH ROW EXECUTE PROCEDURE set_updated_at();`,
    // supplies.stock_qty — stock disponible del insumo, se ajusta a mano y se
    // suma automáticamente al registrar un gasto con detalle (ver expense_record_items).
    `ALTER TABLE supplies ADD COLUMN IF NOT EXISTS stock_qty NUMERIC(12,3) NOT NULL DEFAULT 0;`,
    // supplies.reference_qty — a cuánto de `unit` corresponde last_price_clp
    // (ej: 1 para el litro de leche, 30 para la bandeja de huevos), usado para
    // calcular el costo de una receta al convertir unidades.
    `ALTER TABLE supplies ADD COLUMN IF NOT EXISTS reference_qty NUMERIC(12,3) NOT NULL DEFAULT 1;`,

    // ============================================
    // Tabla: providers (proveedores)
    // ============================================
    `CREATE TABLE IF NOT EXISTS providers (
      id UUID PRIMARY KEY,
      name VARCHAR(200) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`,
    `CREATE INDEX IF NOT EXISTS idx_providers_name ON providers(name);`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_providers_name_unique ON providers(LOWER(name));`,

    // ============================================
    // Tabla: expense_records (gastos)
    // ============================================
    `CREATE TABLE IF NOT EXISTS expense_records (
      id UUID PRIMARY KEY,
      supply_id UUID REFERENCES supplies(id) ON DELETE SET NULL,
      description VARCHAR(300) NOT NULL,
      amount_clp INT NOT NULL CHECK (amount_clp > 0),
      expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`,
    `CREATE INDEX IF NOT EXISTS idx_expense_records_date ON expense_records(expense_date);`,
    `ALTER TABLE expense_records ADD COLUMN IF NOT EXISTS provider_id UUID;`,
    `DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'expense_records_provider_id_fkey' AND conrelid = 'expense_records'::regclass
      ) THEN
        ALTER TABLE expense_records ADD CONSTRAINT expense_records_provider_id_fkey
          FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE SET NULL;
      END IF;
    EXCEPTION WHEN undefined_table THEN NULL;
    END $$;`,
    `CREATE INDEX IF NOT EXISTS idx_expense_records_provider ON expense_records(provider_id);`,

    // ============================================
    // Tabla: expense_record_items (detalle de gastos)
    // ============================================
    `CREATE TABLE IF NOT EXISTS expense_record_items (
      id UUID PRIMARY KEY,
      expense_record_id UUID NOT NULL REFERENCES expense_records(id) ON DELETE CASCADE,
      supply_id UUID NOT NULL REFERENCES supplies(id) ON DELETE RESTRICT,
      product_name_snapshot VARCHAR(200) NOT NULL,
      quantity NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
      unit_price_clp INT NOT NULL CHECK (unit_price_clp >= 0),
      total_clp INT NOT NULL CHECK (total_clp >= 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`,
    `CREATE INDEX IF NOT EXISTS idx_expense_record_items_expense ON expense_record_items(expense_record_id);`,
    `CREATE INDEX IF NOT EXISTS idx_expense_record_items_supply ON expense_record_items(supply_id);`,
    // unit — en qué unidad se compró esta línea (puede diferir de la unidad
    // base del insumo, ej: comprás "10 kg" de algo cuyo stock se lleva en
    // gramos). Se convierte con convertQuantity antes de sumar/revertir stock.
    // Nullable: registros históricos de antes de este campo no lo tienen.
    `ALTER TABLE expense_record_items ADD COLUMN IF NOT EXISTS unit VARCHAR(20);`,
    // content_qty/content_unit — cuando la compra es por unidad discreta (paquete,
    // saco, bandeja...), cuánto del insumo (en SU unidad base) contiene CADA unidad
    // comprada (ej: paquete de 250g). Sin esto, "2 paquetes de 250g" no se puede
    // distinguir de "2 gramos" y el stock/costo quedan mal por el factor de empaque.
    // Nullable: null = comportamiento previo (compra directa en la unidad del insumo).
    `ALTER TABLE expense_record_items ADD COLUMN IF NOT EXISTS content_qty NUMERIC(12,3);`,
    `ALTER TABLE expense_record_items ADD COLUMN IF NOT EXISTS content_unit VARCHAR(20);`,

    // ============================================
    // Tabla: kitchen_equipment (hornos, etc. — consumo de gas/electricidad)
    // ============================================
    `CREATE TABLE IF NOT EXISTS kitchen_equipment (
      id UUID PRIMARY KEY,
      name VARCHAR(150) NOT NULL,
      energy_type VARCHAR(20) NOT NULL CHECK (energy_type IN ('ELECTRIC','GAS')),
      consumption_rate NUMERIC(12,4) NOT NULL CHECK (consumption_rate >= 0),
      consumption_unit VARCHAR(30) NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`,
    `CREATE INDEX IF NOT EXISTS idx_kitchen_equipment_active ON kitchen_equipment(is_active);`,

    // ============================================
    // Tabla: recipes (recetas)
    // ============================================
    `CREATE TABLE IF NOT EXISTS recipes (
      id UUID PRIMARY KEY,
      name VARCHAR(200) NOT NULL,
      portions INT NOT NULL DEFAULT 1 CHECK (portions > 0),
      notes TEXT,
      equipment_id UUID REFERENCES kitchen_equipment(id) ON DELETE SET NULL,
      baking_time_minutes NUMERIC(8,2) CHECK (baking_time_minutes IS NULL OR baking_time_minutes >= 0),
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`,
    `CREATE INDEX IF NOT EXISTS idx_recipes_name ON recipes(name);`,
    `CREATE INDEX IF NOT EXISTS idx_recipes_active ON recipes(is_active);`,
    `DROP TRIGGER IF EXISTS trg_recipes_updated_at ON recipes;`,
    `CREATE TRIGGER trg_recipes_updated_at
      BEFORE UPDATE ON recipes
      FOR EACH ROW EXECUTE PROCEDURE set_updated_at();`,

    // Modo de costeo manual — para costear sin cargar insumos (el usuario
    // tipea el costo total directamente).
    `ALTER TABLE recipes ADD COLUMN IF NOT EXISTS cost_mode VARCHAR(10) NOT NULL DEFAULT 'INSUMOS' CHECK (cost_mode IN ('INSUMOS','MANUAL'));`,
    `ALTER TABLE recipes ADD COLUMN IF NOT EXISTS manual_cost_clp INT CHECK (manual_cost_clp IS NULL OR manual_cost_clp >= 0);`,

    // Escalado por molde (torta por capas) — receta "patrón" calibrada para un
    // molde/capas de referencia, que luego se recalcula para otro tamaño.
    `ALTER TABLE recipes ADD COLUMN IF NOT EXISTS is_scalable BOOLEAN NOT NULL DEFAULT false;`,
    `ALTER TABLE recipes ADD COLUMN IF NOT EXISTS ref_diameter_cm NUMERIC(8,2);`,
    `ALTER TABLE recipes ADD COLUMN IF NOT EXISTS ref_height_cm NUMERIC(8,2);`,
    `ALTER TABLE recipes ADD COLUMN IF NOT EXISTS ref_layers INT;`,
    `ALTER TABLE recipes ADD COLUMN IF NOT EXISTS labor_minutes INT CHECK (labor_minutes IS NULL OR labor_minutes >= 0);`,
    `ALTER TABLE recipes ADD COLUMN IF NOT EXISTS labor_rate_clp_hour INT CHECK (labor_rate_clp_hour IS NULL OR labor_rate_clp_hour >= 0);`,
    `ALTER TABLE recipes ADD COLUMN IF NOT EXISTS margin_pct NUMERIC(5,2) CHECK (margin_pct IS NULL OR (margin_pct >= 0 AND margin_pct < 100));`,

    // ============================================
    // Tabla: recipe_components (Mezcla, Almíbar, Relleno, Cobertura...) —
    // solo se usan cuando recipes.is_scalable = true.
    // ============================================
    `CREATE TABLE IF NOT EXISTS recipe_components (
      id UUID PRIMARY KEY,
      recipe_id UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
      name VARCHAR(150) NOT NULL,
      layer_scale_basis VARCHAR(10) NOT NULL DEFAULT 'NONE' CHECK (layer_scale_basis IN ('CAKE','FILLING','NONE')),
      sort_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`,
    `CREATE INDEX IF NOT EXISTS idx_recipe_components_recipe ON recipe_components(recipe_id);`,

    // ============================================
    // Tabla: recipe_items (insumos que componen cada receta)
    // ============================================
    `CREATE TABLE IF NOT EXISTS recipe_items (
      id UUID PRIMARY KEY,
      recipe_id UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
      supply_id UUID NOT NULL REFERENCES supplies(id) ON DELETE RESTRICT,
      quantity NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
      unit VARCHAR(20) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`,
    `CREATE INDEX IF NOT EXISTS idx_recipe_items_recipe ON recipe_items(recipe_id);`,
    `CREATE INDEX IF NOT EXISTS idx_recipe_items_supply ON recipe_items(supply_id);`,
    // component_id — a qué componente pertenece esta línea cuando la receta es
    // escalable (null en recetas planas). Si se borra el componente, sus líneas van con él.
    `ALTER TABLE recipe_items ADD COLUMN IF NOT EXISTS component_id UUID;`,
    `DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'recipe_items_component_id_fkey' AND conrelid = 'recipe_items'::regclass
      ) THEN
        ALTER TABLE recipe_items ADD CONSTRAINT recipe_items_component_id_fkey
          FOREIGN KEY (component_id) REFERENCES recipe_components(id) ON DELETE CASCADE;
      END IF;
    EXCEPTION WHEN undefined_table THEN NULL;
    END $$;`,
    `CREATE INDEX IF NOT EXISTS idx_recipe_items_component ON recipe_items(component_id);`,

    // ============================================
    // products.recipe_id — enlaza una receta a un producto para autocompletar
    // cost_price_clp (costo receta / portions) en vez de cargarlo a mano.
    // ============================================
    `ALTER TABLE products ADD COLUMN IF NOT EXISTS recipe_id UUID;`,
    `DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'products_recipe_id_fkey' AND conrelid = 'products'::regclass
      ) THEN
        ALTER TABLE products ADD CONSTRAINT products_recipe_id_fkey
          FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE SET NULL;
      END IF;
    EXCEPTION WHEN undefined_table THEN NULL;
    END $$;`,
    `CREATE INDEX IF NOT EXISTS idx_products_recipe ON products(recipe_id);`,
    // Tamaño objetivo cuando la receta vinculada es escalable — si se dejan en
    // null, se usa el molde/capas de referencia de la receta.
    `ALTER TABLE products ADD COLUMN IF NOT EXISTS target_diameter_cm NUMERIC(8,2);`,
    `ALTER TABLE products ADD COLUMN IF NOT EXISTS target_height_cm NUMERIC(8,2);`,
    `ALTER TABLE products ADD COLUMN IF NOT EXISTS target_layers INT;`,

    // ============================================
    // FEATURE: System Config (for global settings like cake_base_price)
    // Se crea antes de su primer seed para que una base nueva quede completa
    // en el primer arranque.
    // ============================================
    `CREATE TABLE IF NOT EXISTS system_config (
      key VARCHAR(100) PRIMARY KEY,
      value TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`,

    // Config de energía (reutiliza system_config, mismo patrón que cake_base_price).
    // Se seedean en 0 — hay que cargar el valor real desde /admin/config.
    `INSERT INTO system_config (key, value) VALUES ('energy_price_kwh', '0') ON CONFLICT (key) DO NOTHING;`,
    `INSERT INTO system_config (key, value) VALUES ('energy_price_gas', '0') ON CONFLICT (key) DO NOTHING;`,

    // ============================================
    // Tablas: cake builder
    // ============================================
    `CREATE TABLE IF NOT EXISTS cake_config_category (
      id UUID PRIMARY KEY,
      type VARCHAR(50) NOT NULL,
      label VARCHAR(100) NOT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`,
    `CREATE TABLE IF NOT EXISTS cake_config_option (
      id UUID PRIMARY KEY,
      category_id UUID NOT NULL REFERENCES cake_config_category(id) ON DELETE CASCADE,
      label VARCHAR(100) NOT NULL,
      description VARCHAR(300),
      extra_price_clp INT NOT NULL DEFAULT 0,
      is_default BOOLEAN NOT NULL DEFAULT false,
      diameter_cm INT,
      image_url TEXT,
      is_active BOOLEAN NOT NULL DEFAULT true,
      sort_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`,
    `CREATE INDEX IF NOT EXISTS idx_cake_config_option_category ON cake_config_option(category_id);`,
    `ALTER TABLE cake_config_option ADD COLUMN IF NOT EXISTS image_url TEXT;`,
    // cake_orders se crea ANTES de sus ALTER: en una base nueva los ALTER
    // fallaban en el primer arranque. En bases existentes el CREATE no hace nada.
    `CREATE TABLE IF NOT EXISTS cake_orders (
      id UUID PRIMARY KEY,
      order_number VARCHAR(30) UNIQUE NOT NULL,
      customer_name VARCHAR(200) NOT NULL,
      customer_email VARCHAR(200),
      customer_phone VARCHAR(50),
      customer_address TEXT,
      size_option_id UUID REFERENCES cake_config_option(id),
      layers_option_id UUID REFERENCES cake_config_option(id),
      sponge_option_id UUID REFERENCES cake_config_option(id),
      filling_option_id UUID REFERENCES cake_config_option(id),
      decoration_option_id UUID REFERENCES cake_config_option(id),
      theme_option_id UUID REFERENCES cake_config_option(id),
      base_price_clp INT NOT NULL DEFAULT 0,
      extras_price_clp INT NOT NULL DEFAULT 0,
      total_price_clp INT NOT NULL DEFAULT 0,
      deposit_clp INT NOT NULL DEFAULT 0,
      notes TEXT,
      status VARCHAR(30) NOT NULL DEFAULT 'PENDING_PAYMENT',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`,
    `ALTER TABLE cake_orders ADD COLUMN IF NOT EXISTS theme_option_id UUID;`,
    `DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'cake_orders_theme_option_id_fkey' AND conrelid = 'cake_orders'::regclass
      ) THEN
        ALTER TABLE cake_orders ADD CONSTRAINT cake_orders_theme_option_id_fkey
          FOREIGN KEY (theme_option_id) REFERENCES cake_config_option(id);
      END IF;
    EXCEPTION WHEN undefined_table THEN NULL;
    END $$;`,
    `CREATE INDEX IF NOT EXISTS idx_cake_orders_status ON cake_orders(status);`,

    // Seed categorías iniciales del cake builder (idempotente)
    `INSERT INTO cake_config_category (id, type, label, sort_order, is_active)
     VALUES
       ('00000000-0000-0000-0001-000000000000', 'THEME',      'Diseño/Temática', 0, true),
       ('00000000-0000-0000-0001-000000000001', 'SIZE',       'Tamaño',      1, true),
       ('00000000-0000-0000-0001-000000000002', 'LAYERS',     'Capas',       2, true),
       ('00000000-0000-0000-0001-000000000003', 'SPONGE',     'Bizcocho',    3, true),
       ('00000000-0000-0000-0001-000000000004', 'FILLING',    'Relleno',     4, true),
       ('00000000-0000-0000-0001-000000000005', 'DECORATION', 'Decoración',  5, true)
     ON CONFLICT (id) DO NOTHING;`,

    // Seed opciones iniciales (idempotente)
    `INSERT INTO cake_config_option (id, category_id, label, extra_price_clp, is_default, diameter_cm, sort_order)
     VALUES
       ('00000000-0000-0000-0002-000000000001', '00000000-0000-0000-0001-000000000001', '10 pulgadas',   0,     true,  25, 1),
       ('00000000-0000-0000-0002-000000000002', '00000000-0000-0000-0001-000000000001', '16 pulgadas',   15000, false, 40, 2),
       ('00000000-0000-0000-0002-000000000003', '00000000-0000-0000-0001-000000000001', '20 pulgadas',   25000, false, 50, 3),
       ('00000000-0000-0000-0002-000000000004', '00000000-0000-0000-0001-000000000001', '24 pulgadas',   35000, false, 60, 4),
       ('00000000-0000-0000-0002-000000000005', '00000000-0000-0000-0001-000000000002', '1 capa',        0,     true,  null, 1),
       ('00000000-0000-0000-0002-000000000006', '00000000-0000-0000-0001-000000000002', '2 capas',       8000,  false, null, 2),
       ('00000000-0000-0000-0002-000000000007', '00000000-0000-0000-0001-000000000002', '3 capas',       15000, false, null, 3),
       ('00000000-0000-0000-0002-000000000008', '00000000-0000-0000-0001-000000000003', 'Vainilla',      0,     true,  null, 1),
       ('00000000-0000-0000-0002-000000000009', '00000000-0000-0000-0001-000000000003', 'Chocolate',     3000,  false, null, 2),
       ('00000000-0000-0000-0002-000000000010', '00000000-0000-0000-0001-000000000003', 'Red Velvet',    5000,  false, null, 3),
       ('00000000-0000-0000-0002-000000000011', '00000000-0000-0000-0001-000000000004', 'Manjar',        0,     true,  null, 1),
       ('00000000-0000-0000-0002-000000000012', '00000000-0000-0000-0001-000000000004', 'Ganash chocolate', 4000, false, null, 2),
       ('00000000-0000-0000-0002-000000000013', '00000000-0000-0000-0001-000000000004', 'Crema Bariloche', 4000, false, null, 3),
       ('00000000-0000-0000-0002-000000000014', '00000000-0000-0000-0001-000000000005', 'Decoración estándar', 0, true, null, 1),
       ('00000000-0000-0000-0002-000000000015', '00000000-0000-0000-0001-000000000005', 'Decoración temática', 10000, false, null, 2)
     ON CONFLICT (id) DO NOTHING;`,

    // ============================================
    // FEATURE: Product Toppings
    // ============================================
    `CREATE TABLE IF NOT EXISTS product_toppings (
      id UUID PRIMARY KEY,
      product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      name VARCHAR(100) NOT NULL,
      type VARCHAR(20) NOT NULL DEFAULT 'ADDITIONAL' CHECK (type IN ('BASE', 'ADDITIONAL')),
      price_clp INT NOT NULL DEFAULT 0 CHECK (price_clp >= 0),
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`,
    `CREATE INDEX IF NOT EXISTS idx_product_toppings_product_id ON product_toppings(product_id);`,
    `DROP TRIGGER IF EXISTS trg_product_toppings_updated_at ON product_toppings;`,
    `CREATE TRIGGER trg_product_toppings_updated_at
      BEFORE UPDATE ON product_toppings
      FOR EACH ROW EXECUTE PROCEDURE set_updated_at();`,

    // Seed default cake base price (system_config se crea más arriba)
    `INSERT INTO system_config (key, value) VALUES ('cake_base_price', '30000') ON CONFLICT (key) DO NOTHING;`,

    // ============================================
    // FEATURE: Order Items Enhancements (variants & toppings)
    // ============================================
    `ALTER TABLE order_items ADD COLUMN IF NOT EXISTS variant_id UUID;`,
    `DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'order_items_variant_id_fkey' AND conrelid = 'order_items'::regclass
      ) THEN
        ALTER TABLE order_items ADD CONSTRAINT order_items_variant_id_fkey
          FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE SET NULL;
      END IF;
    EXCEPTION WHEN undefined_table THEN NULL;
    END $$;`,
    `ALTER TABLE order_items ADD COLUMN IF NOT EXISTS variant_name VARCHAR(100);`,
    `ALTER TABLE order_items ADD COLUMN IF NOT EXISTS selected_toppings JSONB;`,

    // ============================================
    // FEATURE: Automatic Stock Calculation (Trigger)
    // ============================================
    // products.stock_qty = suma de las variantes ACTIVAS (igual que el catálogo
    // público): el stock de una variante inactiva no se puede vender. Si la
    // variante cambia de producto se recalculan ambos productos.
    `CREATE OR REPLACE FUNCTION update_product_stock_from_variants()
    RETURNS TRIGGER AS $$
    DECLARE
      affected UUID[];
      pid UUID;
      total INT;
    BEGIN
      IF TG_OP = 'INSERT' THEN
        affected := ARRAY[NEW.product_id];
      ELSIF TG_OP = 'DELETE' THEN
        affected := ARRAY[OLD.product_id];
      ELSIF OLD.product_id IS DISTINCT FROM NEW.product_id THEN
        affected := ARRAY[OLD.product_id, NEW.product_id];
      ELSE
        affected := ARRAY[NEW.product_id];
      END IF;

      FOREACH pid IN ARRAY affected LOOP
        SELECT COALESCE(SUM(stock_qty), 0) INTO total
        FROM product_variants
        WHERE product_id = pid AND is_active;
        UPDATE products SET stock_qty = total WHERE id = pid AND stock_qty IS DISTINCT FROM total;
      END LOOP;
      RETURN NULL;
    END;
    $$ LANGUAGE plpgsql;`,

    `DROP TRIGGER IF EXISTS trg_update_stock_variants_insert_update ON product_variants;`,
    `CREATE TRIGGER trg_update_stock_variants_insert_update
      AFTER INSERT OR UPDATE OF stock_qty, product_id, is_active ON product_variants
      FOR EACH ROW EXECUTE PROCEDURE update_product_stock_from_variants();`,

    `DROP TRIGGER IF EXISTS trg_update_stock_variants_delete ON product_variants;`,
    `CREATE TRIGGER trg_update_stock_variants_delete
      AFTER DELETE ON product_variants
      FOR EACH ROW EXECUTE PROCEDURE update_product_stock_from_variants();`,

    // Repara productos cuyo stock quedó desfasado de la suma de sus variantes
    // activas (el PATCH de producto lo pisaba con un valor viejo del
    // formulario; antes también se sumaban las inactivas).
    // Idempotente: solo toca filas que no coinciden.
    `UPDATE products p
     SET stock_qty = s.total
     FROM (
       SELECT product_id, COALESCE(SUM(stock_qty) FILTER (WHERE is_active), 0)::int AS total
       FROM product_variants
       GROUP BY product_id
     ) s
     WHERE p.id = s.product_id AND p.stock_qty <> s.total;`,


    // ============================================
    // FEATURE: Hero Slides (Dynamic Carousel)
    // ============================================
    `CREATE TABLE IF NOT EXISTS hero_slides (
      id UUID PRIMARY KEY,
      title VARCHAR(200),
      subtitle VARCHAR(300),
      button_text VARCHAR(100),
      button_link VARCHAR(300),
      image_url VARCHAR(500) NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT true,
      sort_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`,
    `CREATE INDEX IF NOT EXISTS idx_hero_slides_active_sort ON hero_slides(is_active, sort_order);`,
    `DROP TRIGGER IF EXISTS trg_hero_slides_updated_at ON hero_slides;`,
    `CREATE TRIGGER trg_hero_slides_updated_at
      BEFORE UPDATE ON hero_slides
      FOR EACH ROW EXECUTE PROCEDURE set_updated_at();`,

    // ============================================
    // FIX: Agregar order_code a orders si no existe
    // ============================================
    `DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='orders' AND column_name='order_code'
      ) THEN
        ALTER TABLE orders ADD COLUMN order_code TEXT;
      END IF;
    EXCEPTION WHEN undefined_table THEN NULL;
    END $$;`,

    // ============================================
    // FEATURE: Order Price Adjustments
    // ============================================
    `ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_amount_clp INT NOT NULL DEFAULT 0;`,
    `ALTER TABLE orders ADD COLUMN IF NOT EXISTS final_price_override_clp INT;`,

    // ============================================
    // FIX: orders.status constraint — incluir PENDING_PAYMENT
    // Un solo bloque: primero se agrega la v2 y solo después se elimina la
    // original. Si la v2 no se pudiera agregar, el bloque completo se revierte
    // y `orders` nunca queda sin restricción de estado.
    // La v3 (vocabulario canónico, más abajo) la reemplaza: si ya existe, la v2
    // no se vuelve a crear.
    // ============================================
    `DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'orders_status_check_v2' AND conrelid = 'orders'::regclass
      ) AND NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'orders_status_check_v3' AND conrelid = 'orders'::regclass
      ) THEN
        ALTER TABLE orders ADD CONSTRAINT orders_status_check_v2
          CHECK (status IN ('PENDING_PAYMENT','PENDING_CONFIRMATION','CONFIRMED','PAID','PREPARING','READY','DELIVERED','CANCELLED'));
      END IF;
      ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
    EXCEPTION WHEN undefined_table THEN NULL;
    END $$;`,

    // ============================================
    // FIX: UNIQUE constraint en customers.email
    // ============================================

    // Eliminar constraint viejo si existe (permite múltiples NULL)
    `DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'customers_email_key' AND conrelid = 'customers'::regclass
      ) THEN
        ALTER TABLE customers DROP CONSTRAINT customers_email_key;
      END IF;
    EXCEPTION
      WHEN undefined_table THEN NULL;
      WHEN undefined_object THEN NULL;
    END $$;`,

    // ============================================
    // FEATURE: Motor de Tarifa (Platform Fee Engine)
    //
    // Cobra el DUEÑO DE LA PLATAFORMA (no el panadero) por cada orden que
    // cierra (status=DELIVERED). platform_fee_tiers son reglas de tarifa
    // configurables por rango de volumen mensual [min, max). Cada fila de
    // platform_fee_charges es una FOTO del cobro en el momento en que se
    // generó — nunca se recalcula si la config de tiers cambia después.
    // ============================================
    `CREATE TABLE IF NOT EXISTS platform_fee_tiers (
      id UUID PRIMARY KEY,
      label TEXT NOT NULL,
      min_monthly_volume_clp BIGINT NOT NULL CHECK (min_monthly_volume_clp >= 0),
      max_monthly_volume_clp BIGINT,
      fee_per_transaction_clp INT NOT NULL CHECK (fee_per_transaction_clp >= 0),
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT platform_fee_tiers_range_chk
        CHECK (max_monthly_volume_clp IS NULL OR max_monthly_volume_clp > min_monthly_volume_clp)
    );`,
    `CREATE INDEX IF NOT EXISTS idx_platform_fee_tiers_active
      ON platform_fee_tiers(is_active, min_monthly_volume_clp);`,
    `DROP TRIGGER IF EXISTS trg_platform_fee_tiers_updated_at ON platform_fee_tiers;`,
    `CREATE TRIGGER trg_platform_fee_tiers_updated_at
      BEFORE UPDATE ON platform_fee_tiers
      FOR EACH ROW EXECUTE PROCEDURE set_updated_at();`,

    `CREATE TABLE IF NOT EXISTS platform_fee_charges (
      id UUID PRIMARY KEY,
      order_id UUID NOT NULL UNIQUE REFERENCES orders(id) ON DELETE RESTRICT,
      order_no BIGINT NOT NULL,
      order_code TEXT,
      order_total_clp INT NOT NULL,
      tier_id UUID REFERENCES platform_fee_tiers(id) ON DELETE SET NULL,
      tier_label_snapshot TEXT,
      fee_applied_clp INT NOT NULL CHECK (fee_applied_clp >= 0),
      is_fallback BOOLEAN NOT NULL DEFAULT FALSE,
      period_month DATE NOT NULL,
      monthly_volume_at_charge_clp BIGINT NOT NULL,
      monthly_txn_ordinal INT NOT NULL,
      source_status TEXT NOT NULL DEFAULT 'DELIVERED',
      charged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      reversed_at TIMESTAMPTZ,
      reversed_reason TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`,
    `CREATE INDEX IF NOT EXISTS idx_platform_fee_charges_period
      ON platform_fee_charges(period_month);`,
    `CREATE INDEX IF NOT EXISTS idx_platform_fee_charges_charged_at
      ON platform_fee_charges(charged_at DESC);`,
    `CREATE INDEX IF NOT EXISTS idx_platform_fee_charges_tier
      ON platform_fee_charges(tier_id);`,
    `DROP TRIGGER IF EXISTS trg_platform_fee_charges_updated_at ON platform_fee_charges;`,
    `CREATE TRIGGER trg_platform_fee_charges_updated_at
      BEFORE UPDATE ON platform_fee_charges
      FOR EACH ROW EXECUTE PROCEDURE set_updated_at();`,

    // Marca informativa (nunca funcional): sembrada UNA sola vez gracias a
    // ON CONFLICT DO NOTHING. Documenta desde cuándo corre el motor — el
    // motor jamás cobra retroactivo, esto es solo para mostrar en el
    // dashboard y como referencia para un backfill manual futuro, si algún
    // día se decide conscientemente.
    `INSERT INTO system_config (key, value)
     VALUES ('platform_fee_engine_activated_at', NOW()::text)
     ON CONFLICT (key) DO NOTHING;`,

    // ============================================
    // RESTRICCIONES GENÉRICAS DE INTEGRIDAD (catálogo y configuración)
    // Las del dominio de pedidos/stock/estados quedan para su propio cambio.
    // ============================================
    ...guardedCheckConstraint(
      "cake_config_option",
      "cake_config_option_extra_price_nonneg",
      "extra_price_clp >= 0"
    ),
    ...guardedCheckConstraint(
      "cake_config_option",
      "cake_config_option_diameter_positive",
      "diameter_cm IS NULL OR diameter_cm > 0"
    ),
    ...guardedCheckConstraint(
      "product_variants",
      "product_variants_price_override_nonneg",
      "price_override_clp IS NULL OR price_override_clp >= 0"
    ),
    ...guardedCheckConstraint(
      "products",
      "products_cost_price_nonneg",
      "cost_price_clp IS NULL OR cost_price_clp >= 0"
    ),
    ...guardedCheckConstraint(
      "supplies",
      "supplies_last_price_nonneg",
      "last_price_clp IS NULL OR last_price_clp >= 0"
    ),
    ...guardedCheckConstraint("supplies", "supplies_reference_qty_positive", "reference_qty > 0"),

    // Índices redundantes con una UNIQUE existente (solo escritura extra).
    dropRedundantIndex("users", "idx_users_email", "users_email_key"),
    dropRedundantIndex("products", "idx_products_slug", "products_slug_key"),

    ...orderDomainStatements(),
    ...paymentsStatements(),
  ];
  return statements;
}

// Residencia declarada: ambos campos o ninguno; unidad de 1 a 60 caracteres.
const RESIDENCY_CHECK =
  "(residency_unit IS NULL AND residency_declared_at IS NULL) OR " +
  "(residency_declared_at IS NOT NULL AND char_length(btrim(residency_unit)) BETWEEN 1 AND 60)";

/**
 * Dominio de pedidos (órdenes, tortas, stock, auditoría, modo solo residentes).
 * Los vocabularios salen de src/lib/orderStatus.js y cakeOrderStatus.js: una
 * sola fuente para el código y para los CHECK. Orden: columnas → datos
 * heredados → restricciones (cada CHECK nuevo se agrega NOT VALID y se valida
 * aparte, después de normalizar los datos que lo violarían).
 */
function orderDomainStatements() {
  const orderStatusCase = legacyOrderStatusCaseSql("status");
  const cakeStatusCase = legacyCakeStatusCaseSql("status");
  return [
    // ============================================
    // Permisos por usuario (B-09): desde cuándo la matriz guardada rige.
    // NULL = matriz heredada nunca aplicada → valen los permisos del rol.
    // ============================================
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions_configured_at TIMESTAMPTZ;`,

    // ============================================
    // Clientes: origen de la ficha (C-13). Las fichas creadas por la web
    // (clientes con pedidos solo web) pasan a WEB una única vez; las del panel
    // quedan ADMIN y un pedido público nunca las reutiliza ni modifica.
    // ============================================
    addColumnWithBackfill(
      "customers",
      "source",
      "TEXT NOT NULL DEFAULT 'ADMIN'",
      `UPDATE customers c SET source = 'WEB'
         WHERE EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id AND o.order_code LIKE 'WEB-%')
           AND NOT EXISTS (
             SELECT 1 FROM orders o
             WHERE o.customer_id = c.id AND (o.order_code IS NULL OR o.order_code NOT LIKE 'WEB-%')
           );`
    ),
    ...guardedCheckConstraint("customers", "customers_source_check", "source IN ('ADMIN','WEB')"),

    // ============================================
    // Reserva de stock por orden (B-18/C-01, payments-design §4.1/§8.1).
    // Relleno único: las órdenes del panel siempre descontaron stock al crearse
    // (CONSUMED, también las canceladas: cancelar nunca lo devolvió); las web
    // nunca descontaron (NONE).
    // ============================================
    addColumnWithBackfill(
      "orders",
      "stock_reservation_status",
      "TEXT NOT NULL DEFAULT 'NONE'",
      `UPDATE orders SET stock_reservation_status = 'CONSUMED'
         WHERE stock_reservation_status = 'NONE' AND (order_code IS NULL OR order_code NOT LIKE 'WEB-%');`
    ),
    ...guardedCheckConstraint(
      "orders",
      "orders_stock_reservation_status_check",
      `stock_reservation_status IN (${sqlStatusList(STOCK_RESERVATION_STATUSES)})`
    ),

    // Quién canceló (payments-design §4.1). Las canceladas heredadas solo
    // pudieron cancelarse desde el panel.
    addColumnWithBackfill(
      "orders",
      "cancellation_source",
      "TEXT",
      `UPDATE orders SET cancellation_source = 'ADMIN' WHERE status = 'CANCELLED';`
    ),
    ...guardedCheckConstraint(
      "orders",
      "orders_cancellation_source_check",
      `(cancellation_source IS NULL OR cancellation_source IN (${sqlStatusList(CANCELLATION_SOURCES)})) ` +
        `AND (cancellation_source IS NULL OR status = 'CANCELLED')`
    ),

    // Idempotencia del checkout público (doble clic / reintento de red).
    `ALTER TABLE orders ADD COLUMN IF NOT EXISTS client_request_id UUID;`,
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_client_request_id ON orders(client_request_id) WHERE client_request_id IS NOT NULL;`,

    // Residencia declarada (D2), entrega (D3) y datos del pedido web.
    `ALTER TABLE orders ADD COLUMN IF NOT EXISTS residency_unit TEXT;`,
    `ALTER TABLE orders ADD COLUMN IF NOT EXISTS residency_declared_at TIMESTAMPTZ;`,
    ...guardedCheckConstraint("orders", "orders_residency_check", RESIDENCY_CHECK),
    `ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_address TEXT;`,
    `ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_date DATE;`,
    `ALTER TABLE orders ADD COLUMN IF NOT EXISTS notes TEXT;`,
    `ALTER TABLE orders ADD COLUMN IF NOT EXISTS contact_email TEXT;`,
    ...guardedCheckConstraint(
      "orders",
      "orders_text_lengths_check",
      "(notes IS NULL OR char_length(notes) <= 1000) AND " +
        "(delivery_address IS NULL OR char_length(delivery_address) <= 500) AND " +
        "(contact_email IS NULL OR char_length(contact_email) <= 254)"
    ),
    // Cuándo se registró el pago (se fija al pasar payment_status a PAID).
    `ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;`,

    // Montos nunca negativos (B-32).
    ...guardedCheckConstraint(
      "orders",
      "orders_money_nonneg",
      "subtotal_clp >= 0 AND delivery_fee_clp >= 0 AND discount_amount_clp >= 0 " +
        "AND (final_price_override_clp IS NULL OR final_price_override_clp >= 0) AND total_clp >= 0"
    ),
    ...guardedCheckConstraint("order_items", "order_items_money_nonneg", "unit_price_clp >= 0 AND line_total_clp >= 0"),
    // FK con ON DELETE SET NULL: sin índice, borrar una variante recorre order_items.
    `CREATE INDEX IF NOT EXISTS idx_order_items_variant_id ON order_items(variant_id);`,

    // ============================================
    // Pedidos de torta: idempotencia, residencia, fecha de entrega, montos.
    // (Las columnas de pago del abono las agrega la unidad de pagos.)
    // ============================================
    `ALTER TABLE cake_orders ADD COLUMN IF NOT EXISTS client_request_id UUID;`,
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_cake_orders_client_request_id ON cake_orders(client_request_id) WHERE client_request_id IS NOT NULL;`,
    `ALTER TABLE cake_orders ADD COLUMN IF NOT EXISTS residency_unit TEXT;`,
    `ALTER TABLE cake_orders ADD COLUMN IF NOT EXISTS residency_declared_at TIMESTAMPTZ;`,
    ...guardedCheckConstraint("cake_orders", "cake_orders_residency_check", RESIDENCY_CHECK),
    `ALTER TABLE cake_orders ADD COLUMN IF NOT EXISTS delivery_date DATE;`,
    ...guardedCheckConstraint(
      "cake_orders",
      "cake_orders_money_nonneg",
      "base_price_clp >= 0 AND extras_price_clp >= 0 AND total_price_clp >= 0 AND deposit_clp >= 0"
    ),

    // ============================================
    // Auditoría de órdenes y tortas (B-10): quién, qué, de → a, cuándo.
    // Se escribe en la misma transacción que cada cambio.
    // ============================================
    `CREATE TABLE IF NOT EXISTS order_events (
      id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      order_id UUID REFERENCES orders(id) ON DELETE RESTRICT,
      cake_order_id UUID REFERENCES cake_orders(id) ON DELETE RESTRICT,
      event_type TEXT NOT NULL,
      from_value TEXT,
      to_value TEXT,
      actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      actor_email TEXT,
      actor_role TEXT,
      source TEXT NOT NULL,
      data JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT order_events_target_check CHECK (num_nonnulls(order_id, cake_order_id) = 1),
      CONSTRAINT order_events_source_check CHECK (source IN (${sqlStatusList(ORDER_EVENT_SOURCES)}))
    );`,
    `CREATE INDEX IF NOT EXISTS idx_order_events_order ON order_events(order_id, created_at);`,
    `CREATE INDEX IF NOT EXISTS idx_order_events_cake_order ON order_events(cake_order_id, created_at);`,

    // ============================================
    // Vocabulario canónico de estados de orden (C-10/B-22). Los valores que la
    // v2 todavía admitía (PENDING_CONFIRMATION, CONFIRMED) se normalizan
    // dejando un evento con el valor anterior; luego la v3 reemplaza a la v2
    // en un solo bloque (nunca queda `orders` sin restricción de estado).
    // ============================================
    `INSERT INTO order_events (order_id, event_type, from_value, to_value, source, data)
     SELECT id, 'LEGACY_STATUS_NORMALIZED', status, ${orderStatusCase}, 'MIGRATION',
            '{"motivo":"vocabulario canonico de estados de orden"}'::jsonb
     FROM orders
     WHERE ${orderStatusCase} IS NOT NULL AND ${orderStatusCase} <> status;`,
    `UPDATE orders SET status = ${orderStatusCase}
     WHERE ${orderStatusCase} IS NOT NULL AND ${orderStatusCase} <> status;`,
    `DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'orders_status_check_v3' AND conrelid = 'orders'::regclass
      ) THEN
        ALTER TABLE orders ADD CONSTRAINT orders_status_check_v3
          CHECK (status IN (${sqlStatusList(ORDER_STATUSES)})) NOT VALID;
      END IF;
      ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check_v2;
      ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
    END $$;`,
    validateConstraintStatement("orders", "orders_status_check_v3"),

    // ============================================
    // Vocabulario canónico de estados de torta (B-21/C-02): el que usa el
    // panel. Legados: PENDING → PENDING_PAYMENT, PAID → CONFIRMED,
    // PREPARING → IN_PROGRESS (con evento). Un valor desconocido no se toca:
    // la validación del CHECK falla y queda reportada en db:validate.
    // ============================================
    `INSERT INTO order_events (cake_order_id, event_type, from_value, to_value, source, data)
     SELECT id, 'LEGACY_STATUS_NORMALIZED', status, ${cakeStatusCase}, 'MIGRATION',
            '{"motivo":"vocabulario canonico de estados de torta"}'::jsonb
     FROM cake_orders
     WHERE ${cakeStatusCase} IS NOT NULL AND ${cakeStatusCase} <> status;`,
    `UPDATE cake_orders SET status = ${cakeStatusCase}
     WHERE ${cakeStatusCase} IS NOT NULL AND ${cakeStatusCase} <> status;`,
    ...guardedCheckConstraint("cake_orders", "cake_orders_status_check", `status IN (${sqlStatusList(CAKE_ORDER_STATUSES)})`),

    // ============================================
    // Código de orden único (B-32/B-37/C-07): los duplicados heredados (p. ej.
    // dos ORD-<ms> en el mismo milisegundo) reciben un sufijo -2, -3...
    // (con evento) antes del índice UNIQUE parcial.
    // ============================================
    `INSERT INTO order_events (order_id, event_type, from_value, to_value, source)
     SELECT d.id, 'ORDER_CODE_DEDUPLICATED', d.order_code, d.order_code || '-' || d.rn, 'MIGRATION'
     FROM (
       SELECT id, order_code, ROW_NUMBER() OVER (PARTITION BY order_code ORDER BY created_at, id) AS rn
       FROM orders WHERE order_code IS NOT NULL
     ) d
     WHERE d.rn > 1;`,
    `UPDATE orders o SET order_code = o.order_code || '-' || d.rn
     FROM (
       SELECT id, ROW_NUMBER() OVER (PARTITION BY order_code ORDER BY created_at, id) AS rn
       FROM orders WHERE order_code IS NOT NULL
     ) d
     WHERE o.id = d.id AND d.rn > 1;`,
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_order_code ON orders(order_code) WHERE order_code IS NOT NULL;`,

    // ============================================
    // Stock de insumos nunca negativo (B-27): el error de validación por línea
    // pudo dejar insumos bajo cero; se llevan a 0 antes del CHECK.
    // ============================================
    `UPDATE supplies SET stock_qty = 0 WHERE stock_qty < 0;`,
    ...guardedCheckConstraint("supplies", "supplies_stock_qty_nonneg", "stock_qty >= 0"),

    // ============================================
    // Modo de venta "solo residentes" (D2/D3). Valores iniciales de esta
    // instancia; después los edita el panel (PUT /admin/settings/sales).
    // ============================================
    ...SALES_SETTINGS_KEYS.map(
      (key) =>
        `INSERT INTO system_config (key, value) VALUES (${sqlLiteral(key)}, ${sqlLiteral(DEFAULT_SALES_SETTINGS[key])}) ON CONFLICT (key) DO NOTHING;`
    ),
  ];
}

const PAYMENT_PROVIDERS_SQL = sqlStatusList(PAYMENT_PROVIDERS);
const SUCCESS_ATTEMPTS_SQL = sqlStatusList(SUCCESS_STATUSES);
const OPEN_ATTEMPTS_SQL = sqlStatusList(OPEN_STATUSES);

/**
 * Pagos en línea (Webpay Plus / Mercado Pago Checkout Pro), payments-design §4
 * + abono de tortas (§5.7, decisión D1). Un intento de pago por fila en
 * `payments`, auditoría y deduplicación en `payment_events`, reembolsos en
 * `payment_refunds`. Las órdenes y tortas en línea reutilizan sus estados.
 */
function paymentsStatements() {
  return [
    // ============================================
    // orders: columnas del pago en línea (las de stock, origen de cancelación
    // e idempotencia las agregó el dominio de pedidos).
    // ============================================
    `ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_provider TEXT;`,
    ...guardedCheckConstraint("orders", "orders_payment_provider_check", `payment_provider IS NULL OR payment_provider IN (${PAYMENT_PROVIDERS_SQL})`),
    // Token de acceso a la página de pago (capacidad: 32 bytes base64url generados en Node).
    `ALTER TABLE orders ADD COLUMN IF NOT EXISTS public_token TEXT;`,
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_public_token ON orders(public_token) WHERE public_token IS NOT NULL;`,
    ...guardedCheckConstraint("orders", "orders_public_token_format", "public_token IS NULL OR public_token ~ '^[A-Za-z0-9_-]{43}$'"),
    // Plazo para pagar (NULL = sin plazo: orden del panel pagable con su enlace).
    `ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_expires_at TIMESTAMPTZ;`,
    `CREATE INDEX IF NOT EXISTS idx_orders_online_pending_expiry
       ON orders(payment_expires_at)
       WHERE payment_method = 'ONLINE' AND status = 'PENDING_PAYMENT';`,
    // Canal de creación (D2: el pago de un pedido WEB exige la declaración de
    // residencia; los del panel, no). Relleno único: los códigos WEB- son web.
    addColumnWithBackfill(
      "orders",
      "channel",
      "TEXT NOT NULL DEFAULT 'ADMIN'",
      `UPDATE orders SET channel = 'WEB' WHERE order_code LIKE 'WEB-%';`
    ),
    ...guardedCheckConstraint("orders", "orders_channel_check", "channel IN ('ADMIN','WEB')"),
    // Cuándo el panel generó el enlace de pago (autorización de la dueña para pagar aunque no haya residencia, D2).
    `ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_link_created_at TIMESTAMPTZ;`,

    // ============================================
    // cake_orders: abono en línea (D1) y saldo registrado por el panel.
    // ============================================
    `ALTER TABLE cake_orders ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'MANUAL';`,
    ...guardedCheckConstraint("cake_orders", "cake_orders_payment_method_check", "payment_method IN ('MANUAL','ONLINE')"),
    `ALTER TABLE cake_orders ADD COLUMN IF NOT EXISTS payment_provider TEXT;`,
    ...guardedCheckConstraint("cake_orders", "cake_orders_payment_provider_check", `payment_provider IS NULL OR payment_provider IN (${PAYMENT_PROVIDERS_SQL})`),
    `ALTER TABLE cake_orders ADD COLUMN IF NOT EXISTS public_token TEXT;`,
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_cake_orders_public_token ON cake_orders(public_token) WHERE public_token IS NOT NULL;`,
    ...guardedCheckConstraint("cake_orders", "cake_orders_public_token_format", "public_token IS NULL OR public_token ~ '^[A-Za-z0-9_-]{43}$'"),
    `ALTER TABLE cake_orders ADD COLUMN IF NOT EXISTS payment_expires_at TIMESTAMPTZ;`,
    `ALTER TABLE cake_orders ADD COLUMN IF NOT EXISTS payment_link_created_at TIMESTAMPTZ;`,
    `ALTER TABLE cake_orders ADD COLUMN IF NOT EXISTS deposit_status TEXT NOT NULL DEFAULT 'PENDING';`,
    ...guardedCheckConstraint("cake_orders", "cake_orders_deposit_status_check", `deposit_status IN (${sqlStatusList(CAKE_DEPOSIT_STATUSES)})`),
    `ALTER TABLE cake_orders ADD COLUMN IF NOT EXISTS deposit_paid_at TIMESTAMPTZ;`,
    `ALTER TABLE cake_orders ADD COLUMN IF NOT EXISTS deposit_payment_method TEXT;`,
    ...guardedCheckConstraint(
      "cake_orders",
      "cake_orders_deposit_payment_method_check",
      "deposit_payment_method IS NULL OR deposit_payment_method IN ('ONLINE','CASH','TRANSFER')"
    ),
    `ALTER TABLE cake_orders ADD COLUMN IF NOT EXISTS balance_status TEXT NOT NULL DEFAULT 'PENDING';`,
    ...guardedCheckConstraint("cake_orders", "cake_orders_balance_status_check", `balance_status IN (${sqlStatusList(CAKE_BALANCE_STATUSES)})`),
    `ALTER TABLE cake_orders ADD COLUMN IF NOT EXISTS balance_paid_at TIMESTAMPTZ;`,
    `ALTER TABLE cake_orders ADD COLUMN IF NOT EXISTS balance_payment_method TEXT;`,
    `ALTER TABLE cake_orders ADD COLUMN IF NOT EXISTS balance_amount_clp INT;`,
    ...guardedCheckConstraint(
      "cake_orders",
      "cake_orders_balance_payment_check",
      "(balance_payment_method IS NULL OR balance_payment_method IN ('CASH','TRANSFER')) AND (balance_amount_clp IS NULL OR balance_amount_clp >= 0)"
    ),
    // Quién canceló (como en orders): solo un pedido vencido por el sistema
    // revive ante un pago tardío del abono. Las canceladas heredadas = panel.
    addColumnWithBackfill(
      "cake_orders",
      "cancellation_source",
      "TEXT",
      `UPDATE cake_orders SET cancellation_source = 'ADMIN' WHERE status = 'CANCELLED';`
    ),
    ...guardedCheckConstraint(
      "cake_orders",
      "cake_orders_cancellation_source_check",
      `(cancellation_source IS NULL OR cancellation_source IN (${sqlStatusList(CANCELLATION_SOURCES)})) ` +
        `AND (cancellation_source IS NULL OR status = 'CANCELLED')`
    ),
    `CREATE INDEX IF NOT EXISTS idx_cake_orders_online_pending_expiry
       ON cake_orders(payment_expires_at)
       WHERE payment_method = 'ONLINE' AND status = 'PENDING_PAYMENT';`,

    // ============================================
    // Tabla "payments" heredada: los scripts sql/*.sql antiguos (eliminados;
    // la documentación vieja pedía ejecutarlos en phpPgAdmin) creaban una
    // tabla payments incompatible (estados INITIATED/AUTHORIZED). Si existe
    // sin las columnas nuevas, se renombra a payments_legacy (con sus
    // restricciones e índices prefijados "legacy_") sin perder datos, y se crea
    // la tabla canónica.
    // ============================================
    `DO $$
    DECLARE
      item record;
    BEGIN
      IF to_regclass('payments') IS NOT NULL
         AND to_regclass('payments_legacy') IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = current_schema() AND table_name = 'payments' AND column_name = 'buy_order'
         ) THEN
        EXECUTE 'ALTER TABLE payments RENAME TO payments_legacy';
        FOR item IN SELECT conname FROM pg_constraint WHERE conrelid = 'payments_legacy'::regclass LOOP
          EXECUTE format('ALTER TABLE payments_legacy RENAME CONSTRAINT %I TO %I', item.conname, left('legacy_' || item.conname, 63));
        END LOOP;
        FOR item IN
          SELECT c.relname FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
          WHERE i.indrelid = 'payments_legacy'::regclass AND left(c.relname, 7) <> 'legacy_'
        LOOP
          EXECUTE format('ALTER INDEX %I RENAME TO %I', item.relname, left('legacy_' || item.relname, 63));
        END LOOP;
        RAISE NOTICE 'Tabla payments heredada renombrada a payments_legacy';
      END IF;
    END $$;`,

    // ============================================
    // payments: un intento de pago por fila (Webpay o Mercado Pago), para una
    // orden del catálogo O un pedido de torta (exactamente uno).
    // ============================================
    `CREATE TABLE IF NOT EXISTS payments (
      id UUID PRIMARY KEY,
      order_id UUID REFERENCES orders(id) ON DELETE RESTRICT,
      cake_order_id UUID REFERENCES cake_orders(id) ON DELETE RESTRICT,
      attempt_no INT NOT NULL,
      provider TEXT NOT NULL,
      environment TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'CREATED',
      amount_clp INT NOT NULL,
      currency TEXT NOT NULL DEFAULT 'CLP',
      buy_order TEXT NOT NULL,
      session_id TEXT NOT NULL,
      client_request_id UUID,
      provider_token TEXT,
      provider_preference_id TEXT,
      provider_payment_id TEXT,
      redirect_url TEXT,
      provider_status TEXT,
      provider_status_detail TEXT,
      response_code INT,
      authorization_code TEXT,
      card_last4 TEXT,
      payment_type TEXT,
      payment_method_id TEXT,
      installments_number INT,
      installments_amount_clp INT,
      accounting_date TEXT,
      transaction_date TIMESTAMPTZ,
      refunded_amount_clp INT NOT NULL DEFAULT 0,
      review_reason TEXT,
      target_applied BOOLEAN NOT NULL DEFAULT false,
      provider_payload JSONB,
      last_error TEXT,
      commit_started_at TIMESTAMPTZ,
      commit_attempts INT NOT NULL DEFAULT 0,
      expires_at TIMESTAMPTZ NOT NULL,
      next_reconcile_at TIMESTAMPTZ,
      reconcile_attempts INT NOT NULL DEFAULT 0,
      reconcile_lease_until TIMESTAMPTZ,
      last_reconciled_at TIMESTAMPTZ,
      finalized_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT payments_target_check CHECK (num_nonnulls(order_id, cake_order_id) = 1),
      CONSTRAINT payments_attempt_no_check CHECK (attempt_no >= 1),
      CONSTRAINT payments_provider_check CHECK (provider IN (${PAYMENT_PROVIDERS_SQL})),
      CONSTRAINT payments_environment_check CHECK (environment IN ('TEST','LIVE')),
      CONSTRAINT payments_status_check CHECK (status IN (${sqlStatusList(ATTEMPT_STATUSES)})),
      CONSTRAINT payments_amount_check CHECK (amount_clp > 0),
      CONSTRAINT payments_currency_check CHECK (currency = 'CLP'),
      CONSTRAINT payments_buy_order_check CHECK (buy_order ~ '^[A-Z0-9-]{1,26}$'),
      CONSTRAINT payments_session_id_check CHECK (char_length(session_id) BETWEEN 1 AND 61),
      CONSTRAINT payments_card_last4_check CHECK (card_last4 IS NULL OR card_last4 ~ '^[0-9]{4}$'),
      CONSTRAINT payments_refunded_check CHECK (refunded_amount_clp >= 0 AND refunded_amount_clp <= amount_clp),
      CONSTRAINT payments_commit_once_check CHECK (commit_attempts BETWEEN 0 AND 1),
      CONSTRAINT payments_buy_order_key UNIQUE (buy_order),
      CONSTRAINT payments_provider_token_key UNIQUE (provider_token),
      CONSTRAINT payments_provider_preference_id_key UNIQUE (provider_preference_id),
      CONSTRAINT payments_provider_payment_id_key UNIQUE (provider_payment_id),
      CONSTRAINT payments_client_request_id_key UNIQUE (client_request_id)
    );`,
    // Garantía contable: a lo más un intento exitoso por orden y por torta.
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_one_success_per_order
       ON payments(order_id) WHERE order_id IS NOT NULL AND status IN (${SUCCESS_ATTEMPTS_SQL});`,
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_one_success_per_cake_order
       ON payments(cake_order_id) WHERE cake_order_id IS NOT NULL AND status IN (${SUCCESS_ATTEMPTS_SQL});`,
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_order_attempt ON payments(order_id, attempt_no) WHERE order_id IS NOT NULL;`,
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_cake_order_attempt ON payments(cake_order_id, attempt_no) WHERE cake_order_id IS NOT NULL;`,
    `CREATE INDEX IF NOT EXISTS idx_payments_reconcile ON payments(next_reconcile_at) WHERE status IN (${OPEN_ATTEMPTS_SQL});`,
    `CREATE INDEX IF NOT EXISTS idx_payments_status_created ON payments(status, created_at DESC);`,
    `DROP TRIGGER IF EXISTS trg_payments_updated_at ON payments;`,
    `CREATE TRIGGER trg_payments_updated_at
       BEFORE UPDATE ON payments
       FOR EACH ROW EXECUTE PROCEDURE set_updated_at();`,

    // ============================================
    // payment_events: auditoría saneada y deduplicación de notificaciones
    // (dedupe_key UNIQUE: un webhook o retorno repetido se cuenta, no se reprocesa).
    // ============================================
    `CREATE TABLE IF NOT EXISTS payment_events (
      id UUID PRIMARY KEY,
      payment_id UUID REFERENCES payments(id) ON DELETE RESTRICT,
      order_id UUID REFERENCES orders(id) ON DELETE RESTRICT,
      cake_order_id UUID REFERENCES cake_orders(id) ON DELETE RESTRICT,
      provider TEXT NOT NULL,
      source TEXT NOT NULL,
      event_type TEXT NOT NULL,
      dedupe_key TEXT,
      from_status TEXT,
      to_status TEXT,
      signature_valid BOOLEAN,
      http_status INT,
      payload JSONB,
      error TEXT,
      received_count INT NOT NULL DEFAULT 1,
      processed_at TIMESTAMPTZ,
      actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT payment_events_target_check CHECK (num_nonnulls(order_id, cake_order_id) <= 1),
      CONSTRAINT payment_events_provider_check CHECK (provider IN (${PAYMENT_PROVIDERS_SQL},'SYSTEM')),
      CONSTRAINT payment_events_source_check CHECK (source IN (${sqlStatusList(PAYMENT_EVENT_SOURCES)})),
      CONSTRAINT payment_events_type_check CHECK (event_type ~ '^[A-Z][A-Z0-9_]{2,59}$'),
      CONSTRAINT payment_events_dedupe_key_key UNIQUE (dedupe_key)
    );`,
    `CREATE INDEX IF NOT EXISTS idx_payment_events_payment ON payment_events(payment_id, created_at);`,
    `CREATE INDEX IF NOT EXISTS idx_payment_events_order ON payment_events(order_id, created_at);`,
    `CREATE INDEX IF NOT EXISTS idx_payment_events_cake_order ON payment_events(cake_order_id, created_at);`,

    // ============================================
    // payment_refunds: reembolsos (solo SUPERADMIN). id = X-Idempotency-Key en MP.
    // A lo más un reembolso abierto (REQUESTED/UNKNOWN) por intento.
    // ============================================
    `CREATE TABLE IF NOT EXISTS payment_refunds (
      id UUID PRIMARY KEY,
      payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
      amount_clp INT NOT NULL,
      status TEXT NOT NULL,
      provider_refund_id TEXT,
      provider_type TEXT,
      reason TEXT NOT NULL,
      requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
      client_request_id UUID NOT NULL,
      provider_payload JSONB,
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolved_at TIMESTAMPTZ,
      CONSTRAINT payment_refunds_amount_check CHECK (amount_clp > 0),
      CONSTRAINT payment_refunds_status_check CHECK (status IN ('REQUESTED','SUCCEEDED','FAILED','UNKNOWN')),
      CONSTRAINT payment_refunds_reason_check CHECK (char_length(reason) BETWEEN 5 AND 300),
      CONSTRAINT payment_refunds_client_request_id_key UNIQUE (client_request_id)
    );`,
    `CREATE INDEX IF NOT EXISTS idx_payment_refunds_payment ON payment_refunds(payment_id);`,
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_refunds_one_open ON payment_refunds(payment_id) WHERE status IN ('REQUESTED','UNKNOWN');`,
    `DROP TRIGGER IF EXISTS trg_payment_refunds_updated_at ON payment_refunds;`,
    `CREATE TRIGGER trg_payment_refunds_updated_at
       BEFORE UPDATE ON payment_refunds
       FOR EACH ROW EXECUTE PROCEDURE set_updated_at();`,

    // Flujo manual (WhatsApp/transferencia) como respaldo activable desde el panel.
    `INSERT INTO system_config (key, value) VALUES ('payments_manual_enabled', 'true') ON CONFLICT (key) DO NOTHING;`,
  ];
}

// Clave del advisory lock que serializa la aplicación del esquema entre
// procesos de Passenger que arrancan al mismo tiempo.
const MIGRATION_LOCK_NAME = "dulcemaria_schema_migrations";

function envFlag(name, env = process.env) {
  const value = String(env[name] ?? "").trim().toLowerCase();
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

/** Estricto por defecto fuera de producción; MIGRATIONS_STRICT=true|false lo fuerza. */
function migrationsStrictMode(env = process.env) {
  const flag = envFlag("MIGRATIONS_STRICT", env);
  return flag === null ? !isProductionMode(env) : flag;
}

async function readMigrationState(client) {
  const rel = await client.query("SELECT to_regclass('public.schema_migration_state') AS rel");
  if (!rel.rows[0].rel) return null;
  const r = await client.query(
    "SELECT fingerprint, applied_at, statements_total, failures FROM schema_migration_state WHERE id = 1"
  );
  return r.rows[0] || null;
}

function reportPersistedFailures(state) {
  const failures = Array.isArray(state?.failures) ? state.failures : [];
  if (!failures.length) return;
  console.error(
    `❌ El esquema se aplicó con ${failures.length} sentencia(s) fallida(s) (${new Date(state.applied_at).toISOString()}): ` +
      failures.map((f) => `${f.id} [${f.code || "sin código"}]`).join(", ")
  );
  console.error(
    '   Revisa "npm run db:validate", corrige la causa (datos heredados, permisos) y reinicia con MIGRATIONS_FORCE=true.'
  );
}

/**
 * Aplica el esquema canónico. Ver la política al inicio del archivo.
 * @param {{ strict?: boolean, force?: boolean }} [options]
 */
async function runCompleteMigrations({
  strict = migrationsStrictMode(),
  force = envFlag("MIGRATIONS_FORCE") === true,
} = {}) {
  const statements = buildMigrationStatements();
  const fingerprint = computeSchemaFingerprint(statements);
  const shortFingerprint = fingerprint.slice(0, 12);
  const pool = getPool();
  const client = await pool.connect();
  let brokenConnection;

  try {
    // Camino rápido sin transacción ni bloqueos: nada cambió desde la última vez.
    if (!force) {
      const state = await readMigrationState(client);
      if (state && state.fingerprint === fingerprint) {
        reportPersistedFailures(state);
        console.log(`✅ Esquema al día (huella ${shortFingerprint}); no se ejecutó DDL.`);
        return { skipped: true, fingerprint, failures: state.failures || [] };
      }
    }

    console.log(
      `🔄 Aplicando esquema canónico (huella ${shortFingerprint}, ${statements.length} sentencias, modo ${strict ? "estricto" : "tolerante"})...`
    );
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = '120s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", [MIGRATION_LOCK_NAME]);

    // Otro proceso pudo aplicar esta misma versión mientras esperábamos el lock.
    if (!force) {
      const state = await readMigrationState(client);
      if (state && state.fingerprint === fingerprint) {
        await client.query("COMMIT");
        reportPersistedFailures(state);
        console.log(`✅ Esquema ya aplicado por otro proceso (huella ${shortFingerprint}).`);
        return { skipped: true, fingerprint, failures: state.failures || [] };
      }
    }

    // Un DDL que no obtiene su lock en 5 s falla (y se reintenta en el próximo
    // arranque) en vez de dejar encoladas las consultas del sitio detrás de él.
    await client.query("SET LOCAL lock_timeout = '5s'");

    const failures = [];
    for (let i = 0; i < statements.length; i++) {
      const id = `#${i + 1} ${describeStatement(statements[i])}`;
      const savepoint = `sp_mig_${i}`;
      await client.query(`SAVEPOINT ${savepoint}`);
      try {
        await client.query(statements[i]);
        await client.query(`RELEASE SAVEPOINT ${savepoint}`);
      } catch (stmtError) {
        await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        const failure = {
          id,
          code: stmtError.code || null,
          message: String(stmtError.message || stmtError),
          transient: isTransientDbError(stmtError.code),
        };
        failures.push(failure);
        console.error(`❌ Migración: falló la sentencia ${id} [${failure.code || "sin código"}]: ${failure.message}`);
        if (strict) {
          const fatal = new Error(
            `Migración abortada (modo estricto): la sentencia ${id} falló [${failure.code || "sin código"}]: ${failure.message}`
          );
          fatal.migrationFailure = failure;
          throw fatal;
        }
      }
    }

    const transientFailures = failures.filter((f) => f.transient);
    if (transientFailures.length === 0) {
      const persisted = failures.map(({ id, code, message }) => ({ id, code, message }));
      await client.query("SAVEPOINT sp_mig_state");
      try {
        await client.query(
          `INSERT INTO schema_migration_state (id, fingerprint, applied_at, statements_total, failures)
           VALUES (1, $1, NOW(), $2, $3::jsonb)
           ON CONFLICT (id) DO UPDATE
             SET fingerprint = EXCLUDED.fingerprint, applied_at = EXCLUDED.applied_at,
                 statements_total = EXCLUDED.statements_total, failures = EXCLUDED.failures`,
          [fingerprint, statements.length, JSON.stringify(persisted)]
        );
        await client.query("RELEASE SAVEPOINT sp_mig_state");
      } catch (stateError) {
        await client.query("ROLLBACK TO SAVEPOINT sp_mig_state");
        console.error(`❌ No se pudo registrar la huella del esquema [${stateError.code || "sin código"}]: ${stateError.message}`);
      }
    }

    await client.query("COMMIT");

    if (failures.length === 0) {
      console.log(`✅ Esquema aplicado: ${statements.length}/${statements.length} sentencias sin errores.`);
    } else {
      console.error(
        `❌ Esquema aplicado con ${failures.length} fallo(s) de ${statements.length} sentencias. La API arranca igual (modo tolerante).`
      );
      if (transientFailures.length) {
        console.error("   Hubo fallos transitorios (bloqueos/timeouts): se reintentará en el próximo arranque.");
      }
    }
    return { skipped: false, fingerprint, failures };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      brokenConnection = rollbackError;
    }
    throw error;
  } finally {
    client.release(brokenConnection);
  }
}

module.exports = { runCompleteMigrations, buildMigrationStatements, migrationsStrictMode };
