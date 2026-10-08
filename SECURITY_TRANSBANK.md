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
FRONTEND_URL=https://admin.dulcemaria.hrcastell.com
PLATFORM_OWNER_EMAIL=<correo autorizado>
TRUST_PROXY_HOPS=1
ENABLE_BOOTSTRAP=false
```

Después de confirmar el administrador, retirar `ADMIN_PASSWORD` y
`BOOTSTRAP_TOKEN` del entorno. La recuperación debe ejecutarse mediante un
comando CLI en una terminal segura, no mediante una URL pública.

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
