#!/bin/bash

set -euo pipefail

WORKSPACE_HOME="${WORKSPACE_HOME:-/home/workspace}"
AUTHORIZED_KEYS="${WORKSPACE_HOME}/.ssh/authorized_keys"

mkdir -p "${WORKSPACE_HOME}/.ssh"
touch "${AUTHORIZED_KEYS}"

if [[ -n "${SSH_PUBLIC_KEY:-}" ]]; then
  echo "${SSH_PUBLIC_KEY}" >> "${AUTHORIZED_KEYS}"
fi

if [[ -f /host/home/.ssh/authorized_keys ]]; then
  cat /host/home/.ssh/authorized_keys >> "${AUTHORIZED_KEYS}"
fi

if [[ -d /host/home/.ssh ]]; then
  cp -r /host/home/.ssh/* "${WORKSPACE_HOME}/.ssh/" 2>/dev/null || true
fi

sort -u "${AUTHORIZED_KEYS}" -o "${AUTHORIZED_KEYS}" 2>/dev/null || true
chown -R workspace:workspace "${WORKSPACE_HOME}/.ssh"
chmod 700 "${WORKSPACE_HOME}/.ssh"
chmod 600 "${WORKSPACE_HOME}/.ssh/id_"* 2>/dev/null || true
chmod 644 "${WORKSPACE_HOME}/.ssh/"*.pub 2>/dev/null || true
chmod 644 "${WORKSPACE_HOME}/.ssh/known_hosts" 2>/dev/null || true
chmod 644 "${WORKSPACE_HOME}/.ssh/config" 2>/dev/null || true
chmod 600 "${AUTHORIZED_KEYS}"
