#!/bin/bash

# Semplify VM Setup Script
# Run this script after SSH into the VM
# Usage: chmod +x setup-vm.sh && ./setup-vm.sh

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}=========================================="
echo -e "  Semplify VM Setup Script"
echo -e "==========================================${NC}"
echo ""

# Step 1: Update system
echo -e "${YELLOW}[1/9] Updating system packages...${NC}"
sudo apt update && sudo apt upgrade -y
echo -e "${GREEN}  System updated${NC}"

# Step 2: Install essential packages
echo -e "${YELLOW}[2/9] Installing essential packages...${NC}"
sudo apt install -y \
  curl \
  wget \
  git \
  vim \
  htop \
  ufw \
  fail2ban \
  unzip \
  software-properties-common \
  apt-transport-https \
  ca-certificates \
  gnupg \
  lsb-release
echo -e "${GREEN}  Essential packages installed${NC}"

# Step 3: Configure firewall
echo -e "${YELLOW}[3/9] Configuring firewall (UFW)...${NC}"
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp comment 'SSH'
sudo ufw allow 80/tcp comment 'HTTP'
sudo ufw allow 443/tcp comment 'HTTPS'
sudo ufw allow 3000/tcp comment 'Dokploy Dashboard'
sudo ufw --force enable
echo -e "${GREEN}  Firewall configured${NC}"

# Step 4: Configure fail2ban
echo -e "${YELLOW}[4/9] Configuring fail2ban...${NC}"
sudo systemctl start fail2ban
sudo systemctl enable fail2ban
echo -e "${GREEN}  Fail2ban configured${NC}"

# Step 5: Set timezone
echo -e "${YELLOW}[5/9] Setting timezone to Europe/London...${NC}"
sudo timedatectl set-timezone Europe/London
echo -e "${GREEN}  Timezone set${NC}"

# Step 6: Create swap file
echo -e "${YELLOW}[6/9] Creating 4GB swap file...${NC}"
if [ ! -f /swapfile ]; then
    sudo fallocate -l 4G /swapfile
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile
    sudo swapon /swapfile
    echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
    echo -e "${GREEN}  Swap file created${NC}"
else
    echo -e "${GREEN}  Swap file already exists${NC}"
fi

# Step 7: Install Docker
echo -e "${YELLOW}[7/9] Installing Docker...${NC}"
if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com -o get-docker.sh
    sudo sh get-docker.sh
    sudo usermod -aG docker $USER
    rm get-docker.sh
    echo -e "${GREEN}  Docker installed${NC}"
else
    echo -e "${GREEN}  Docker already installed${NC}"
fi

# Step 8: Configure Docker daemon
echo -e "${YELLOW}[8/9] Configuring Docker daemon...${NC}"
sudo mkdir -p /etc/docker
sudo tee /etc/docker/daemon.json > /dev/null <<EOF
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  },
  "storage-driver": "overlay2"
}
EOF
sudo systemctl restart docker
sudo systemctl enable docker
echo -e "${GREEN}  Docker configured${NC}"

# Step 9: Install Dokploy
echo -e "${YELLOW}[9/9] Installing Dokploy...${NC}"
curl -sSL https://dokploy.com/install.sh | sh
echo -e "${GREEN}  Dokploy installed${NC}"

# Get public IP
PUBLIC_IP=$(curl -s ifconfig.me)

# Summary
echo ""
echo -e "${GREEN}=========================================="
echo -e "  Setup Complete!"
echo -e "==========================================${NC}"
echo ""
echo -e "${CYAN}System Info:${NC}"
echo -e "  Hostname:    $(hostname)"
echo -e "  Public IP:   $PUBLIC_IP"
echo -e "  Docker:      $(docker --version)"
echo ""
echo -e "${CYAN}Dokploy Dashboard:${NC}"
echo -e "  URL: ${YELLOW}http://$PUBLIC_IP:3000${NC}"
echo ""
echo -e "${CYAN}Firewall Status:${NC}"
sudo ufw status
echo ""
echo -e "${YELLOW}IMPORTANT:${NC}"
echo -e "  Log out and log back in for Docker group to take effect"
echo -e "  Or run: ${YELLOW}newgrp docker${NC}"
echo ""
echo -e "${CYAN}Next Steps:${NC}"
echo -e "  1. Open Dokploy dashboard in browser: http://$PUBLIC_IP:3000"
echo -e "  2. Create admin account"
echo -e "  3. Connect GitHub repository"
echo -e "  4. Deploy applications"
echo ""
