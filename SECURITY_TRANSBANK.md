# Seguridad y preparación para Transbank

## Regla principal

Ningún sistema conectado a Internet es imposible de vulnerar. El objetivo es
reducir superficie de ataque, limitar el impacto de una cuenta comprometida,
detectar fallos y recuperar el servicio sin perder pedidos ni pagos.

Nunca guardar ni solicitar en este proyecto el número completo de tarjeta,
CVV, PIN ni claves de acceso al portal Transbank. Webpay aloja la captura de
tarjeta. El backend solo conservará identificadores y el resultado permitido de
la transacción.

## Correcciones aplicadas

- El backend vuelve a calcular precios, variantes y totales desde PostgreSQL.
- Los totales de tortas se calculan desde `system_config` y opciones activas.
- El JWT administrativo vive en una cookie `HttpOnly`, `Secure` en producción
  y `SameSite=Strict`; ya no queda disponible para JavaScript.
- Cada request autenticado revalida que el usuario siga activo y conserva el
  rol actual de la base de datos.
- Las mutaciones con cookie verifican el origen, además de CORS.
- El bootstrap HTTP queda apagado por defecto y no acepta secretos en la URL.
- Se eliminaron precios/nombres confiados al navegador, se limitaron cantidades
  y frecuencia de pedidos y un pedido público ya no puede sobrescribir una ficha
  privada usando solo el teléfono.
- Se escaparon datos administrables antes de insertarlos como HTML en el sitio
  público y se restringieron enlaces a HTTP/HTTPS.
- Se agregaron CSP, Referrer-Policy y Permissions-Policy al sitio público.
- Se protegió el borrado de imágenes contra rutas fuera de `uploads`.
- Se actualizaron dependencias vulnerables y se desactivaron Nuxt DevTools.

## Configuración obligatoria de producción

Configurar en cPanel/Passenger, nunca en Git ni en el frontend:

```text
NODE_ENV=production
DATABASE_URL=...
JWT_SECRET=<64 bytes aleatorios o más>
ADMIN_ORIGINS=https://admin.dulcemaria.hrcastell.com
PUBLIC_ORIGINS=https://dulcemaria.hrcastell.com
PLATFORM_OWNER_EMAIL=<correo autorizado>
TRUST_PROXY_HOPS=1
ENABLE_BOOTSTRAP=false
```

Después de confirmar el administrador, retirar `ADMIN_PASSWORD` y
`BOOTSTRAP_TOKEN` del entorno. La recuperación se ejecuta con el CLI desde la
terminal del hosting, nunca mediante una URL pública (ver más abajo).

## Endurecimiento del backend (variables y comportamientos)

- **Modo seguro por defecto:** si `NODE_ENV` falta o no es `development`/`test`,
  la API se comporta como producción (cookie Secure, HSTS, errores enmascarados,
  bootstrap prohibido) y lo advierte al arrancar.
- **`JWT_SECRET`:** en producción el arranque falla si tiene menos de 43
  caracteres, parece un valor de ejemplo (`change`, `secret`, `example`, …) o es
  repetitivo. Generar uno con
  `node -e "console.log(require('crypto').randomBytes(64).toString('base64url'))"`.
- **Orígenes:** `ADMIN_ORIGINS` (lista separada por comas) son los únicos
  orígenes con CORS con credenciales en `/auth` y `/admin` y los únicos
  aceptados como `Origin` en mutaciones con cookie. `PUBLIC_ORIGINS` reciben CORS
  sin credenciales en las rutas públicas. Si faltan, se usa `FRONTEND_URL`
  (comportamiento anterior) con advertencia; el sitio público nunca queda como
  origen del panel. CORS nunca responde 403 por un Origin desconocido: el retorno
  de Webpay (POST de formulario desde Transbank) llega a la ruta. Además, en
  `/auth` y `/admin` se rechazan solicitudes de navegador `same-site`/`cross-site`
  cuyo Origin no sea del panel (Fetch Metadata), así un subdominio hermano no
  puede usar la sesión.
  Pendiente para la integración de pago: montar `express.urlencoded` solo en la
  ruta de retorno y ajustar `form-action` si la API renderiza la redirección.
- **Sesión:** cookie `__Host-dm_session` (Secure, Path=/, sin Domain) en
  producción; ya no se acepta `Authorization: Bearer`. `users.session_version`
  viaja en el JWT (`sv`): cambiar contraseña, rol o estado activo, y
  `POST /auth/logout-all`, cierran todas las sesiones del usuario.
  `POST /auth/logout` borra la cookie aunque el token haya vencido. El login
  responde igual para cuentas inactivas y contraseñas incorrectas, limita
  también por cuenta (10 fallos/15 min) y re-hashea hashes heredados.
- **CLI de administración** (terminal SSH, con las mismas variables que la app):
  `npm run admin:create-superadmin -- --email <correo>`,
  `npm run admin:reset-password -- --email <correo>` y
  `npm run admin:revoke-sessions -- --email <correo>`. La contraseña se pide
  oculta o se lee desde stdin; nunca se pasa como argumento.
