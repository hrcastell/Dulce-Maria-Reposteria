# Dulce María Repostería — Backend (Norte, Esquema y Plan de Trabajo)

> Fecha: 2026-02-06  
> Objetivo de este documento: **alinear el norte**, dejar un **esquema único (canonical)** de base de datos y un **plan de migraciones** para cerrar backend sin “parches” dispersos.

---

## 1) Propósito de la aplicación (el norte)

**Dulce María Repostería** es una aplicación web para:

1. **Promocionar y vender** postres mediante un catálogo público (landing + catálogo + carrito + checkout).
2. Tener un **portal administrativo** (solo usuarios autorizados) para:
   - CRUD de productos e imágenes (hasta 8 imágenes por producto).
   - CRUD y búsqueda de clientes.
   - Registro de **ventas/pedidos** (orders) con detalle (order_items).
   - Reportes: ventas del día, top productos, métricas básicas.

### Principios
- **Portal admin** protegido por JWT y roles.
- **Datos consistentes**: ventas y descuentos de stock se ejecutan en **transacciones**.
- **Cero cambios manuales** en BD: todo se aplica mediante **migraciones idempotentes** al iniciar la app.

---

## 2) Módulos (backend)

### Público (web)
- Catálogo público de productos activos.
- (Opcional, si se habilita checkout público) creación de pedido web.

### Admin (portal)
- Autenticación
- Gestión de usuarios (alta por SUPERADMIN)
- Productos + imágenes
- Clientes
- Ventas / pedidos
- Reportes

---

## 3) Esquema Canonical (Base de Datos)

**Esquema:** `public`  
**DB:** `hernanci_dulcemaria` (PostgreSQL)

> Nota: este es el **único diseño válido** de aquí en adelante.  
> Si la BD actual no coincide, se corrige con **una migración única** (idempotente) que:
> - cree tablas faltantes
> - agregue columnas faltantes
> - cree índices
> - cree triggers

---

## 4) Tablas y campos (definitivo)

### 4.1 users
Usuarios del portal (admin).

| Campo | Tipo | Reglas |
|---|---|---|
| id | UUID (PK) | generado por app |
| email | TEXT | UNIQUE, NOT NULL |
| password_hash | TEXT | NOT NULL |
| full_name | TEXT | NULL |
| role | TEXT | NOT NULL, DEFAULT 'STAFF' (CHECK IN 'SUPERADMIN','ADMIN','STAFF') |
| is_active | BOOLEAN | NOT NULL DEFAULT true |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL DEFAULT now() |

Índices: `users(email)` unique.

---

### 4.2 products
Productos del catálogo.

| Campo | Tipo | Reglas |
|---|---|---|
| id | UUID (PK) | generado por app |
| name | TEXT | NOT NULL |
| slug | TEXT | UNIQUE, NOT NULL (para URLs amigables) |
| description | TEXT | NULL |
| price_clp | INT | NOT NULL (>=0) |
| stock_qty | INT | NOT NULL DEFAULT 0 (>=0) |
| is_active | BOOLEAN | NOT NULL DEFAULT true |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL DEFAULT now() |

Índices: `products(is_active)`, `products(created_at)`.

---

### 4.3 product_images
Hasta 8 imágenes por producto.

| Campo | Tipo | Reglas |
|---|---|---|
| id | UUID (PK) | generado por app |
| product_id | UUID (FK) | NOT NULL → products(id), ON DELETE CASCADE |
| url | TEXT | NOT NULL |
| url_thumb | TEXT | NULL |
| sort_order | INT | NOT NULL DEFAULT 0 |
| is_primary | BOOLEAN | NOT NULL DEFAULT false |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT now() |

Índices: `product_images(product_id)`, `product_images(product_id, is_primary)`.

> Convención de storage: `/uploads/products/<productId>/<filename>.jpg`

---

### 4.4 customers
Clientes (admin y/o checkout web).

