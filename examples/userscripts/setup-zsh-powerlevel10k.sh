#!/bin/bash
set -euo pipefail

echo "=== User bootstrap: Setting up oh-my-zsh and powerlevel10k ==="

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

# Update .zshrc to use powerlevel10k theme
if [ -f "$HOME/.zshrc" ]; then
    echo "Configuring .zshrc to use powerlevel10k..."
    sed -i 's/^ZSH_THEME=.*/ZSH_THEME="powerlevel10k\/powerlevel10k"/' "$HOME/.zshrc"
else
    echo "Warning: .zshrc not found, oh-my-zsh may not have installed correctly"
fi

# Copy p10k configuration from host if available (use sudo since /host/home has restricted permissions)
HOST_P10K="/host/home/.p10k.zsh"
if sudo test -f "$HOST_P10K" 2>/dev/null; then
    echo "Found p10k config, copying to workspace..."
    sudo cp "$HOST_P10K" "$HOME/.p10k.zsh"
    sudo chown workspace:workspace "$HOME/.p10k.zsh"
    echo "✓ p10k config copied successfully"

    # Ensure .zshrc sources the p10k config
    if [ -f "$HOME/.zshrc" ]; then
        # Remove any existing p10k source line to avoid duplicates
        sed -i '/\[[ -f ~\/\.p10k\.zsh \]\] && source ~\/\.p10k\.zsh/d' "$HOME/.zshrc"
        # Add source line at the end
        echo "" >> "$HOME/.zshrc"
        echo "# To customize prompt, run \`p10k configure\` or edit ~/.p10k.zsh." >> "$HOME/.zshrc"
        echo "[[ -f ~/.p10k.zsh ]] && source ~/.p10k.zsh" >> "$HOME/.zshrc"
    fi
else
    echo "No p10k config found on host, you can run 'p10k configure' to set it up"
fi

# Change default shell to zsh
CURRENT_SHELL=$(getent passwd "$(whoami)" | cut -d: -f7)
if [ "$CURRENT_SHELL" != "/usr/bin/zsh" ] && [ "$CURRENT_SHELL" != "/bin/zsh" ]; then
    echo "Changing default shell to zsh..."
    sudo chsh -s "$(which zsh)" "$(whoami)"
    echo "Default shell changed to zsh (will take effect on next login)"
else
    echo "Default shell is already zsh"
fi

echo "=== oh-my-zsh and powerlevel10k setup complete ==="
echo "==="
