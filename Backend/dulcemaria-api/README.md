# Dulce María Repostería - Backend API

API REST para la gestión de productos, clientes y ventas de Dulce María Repostería.

**Versión:** 2.0.0-security  
**Node.js:** v20.19.4  
**PostgreSQL:** 10.23+

---

## 🚀 Inicio Rápido

### 1. Instalar Dependencias

```bash
cd Backend/dulcemaria-api
npm install
```

### 2. Configurar Variables de Entorno

Crea un archivo `.env` en la raíz del proyecto (no commitear):

```env
NODE_ENV=production

# Base de datos
DATABASE_URL=postgresql://hernanci_hernan:PASSWORD@localhost:5432/hernanci_dulcemaria?schema=public

# JWT (mínimo 32 caracteres)
JWT_SECRET=tu_secret_muy_largo_y_seguro_minimo_32_caracteres

# Admin inicial (para bootstrap)
ADMIN_EMAIL=tu_correo@dominio.com
ADMIN_PASSWORD=tu_clave_super_segura

# Bootstrap token (para crear superadmin)
BOOTSTRAP_TOKEN=token_secreto_para_bootstrap

# Frontend URL (para CORS)
FRONTEND_URL=https://hrcastell.com
```

### 3. Ejecutar Migraciones

```bash
npm run db:migrate
```

Esto creará todas las tablas, índices y triggers necesarios.

### 4. Validar Schema

```bash
npm run db:validate
```

Verifica que la base de datos esté correctamente configurada.

### 5. Crear Superadmin (solo primera vez)

Accede a:
```
POST http://tu-dominio.com/auth/bootstrap?token=tu_BOOTSTRAP_TOKEN
```

Esto creará el usuario SUPERADMIN inicial.

### 6. Iniciar Servidor

```bash
npm start
```

El servidor iniciará en el puerto 3000 (o el configurado en `PORT`).

---

## 📁 Estructura del Proyecto

```
dulcemaria-api/
├── src/
│   ├── config/
│   │   └── env.js              # Validación de variables de entorno
│   │
│   ├── middleware/
│   │   ├── auth.js             # Autenticación JWT + roles
│   │   ├── rate-limit.js       # Rate limiting
│   │   └── validate-uuid.js    # Validación de UUIDs
│   │
│   ├── routes/
│   │   ├── auth.js             # Login, bootstrap
│   │   ├── public.catalog.js   # Catálogo público
│   │   ├── admin.users.js      # CRUD usuarios
│   │   ├── admin.products.js   # CRUD productos + imágenes
│   │   ├── admin.customers.js  # CRUD clientes
│   │   ├── admin.orders.js     # CRUD ventas/pedidos
│   │   └── admin.reports.js    # Reportes
│   │
│   ├── migrations/
│   │   ├── complete.js         # Migración completa canonical
│   │   └── sales.js            # (deprecado - usar complete.js)
│   │
│   ├── utils/
│   │   ├── password.js         # Hash y verificación passwords
│   │   └── slug.js             # Generación de slugs
│   │
│   └── db.js                   # Pool de conexiones PostgreSQL
│
├── scripts/
│   ├── migrate-complete.js     # Ejecuta migración completa
│   ├── validate-schema.js      # Valida schema de BD
│   ├── init-db.js              # (legacy)
│   └── seed-superadmin.js      # (legacy)
│
├── uploads/                    # Imágenes subidas
├── server.js                   # Punto de entrada
├── package.json
├── .env.example
└── CHANGES.md                  # Log de cambios v2.0

```

---

## 🔑 Autenticación

### Login

```bash
POST /auth/login
Content-Type: application/json

{
  "email": "usuario@dominio.com",
  "password": "contraseña"
}
```

**Response:**
```json
{
  "ok": true,
  "token": "eyJhbGc...",
  "user": {
    "id": "uuid",
    "email": "usuario@dominio.com",
    "role": "ADMIN"
  }
}
```

### Usar Token

Incluir en todos los requests a `/admin/*`:

```
Authorization: Bearer eyJhbGc...
```

### Roles

- **SUPERADMIN:** Acceso total
- **ADMIN:** Gestión de productos, clientes y ventas
- **STAFF:** Solo lectura y creación de ventas

---

## 🛡️ Seguridad

### Rate Limiting

- **Login:** 5 intentos / 15 minutos
- **Bootstrap:** 3 intentos / 1 hora
- **Catálogo público:** 100 requests / minuto
- **Admin API:** 200 requests / minuto

### CORS

Solo permite requests desde:
- `http://localhost:3000` (dev)
- `http://localhost:5173` (Vite dev)
- `https://hrcastell.com`
- `https://www.hrcastell.com`
- Variable `FRONTEND_URL`

### Validaciones

