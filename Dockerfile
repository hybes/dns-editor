# syntax=docker/dockerfile:1
# Reproducible build for the Nuxt 4 app. Avoids Nixpacks' runtime fetch of nixpkgs
# from GitHub (the source of the 504 build failure) and runs the correct Nuxt 4
# production server (node .output/server/index.mjs, not the legacy `nuxt start`).

# ---- Build stage ----
FROM node:24-slim AS build
WORKDIR /app

# Copy source first so the `nuxt prepare` postinstall has nuxt.config + app present.
COPY . .

# Install exactly what the lockfile resolves (includes the @unhead/schema-org override
# and the Linux oxc-parser bindings) and build the Nitro server output.
RUN npm ci && npm run build

# ---- Runtime stage ----
# Only the self-contained .output bundle is needed at runtime — no node_modules.
FROM node:24-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    NITRO_PORT=3000

COPY --from=build /app/.output ./.output

EXPOSE 3000
USER node
# OPENAI_API_KEY (and any other secrets) are injected at runtime by the platform —
# they are read via runtimeConfig and are intentionally NOT baked into the image.
CMD ["node", ".output/server/index.mjs"]
