# Dulce María Repostería - Frontend

Sistema de gestión web para Dulce María Repostería.

## 🛠️ Stack Tecnológico

- **Nuxt 3** - Framework Vue.js con SSR
- **Vue 3** - Framework JavaScript progresivo
- **Tailwind CSS** - Framework CSS utility-first
- **TypeScript** - Tipado estático

## 📋 Requisitos Previos

- Node.js 18.x o superior
- npm o yarn

## 🚀 Instalación

```bash
# Instalar dependencias
npm install

# o con yarn
yarn install
```

## 🔧 Configuración

1. Copia el archivo `.env.example` a `.env`:
```bash
cp .env.example .env
```

2. Configura la URL de tu API backend en `.env`:
```env
NUXT_PUBLIC_API_BASE=https://hrcastell.com
```

## 💻 Desarrollo

```bash
# Iniciar servidor de desarrollo en http://localhost:3000
npm run dev
```

## 🏗️ Build para Producción

```bash
# Generar build de producción
npm run build

# Preview del build de producción
npm run preview

# Generar sitio estático
npm run generate
```

## 📁 Estructura del Proyecto

```
dulcemaria-web/
├── assets/           # Assets estáticos (CSS, imágenes)
├── components/       # Componentes Vue reutilizables
├── composables/      # Composables de Vue
├── layouts/          # Layouts de página
├── middleware/       # Middleware de Nuxt
├── pages/            # Páginas de la aplicación
├── plugins/          # Plugins de Nuxt
├── public/           # Archivos públicos estáticos
├── server/           # API routes y server middleware
├── utils/            # Utilidades y helpers
├── app.vue           # Componente raíz
├── nuxt.config.ts    # Configuración de Nuxt
└── tailwind.config.js # Configuración de Tailwind
```

## 🎨 Convenciones de Estilo

- Usamos **Tailwind CSS** para estilos
- Componentes con **Composition API** de Vue 3
- **TypeScript** para type safety
- Código formateado con ESLint y Prettier

## 🔗 API Backend

El frontend se conecta al backend REST API en:
- Producción: `https://hrcastell.com`
- Development: Configurable en `.env`

## 📚 Documentación

- [Nuxt 3 Docs](https://nuxt.com/)
- [Vue 3 Docs](https://vuejs.org/)
- [Tailwind CSS Docs](https://tailwindcss.com/)

## 👨‍💻 Desarrollo

Para comenzar el desarrollo:

1. Instala las dependencias
2. Configura el `.env`
3. Ejecuta `npm run dev`
4. Abre http://localhost:3000

---

**Dulce María Repostería** - Sistema de Gestión © 2026
