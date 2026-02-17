# Instalación en cPanel (SIN acceso a terminal)

Guía completa para instalar el refactor v2.0 en cPanel sin acceso a terminal.

---

## 📋 Requisitos Previos

- ✅ Acceso a cPanel con File Manager
- ✅ Node.js App configurada en cPanel
- ✅ Acceso a la sección "Environment Variables" de tu app Node.js
- ✅ Cliente FTP o File Manager de cPanel

---

## 🔧 PASO 1: Subir Archivos al Servidor

### Archivos a Subir/Reemplazar

#### ✨ Nuevos archivos (crear carpetas si no existen):
```
src/config/env.js
src/middleware/rate-limit.js
src/middleware/validate-uuid.js
src/migrations/complete.js
scripts/migrate-complete.js
scripts/validate-schema.js
CHANGES.md
README.md
INSTALL_CPANEL.md (este archivo)
```

#### 🔄 Archivos existentes a REEMPLAZAR:
```
server.js
package.json
src/routes/auth.js
src/routes/admin.products.js
src/routes/admin.orders.js
```

### Cómo Subir

**Opción A: File Manager de cPanel**

1. Inicia sesión en **cPanel**
2. Abre **File Manager**
3. Navega a la carpeta de tu app (ej: `public_html/dulcemaria-api/`)
4. Para cada archivo:
   - Si es nuevo: Click **"Upload"**, selecciona el archivo
   - Si existe: Selecciona el archivo existente → **"Delete"** → sube el nuevo

**Opción B: FTP (FileZilla, WinSCP)**

1. Conecta via FTP a tu servidor
2. Navega a la carpeta de tu app Node.js
3. Arrastra y suelta los archivos (sobrescribe los existentes)

---

## 🔑 PASO 2: Configurar Variables de Entorno

**⚠️ CRÍTICO:** En cPanel NO uses archivo `.env`. Debes configurar las variables en la interfaz de Node.js App.

### 2.1 Acceder a Configuración

1. En cPanel, busca **"Setup Node.js App"** o **"Node.js Selector"**
2. Click en tu aplicación existente (dulcemaria-api)
3. Busca la sección **"Environment Variables"**

### 2.2 Agregar Variables Requeridas

Click en **"Add Variable"** para cada una:

| Variable | Valor | Notas Importantes |
|----------|-------|-------------------|
| `NODE_ENV` | `production` | Sin comillas |
| `DATABASE_URL` | `postgresql://usuario:password@localhost:5432/dulcemaria` | Usa tus credenciales REALES |
| `JWT_SECRET` | *genera uno* | **Mínimo 32 caracteres** Ver 👇 |
| `ADMIN_EMAIL` | `tu_email@dominio.com` | Para crear superadmin (si aún no tienes) |
| `ADMIN_PASSWORD` | `Clave$egura123!` | Mínimo 8 caracteres (si aún no tienes) |
| `BOOTSTRAP_TOKEN` | `secreto-bootstrap-456` | **OPCIONAL** - Solo si vas a usar /auth/bootstrap |
| `FRONTEND_URL` | `https://hrcastell.com` | **OPCIONAL** - Para CORS, sin barra final |
| `PORT` | `3000` | **OPCIONAL** - O el puerto que uses |

**Nota:** Si ya tienes el usuario SUPERADMIN creado, puedes omitir `BOOTSTRAP_TOKEN`, `ADMIN_EMAIL` y `ADMIN_PASSWORD`.

#### 🔐 Generar JWT_SECRET Seguro

Opción 1 - Consola del navegador (F12):
```javascript
Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('')
```

Opción 2 - Generador online:
- Ve a: https://www.uuidgenerator.net/
- Genera 2 UUIDs
- Junta ambos (64 caracteres)
- Ejemplo: `a1b2c3d4-e5f6-7890-abcd-ef1234567890-9876fedc-ba09-8765-4321-0fedcba98765`

### 2.3 Guardar y Verificar

1. Después de agregar TODAS las variables, click **"Save"**
2. Verifica que aparezcan todas en la lista
3. **NO reinicies todavía** (falta instalar dependencias)

---

## 📦 PASO 3: Instalar Nueva Dependencia (express-rate-limit)

### Opción A: Botón "Run NPM Install" (RECOMENDADO)

1. En **Setup Node.js App**, busca el botón **"Run NPM Install"** o **"Install Dependencies"**
2. Click en ese botón
3. Espera 1-2 minutos (verás un spinner o loading)
4. Debe aparecer mensaje de éxito

### Opción B: Si NO hay botón NPM Install

