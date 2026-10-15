#!/bin/sh
# Copia apps/shared para dentro de www/shared de cada app (Capacitor só empacota a pasta www).
cd "$(dirname "$0")/.."
for app in cliente motoboy; do rm -rf apps/$app/www/shared; cp -r apps/shared apps/$app/www/shared; done
echo "shared copiado"
