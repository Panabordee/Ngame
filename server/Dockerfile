FROM node:24.18.0-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json tsconfig.json ./
COPY client/package.json ./client/package.json
COPY server/package.json ./server/package.json
COPY shared/package.json ./shared/package.json
RUN npm ci --omit=dev --workspace @ngame/server --workspace @ngame/shared --include-workspace-root

COPY server/src ./server/src
COPY shared/src ./shared/src

RUN chown -R node:node /app
USER node
EXPOSE 2567
CMD ["node", "server/src/index.ts"]