Voy a crear un endpoint auxiliar temporal para instalar dependencias.

**Sube este archivo:** `scripts/install-helper.js`

```javascript
require("dotenv").config();
const { exec } = require("child_process");
const express = require("express");
const app = express();

app.get("/install-deps-now", (req, res) => {
  if (req.query.token !== process.env.BOOTSTRAP_TOKEN) {
    return res.status(403).send("Forbidden");
  }

  console.log("📦 Installing dependencies...");
  
  exec("npm install", { cwd: __dirname + "/.." }, (error, stdout, stderr) => {
    if (error) {
      return res.status(500).send(`ERROR: ${error.message}\n\n${stderr}`);
    }
    res.send(`SUCCESS!\n\n${stdout}`);
  });
});

app.listen(3001, () => console.log("Install helper on port 3001"));
```

**Pasos:**
1. Sube `scripts/install-helper.js`
2. En Node.js App Manager, cambia temporalmente "Application Startup File" a `scripts/install-helper.js`
3. Click "Restart"
4. Accede a: `https://tu-dominio.com/install-deps-now?token=TU_BOOTSTRAP_TOKEN`
5. Espera a ver "SUCCESS!" en el navegador
6. Vuelve a cambiar "Application Startup File" a `server.js`
7. **ELIMINA** `scripts/install-helper.js`

---

## 🗃️ PASO 4: Ejecutar Migraciones de Base de Datos

Como no tienes terminal, usaremos un endpoint web temporal.

### 4.1 Crear Helper de Migraciones

**Sube este archivo:** `scripts/migrate-helper.js`

```javascript
require("dotenv").config();
const express = require("express");
const { runCompleteMigrations } = require("../src/migrations/complete");

const app = express();

app.get("/run-migrations-now", async (req, res) => {
  if (req.query.token !== process.env.BOOTSTRAP_TOKEN) {
    return res.status(403).send("Forbidden - Invalid token");
  }

  console.log("🚀 Running database migrations...");
  
  try {
    await runCompleteMigrations();
    res.send(`
      ✅ MIGRATIONS COMPLETED SUCCESSFULLY!
      
      Database is now up to date with:
      - All tables created
      - All columns added
      - All indexes created
      - All triggers created
      
      You can now proceed to STEP 5.
    `);
  } catch (error) {
    res.status(500).send(`
      ❌ MIGRATION FAILED
      
      Error: ${error.message}
      
      Stack:
      ${error.stack}
    `);
  }
});

app.listen(3002, () => console.log("Migration helper on port 3002"));
```

### 4.2 Ejecutar Migraciones

**Pasos:**

1. Sube `scripts/migrate-helper.js` a tu servidor
2. En **Node.js App Manager**:
   - Cambia "Application Startup File" a `scripts/migrate-helper.js`
   - Click **"Restart"**
3. Espera 10 segundos
4. Accede en tu navegador a: 
   ```
   https://tu-dominio.com/run-migrations-now?token=TU_BOOTSTRAP_TOKEN
   ```
5. Deberías ver en pantalla:
   ```
   ✅ MIGRATIONS COMPLETED SUCCESSFULLY!
   ```

### 4.3 Si ves errores

Si aparece un error:
1. **Copia todo el mensaje de error**
2. Verifica que `DATABASE_URL` esté correcta
3. Verifica que el usuario de BD tenga permisos de CREATE TABLE

### 4.4 Restaurar Configuración

1. En Node.js App Manager
2. Cambia "Application Startup File" de vuelta a `server.js`
3. **NO reinicies todavía**

### 4.5 Limpiar

**ELIMINA** el archivo `scripts/migrate-helper.js` (por seguridad)

---

## ✅ PASO 5: Validar Schema (Opcional pero Recomendado)

Verifica que las migraciones se aplicaron correctamente.

### 5.1 Crear Helper de Validación

**Sube este archivo:** `scripts/validate-helper.js`

