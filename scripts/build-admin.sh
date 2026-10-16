#!/bin/sh
# Monta o painel admin para publicar (Cloudflare Pages): dist-admin/ com index.html + shared/ + noindex.
set -e
cd "$(dirname "$0")/.."
rm -rf dist-admin && mkdir -p dist-admin
sed 's|\.\./shared/|shared/|g' apps/admin/index.html > dist-admin/index.html
cp -r apps/shared dist-admin/shared && rm -rf dist-admin/shared/sons
printf 'User-agent: *\nDisallow: /\n' > dist-admin/robots.txt
printf '/*\n  X-Robots-Tag: noindex, nofollow\n  X-Frame-Options: DENY\n  Referrer-Policy: no-referrer\n' > dist-admin/_headers
echo "dist-admin pronto"
