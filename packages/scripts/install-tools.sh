#!/bin/bash
set -euo pipefail

echo "Installing development tools..."

# Install Claude Code
if ! command -v claude &> /dev/null; then
    echo "Installing Claude Code..."
    sudo npm install -g @anthropic-ai/claude-code || {
        echo "Warning: Failed to install Claude Code via npm"
    }
else
    echo "Claude Code is already installed"
fi

# Install Codex
if ! command -v codex &> /dev/null; then
    echo "Installing Codex..."
    sudo npm install -g @openai/codex || {
        echo "Warning: Failed to install Codex via npm"
    }
else
    echo "Codex is already installed"
fi

echo "Tool installation complete!"
