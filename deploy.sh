#!/bin/bash
set -e

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
export PATH=$PATH:$(npm config get prefix)/bin

cd /opt/umrflix
git fetch origin main
git reset --hard origin/main
npm install
npm ci
npm run build
pm2 reload ecosystem.config.js --update-env
pm2 save