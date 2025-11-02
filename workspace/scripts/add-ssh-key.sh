#!/bin/bash

set -euo pipefail

WORKSPACE_HOME="${WORKSPACE_HOME:-/home/workspace}"
AUTHORIZED_KEYS="${WORKSPACE_HOME}/.ssh/authorized_keys"
SSH_DIR="${WORKSPACE_HOME}/.ssh"

mkdir -p "${SSH_DIR}"

if [[ -d /host/home/.ssh ]]; then
  cp -r /host/home/.ssh/* "${SSH_DIR}/" 2>/dev/null || true
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
chown -R workspace:workspace "${SSH_DIR}"
chmod 700 "${SSH_DIR}"
chmod 600 "${SSH_DIR}/id_"* 2>/dev/null || true
chmod 644 "${SSH_DIR}/"*.pub 2>/dev/null || true
chmod 644 "${SSH_DIR}/known_hosts" 2>/dev/null || true
chmod 644 "${SSH_DIR}/config" 2>/dev/null || true
chmod 600 "${AUTHORIZED_KEYS}"

if ! su - workspace -c "pgrep -u \$(id -u) ssh-agent" >/dev/null 2>&1; then
  su - workspace -c "ssh-agent -s" | grep -E '^(SSH_AUTH_SOCK|SSH_AGENT_PID)' > "${WORKSPACE_HOME}/.ssh_agent_env"
  chown workspace:workspace "${WORKSPACE_HOME}/.ssh_agent_env"
  chmod 600 "${WORKSPACE_HOME}/.ssh_agent_env"
fi

loaded_keys=()
password_protected_keys=()

while IFS= read -r keyfile; do
  keyname="$(basename "${keyfile}")"

  if [[ "${keyname}" == "authorized_keys" ]] || [[ "${keyname}" == known_hosts* ]] || [[ "${keyname}" == "config" ]] || [[ "${keyname}" == *.pub ]]; then
    continue
  fi

  if ! ssh-keygen -y -P "" -f "${keyfile}" >/dev/null 2>&1; then
    password_protected_keys+=("${keyname}")
    continue
  fi

  if su - workspace -c "source ${WORKSPACE_HOME}/.ssh_agent_env 2>/dev/null && ssh-add ${keyfile}" </dev/null >/dev/null 2>&1; then
    loaded_keys+=("${keyname}")
  fi
done < <(find "${SSH_DIR}" -type f 2>/dev/null || true)

if [[ ${#loaded_keys[@]} -gt 0 ]]; then
  echo "Loaded SSH keys: ${loaded_keys[*]}"
fi

if [[ ${#password_protected_keys[@]} -gt 0 ]]; then
  echo "Skipped password-protected keys: ${password_protected_keys[*]}"
  echo "To use these keys, run: ssh-add ~/.ssh/<keyname>"
fi
