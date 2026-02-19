# 🗄️ INSTRUCCIONES PARA RECREAR LA BASE DE DATOS

## 📋 Resumen

Este documento te guía paso a paso para crear una **nueva base de datos** con el usuario owner correcto, evitando problemas de permisos.

---

## ⚠️ IMPORTANTE - LEE ANTES DE COMENZAR

1. **NO borres** la base de datos actual hasta confirmar que la nueva funciona
2. La nueva BD se llamará `dulcemaria_db_v2` (puedes cambiar el nombre si deseas)
3. El nuevo usuario será `dulcemaria_owner` con permisos completos
4. Este proceso incluye la columna `permissions` desde el inicio (no necesitas migración)
5. Necesitarás acceso como usuario `postgres` (superusuario de PostgreSQL)

---

## 🔧 PASO 1: GENERAR HASH DE PASSWORD

Antes de ejecutar el SQL, genera el hash de tu password:

### En tu máquina local:

```bash
cd Backend/dulcemaria-api
node sql/generate_password_hash.js
```

**Sigue las instrucciones en pantalla:**
- Ingresa tu password (mínimo 8 caracteres)
- Copia el hash generado
- Guárdalo temporalmente

---

## 🗄️ PASO 2: PREPARAR EL SCRIPT SQL

1. Abre el archivo: `sql/recreate_database.sql`

2. **Busca la línea ~237** (sección de datos iniciales):
   ```sql
   '$2b$10$YourBcryptHashHere', -- REEMPLAZAR con hash real
   ```

3. **Reemplaza** con el hash que generaste en el Paso 1:
   ```sql
   '$2b$10$abc123DefGhI...', -- Tu hash real
   ```

4. **Opcional:** Cambia el password del role `dulcemaria_owner` (línea ~14):
   ```sql
   CREATE ROLE dulcemaria_owner WITH LOGIN PASSWORD 'TuPasswordSegura123!';
   ```
   ⚠️ Guarda este password, lo necesitarás para conectarte.

---

## 💻 PASO 3: EJECUTAR EL SCRIPT

### Opción A: Desde cPanel (Recomendado)

1. **Accede a cPanel → PostgreSQL Databases**

2. **Accede a phpPgAdmin o terminal**

3. **Conéctate como usuario postgres:**
   - Usuario: `postgres`
   - Password: (el que configuraste en PostgreSQL)

4. **Ejecuta el script completo:**
   - Copia todo el contenido de `recreate_database.sql`
   - Pégalo en la consola SQL
   - Click en "Execute" o presiona F5

### Opción B: Desde terminal local (si tienes acceso SSH)

```bash
# Conectarse como postgres
psql -U postgres

# Ejecutar el script
\i /ruta/completa/a/recreate_database.sql
```

---

## ✅ PASO 4: VERIFICAR LA CREACIÓN

Al final del script verás resultados de verificación:

### 1. Tablas creadas:
```
 schemaname | tablename      | tableowner
------------+----------------+-----------------
 public     | customers      | dulcemaria_owner
 public     | order_items    | dulcemaria_owner
 public     | orders         | dulcemaria_owner
 public     | payments       | dulcemaria_owner
 public     | product_images | dulcemaria_owner
 public     | products       | dulcemaria_owner
 public     | users          | dulcemaria_owner
```

### 2. Usuario SUPERADMIN:
```
                  id                  |             email              |    role    | is_active
--------------------------------------+--------------------------------+------------+-----------
 xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx | hernan.castellanos@hrcastell.com | SUPERADMIN | t
```

### 3. Resumen de registros:
```
    tabla       | registros
----------------+-----------
 users          |         1
 customers      |         0
 products       |         0
 ...
```

**Si ves esto, ¡la BD se creó correctamente! ✅**

---

## 🔌 PASO 5: ACTUALIZAR CONFIGURACIÓN DEL BACKEND

1. **Abre:** `Backend/dulcemaria-api/.env`

2. **Actualiza la variable DATABASE_URL:**

   ```env
   # Opción 1: URL completa
   DATABASE_URL=postgresql://dulcemaria_owner:TuPasswordSegura123!@localhost:5432/dulcemaria_db_v2
   
   # Opción 2: Variables separadas (si las usas)
   DB_HOST=localhost
   DB_PORT=5432
   DB_USER=dulcemaria_owner
   DB_PASSWORD=TuPasswordSegura123!
   DB_NAME=dulcemaria_db_v2
   ```

