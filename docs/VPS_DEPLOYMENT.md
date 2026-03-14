# VPS Deployment Guide (Advanced)

> Most users do not need this. The CLAW Mining Skill runs directly on your local machine via your AI Agent. This guide is for advanced users who want to run a persistent miner on a remote server.

## Prerequisites

- A VPS (e.g., DigitalOcean, AWS, Hetzner) with Ubuntu 22.04+
- SSH access to the server
- Basic familiarity with the command line

## Server Specs

| Setup | CPU | RAM | Cost |
|-------|-----|-----|------|
| 1 address (auto mode) | 1 vCPU | 1 GB | ~$6/mo |

## Installation

### 1. SSH into Your Server

```bash
ssh root@YOUR_SERVER_IP
```

### 2. Install Node.js 20+

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt-get install -y nodejs git
```

### 3. Clone and Install

```bash
cd ~
git clone https://github.com/Cliai21/clawing.git
cd clawing/miner
npm install
```

### 4. Configure Environment

```bash
cp .env.mainnet.example .env
nano .env
# Fill in: PRIVATE_KEY, AI_API_KEY, RPC_URL, etc.
chmod 600 .env
```

### 5. Verify Configuration

```bash
npx tsx src/index.ts status
```

### 6. Start Mining in a Detachable Session

```bash
# Create a detachable session
screen -S claw-miner

# Start automatic mining
npx tsx src/index.ts auto

# Detach: press Ctrl+A then D
# Reattach later: screen -r claw-miner
```

## Firewall Setup (UFW)

```bash
sudo ufw allow 22/tcp    # SSH
sudo ufw enable
```

The miner only makes outbound connections — no inbound ports needed.

## Monitoring

```bash
# Reattach to the mining session
screen -r claw-miner

# View from outside (tail the screen log)
screen -S claw-miner -X hardcopy /tmp/claw-screen.txt && cat /tmp/claw-screen.txt
```

## Updating the Miner

```bash
cd ~/clawing/miner
git pull
npm install
# Restart the miner in screen
```

## Security Notes

1. **Use a dedicated mining wallet** — NOT your main wallet or hardware wallet
2. **Only keep minimal ETH** in the mining wallet (~0.01 ETH is plenty)
3. **Protect `.env`** — run `chmod 600 .env`, never commit to git
4. **Use SSH keys** for server access, disable password authentication
5. **Keep Node.js updated** — `sudo apt update && sudo apt upgrade nodejs`
