# UmrFlix — VPS Deployment Guide

This guide covers deploying UmrFlix on your own VPS with **PM2** process management and **Nginx Proxy Manager** as the reverse proxy.

---

## Prerequisites

- A VPS running Ubuntu 22.04+ (or any Debian-based distro)
- **Nginx Proxy Manager** already running (Docker or bare-metal)
- A domain pointed to your VPS (e.g., `umrflix.example.com`)
- Node.js 20.x+ (LTS recommended)
- Git
- (Optional) A self-hosted Convex backend — see [Convex section](#optional-self-hosted-convex) below

---

## 1. Server Preparation

```bash
# Install Node.js 20 LTS (if not already installed)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git

# Verify
node -v   # v20.x+
npm -v    # 10.x+
```

---

## 2. Clone the Repository

```bash
sudo mkdir -p /opt/umrflix
sudo chown $USER:$USER /opt/umrflix
git clone https://github.com/YOUR_USER/umrflix.git /opt/umrflix
cd /opt/umrflix
```

---

## 3. Environment Configuration

Create the production environment file:

```bash
cp .env.example .env.local
nano .env.local
```

Set every variable for your environment:

```ini
# Required
TMDB_PROXY_URL=https://tmdb-proxy.<subdomain>.workers.dev
TMDB_PROXY_SECRET=your_tmdb_proxy_secret
NEXT_PUBLIC_APP_URL=https://umrflix.example.com
SESSION_SECRET=generate_a_random_64_char_string_here

# Radarr (if used)
RADARR_URL=http://your-radarr-host:7878
RADARR_API_KEY=your_radarr_api_key

# Sonarr (if used)
SONARR_URL=http://your-sonarr-host:8989
SONARR_API_KEY=your_sonarr_api_key

# Jellyfin (if used)
JELLYFIN_URL=http://your-jellyfin-host:8096
JELLYFIN_USERNAME=your_admin_username
JELLYFIN_PASSWORD=your_admin_password

# qBittorrent (if used)
QBITTORRENT_URL=http://your-qbit-host:8080
QBITTORRENT_USERNAME=your_qbit_username
QBITTORRENT_PASSWORD=your_qbit_password

# Convex (optional — see section below)
CONVEX_SELF_HOSTED_URL=http://your-convex-host:XXXX
CONVEX_SELF_HOSTED_ADMIN_KEY=your_convex_admin_key
NEXT_PUBLIC_CONVEX_URL=http://your-convex-host:XXXX
```

> **`SESSION_SECRET`**: Generate a strong random key:
> ```bash
> node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
> ```

---

## 4. Install Dependencies & Build

```bash
cd /opt/umrflix
npm ci
npm run build
```

The build output goes to `.next/`. A `data/` directory will be created automatically at runtime for file-based persistence (Convex fallback).

---

## 5. Process Management with PM2

Install PM2 globally and configure it to start on boot:

```bash
sudo npm install -g pm2

# Start the app in standard (fork) mode
pm2 start npm --name umrflix -- start

# Save the process list
pm2 save

# Enable PM2 startup (so it restarts on server reboot)
pm2 startup systemd
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u $USER --hp /home/$USER
```

> ⚠️ **CRITICAL WARNING FOR WATCH PARTY:**
> Do **NOT** use PM2 Cluster Mode (e.g. `pm2 start ... -i max`). Watch Party uses process-local memory for room management and real-time EventBus (SSE). Running in multi-process cluster mode splits users across isolated Node processes, causing members not to show up in parties and breaking media synchronization. Always run PM2 in single-instance (`fork`) mode (default).

**Useful PM2 commands:**
```bash
pm2 status              # Check status
pm2 logs umrflix        # View logs
pm2 restart umrflix     # Restart after config changes
pm2 stop umrflix        # Stop the app
```

The app will run on **port 3000** by default.

---

## 6. Nginx Proxy Manager — Domain Setup

Since you already have Nginx Proxy Manager running, add a new **Proxy Host**:

| Field | Value |
|-------|-------|
| **Domain** | `umrflix.example.com` |
| **Scheme** | `http` |
| **Forward IP** | Your VPS IP (e.g., `192.168.1.100` or `localhost`) |
| **Forward Port** | `3000` |
| **Cache Assets** | Yes (optional, recommended) |
| **Block Common Exploits** | Yes |
| **Websockets Support** | No (not needed — UmrFlix does not use WebSockets) |

### SSL
1. Go to the **SSL** tab
2. Select "Request a new SSL Certificate"
3. Enable "Force SSL" and "HTTP/2 Support"
4. Set "Email for Let's Encrypt" and agree to terms

### Required: Disable Buffering for Server-Sent Events (SSE) & Watch Party
UmrFlix uses Server-Sent Events (SSE) via `/api/events` for Watch Party state, membership updates, and real-time notifications. Nginx Proxy Manager buffers proxied responses by default, which causes Watch Party sync events to freeze or delay.

Add the following configuration in Nginx Proxy Manager under your Proxy Host's **Advanced** tab:

```nginx
# Disable buffering for SSE (Watch Party & real-time events)
location /api/events {
    proxy_pass http://127.0.0.1:3000/api/events;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 86400s;
    proxy_send_timeout 86400s;
}

# Never cache/buffer Watch Party API (snapshot polls drive the sync clock)
location /api/party {
    proxy_pass http://127.0.0.1:3000/api/party;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    proxy_buffering off;
    proxy_cache off;
}

# Optional: Increase body limit for media proxy streaming
client_max_body_size 100M;
proxy_read_timeout 600s;
proxy_send_timeout 600s;
```

> **Important:** If you use the Jellyfin media proxy (`/api/jellyfin/proxy/...`), consider increasing `proxy_read_timeout` significantly (e.g., `3600s`) or bypass the proxy entirely and connect the client directly to your Jellyfin instance.

---

## 7. Firewall

Ensure port 3000 is **not** exposed publicly — Nginx Proxy Manager handles external traffic:

```bash
sudo ufw allow 22/tcp          # SSH
sudo ufw allow 80/tcp          # HTTP (for NPM)
sudo ufw allow 443/tcp         # HTTPS (for NPM)
sudo ufw deny 3000/tcp         # Block direct access to Next.js
sudo ufw enable
```

---

## 8. (Optional) Self-Hosted Convex

UmrFlix uses Convex for persistent storage (watchlist, requests, notifications, room state). It falls back to local JSON files in `data/` if Convex is unavailable, but for production with watch parties, a Convex backend is recommended.

### Deploy Convex via Docker

```yaml
# docker-compose.yml
services:
  convex:
    image: ghcr.io/get-convex/convex-backend:latest
    ports:
      - "XXXX:XXXX"
    volumes:
      - convex_data:/data
    environment:
      - CONVEX_CLOUD_URL=http://0.0.0.0:XXXX

volumes:
  convex_data:
```

(Replace XXXX with the actual port — refer to Convex docs for current config.)

### Configure UmrFlix

Once Convex is running, point UmrFlix to it:

```ini
CONVEX_SELF_HOSTED_URL=http://your-vps-ip:XXXX
CONVEX_SELF_HOSTED_ADMIN_KEY=your_admin_key
NEXT_PUBLIC_CONVEX_URL=http://your-vps-ip:XXXX
```

Deploy the Convex functions:

```bash
cd /opt/umrflix
npx convex deploy
```

> **Heads up:** The Convex Docker image and ports change frequently. Check the [Convex self-hosting guide](https://docs.convex.dev/self-hosting) for the latest approach.

---

## 9. Updating the App

```bash
cd /opt/umrflix
git pull
npm ci
npm run build
pm2 restart umrflix
```

---

## 10. Logs & Monitoring

```bash
# Tail logs
pm2 logs umrflix --lines 100

# Monitor CPU/Memory
pm2 monit

# List all processes
pm2 status
```

---

## Architecture Overview

```
Internet
    │
    ▼
Nginx Proxy Manager (port 443/80)
    │
    ▼ (proxy_pass http://localhost:3000)
UmrFlix (Next.js, PM2, port 3000)
    │
    ├── TMDB / Radarr / Sonarr / Jellyfin (outbound)
    │
    └── data/ (JSON file fallback)
         └── (optional) Self-hosted Convex
```

---

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| `502 Bad Gateway` in NPM | Next.js not running | `pm2 restart umrflix` |
| Blank page, console 404s | Build artifacts missing | `npm run build` then restart |
| Auth not working across restarts | `SESSION_SECRET` changed | Set a fixed secret in `.env.local` |
| Images not loading | TMDB remote pattern mismatch | Check `next.config.ts` `remotePatterns` |
| High memory usage | Media proxy streaming | Disable `/api/jellyfin/proxy` — connect clients directly to Jellyfin |
| `data/` writes failing | Directory permissions | `sudo chown -R $USER:$USER /opt/umrflix/data` |
| Watch Party users missing / sync broken | PM2 in cluster mode or Nginx SSE buffering | Run PM2 in single-instance mode (`pm2 restart umrflix -- --fork`) and add `proxy_buffering off;` to NPM for `/api/events` |
