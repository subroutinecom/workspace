#!/bin/bash

set -euo pipefail

WORKSPACE_HOME="${WORKSPACE_HOME:-/home/workspace}"
AUTHORIZED_KEYS="${WORKSPACE_HOME}/.ssh/authorized_keys"

mkdir -p "${WORKSPACE_HOME}/.ssh"

if [[ -d /host/home/.ssh ]]; then
  cp -r /host/home/.ssh/* "${WORKSPACE_HOME}/.ssh/" 2>/dev/null || true
fi

if [[ ! -f "${AUTHORIZED_KEYS}" ]]; then
  touch "${AUTHORIZED_KEYS}"
fi

if [[ -n "${SSH_PUBLIC_KEY:-}" ]]; then
  if ! grep -qF "${SSH_PUBLIC_KEY}" "${AUTHORIZED_KEYS}" 2>/dev/null; then
    echo "${SSH_PUBLIC_KEY}" >> "${AUTHORIZED_KEYS}"
  fi
fi

sort -u "${AUTHORIZED_KEYS}" -o "${AUTHORIZED_KEYS}" 2>/dev/null || true

chown -R workspace:workspace "${WORKSPACE_HOME}/.ssh"
chmod 700 "${WORKSPACE_HOME}/.ssh"

find "${WORKSPACE_HOME}/.ssh" -type f -not -name "*.pub" -not -name "known_hosts" -not -name "config" -not -name "authorized_keys" -exec chmod 600 {} \; 2>/dev/null || true

chmod 644 "${WORKSPACE_HOME}/.ssh/"*.pub 2>/dev/null || true
chmod 644 "${WORKSPACE_HOME}/.ssh/known_hosts" 2>/dev/null || true
chmod 644 "${WORKSPACE_HOME}/.ssh/config" 2>/dev/null || true
chmod 600 "${AUTHORIZED_KEYS}"