- **Configuración del Motor de Tarifa:** `/admin/config/:key` solo acepta las
  claves de la panadería (precio base de torta y energía). La tarifa de respaldo
  `platform_fee_default_clp` se administra en `/admin/platform-fees/config`,
  exclusivo de `PLATFORM_OWNER_EMAIL`.
- **Subidas:** solo JPEG/PNG/WebP verificados por contenido; nombre y extensión
  los decide el servidor. `/uploads` entrega solo extensiones de imagen con
  `nosniff`, CSP `sandbox` y caché larga. Revisar `uploads/hero/` del servidor por
  archivos no-imagen subidos antes de este cambio (ya no se sirven).
- **Esquema:** la API guarda una huella del esquema en `schema_migration_state`
  y no repite el DDL si nada cambió. En producción un fallo de sentencia no
  impide arrancar, pero se registra con su id y SQLSTATE en cada arranque y lo
  informa `npm run db:validate`; tras corregir la causa, reiniciar una vez con
  `MIGRATIONS_FORCE=true` y luego quitarla. `MIGRATIONS_STRICT=true` aborta el
  arranque ante cualquier fallo (por defecto en desarrollo).
- **Proxy y límites:** `TRUST_PROXY_HOPS` = cantidad de proxies de confianza
  delante de Node. Si es mayor que la cadena real, `X-Forwarded-For` falsificado
  evade los límites; si es menor, todos comparten la IP del proxy. Para calibrarlo,
  arrancar una vez con `TRUST_PROXY_DIAGNOSTIC=true` (registra `req.ip` y la
  cadena recibida en las primeras 20 solicitudes) y luego quitarlo. Los límites
  viven en memoria por proceso: con varios procesos de Passenger cada uno cuenta
  por separado y un reinicio los pone en cero.

En el hosting también se debe:

1. Forzar HTTPS y redirigir HTTP antes de Node.
2. Mantener PostgreSQL sin acceso público; aceptar solo el host de la app.
3. Respaldar la base diariamente, cifrar copias y probar restauración.
4. No publicar `.env`, `server.zip`, logs, dumps SQL ni directorios de trabajo.
5. Añadir en el proxy `X-Content-Type-Options: nosniff`, HSTS y
   `frame-ancestors 'none'` (esta última directiva no funciona mediante meta).
6. Rotar inmediatamente cualquier credencial que haya sido enviada por chat,
   correo, captura de pantalla o incluida alguna vez en un ZIP público.

## Diseño correcto para Webpay Plus

Para este comercio corresponde normalmente Webpay Plus normal. Antes de usar
producción hay que confirmar en el portal Transbank que ese producto está
habilitado y obtener por canal seguro el código de comercio y API Key Secret.

Variables futuras del backend:

```text
TRANSBANK_ENV=integration
TRANSBANK_COMMERCE_CODE=<solo en producción>
TRANSBANK_API_KEY_SECRET=<solo en producción>
TRANSBANK_RETURN_URL=https://api.dulcemaria.hrcastell.com/public/payments/webpay/return
PUBLIC_SITE_URL=https://dulcemaria.hrcastell.com
```

Secuencia prevista:

1. El servidor crea el pedido con monto autoritativo y genera una orden de
   compra única (máximo 26 caracteres).
2. El servidor registra un intento de pago y llama `Transaction.create` con
   `buy_order`, `session_id`, monto y URL de retorno.
3. El navegador se envía a la URL oficial recibida de Transbank mediante POST
   con `token_ws`. Nunca se construye ni se acepta una URL de pago desde el
   cliente.
4. Al volver, el backend ejecuta `Transaction.commit(token)` una sola vez.
5. Solo marca `PAID` si coinciden monto, orden de compra y sesión guardados, y
   además Transbank devuelve `status=AUTHORIZED` y `response_code=0`.
6. La operación de base de datos es idempotente: refrescar la página o recibir
   un retorno repetido no duplica pago, stock ni cobros internos.
7. Cancelaciones, abandonos y timeouts liberan la reserva de stock. Un trabajo
   de conciliación consulta estados pendientes antes de asumir fracaso.
8. Logs y panel muestran IDs, estado, monto y últimos cuatro dígitos si
   Transbank los entrega; nunca datos completos de tarjeta ni el API secret.

## Datos que debe preparar el propietario

- Confirmación de que el producto contratado es **Webpay Plus**.
- Código de comercio de producción.
- API Key Secret de producción.
- Acceso al portal para completar la validación/puesta en producción.
- URL pública definitiva del sitio y de la API con certificado TLS válido.

No pegar las claves en tickets, commits ni conversaciones. Deben cargarse
directamente como variables secretas del hosting cuando la integración de
prueba haya pasado todos los casos de aprobación, rechazo, abandono, retorno
duplicado y error de red.
