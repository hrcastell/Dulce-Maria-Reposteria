require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL;
  const pass = process.env.ADMIN_PASSWORD;

  if (!email || !pass) throw new Error("Faltan ADMIN_EMAIL o ADMIN_PASSWORD en el panel.");

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log("✅ SUPERADMIN ya existe:", email);
    return;
  }

  const passwordHash = await bcrypt.hash(pass, 12);

  await prisma.user.create({
    data: {
      email,
      passwordHash,
      role: "SUPERADMIN",
      isActive: true,
      fullName: "Dulce María - Superadmin",
    },
  });

  console.log("✅ SUPERADMIN creado:", email);
}

main()
  .catch((e) => {
    console.error("❌ Seed error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
