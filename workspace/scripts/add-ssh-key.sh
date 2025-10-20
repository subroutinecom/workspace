#!/bin/bash

set -euo pipefail

WORKSPACE_HOME="${WORKSPACE_HOME:-/home/workspace}"
AUTHORIZED_KEYS="${WORKSPACE_HOME}/.ssh/authorized_keys"

mkdir -p "$(dirname "${AUTHORIZED_KEYS}")"
touch "${AUTHORIZED_KEYS}"

if [[ -n "${SSH_PUBLIC_KEY:-}" ]]; then
  echo "${SSH_PUBLIC_KEY}" >> "${AUTHORIZED_KEYS}"
fi

if [[ -f /host/home/.ssh/authorized_keys ]]; then
  cat /host/home/.ssh/authorized_keys >> "${AUTHORIZED_KEYS}"
fi

sort -u "${AUTHORIZED_KEYS}" -o "${AUTHORIZED_KEYS}"
chmod 600 "${AUTHORIZED_KEYS}"
chown workspace:workspace "${AUTHORIZED_KEYS}"
