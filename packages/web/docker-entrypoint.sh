#!/bin/sh
set -eu

# Render the runtime config before nginx starts so one built image can be used
# in compose and in K3s with different server URLs.
envsubst '${GAME_SERVER_URL}' < /etc/civ1/config.template.js \
  > /usr/share/nginx/html/config.js

exec nginx -g 'daemon off;'
