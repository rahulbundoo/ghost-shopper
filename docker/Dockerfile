# Optional CI/deployment targets. Local development runs Node directly.
FROM node:22-bookworm-slim AS build
WORKDIR /workspace
RUN npm install --global pnpm@10.34.6
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm run build

FROM node:22-bookworm-slim AS web
ENV NODE_ENV=production
WORKDIR /workspace/apps/web
# Preserve pnpm's workspace links and generated Prisma client.
# Deployment image minimization is deferred to production hardening.
COPY --from=build --chown=node:node /workspace /workspace
USER node
CMD ["node", "node_modules/@react-router/serve/bin.js", "build/server/index.js"]

FROM node:22-bookworm-slim AS runner
ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /workspace/apps/runner
COPY --from=build --chown=node:node /workspace /workspace
RUN node /workspace/packages/browser/node_modules/playwright/cli.js install --with-deps chromium --only-shell \
    && chmod -R a+rX /ms-playwright
USER node
CMD ["node", "dist/index.js"]
