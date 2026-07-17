FROM node:24.18.0-bookworm-slim AS builder

WORKDIR /build
ARG VITE_API_URL
ARG VITE_REALTIME_URL
ENV VITE_API_URL=$VITE_API_URL \
    VITE_REALTIME_URL=$VITE_REALTIME_URL

COPY package.json package-lock.json tsconfig.json ./
COPY client/package.json ./client/package.json
COPY server/package.json ./server/package.json
COPY shared/package.json ./shared/package.json
RUN npm ci

COPY client ./client
COPY shared ./shared
RUN npm run build --workspace @ngame/client

FROM nginx:1.28-alpine
COPY client/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /build/client/dist /usr/share/nginx/html
EXPOSE 8080
