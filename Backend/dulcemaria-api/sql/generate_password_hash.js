/**
 * Script para generar hash de password bcrypt
 * Uso: node sql/generate_password_hash.js
 */

const bcrypt = require('bcrypt');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log('='.repeat(60));
console.log('GENERADOR DE PASSWORD HASH BCRYPT');
console.log('='.repeat(60));
console.log('');

rl.question('Ingresa el password para el usuario SUPERADMIN: ', (password) => {
  if (!password || password.length < 8) {
    console.error('❌ Error: El password debe tener al menos 8 caracteres');
    rl.close();
    process.exit(1);
  }

  console.log('\n⏳ Generando hash...\n');

  const hash = bcrypt.hashSync(password, 10);

  console.log('✅ Hash generado exitosamente:\n');
  console.log('─'.repeat(60));
  console.log(hash);
  console.log('─'.repeat(60));
  console.log('\n📋 Copia este hash y reemplázalo en el script SQL:');
  console.log(`   Línea ~237 de recreate_database.sql`);
  console.log(`   Busca: '$2b$10$YourBcryptHashHere'`);
  console.log(`   Reemplaza con: '${hash}'`);
  console.log('');

  rl.close();
});
