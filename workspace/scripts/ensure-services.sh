#!/bin/bash

# Ensure essential background services are running inside the workspace container.
# This script runs continuously to monitor and restart services if they crash.

set -euo pipefail

is_running() {
  pgrep -x "$1" >/dev/null 2>&1
}

start_docker() {
  if is_running "dockerd"; then
    return
  fi

  echo "[workspace:services] Starting Docker daemon..."
  dockerd \
    --host=unix:///var/run/docker.sock \
    --host=tcp://0.0.0.0:2376 \
    >/var/log/dockerd.log 2>&1 &

  for _ in {1..20}; do
    if docker info >/dev/null 2>&1; then
      echo "[workspace:services] Docker daemon is ready."
      return
    fi
    sleep 1
  done

  echo "[workspace:services] Warning: Docker daemon did not become ready in time."
}

start_sshd() {
  if is_running "sshd"; then
    return
  fi
  echo "[workspace:services] Starting SSH daemon..."
  /usr/sbin/sshd -D >/var/log/sshd.log 2>&1 &
}

start_docker
start_sshd

# Monitor services every 10 seconds and restart if needed
while true; do
  sleep 10
  start_docker
  start_sshd
done