```javascript
require("dotenv").config();
const express = require("express");
const { getPool } = require("../src/db");

const app = express();

app.get("/validate-schema-now", async (req, res) => {
  if (req.query.token !== process.env.BOOTSTRAP_TOKEN) {
    return res.status(403).send("Forbidden");
  }

  const pool = getPool();
  const results = [];

  try {
    // Verificar tablas
    const tables = ["users", "products", "product_images", "customers", "orders", "order_items"];
    
    for (const table of tables) {
      const r = await pool.query(
        `SELECT EXISTS (
          SELECT 1 FROM information_schema.tables 
          WHERE table_schema = 'public' AND table_name = $1
        )`,
        [table]
      );
      const exists = r.rows[0].exists;
      results.push(`${exists ? '✅' : '❌'} Table: ${table}`);
    }

    // Verificar product_images tiene las columnas correctas
    const cols = await pool.query(
      `SELECT column_name FROM information_schema.columns 
       WHERE table_name = 'product_images' 
       ORDER BY ordinal_position`
    );
    
    results.push('\n📋 product_images columns:');
    cols.rows.forEach(c => results.push(`   - ${c.column_name}`));

    res.send(results.join('\n'));
  } catch (error) {
    res.status(500).send(`ERROR: ${error.message}`);
  }
});

app.listen(3003, () => console.log("Validation helper on port 3003"));
```

### 5.2 Ejecutar Validación

1. Sube `scripts/validate-helper.js`
2. Cambia "Application Startup File" a `scripts/validate-helper.js`
3. Restart
4. Accede a: `https://tu-dominio.com/validate-schema-now?token=TU_BOOTSTRAP_TOKEN`
5. Verifica que todas las tablas tengan ✅
6. Restaura "Application Startup File" a `server.js`
7. **ELIMINA** `scripts/validate-helper.js`

---

## 🚀 PASO 6: Reiniciar Aplicación Final

### 6.1 Verificar Configuración

Antes de reiniciar, verifica:
- ✅ Todos los archivos subidos
- ✅ Todas las variables de entorno configuradas
- ✅ `express-rate-limit` instalado (PASO 3)
- ✅ Migraciones ejecutadas (PASO 4)
- ✅ "Application Startup File" = `server.js`

### 6.2 Reiniciar

1. En **Node.js App Manager**
2. Click **"Restart"**
3. Espera 10-15 segundos

### 6.3 Verificar que Inició

Accede a:
```
https://tu-dominio.com/health
```

**Respuesta esperada:**
```json
{
  "ok": true,
  "service": "dulcemaria-api",
  "build": "2026-02-05-fixed",
  "time": "2026-02-07T19:30:00.000Z"
}
```

### 6.4 Si ves Error 502/503

1. Ve a Node.js App Manager → **"Error Log"**
2. Busca el último error
3. Errores comunes:
   - `Missing required environment variable` → Revisa PASO 2
   - `Cannot find module 'express-rate-limit'` → Revisa PASO 3
   - `column does not exist` → Revisa PASO 4

---

## 🔐 PASO 7: Crear Usuario SUPERADMIN

Con la app corriendo, crea tu superadmin usando Postman o Thunder Client.

### 7.1 Con Postman

1. Abre **Postman**
2. Nueva Request:
   - Método: **POST**
   - URL: `https://tu-dominio.com/auth/bootstrap?token=TU_BOOTSTRAP_TOKEN`
     - Reemplaza `TU_BOOTSTRAP_TOKEN` con el valor real de tu variable `BOOTSTRAP_TOKEN`
3. Click **"Send"**

**Respuesta esperada:**
```json
{
  "ok": true,
  "message": "SUPERADMIN listo.",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "a1b2c3d4-...",
    "email": "tu_email@dominio.com",
    "role": "SUPERADMIN"
  }
}
```

### 7.2 Con Thunder Client (VSCode Extension)

1. Instala "Thunder Client" en VSCode
2. Nueva Request
3. POST a `https://tu-dominio.com/auth/bootstrap?token=TU_BOOTSTRAP_TOKEN`
4. Send

### 7.3 Guardar el Token

**IMPORTANTE:** Copia y guarda el `token` que te devuelve. Lo necesitarás para hacer login.

---

## 🧪 PASO 8: Verificar Funcionamiento Completo

### Test 1: Health Check ✅

```
GET https://tu-dominio.com/health
```

Debe responder 200 OK.

### Test 2: DB Check ✅

```
GET https://tu-dominio.com/db-check
```

Debe responder:
```json
{
  "ok": true,
  "dbTime": "2026-02-07..."
}
```

### Test 3: Login ✅

Postman POST:
```
URL: https://tu-dominio.com/auth/login
Body (JSON):
{
  "email": "tu_email@dominio.com",
  "password": "tu_contraseña"
}
```

Debe devolver token JWT.

### Test 4: Catálogo Público ✅

```
GET https://tu-dominio.com/catalog/products
```

Debe devolver lista de productos (puede estar vacía al inicio).

### Test 5: Admin API ✅

Postman GET:
```
URL: https://tu-dominio.com/admin/products
Headers:
  Authorization: Bearer TU_TOKEN_JWT
```

Debe devolver 200 OK con lista de productos.

