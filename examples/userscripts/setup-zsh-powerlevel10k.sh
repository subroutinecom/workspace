#!/bin/bash
set -euo pipefail

# Userscript: Setup zsh with oh-my-zsh and powerlevel10k theme
#
# This script:
# - Installs oh-my-zsh (if not already installed)
# - Installs powerlevel10k theme
# - Copies your existing .p10k.zsh config from host machine (if available)
# - Sets zsh as the default shell
#
# To use this script:
# 1. Copy it to ~/.workspaces/userscripts/
# 2. Make it executable: chmod +x ~/.workspaces/userscripts/setup-zsh-powerlevel10k.sh
# 3. (Optional) Configure powerlevel10k on your host: run `p10k configure` in zsh
# 4. Start any workspace - the script runs automatically during initialization

echo "=== Setting up zsh with oh-my-zsh and powerlevel10k ==="

# Install oh-my-zsh if not present
if [ ! -d "$HOME/.oh-my-zsh" ]; then
    echo "Installing oh-my-zsh..."
    sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)" "" --unattended
else
    echo "oh-my-zsh is already installed"
fi

# Install powerlevel10k theme if not present
P10K_DIR="${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}/themes/powerlevel10k"
if [ ! -d "$P10K_DIR" ]; then
    echo "Installing powerlevel10k theme..."
    git clone --depth=1 https://github.com/romkatv/powerlevel10k.git "$P10K_DIR"
else
    echo "powerlevel10k is already installed"
fi

# Configure .zshrc to use powerlevel10k theme
if [ -f "$HOME/.zshrc" ]; then
    echo "Configuring .zshrc to use powerlevel10k..."
    sed -i 's/^ZSH_THEME=.*/ZSH_THEME="powerlevel10k\/powerlevel10k"/' "$HOME/.zshrc"
else
    echo "Warning: .zshrc not found, oh-my-zsh may not have installed correctly"
fi

# Copy p10k configuration from host if available
# The host home directory is mounted at /host/home in workspaces
HOST_P10K="/host/home/.p10k.zsh"
if [ -d "/host/home" ] && sudo test -f "$HOST_P10K"; then
    echo "Copying p10k configuration from host..."
    sudo cp "$HOST_P10K" "$HOME/.p10k.zsh"
    sudo chown "$(whoami):$(whoami)" "$HOME/.p10k.zsh"

    # Add p10k config source to .zshrc
    if [ -f "$HOME/.zshrc" ]; then
        # Remove any existing p10k source line to avoid duplicates
        sed -i '/\[[ -f ~\/\.p10k\.zsh \]\] && source ~\/\.p10k\.zsh/d' "$HOME/.zshrc"
        # Add source line at the end
        echo "" >> "$HOME/.zshrc"
        echo "# To customize prompt, run \`p10k configure\` or edit ~/.p10k.zsh." >> "$HOME/.zshrc"
        echo "[[ -f ~/.p10k.zsh ]] && source ~/.p10k.zsh" >> "$HOME/.zshrc"
    fi
    echo "Successfully copied and configured p10k config"
else
    echo "Note: p10k config not found on host at $HOST_P10K"
    echo "      You'll see the powerlevel10k configuration wizard on first zsh launch"
    echo "      After configuring, your .p10k.zsh will be saved for future workspaces"
fi

# Change default shell to zsh
CURRENT_SHELL=$(getent passwd "$(whoami)" | cut -d: -f7)
if [ "$CURRENT_SHELL" != "/usr/bin/zsh" ] && [ "$CURRENT_SHELL" != "/bin/zsh" ]; then
    echo "Changing default shell to zsh..."
    sudo chsh -s "$(which zsh)" "$(whoami)"
    echo "Default shell changed to zsh"
else
    echo "Default shell is already zsh"
fi

echo "=== zsh and powerlevel10k setup complete ==="
