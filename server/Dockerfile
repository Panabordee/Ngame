FROM node:24.18.0-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app
RUN chown node:node /app

COPY --chown=node:node package.json package-lock.json tsconfig.json ./
COPY --chown=node:node client/package.json ./client/package.json
COPY --chown=node:node server/package.json ./server/package.json
COPY --chown=node:node shared/package.json ./shared/package.json
USER node
RUN npm ci --omit=dev --workspace @ngame/server --workspace @ngame/shared --include-workspace-root

COPY --chown=node:node server/src ./server/src
COPY --chown=node:node shared/src ./shared/src

EXPOSE 2567
CMD ["node", "server/src/index.ts"]
