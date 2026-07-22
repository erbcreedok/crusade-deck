# Статика клиента. Адрес игрового сервера ЗАШИВАЕТСЯ В БАНДЛ на этапе сборки —
# передавай его build-аргументами (см. docker-compose.yml), а не переменными
# окружения контейнера: после `vite build` их уже некуда подставить.
#
#   docker build --build-arg VITE_SERVER_URL=wss://api.example.com \
#                 --build-arg VITE_HTTP_URL=https://api.example.com .

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .

ARG VITE_SERVER_URL=ws://localhost:2567
ARG VITE_HTTP_URL=http://localhost:2567
ENV VITE_SERVER_URL=${VITE_SERVER_URL}
ENV VITE_HTTP_URL=${VITE_HTTP_URL}
RUN npm run build

FROM nginx:alpine AS runtime
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
