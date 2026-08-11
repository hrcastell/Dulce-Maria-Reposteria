# ---------------------------------------------------------------------------
# LOCAL DEVELOPMENT ONLY — DulceMaria API (Express + node-postgres)
#
# This Dockerfile exists purely as a developer-convenience runtime for
# `docker compose up` on a workstation. It has NOTHING to do with how this
# project is actually deployed: production runs on cPanel shared hosting
# (Node "Setup Node.js App" / Passenger) with PostgreSQL managed through
# phpPgAdmin. There is no container involved anywhere in the real deploy
# path. Do not adapt this image for production use.
# ---------------------------------------------------------------------------
FROM node:20-alpine

WORKDIR /usr/src/app

# Install dependencies first for better layer caching. package-lock.json is
# copied if present; npm falls back to a regular install otherwise.
COPY package*.json ./
RUN npm install

# Source is bind-mounted over this at `docker compose up` time (see
# docker-compose.yml at the repo root), so this COPY only matters for
# `docker build` run in isolation.
COPY . .

EXPOSE 3000

# nodemon.json in this folder enables legacyWatch/polling so file-change
# detection works reliably across a Docker bind mount on Windows/WSL.
CMD ["npm", "run", "dev"]
