# Workspace demo Dockerfile
# Provides a reusable Docker-in-Docker environment with SSH access.

FROM docker:26.1-dind

RUN apk update && apk upgrade --no-cache && apk add --no-cache \
    bash \
    sudo \
    shadow \
    openssh-server \
    git \
    curl \
    wget \
    tzdata \
    nodejs \
    npm \
    yarn \
    python3 \
    py3-pip \
    jq \
    rsync \
    unzip \
    zip \
    nano \
    vim \
    docker-cli-compose \
    ca-certificates

RUN cp /usr/share/zoneinfo/UTC /etc/localtime \
    && echo "UTC" > /etc/timezone

# Configure SSH daemon defaults
RUN ssh-keygen -A \
    && sed -i 's/#\?PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config \
    && sed -i 's/#\?PasswordAuthentication.*/PasswordAuthentication yes/' /etc/ssh/sshd_config \
    && sed -i 's/#\?AllowTcpForwarding.*/AllowTcpForwarding yes/' /etc/ssh/sshd_config \
    && sed -i 's/#\?AllowAgentForwarding.*/AllowAgentForwarding yes/' /etc/ssh/sshd_config \
    && sed -i 's/#\?GatewayPorts.*/GatewayPorts clientspecified/' /etc/ssh/sshd_config

# Create workspace user with passwordless sudo
RUN adduser -D -s /bin/bash workspace \
    && echo "workspace:workspace" | chpasswd \
    && addgroup workspace wheel \
    && addgroup workspace docker \
    && echo "%wheel ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

# Prepare directories
RUN mkdir -p /home/workspace /workspace/config /workspace/template /workspace/source \
    && chown -R workspace:workspace /home/workspace /workspace

# Copy scripts into image
COPY scripts /opt/workspace/scripts
RUN chmod +x /opt/workspace/scripts/*.sh \
    && install -m 0755 /opt/workspace/scripts/init-workspace.sh /usr/local/bin/init-workspace.sh \
    && install -m 0755 /opt/workspace/scripts/ensure-services.sh /usr/local/bin/ensure-services.sh \
    && install -m 0755 /opt/workspace/scripts/entrypoint.sh /opt/workspace/entrypoint.sh \
    && install -m 0755 /opt/workspace/scripts/add-ssh-key.sh /opt/workspace/add-ssh-key.sh

USER root
WORKDIR /home/workspace

EXPOSE 22 2376

ENTRYPOINT ["/opt/workspace/entrypoint.sh"]