3. **Si estás en cPanel:**
   - Cambia `localhost` por la IP/host de tu servidor PostgreSQL
   - Puede ser: `localhost`, `127.0.0.1`, o `pgsql.tudominio.com`

---

## 🚀 PASO 6: REINICIAR EL BACKEND

### En local:
```bash
cd Backend/dulcemaria-api
npm run dev
```

### En cPanel:
1. Ve a "Setup Node.js App"
2. Selecciona tu aplicación
3. Click "Restart"

---

## 🧪 PASO 7: PROBAR LA CONEXIÓN

### 1. Verifica los logs del backend:

Deberías ver algo como:
```
✅ PostgreSQL connected to dulcemaria_db_v2
Server running on port 5000
```

### 2. Prueba el login:

**Endpoint:** `POST /auth/login`

**Body:**
```json
{
  "email": "hernan.castellanos@hrcastell.com",
  "password": "TuPasswordAqui"
}
```

**Respuesta esperada:**
```json
{
  "ok": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "...",
    "email": "hernan.castellanos@hrcastell.com",
    "role": "SUPERADMIN"
  }
}
```

---

## 📊 PASO 8: MIGRAR DATOS (Opcional)

Si necesitas copiar datos de la BD antigua:

### 1. Exportar datos de BD antigua:

```sql
-- Conectarse a la BD antigua
\c dulcemaria_db

-- Exportar customers
\copy customers TO '/tmp/customers.csv' CSV HEADER;

-- Exportar products
\copy products TO '/tmp/products.csv' CSV HEADER;

-- Exportar orders
\copy orders TO '/tmp/orders.csv' CSV HEADER;
```

### 2. Importar a BD nueva:

```sql
-- Conectarse a la BD nueva
\c dulcemaria_db_v2

-- Importar customers
\copy customers FROM '/tmp/customers.csv' CSV HEADER;

-- Importar products
\copy products FROM '/tmp/products.csv' CSV HEADER;

-- Importar orders
\copy orders FROM '/tmp/orders.csv' CSV HEADER;
```

---

## 🔍 COMANDOS ÚTILES

### Verificar conexión actual:
```sql
SELECT current_database(), current_user, session_user;
```

### Ver todos los usuarios/roles:
```sql
SELECT rolname, rolsuper, rolcreatedb FROM pg_roles WHERE rolname LIKE '%dulce%';
```

### Ver permisos de una tabla:
```sql
\dp users
```

### Cambiar owner de todas las tablas (si es necesario):
```sql
ALTER TABLE users OWNER TO dulcemaria_owner;
ALTER TABLE customers OWNER TO dulcemaria_owner;
-- etc.
```

---

## ❌ SOLUCIÓN DE PROBLEMAS

### Error: "permission denied for database"
**Causa:** No estás conectado como postgres o como owner.
**Solución:** Conéctate como `postgres` primero.

### Error: "role 'dulcemaria_owner' already exists"
**Causa:** El usuario ya existe.
**Solución:** Omite la creación del role o usa `DROP ROLE` primero.

### Error: "database 'dulcemaria_db_v2' already exists"
**Causa:** La BD ya existe.
**Solución:** Usa otro nombre o elimínala con `DROP DATABASE`.

### No puedo conectarme con el nuevo usuario
**Causa:** Password incorrecto o el role no tiene LOGIN.
**Solución:** 
```sql
ALTER ROLE dulcemaria_owner WITH LOGIN PASSWORD 'NuevoPassword';
```

---

## 📝 CHECKLIST FINAL

- [ ] Hash de password generado
- [ ] Script SQL actualizado con el hash
- [ ] Script ejecutado sin errores
- [ ] Verificación muestra 7 tablas creadas
- [ ] Usuario SUPERADMIN existe
- [ ] .env actualizado con nueva DATABASE_URL
- [ ] Backend reiniciado
- [ ] Login funciona correctamente
- [ ] Panel de usuarios accesible (frontend)

---

## 🎯 ¿TODO FUNCIONÓ?

Si completaste todos los pasos y el login funciona:

1. **Opcional:** Elimina la BD antigua cuando estés seguro:
   ```sql
   DROP DATABASE dulcemaria_db;
   ```

2. **Sube los cambios** del backend a cPanel si aplica

3. **Prueba las nuevas funcionalidades:**
   - Carga de imágenes en productos
   - Gestión de usuarios y permisos

---

## 📞 SOPORTE

Si encuentras problemas:
1. Revisa los logs del backend
2. Verifica la conexión con `psql`
3. Confirma que el usuario tiene permisos correctos

**¡Ahora sí tienes control total de tu base de datos!** 🎉
