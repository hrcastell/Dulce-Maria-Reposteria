# ---------------------------------------------------------------------------
# LOCAL DEVELOPMENT ONLY — DulceMaria public catalog site (Vite)
#
# This Dockerfile exists purely as a developer-convenience runtime for
# `docker compose up` on a workstation. It has NOTHING to do with how this
# project is actually deployed: production runs on cPanel shared hosting
# with PostgreSQL managed through phpPgAdmin — this static site is built
# with `vite build` and uploaded as plain files, no container involved.
# Do not adapt this image for production use.
# ---------------------------------------------------------------------------
FROM node:20-alpine

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000

# --host 0.0.0.0 is required so the Docker port mapping (host 4303 ->
# container 3000) can actually reach Vite's dev server.
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
