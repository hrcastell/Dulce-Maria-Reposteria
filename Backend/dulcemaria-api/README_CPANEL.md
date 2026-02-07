# Dulce Maria Reposteria — API (cPanel) [V3]

✅ Este ZIP fuerza Prisma a correr **local** con `npx`, para evitar el error del panel apuntando a:
`/home/.../nodevenv/.../lib/node_modules/prisma/...`

## Pasos
1) Sube y extrae en `~/dulcemaria-api/` (o el Application root que uses)
2) En Setup Node.js App:
   - startup: `server.js`
   - variables:
     - DATABASE_URL = postgresql://hernanci_hernan:PASS@localhost:5432/hernanci_dulcemaria?schema=public
     - JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD, NODE_ENV=production
   - ⚠️ NO definas PORT salvo que el panel lo exija.

3) Click **Run NPM Install**
4) Terminal (si tienes):
```bash
cd ~/dulcemaria-api
npm run db:push
npm run seed:superadmin
```
5) Restart

Prueba: /health y /db-check
