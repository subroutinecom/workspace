if [ -f /etc/environment ]; then
  export $(grep "^SSH_AUTH_SOCK=" /etc/environment 2>/dev/null | xargs)
  export $(grep "^SSH_AGENT_PID=" /etc/environment 2>/dev/null | xargs)
fi
