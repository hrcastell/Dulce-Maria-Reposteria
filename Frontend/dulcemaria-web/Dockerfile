# ---------------------------------------------------------------------------
# LOCAL DEVELOPMENT ONLY — DulceMaria Admin Panel (Nuxt 3)
#
# This Dockerfile exists purely as a developer-convenience runtime for
# `docker compose up` on a workstation. It has NOTHING to do with how this
# project is actually deployed: production runs on cPanel shared hosting
# with PostgreSQL managed through phpPgAdmin. There is no container
# involved anywhere in the real deploy path. Do not adapt this image for
# production use — the real build/deploy of this Nuxt app is a separate,
# non-Docker process documented elsewhere in this repo.
# ---------------------------------------------------------------------------
FROM node:20-alpine

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000

# --host 0.0.0.0 is required so the Docker port mapping (host 4302 ->
# container 3000) can actually reach Nuxt's dev server.
CMD ["npx", "nuxt", "dev", "--host", "0.0.0.0"]
