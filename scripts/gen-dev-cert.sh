#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CERT_DIR="$ROOT_DIR/certs"
KEY_FILE="$CERT_DIR/localhost-key.pem"
CERT_FILE="$CERT_DIR/localhost-cert.pem"

mkdir -p "$CERT_DIR"

if ! command -v openssl >/dev/null 2>&1; then
  echo "openssl not found. Install openssl and run again."
  exit 1
fi

cat > "$CERT_DIR/localhost-openssl.cnf" <<'EOF'
[req]
default_bits = 2048
prompt = no
default_md = sha256
distinguished_name = dn
x509_extensions = v3_req

[dn]
C = RU
ST = Dev
L = Dev
O = PulseMessenger
OU = Dev
CN = localhost

[v3_req]
subjectAltName = @alt_names
basicConstraints = CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth

[alt_names]
DNS.1 = localhost
IP.1 = 127.0.0.1
IP.2 = ::1
EOF

openssl req -x509 -nodes -newkey rsa:2048 \
  -keyout "$KEY_FILE" \
  -out "$CERT_FILE" \
  -days 825 \
  -config "$CERT_DIR/localhost-openssl.cnf"

rm -f "$CERT_DIR/localhost-openssl.cnf"

echo "Generated:"
echo "  $KEY_FILE"
echo "  $CERT_FILE"
echo "Run HTTPS server with: npm run start:https"