| Campo | Tipo | Reglas |
|---|---|---|
| id | UUID (PK) | generado por app |
| email | TEXT | UNIQUE, NULL (permitimos cliente sin email) |
| full_name | TEXT | NOT NULL |
| phone | TEXT | NULL |
| address | TEXT | NULL |
| notes | TEXT | NULL |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL DEFAULT now() |

Índices: `customers(email)` unique.

---

### 4.5 orders  ✅ (ventas / pedidos)
Cabecera de venta.

| Campo | Tipo | Reglas |
|---|---|---|
| id | UUID (PK) | generado por app |
| order_no | BIGINT | identity, UNIQUE |
| customer_id | UUID (FK) | NOT NULL → customers(id) |
| status | TEXT | NOT NULL DEFAULT 'PENDING_CONFIRMATION' (CHECK) |
| payment_status | TEXT | NOT NULL DEFAULT 'PENDING' (CHECK) |
| payment_method | TEXT | NOT NULL DEFAULT 'TRANSFER' (CHECK) |
| delivery_method | TEXT | NOT NULL DEFAULT 'PICKUP' (CHECK) |
| subtotal_clp | INT | NOT NULL DEFAULT 0 |
| delivery_fee_clp | INT | NOT NULL DEFAULT 0 |
| total_clp | INT | NOT NULL DEFAULT 0 |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT now() |
| updated_at | TIMESTAMPTZ | NOT NULL DEFAULT now() |

**Enumeraciones (CHECK)**
- `status`: 'PENDING_CONFIRMATION','CONFIRMED','PREPARING','READY','DELIVERED','CANCELLED'
- `payment_status`: 'PENDING','PAID','FAILED','REFUNDED'
- `payment_method`: 'TRANSFER','CASH','ONLINE'
- `delivery_method`: 'PICKUP','DELIVERY'

Índices: `orders(created_at)`, `orders(customer_id)`, `orders(status)`.

---

### 4.6 order_items  ✅ (detalle de venta)
Detalle por producto vendido.

| Campo | Tipo | Reglas |
|---|---|---|
| id | UUID (PK) | generado por app |
| order_id | UUID (FK) | NOT NULL → orders(id), ON DELETE CASCADE |
| product_id | UUID (FK) | NOT NULL → products(id) |
| product_name_snapshot | TEXT | NOT NULL |
| unit_price_clp | INT | NOT NULL |
| qty | INT | NOT NULL CHECK (qty > 0) |
| line_total_clp | INT | NOT NULL |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT now() |

Índices: `order_items(order_id)`, `order_items(product_id)`.

---

## 5) Reglas de negocio críticas

### Crear venta/pedido
- Validar productos activos + stock suficiente
- Calcular subtotal/total
- Transacción: insertar order + items + descontar stock
- Stock insuficiente → 400 con mensaje claro

---

## 6) Endpoints (contract)

**Auth**
- `POST /auth/login`

**Admin**
- `POST /admin/customers`
- `GET /admin/customers?q=`
- `POST /admin/orders`
- `GET /admin/orders?from&to&status`
- `GET /admin/orders/:id`
- `PATCH /admin/orders/:id/status`
- `GET /admin/reports/daily?date=YYYY-MM-DD`

---

## 7) Plan de migración (sin ejecución manual)

### Problema actual
Error:
> `column "payment_status" of relation "orders" does not exist`

Esto indica que tu tabla `orders` real está incompleta vs el schema canonical.

### Estrategia
- Mantener **una sola migración canonical** al iniciar la app.
- Esa migración debe hacer:
  - `CREATE TABLE IF NOT EXISTS ...`
  - `ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...` para TODAS las columnas canonical
  - Triggers `updated_at` (con compatibilidad Postgres antiguo usando `EXECUTE PROCEDURE`)

### Definition of Done (cierre backend)
- Migración aplica OK (log: “Sales migrations OK”)
- `POST /admin/orders` crea venta y descuenta stock
- `GET /admin/orders/:id` devuelve items
- `GET /admin/reports/daily` devuelve totales y top productos

---

**Fin.**
