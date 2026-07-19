#!/bin/sh
set -eu

runtime_secrets=/app/runtime-secrets
install -d -m 700 -o ngame -g ngame "$runtime_secrets"
install -m 600 -o ngame -g ngame /run/secrets/jwt_private_key "$runtime_secrets/jwt-private.pem"
install -m 644 -o ngame -g ngame /run/secrets/jwt_public_key "$runtime_secrets/jwt-public.pem"

export JWT_PRIVATE_KEY_FILE="$runtime_secrets/jwt-private.pem"
export JWT_PUBLIC_KEY_FILE="$runtime_secrets/jwt-public.pem"

exec setpriv --reuid=ngame --regid=ngame --init-groups "$@"
