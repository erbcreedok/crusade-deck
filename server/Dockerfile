# Игровой сервер (Colyseus). Слушает $PORT (по умолчанию 2567).
# Данные аккаунтов пишутся в ./data относительно WORKDIR — примонтируй том поверх,
# иначе они пропадут при пересоздании контейнера (см. docker-compose.yml).

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist

# Номер сборки и коммит: в образе .git нет, спросить git неоткуда (см. src/version.ts).
# Сервер отдаёт их в /health — по ним видно, той же ли сборки клиент.
ARG APP_BUILD=dev
ARG APP_COMMIT=dev
ENV APP_BUILD=${APP_BUILD}
ENV APP_COMMIT=${APP_COMMIT}

EXPOSE 2567
CMD ["node", "dist/index.js"]
