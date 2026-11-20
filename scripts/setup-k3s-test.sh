#!/usr/bin/env bash
# Start a self-contained K3s test cluster in a privileged Docker container.
# Uses alternate host ports so it coexists with a host K3s on 6443/30080/30787:
#   API 16443 | web 31080 | server HTTP 31787 | server WS 31788
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

NAME="civ1-k3s"
TMP_ROOT="${TMPDIR:-/tmp}/civ1-k3s"
mkdir -p "$TMP_ROOT"
KUBECONFIG_PATH="$TMP_ROOT/k3s-test.yaml"
DB_PASSWORD="civ1test"
SERVER_SECRET="k3s-test-secret"

echo "[k3s] building app images"
docker compose build server web >/dev/null
docker tag civ1browser-server civ1browser-server:local
docker tag civ1browser-web civ1browser-web:local

echo "[k3s] (re)creating container $NAME"
docker rm -f "$NAME" >/dev/null 2>&1 || true
# NodePorts: web 30080, server 30787/30788. HTTPS is exposed via port-forward.
docker run -d --privileged --name "$NAME" \
  -p 16443:6443 -p 31080:30080 -p 31787:30787 -p 31788:30788 \
  rancher/k3s:v1.31.4-k3s1 server \
  --disable=servicelb --write-kubeconfig-mode 644 >/dev/null

echo "[k3s] waiting for API and node registration"
for _ in $(seq 1 60); do
  node_count="$(docker exec "$NAME" kubectl get nodes --no-headers 2>/dev/null | wc -l || true)"
  node_count="${node_count//[^0-9]/}"
  if [ "$node_count" -ge 1 ]; then break; fi
  sleep 2
done
# K3s rotates its serving cert once at bootstrap; wait before copying the CA.
sleep 5
docker cp "$NAME":/etc/rancher/k3s/k3s.yaml "$KUBECONFIG_PATH"
sed -i 's/:6443/:16443/' "$KUBECONFIG_PATH"
export KUBECONFIG="$KUBECONFIG_PATH"
kubectl wait --for=condition=Ready node --all --timeout=90s >/dev/null

echo "[k3s] importing images into containerd"
docker save civ1browser-server:local | docker exec -i "$NAME" ctr -n k8s.io images import - >/dev/null
docker save civ1browser-web:local | docker exec -i "$NAME" ctr -n k8s.io images import - >/dev/null

echo "[k3s] applying namespace"
kubectl apply -f k8s/namespace.yaml >/dev/null

echo "[k3s] creating self-signed TLS secret for civ1.local"
CERT_DIR="$TMP_ROOT/civ1-tls"
mkdir -p "$CERT_DIR"
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout "$CERT_DIR/tls.key" -out "$CERT_DIR/tls.crt" \
  -subj "/CN=civ1.local" -addext "subjectAltName=DNS:civ1.local,DNS:localhost" >/dev/null 2>&1
kubectl -n civ1 delete secret civ1-tls >/dev/null 2>&1 || true
kubectl -n civ1 create secret tls civ1-tls \
  --cert="$CERT_DIR/tls.crt" --key="$CERT_DIR/tls.key" >/dev/null

echo "[k3s] applying manifests"
kubectl apply -k k8s >/dev/null
# Secrets are created outside git (see k8s/secrets.example.yaml).
kubectl -n civ1 delete secret civ1-db civ1-server >/dev/null 2>&1 || true
kubectl -n civ1 create secret generic civ1-db \
  --from-literal=POSTGRES_DB=civ1 --from-literal=POSTGRES_USER=civ1 \
  --from-literal=POSTGRES_PASSWORD="$DB_PASSWORD" >/dev/null
kubectl -n civ1 create secret generic civ1-server \
  --from-literal=PG_URL="postgres://civ1:${DB_PASSWORD}@civ1-postgres:5432/civ1" \
  --from-literal=GAME_SERVER_SECRET="$SERVER_SECRET" >/dev/null
# Point the web runtime config at this cluster's NodePort.
kubectl -n civ1 patch configmap civ1-web-config --type merge \
  -p '{"data":{"GAME_SERVER_URL":"http://localhost:31787"}}' >/dev/null
kubectl -n civ1 rollout restart deploy/civ1-web >/dev/null

echo "[k3s] waiting for pods"
for deploy in civ1-postgres civ1-server civ1-web; do
  kubectl -n civ1 rollout status --timeout=180s "statefulset/$deploy" 2>/dev/null \
    || kubectl -n civ1 rollout status --timeout=180s "deployment/$deploy" >/dev/null
done

echo "[k3s] waiting for ingress controller"
for _ in $(seq 1 40); do
  if kubectl -n kube-system get pods -l app.kubernetes.io/name=traefik 2>/dev/null | grep -q Running; then break; fi
  if kubectl -n kube-system get pods -l app=traefik 2>/dev/null | grep -q Running; then break; fi
  sleep 2
done

echo "[k3s] exposing HTTPS ingress on localhost:30443"
# Traefik's NodePort changes per cluster; a port-forward gives a stable URL.
pkill -f 'port-forward.*svc/traefik' >/dev/null 2>&1 || true
nohup kubectl -n kube-system port-forward svc/traefik 30443:443 >/dev/null 2>&1 &
sleep 3

echo "[k3s] ready"
echo "  web:      http://localhost:31080/"
echo "  server:   http://localhost:31787/health"
echo "  https:    https://civ1.local:30443/  (add 'civ1.local' to /etc/hosts)"
echo "  run:      CIV1_SERVER=http://localhost:31787 CIV1_WEB=http://localhost:31080 npm run test:k3s"
echo "  https e2e: CIV1_WEB=https://civ1.local:30443/ CIV1_SERVER=https://civ1.local:30443/api npm run test:k3s"
echo "  kubeconfig: $KUBECONFIG_PATH"
