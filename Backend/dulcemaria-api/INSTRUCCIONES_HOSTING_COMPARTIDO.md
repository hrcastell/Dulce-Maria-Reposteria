# 🗄️ INSTRUCCIONES PARA HOSTING COMPARTIDO

## 📋 Para hostings compartidos SIN terminal y SIN extensiones

Esta guía es específica para hostings compartidos donde:
- ❌ No tienes acceso a terminal/SSH
- ❌ No puedes instalar extensiones PostgreSQL
- ❌ No puedes conectar a clientes externos
- ✅ Solo tienes acceso a phpPgAdmin o panel web

---

## 🚀 PROCESO SIMPLIFICADO

### **PASO 1: Generar Hash de Password**

En tu máquina local:

```bash
cd Backend/dulcemaria-api
node sql/generate_password_hash.js
```

Ingresa tu password y **copia el hash generado**. Lo necesitarás en el Paso 4.

---

### **PASO 2: Crear Base de Datos desde el Panel**

1. **Accede a tu panel de hosting** (cPanel, Plesk, etc.)

2. **Ve a "PostgreSQL Databases"**

3. **Crea una nueva base de datos:**
   - Nombre: `dulcemaria_db_v2` (o el que prefieras)
   - Click en "Create Database"

4. **Asigna un usuario a la BD:**
   - Si no tienes usuario, créalo desde el panel
   - Nombre sugerido: `dulcemaria_user`
   - Password: elige uno seguro
   - Asigna este usuario a la BD recién creada
   - Dale **TODOS los privilegios**

5. **Guarda esta información:**
   ```
   Host: localhost (o el que te indique el hosting)
   Puerto: 5432 (o el que te indique)
   Base de datos: dulcemaria_db_v2
   Usuario: [tu_usuario]
   Password: [tu_password]
   ```

---

### **PASO 3: Acceder a phpPgAdmin**

1. En el panel de hosting, busca **"phpPgAdmin"** o "PostgreSQL Manager"

2. **Inicia sesión:**
   - Usuario: el que creaste/asignaste
   - Password: el password del usuario
   - Base de datos: dulcemaria_db_v2

3. Deberías ver la base de datos vacía (sin tablas aún)

---

### **PASO 4: Preparar el Script SQL**

1. **Abre el archivo:** `sql/recreate_database_simple.sql`

2. **Busca la línea 173** (sección INSERT usuario):
   ```sql
   '$2b$10$REEMPLAZAR_CON_HASH_REAL', -- CAMBIAR ESTO
   ```

3. **Reemplaza con el hash** que generaste en el Paso 1:
   ```sql
   '$2b$10$abc123xyz...tu_hash_real',
   ```

4. **Guarda el archivo**

---

### **PASO 5: Ejecutar el Script**

En phpPgAdmin:

1. **Selecciona la base de datos** `dulcemaria_db_v2` en el menú izquierdo

2. **Click en "SQL"** en el menú superior

3. **Copia TODO el contenido** de `recreate_database_simple.sql`

4. **Pégalo en el área de texto** de phpPgAdmin

5. **Click en "Execute"** o "Ejecutar"

6. **Espera** a que termine (puede tardar unos segundos)

---

### **PASO 6: Verificar la Creación**

Al final del script verás los resultados de verificación:

**Tablas creadas (deberías ver 7):**
```
 tablename       | schemaname
-----------------+------------
 customers       | public
 order_items     | public
 orders          | public
 payments        | public
 product_images  | public
 products        | public
 users           | public
```

**Usuario SUPERADMIN:**
```
 email                           | role       | is_active
---------------------------------+------------+-----------
 hernan.castellanos@hrcastell.com| SUPERADMIN | t
```

**Resumen:**
```
 tabla           | registros
-----------------+-----------
 users           |         1
 customers       |         0
 products        |         0
 ...
```

✅ **Si ves esto, ¡todo funcionó correctamente!**

---

### **PASO 7: Actualizar Configuración del Backend**

1. **Abre:** `Backend/dulcemaria-api/.env`

2. **Actualiza con los datos de tu hosting:**

```env
# Datos que obtuviste en el Paso 2
DATABASE_URL=postgresql://TU_USUARIO:TU_PASSWORD@localhost:5432/dulcemaria_db_v2

# Ejemplo real:
# DATABASE_URL=postgresql://dulcemxxx_user:Pass123!@localhost:5432/dulcemaria_db_v2
```

**Importante:**
- Usa el usuario que **creaste en el panel del hosting**
- Usa el password que **asignaste a ese usuario**
- El host suele ser `localhost` en hosting compartido
- Verifica el puerto (generalmente 5432)

---

### **PASO 8: Subir y Reiniciar Backend**

#### Si estás en local:
```bash
cd Backend/dulcemaria-api
npm run dev
```