- JWT_SECRET mínimo 32 caracteres
- Todos los UUIDs validados antes de usar
- Passwords hasheados con bcryptjs (12 rounds)
- Queries SQL con parámetros preparados

---

## 📡 Endpoints

### Públicos (sin autenticación)

#### Health Check
```
GET /health
```

#### DB Check
```
GET /db-check
```

#### Catálogo Público
```
GET /catalog/products
```

### Auth

#### Login
```
POST /auth/login
Body: { email, password }
```

#### Bootstrap (solo primera vez)
```
POST /auth/bootstrap?token=BOOTSTRAP_TOKEN
```

### Admin - Productos

```
GET    /admin/products                    # Listar todos
POST   /admin/products                    # Crear
PUT    /admin/products/:id                # Actualizar
GET    /admin/products/:id/images         # Listar imágenes
POST   /admin/products/:id/images         # Subir imágenes (max 8)
PATCH  /admin/products/images/:id/primary # Marcar como principal
DELETE /admin/products/images/:id         # Eliminar imagen
```

### Admin - Clientes

```
GET    /admin/customers?q=busqueda        # Listar/buscar
POST   /admin/customers                   # Crear
```

### Admin - Ventas/Órdenes

```
GET    /admin/orders?from&to&status       # Listar con filtros
GET    /admin/orders/:id                  # Detalle de orden
POST   /admin/orders                      # Crear venta (descuenta stock)
PATCH  /admin/orders/:id/status           # Cambiar estado
```

### Admin - Reportes

```
GET    /admin/reports/daily?date=YYYY-MM-DD  # Ventas del día + top productos
```

---

## 🗃️ Base de Datos

### Tablas

- **users** - Usuarios del sistema (admin)
- **products** - Productos del catálogo
- **product_images** - Imágenes de productos (hasta 8)
- **customers** - Clientes
- **orders** - Ventas/pedidos (cabecera)
- **order_items** - Detalle de ventas (líneas)

### Migraciones

Las migraciones se ejecutan automáticamente al iniciar el servidor.

Para ejecutar manualmente:
```bash
npm run db:migrate
```

Para validar schema:
```bash
npm run db:validate
```

---

## 🛠️ Scripts Disponibles

```bash
npm start                 # Iniciar servidor
npm run db:migrate        # Ejecutar migraciones
npm run db:validate       # Validar schema
npm run db:init           # (legacy) Inicializar BD
npm run seed:superadmin   # (legacy) Crear superadmin
```

---

## 🐛 Troubleshooting

### Error: "Missing required environment variable"

Verifica que `.env` tenga todas las variables requeridas:
- `DATABASE_URL`
- `JWT_SECRET` (min 32 caracteres)

### Error: "JWT_SECRET must be at least 32 characters"

Tu `JWT_SECRET` es muy corto. Genera uno nuevo:

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

### Error: "Migration failed"

Revisa que:
1. PostgreSQL esté corriendo
2. `DATABASE_URL` sea correcta
3. Usuario de BD tenga permisos de CREATE TABLE

### Error: "Origin not allowed by CORS"

Agrega tu frontend URL a la whitelist en `server.js` o configura `FRONTEND_URL` en `.env`.

### Rate limit excedido

Espera el tiempo indicado en el mensaje de error. En desarrollo, puedes incrementar los límites en `src/middleware/rate-limit.js`.

---

## 📦 Dependencias Principales

```json
{
  "express": "^4.21.2",
  "pg": "^8.11.5",
  "jsonwebtoken": "^9.0.2",
  "bcryptjs": "^2.4.3",
  "zod": "^3.23.8",
  "helmet": "^7.1.0",
  "cors": "^2.8.5",
  "express-rate-limit": "^7.1.5",
  "multer": "^1.4.5-lts.1"
}
```

---

## 🚧 Roadmap

### ✅ v2.0 - Security & Migrations (COMPLETADO)
- [x] Migraciones completas e idempotentes
- [x] Validación de variables de entorno
- [x] Rate limiting
- [x] CORS restrictivo
- [x] Validación de UUIDs

### 🔄 v2.1 - Architecture (EN PROGRESO)
- [ ] Refactor a capas (services/repositories)
- [ ] Validators separados
- [ ] Logging estructurado (Winston)
- [ ] Tests con Jest

### 📋 v2.2 - Features
- [ ] Generación de thumbnails
- [ ] Cache con Redis
- [ ] Background jobs
- [ ] Documentación Swagger

---

## 📄 Licencia

Privado - Uso personal de Dulce María Repostería

---

## 👤 Autor

Hernán Ricardo  
Dulce María Repostería

---

## 📞 Soporte

Para issues o preguntas, revisar:
- `CHANGES.md` - Log de cambios
- `docs/` - Documentación adicional (próximamente)
