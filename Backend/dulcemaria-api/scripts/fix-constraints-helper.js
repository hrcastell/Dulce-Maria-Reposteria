/**
 * Helper temporal para ejecutar corrección de CHECK constraints
 * ELIMINAR después de usar
 */

// dotenv opcional - en cPanel no se usa
try {
  require("dotenv").config();
} catch (e) {
  console.log("dotenv not available - using environment variables from cPanel");
}

const express = require("express");
const { fixOrdersConstraints } = require("../src/migrations/fix-orders-constraints");

const app = express();

app.get("/", (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Fix Constraints Helper</title>
  <style>
    body { font-family: Arial; max-width: 800px; margin: 50px auto; padding: 20px; }
    .info { background: #d1ecf1; border: 1px solid #bee5eb; padding: 20px; border-radius: 5px; }
    h1 { color: #0c5460; }
  </style>
</head>
<body>
  <div class="info">
    <h1>🔧 Fix Constraints Helper</h1>
    <p>Para ejecutar la corrección de CHECK constraints en orders:</p>
    <p><strong>/fix-constraints-now?token=TU_JWT_SECRET</strong></p>
  </div>
</body>
</html>
  `);
});

app.get("/fix-constraints-now", async (req, res) => {
  const providedToken = req.query.token || "";
  const expectedToken = process.env.JWT_SECRET || "";
  
  if (!expectedToken || providedToken !== expectedToken) {
    return res.status(403).send("Forbidden");
  }

  console.log("🔧 Fixing orders constraints...");
  
  try {
    const result = await fixOrdersConstraints();
    
    res.send(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Constraints Fixed</title>
  <style>
    body { font-family: Arial; max-width: 800px; margin: 50px auto; padding: 20px; }
    .success { background: #d4edda; border: 1px solid #c3e6cb; padding: 20px; border-radius: 5px; }
    h1 { color: #155724; }
    pre { background: #f8f9fa; padding: 10px; border-radius: 3px; overflow-x: auto; }
  </style>
</head>
<body>
  <div class="success">
    <h1>✅ CONSTRAINTS FIXED</h1>
    
    <p><strong>Operaciones completadas: ${result.applied}/${result.total}</strong></p>
    
    <p>Constraints actualizados en orders:</p>
    <ul>
      <li><strong>status</strong>: PENDING_CONFIRMATION, CONFIRMED, PREPARING, READY, DELIVERED, CANCELLED</li>
      <li><strong>payment_status</strong>: PENDING, PAID, FAILED, REFUNDED</li>
      <li><strong>payment_method</strong>: TRANSFER, CASH, ONLINE</li>
      <li><strong>delivery_method</strong>: PICKUP, DELIVERY</li>
    </ul>

    <p><strong>Próximos pasos:</strong></p>
    <ol>
      <li>Cambia "Application Startup File" de vuelta a: <code>server.js</code></li>
      <li>Restart la aplicación</li>
      <li>Prueba actualizar status: PATCH /admin/orders/:id/status</li>
      <li>Prueba actualizar payment: PATCH /admin/orders/:id/payment</li>
      <li>Si todo funciona, elimina estos archivos temporales de cPanel</li>
    </ol>

    <p><strong>Archivos temporales a eliminar:</strong></p>
    <ul>
      <li>scripts/fix-constraints-helper.js</li>
      <li>src/migrations/fix-orders-constraints.js</li>
    </ul>

    <details>
      <summary>Ver detalles técnicos</summary>
      <pre>${JSON.stringify(result.statements, null, 2)}</pre>
    </details>
  </div>
</body>
</html>
    `);
    
  } catch (error) {
    console.error("❌ Error:", error);
    
    res.status(500).send(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Error</title>
  <style>
    body { font-family: Arial; max-width: 800px; margin: 50px auto; padding: 20px; }
    .error { background: #f8d7da; border: 1px solid #f5c6cb; padding: 20px; border-radius: 5px; }
    h1 { color: #721c24; }
    pre { background: #f8f9fa; padding: 10px; border-radius: 3px; overflow-x: auto; }
  </style>
</head>
<body>
  <div class="error">
    <h1>❌ ERROR</h1>
    <p>Ocurrió un error al corregir los constraints:</p>
    <pre>${error.message}</pre>
    <p>Por favor revisa el log en cPanel.</p>
  </div>
</body>
</html>
    `);
  }
});

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => {
  console.log(`🔧 Fix Constraints Helper running on port ${PORT}`);
  console.log(`Access: /fix-constraints-now?token=YOUR_JWT_SECRET`);
});
