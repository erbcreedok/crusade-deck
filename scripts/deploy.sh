#!/usr/bin/env bash
# Выкатка на Fly.io обеих апп с проставленным номером сборки.
#
# Зачем скрипт, а не два `fly deploy` руками:
#   1) ПОРЯДОК. Клиент вшивает адрес сервера в бандл на этапе сборки, поэтому сервер
#      выкатывается первым. Наоборот — и клиент уедет со старым адресом.
#   2) НОМЕР СБОРКИ. В контекст образа .git не попадает, изнутри его не спросить. Здесь он
#      считается снаружи и передаётся build-аргументом. Голый `fly deploy` соберёт образ с
#      подписью "dev", и по проду нельзя будет понять, что именно на нём крутится.
#
# Использование:
#   scripts/deploy.sh            # обе аппы
#   scripts/deploy.sh server     # только сервер
#   scripts/deploy.sh client     # только клиент
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ -n "$(git status --porcelain)" ]]; then
  echo "!! В рабочем дереве есть несохранённые правки — образ соберётся из них," >&2
  echo "   а номер сборки будет от последнего коммита. Закоммить или отложи их." >&2
  exit 1
fi

APP_BUILD="$(git rev-list --count HEAD)"
APP_COMMIT="$(git rev-parse --short HEAD)"
VERSION="$(node -p "require('./client/package.json').version")"
echo "==> Выкатываю v${VERSION}+${APP_BUILD} (${APP_COMMIT})"

target="${1:-all}"

deploy_one() {
  local dir="$1"
  echo "==> ${dir}"
  (cd "$dir" && flyctl deploy --now \
    --build-arg "APP_BUILD=${APP_BUILD}" \
    --build-arg "APP_COMMIT=${APP_COMMIT}")
}

# Сервер всегда первым: см. пункт 1 выше.
[[ "$target" == "all" || "$target" == "server" ]] && deploy_one server
[[ "$target" == "all" || "$target" == "client" ]] && deploy_one client

echo "==> Готово. Проверка:"
echo "    curl -s https://crusade-deck-server.fly.dev/health"
echo "    открыть https://crusade-deck-client.fly.dev/ — версия внизу главного экрана"