### Test 6: Rate Limiting ✅

Intenta hacer login 6 veces con password incorrecta.

En el 6to intento debes ver:
```json
{
  "ok": false,
  "error": "Demasiados intentos de login. Intenta de nuevo en 15 minutos."
}
```

Esto confirma que rate limiting está activo. ✅

---

## 🎉 ¡Instalación Completada!

Si todos los tests pasaron:

✅ Backend v2.0 instalado correctamente  
✅ Migraciones aplicadas (todas las tablas creadas)  
✅ Seguridad activa (rate limiting, CORS, UUID validation)  
✅ Variables de entorno configuradas  
✅ Superadmin creado  
✅ API funcionando  

---

## 🧹 PASO 9: Limpieza y Seguridad

### 9.1 Eliminar Archivos Temporales

Asegúrate de haber eliminado:
- ❌ `scripts/install-helper.js` (si lo creaste)
- ❌ `scripts/migrate-helper.js`
- ❌ `scripts/validate-helper.js`

### 9.2 Desactivar Bootstrap (Recomendado)

Después de crear el superadmin, desactiva el endpoint bootstrap:

1. En Node.js App Manager → Environment Variables
2. Agrega nueva variable:
   - Name: `BOOTSTRAP_ENABLED`
   - Value: `false`
3. Save
4. Restart app

Ahora el endpoint `/auth/bootstrap` estará deshabilitado (más seguro).

### 9.3 Backup de Base de Datos

1. En cPanel, busca **phpPgAdmin** o **PostgreSQL Databases**
2. Selecciona tu base de datos `hernanci_dulcemaria`
3. Export → SQL → Download

Guarda este backup antes de hacer cambios futuros.

---

## 🔥 Troubleshooting

### Error: "Missing required environment variable: JWT_SECRET"

**Causa:** No configuraste las variables de entorno correctamente.

**Solución:**
1. Ve a Node.js App Manager → Environment Variables
2. Verifica que `JWT_SECRET` exista y tenga mínimo 32 caracteres
3. Save → Restart

### Error: "JWT_SECRET must be at least 32 characters long"

**Causa:** Tu JWT_SECRET es muy corto.

**Solución:**
1. Genera uno nuevo con 64 caracteres (ver PASO 2.2)
2. Actualiza la variable en Node.js App Manager
3. Restart

### Error: "Cannot find module 'express-rate-limit'"

**Causa:** No se instaló la dependencia.

**Solución:**
- Repite PASO 3
- Usa botón "Run NPM Install" o el helper temporal

### Error: "column 'is_primary' does not exist"

**Causa:** Las migraciones no se ejecutaron.

**Solución:**
- Repite PASO 4
- Verifica que viste el mensaje "MIGRATIONS COMPLETED SUCCESSFULLY"

### Error: "Origin not allowed by CORS"

**Causa:** Tu frontend no está en la whitelist.

**Solución:**
1. Agrega tu dominio frontend a `FRONTEND_URL` en variables de entorno
2. O edita `server.js` líneas 27-33 para agregar tu origen
3. Restart

### Error 502 Bad Gateway

**Causa:** La app no inició correctamente.

**Solución:**
1. Node.js App Manager → "Error Log"
2. Busca el error específico
3. Común: falta variable de entorno o error en código

### Rate Limit al Probar

Si te bloquea rate limiting durante tests:

**Solución temporal:**
1. Edita `src/middleware/rate-limit.js`
2. Cambia `max: 5` a `max: 100` en loginLimiter
3. Sube el archivo
4. Restart
5. Después de probar, vuelve a `max: 5`

---

## 📞 Soporte

Si algo no funciona:

1. **Copia el error completo** del Error Log
2. **Indica qué paso** estabas ejecutando
3. **Verifica** que seguiste todos los pasos en orden
4. **Revisa** que todas las variables de entorno estén configuradas

---

## 📝 Próximos Pasos

### Inmediato

1. ✅ Verifica que todo funciona con los 6 tests
2. ✅ Crea algunos productos de prueba
3. ✅ Haz backup de la BD
4. ✅ Documenta tus credenciales en lugar seguro

### Siguiente Fase

Una vez confirmado que todo funciona:

- **Fase 2:** Refactor a arquitectura de capas (services/repositories)
- **Fase 3:** Logging estructurado con Winston
- **Fase 4:** Testing con Jest
- **Fase 5:** Frontend con Vue.js

---

**Versión:** 1.0  
**Fecha:** 2026-02-07  
**Autor:** Hernán Ricardo  
**Proyecto:** Dulce María Repostería Backend v2.0