#### Si estás en el servidor:

1. **Sube los archivos del backend** vía FTP/SFTP

2. **Sube el .env actualizado** (asegúrate de subirlo)

3. **Reinicia la aplicación:**
   - cPanel → Setup Node.js App
   - Selecciona tu app
   - Click "Restart"

---

### **PASO 9: Probar Conexión**

**Opción A: Ver logs**

En cPanel → Setup Node.js App → Click en tu app → Ver logs

Busca:
```
✅ PostgreSQL connected to dulcemaria_db_v2
```

**Opción B: Probar login**

Usa Postman, Thunder Client o curl:

```bash
POST https://tu-dominio.com/api/auth/login
Content-Type: application/json

{
  "email": "hernan.castellanos@hrcastell.com",
  "password": "TuPasswordAqui"
}
```

Respuesta esperada:
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

## ⚠️ PROBLEMAS COMUNES

### Error: "function gen_random_uuid() does not exist"

**Causa:** PostgreSQL < 13

**Solución:** Usa este script alternativo en su lugar:

```sql
-- Reemplaza gen_random_uuid() con esta función en todas las tablas:
CREATE OR REPLACE FUNCTION generate_uuid() RETURNS uuid AS $$
  SELECT md5(random()::text || clock_timestamp()::text)::uuid;
$$ LANGUAGE SQL;

-- Luego en las tablas usa:
id UUID PRIMARY KEY DEFAULT generate_uuid(),
```

### Error: "permission denied"

**Causa:** El usuario no tiene privilegios suficientes

**Solución:**
1. Ve al panel de PostgreSQL
2. Verifica que el usuario tenga TODOS los privilegios
3. Re-asigna los privilegios si es necesario

### Error: "database does not exist"

**Causa:** No seleccionaste la BD correcta en phpPgAdmin

**Solución:**
1. Asegúrate de seleccionar `dulcemaria_db_v2` en el menú izquierdo
2. Luego ejecuta el script SQL

### No puedo conectarme desde Node.js

**Causa:** Credenciales incorrectas en .env

**Solución:**
1. Verifica el usuario en el panel
2. Verifica el nombre de la BD
3. Verifica el host (puede ser localhost, 127.0.0.1, o un hostname específico)
4. Prueba conectarte desde phpPgAdmin con las mismas credenciales

---

## 📊 MIGRAR DATOS DE BD ANTIGUA (Opcional)

Si necesitas copiar datos:

### Opción A: Desde phpPgAdmin

1. **Selecciona la BD antigua**
2. **Click en tabla (ej: customers)**
3. **Click en "Export"**
4. **Formato: SQL**
5. **Descarga el archivo**

Luego:
1. **Selecciona la BD nueva**
2. **Click en "SQL"**
3. **Pega el contenido del archivo descargado**
4. **Ejecuta**

Repite para cada tabla.

### Opción B: Herramienta de respaldo del hosting

Algunos hostings tienen herramientas de backup/restore:
1. Haz backup de la BD antigua
2. Restaura solo los datos (no estructura) en la nueva

---

## ✅ CHECKLIST FINAL

- [ ] Hash de password generado con `generate_password_hash.js`
- [ ] Base de datos creada desde panel de hosting
- [ ] Usuario creado y asignado con todos los privilegios
- [ ] Credenciales guardadas (host, puerto, user, pass, dbname)
- [ ] Script SQL actualizado con hash real
- [ ] Script ejecutado en phpPgAdmin sin errores
- [ ] 7 tablas creadas verificadas
- [ ] Usuario SUPERADMIN existe
- [ ] .env actualizado con DATABASE_URL correcta
- [ ] Backend reiniciado
- [ ] Login funciona desde frontend/API

---

## 🎯 ¿TODO FUNCIONÓ?

Una vez confirmado que todo funciona:

1. **Prueba las funcionalidades:**
   - Login
   - Crear producto
   - Subir imágenes
   - Gestión de usuarios

2. **Opcional:** Elimina la BD antigua cuando estés seguro

3. **Disfruta** de tu aplicación sin problemas de permisos 🎉

---

## 💡 NOTAS IMPORTANTES

- **gen_random_uuid()** es nativo en PostgreSQL 13+, no requiere extensiones
- En hosting compartido **no puedes** crear roles/usuarios desde SQL
- Usa siempre el **usuario del panel** para la conexión
- El script usa **IF NOT EXISTS** para evitar errores si lo ejecutas dos veces
- **JSONB** está disponible desde PostgreSQL 9.4+ (no requiere extensión)

---

## 📞 ¿NECESITAS AYUDA?

Si algo no funciona:
1. Verifica la versión de PostgreSQL: `SELECT version();`
2. Revisa los logs del backend
3. Confirma las credenciales en phpPgAdmin
4. Verifica que el usuario tenga privilegios completos
