#!/bin/bash

set -euo pipefail

WORKSPACE_HOME="${WORKSPACE_HOME:-/home/workspace}"

if [[ -f "${WORKSPACE_HOME}/.ssh_agent_env" ]]; then
  cat >> /etc/environment <<EOF
$(grep '^SSH_AUTH_SOCK=' "${WORKSPACE_HOME}/.ssh_agent_env" | sed 's/; export SSH_AUTH_SOCK;//')
$(grep '^SSH_AGENT_PID=' "${WORKSPACE_HOME}/.ssh_agent_env" | sed 's/; export SSH_AGENT_PID;//')
EOF
fi
