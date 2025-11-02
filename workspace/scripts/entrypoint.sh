#!/bin/bash

# Super simple entrypoint - start services and never exit
# This allows us to investigate issues without the container crashing

echo "[entrypoint] Adding SSH key..."
/opt/workspace/add-ssh-key.sh || echo "[entrypoint] Failed to add SSH key (non-fatal)"

echo "[entrypoint] Setting up SSH agent environment..."
/opt/workspace/setup-ssh-env.sh || echo "[entrypoint] Failed to setup SSH env (non-fatal)"

if [ -f /etc/profile.d/workspace-ssh-agent.sh ]; then
  cat /etc/profile.d/workspace-ssh-agent.sh >> /home/workspace/.bashrc || true
  cat /etc/profile.d/workspace-ssh-agent.sh >> /home/workspace/.zshenv || true
  chown workspace:workspace /home/workspace/.bashrc /home/workspace/.zshenv 2>/dev/null || true
fi

echo "[entrypoint] Fixing workspace directory permissions..."
chown -R workspace:workspace /home/workspace/.cache 2>/dev/null || true

echo "[entrypoint] Starting Docker daemon..."
/usr/local/bin/dockerd-entrypoint.sh dockerd \
  --host=unix:///var/run/docker.sock \
  --host=tcp://0.0.0.0:2376 \
  >/var/log/dockerd.log 2>&1 &

echo "[entrypoint] Waiting for Docker daemon to be ready..."
DOCKER_READY=false
for i in {1..30}; do
  if docker version >/dev/null 2>&1; then
    DOCKER_READY=true
    echo "[entrypoint] Docker daemon is ready (took ${i}s)"
    break
  fi
  sleep 1
done

if [ "$DOCKER_READY" = "false" ]; then
  echo "[entrypoint] ERROR: Docker daemon failed to start after 30 seconds"
  echo "[entrypoint] Docker daemon logs:"
  tail -n 50 /var/log/dockerd.log
  exit 1
fi

echo "[entrypoint] Starting SSH daemon..."
/usr/sbin/sshd >/var/log/sshd.log 2>&1

echo "[entrypoint] Starting service monitor..."
/usr/local/bin/ensure-services.sh >/var/log/workspace-services.log 2>&1 &

echo "[entrypoint] All services started. Container will stay alive."
echo "[entrypoint] Logs: /var/log/dockerd.log, /var/log/sshd.log, /var/log/workspace-services.log"

# Tail docker logs to keep container alive and show what's happening
exec tail -f /var/log/dockerd.log
