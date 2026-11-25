# Build context: the repository root (the server bundles code from packages/shared).
#   docker build -f apps/api/Dockerfile -t torra-api .

FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN npm ci --workspace @torra/api --include-workspace-root=false --ignore-scripts
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
WORKDIR /repo/apps/api
RUN npx prisma generate && npm run build

FROM node:22-alpine AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
# Runtime packages only. Prisma's CLI stays: the container applies pending migrations before it starts.
# Our own postinstall (prisma generate) is skipped, but Prisma's must run: it fetches the schema engine
# that `migrate deploy` uses.
RUN npm ci --workspace @torra/api --include-workspace-root=false --omit=dev --ignore-scripts \
  && npm rebuild @prisma/engines prisma \
  && mkdir -p apps/api/node_modules \
  && npm cache clean --force

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=deps /repo/node_modules node_modules
WORKDIR /repo/apps/api
# npm can place a workspace's dependency under the workspace instead of the root.
COPY --from=deps /repo/apps/api/node_modules node_modules
COPY apps/api/package.json apps/api/prisma.config.ts ./
COPY apps/api/prisma prisma
COPY --from=build /repo/apps/api/dist dist
USER node
EXPOSE 8050
# 384 MB of heap leaves room for the rest of the process on a 512 MB instance.
CMD ["sh", "-c", "/repo/node_modules/.bin/prisma migrate deploy && exec node --max-old-space-size=384 --enable-source-maps dist/main.js"]
