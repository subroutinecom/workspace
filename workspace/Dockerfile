# Workspace Ubuntu Noble Dockerfile
# Provides a reusable Docker-in-Docker environment with SSH access.
# Migrated from Alpine to Ubuntu Noble (24.04 LTS)

FROM ubuntu:noble

# Prevent interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# Install prerequisites for adding Docker repository
RUN apt-get update && apt-get install -y \
    ca-certificates \
    curl \
    gnupg \
    lsb-release \
    && rm -rf /var/lib/apt/lists/*

# Add Docker's official GPG key and repository
RUN install -m 0755 -d /etc/apt/keyrings \
    && curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc \
    && chmod a+r /etc/apt/keyrings/docker.asc \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
    $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Docker Engine, CLI, and development tools
RUN apt-get update && apt-get install -y \
    docker-ce \
    docker-ce-cli \
    containerd.io \
    docker-buildx-plugin \
    docker-compose-plugin \
    bash \
    sudo \
    openssh-server \
    git \
    curl \
    wget \
    tzdata \
    nodejs \
    npm \
    python3 \
    python3-pip \
    jq \
    rsync \
    unzip \
    zip \
    nano \
    vim \
    iproute2 \
    iptables \
    kmod \
    openssl \
    procps \
    && rm -rf /var/lib/apt/lists/*

# Install yarn globally via npm
RUN npm install -g yarn

# Install docker-init (tini) for proper process management
RUN curl -fsSL https://github.com/krallin/tini/releases/download/v0.19.0/tini-static-$(dpkg --print-architecture) -o /usr/local/bin/docker-init \
    && chmod +x /usr/local/bin/docker-init

# Set up iptables-legacy for compatibility (many DinD setups work better with legacy)
RUN update-alternatives --set iptables /usr/sbin/iptables-legacy || true \
    && update-alternatives --set ip6tables /usr/sbin/ip6tables-legacy || true

# Create legacy iptables directory structure for dockerd-entrypoint.sh compatibility
RUN mkdir -p /usr/local/sbin/.iptables-legacy \
    && ln -s /usr/sbin/iptables-legacy /usr/local/sbin/.iptables-legacy/iptables \
    && ln -s /usr/sbin/ip6tables-legacy /usr/local/sbin/.iptables-legacy/ip6tables

# Set timezone to UTC
RUN ln -sf /usr/share/zoneinfo/UTC /etc/localtime \
    && echo "UTC" > /etc/timezone

# Configure SSH daemon
RUN mkdir -p /run/sshd \
    && ssh-keygen -A \
    && sed -i 's/#\?PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config \
    && sed -i 's/#\?PasswordAuthentication.*/PasswordAuthentication yes/' /etc/ssh/sshd_config \
    && sed -i 's/#\?AllowTcpForwarding.*/AllowTcpForwarding yes/' /etc/ssh/sshd_config \
    && sed -i 's/#\?AllowAgentForwarding.*/AllowAgentForwarding yes/' /etc/ssh/sshd_config \
    && sed -i 's/#\?GatewayPorts.*/GatewayPorts clientspecified/' /etc/ssh/sshd_config

# Create workspace user with passwordless sudo
RUN useradd -m -s /bin/bash workspace \
    && echo "workspace:workspace" | chpasswd \
    && usermod -aG sudo workspace \
    && usermod -aG docker workspace \
    && echo "%sudo ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

# Prepare directories
RUN mkdir -p /home/workspace /workspace/config /workspace/template /workspace/source \
    && chown -R workspace:workspace /home/workspace /workspace

# Copy scripts into image
COPY scripts /opt/workspace/scripts
RUN chmod +x /opt/workspace/scripts/*.sh \
    && install -m 0755 /opt/workspace/scripts/dockerd-entrypoint.sh /usr/local/bin/dockerd-entrypoint.sh \
    && install -m 0755 /opt/workspace/scripts/init-workspace.sh /usr/local/bin/init-workspace.sh \
    && install -m 0755 /opt/workspace/scripts/ensure-services.sh /usr/local/bin/ensure-services.sh \
    && install -m 0755 /opt/workspace/scripts/entrypoint.sh /opt/workspace/entrypoint.sh \
    && install -m 0755 /opt/workspace/scripts/add-ssh-key.sh /opt/workspace/add-ssh-key.sh

USER root
WORKDIR /home/workspace

EXPOSE 22 2376

ENTRYPOINT ["/opt/workspace/entrypoint.sh"]
