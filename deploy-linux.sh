#!/bin/bash
set -e

echo "=== Grudge Studio Backend — Linux Deployment ==="
echo ""

# Install Node.js 20 if not present
if ! command -v node &> /dev/null; then
    echo "Installing Node.js 20..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

# Install PostgreSQL if not present
if ! command -v psql &> /dev/null; then
    echo "Installing PostgreSQL 16..."
    sudo apt-get update
    sudo apt-get install -y postgresql postgresql-contrib
    sudo systemctl enable postgresql
    sudo systemctl start postgresql
fi

# Setup PostgreSQL database
echo "Setting up PostgreSQL database..."
sudo -u postgres psql -c "CREATE USER grudge WITH PASSWORD 'grudge_secure_2026';" 2>/dev/null || true
sudo -u postgres psql -c "CREATE DATABASE grudge_game OWNER grudge;" 2>/dev/null || true
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE grudge_game TO grudge;" 2>/dev/null || true

# Create .env if not exists
if [ ! -f .env ]; then
    echo "Creating .env from .env.example..."
    cp .env.example .env
    # Generate a random JWT secret
    JWT_SECRET=$(openssl rand -hex 32)
    sed -i "s|CHANGE_ME_generate_64_char_random_string|${JWT_SECRET}|" .env
    sed -i "s|CHANGE_ME|grudge_secure_2026|" .env
    echo "⚠️  Edit .env to add your CROSSMINT_API_KEY, DISCORD secrets, etc."
fi

# Install dependencies
echo "Installing dependencies..."
npm install

# Push database schema
echo "Pushing database schema..."
npx drizzle-kit push

# Build
echo "Building application..."
npm run build

echo ""
echo "✅ Build complete!"
echo ""
echo "To run in foreground:  npm run start"
echo "To run with PM2:       pm2 start dist/index.js --name grudge-backend"
echo "To run with systemd:   sudo cp deploy/grudge-backend.service /etc/systemd/system/"
echo "                       sudo systemctl enable --now grudge-backend"
echo ""
echo "App will be available at: http://$(hostname -I | awk '{print $1}'):${PORT:-5000}"
