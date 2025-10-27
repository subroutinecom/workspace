#!/bin/bash

set -euo pipefail

WORKSPACE_HOME="${WORKSPACE_HOME:-/home/workspace}"
AUTHORIZED_KEYS="${WORKSPACE_HOME}/.ssh/authorized_keys"

mkdir -p "${WORKSPACE_HOME}/.ssh"
touch "${AUTHORIZED_KEYS}"

# Add SSH public key from environment
if [[ -n "${SSH_PUBLIC_KEY:-}" ]]; then
  echo "${SSH_PUBLIC_KEY}" >> "${AUTHORIZED_KEYS}"
fi

# Add authorized_keys from host
if [[ -f /host/home/.ssh/authorized_keys ]]; then
  cat /host/home/.ssh/authorized_keys >> "${AUTHORIZED_KEYS}"
fi

# Copy SSH keys from host (if no agent is available)
# This runs as root so we can read the files, then chown to workspace user
if [[ ! -S /ssh-agent ]] && [[ -d /host/.ssh ]]; then
  for file in /host/.ssh/id_* /host/.ssh/known_hosts /host/.ssh/config; do
    if [[ -f "$file" ]]; then
      cp "$file" "${WORKSPACE_HOME}/.ssh/" 2>/dev/null || true
    fi
  done
fi

# Set correct ownership and permissions
sort -u "${AUTHORIZED_KEYS}" -o "${AUTHORIZED_KEYS}"
chown -R workspace:workspace "${WORKSPACE_HOME}/.ssh"
chmod 700 "${WORKSPACE_HOME}/.ssh"
chmod 600 "${WORKSPACE_HOME}/.ssh/id_"* 2>/dev/null || true
chmod 644 "${WORKSPACE_HOME}/.ssh/"*.pub 2>/dev/null || true
chmod 644 "${WORKSPACE_HOME}/.ssh/known_hosts" 2>/dev/null || true
chmod 644 "${WORKSPACE_HOME}/.ssh/config" 2>/dev/null || true
chmod 600 "${AUTHORIZED_KEYS}"
