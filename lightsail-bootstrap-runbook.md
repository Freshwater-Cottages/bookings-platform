# Lightsail Bootstrap Runbook (Manual, Repo-Only)

Use this repository's manual Docker Compose bootstrap path from `DEPLOYMENT.md` to get a working Lightsail instance without automated infrastructure.

## 1. Create and wire the host

- Create an Ubuntu 24.04 Lightsail instance and attach a static IP.
- In Lightsail networking, allow inbound ports **22**, **80**, and **443**.
- Point DNS `A` records at the static IP:
  - apex/root domain (required)
  - optional: `www`, `bookings`, `dashboard` (the repo `Caddyfile` defines these hosts)

```
docker compose logs caddy --tail=200
curl -I http://your-domain.com
curl -vkI https://your-domain.com

Perfect — this log gives the exact cause: **DNS NXDOMAIN** for
`bookings.bookingsplatform.freshwatercottages.co.nz`.

Caddy is trying to issue certs for hosts defined in `Caddyfile`, including:
- `{$DOMAIN}`
- `bookings.{$DOMAIN}`
- `dashboard.{$DOMAIN}`
- `www.{$DOMAIN}`

So with `DOMAIN=bookingsplatform.freshwatercottages.co.nz`, you must create DNS records for:
- `bookingsplatform.freshwatercottages.co.nz`
- `bookings.bookingsplatform.freshwatercottages.co.nz`
- `dashboard.bookingsplatform.freshwatercottages.co.nz`
- (optional but configured) `www.bookingsplatform.freshwatercottages.co.nz`

All should point to the Lightsail static IP.
If you only want the base host and not those extra subdomains, remove those site blocks from `Caddyfile` (or change `DOMAIN`) and restart Caddy.
```

## 2. Instance sizing guidance

- For this repo's supported production shape (Docker Compose with `postgres` + `caddy` + `app` cron leader + blue/green web slots), **4 GB RAM is the realistic minimum**.
- A **2 GB / 2 vCPU** Lightsail instance is likely under-provisioned and may hit memory pressure/OOM.
- Recommendation:
  - **4 GB minimum** for light usage.
  - **8 GB preferred** for safer headroom during deploys and load spikes.

## 3. Install dependencies on the instance

```bash
sudo apt update
sudo apt install -y ca-certificates curl gnupg lsb-release

# Install Git
sudo apt install -y git

# Install Docker Engine + Docker Compose plugin using Docker's Ubuntu instructions

# Docker's Official GPG Key
sudo apt update
sudo apt install ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

# Docker's Repository
sudo tee /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF

sudo apt update

# Docker Engine + Compose Plugin
sudo apt install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Optional: Run Docker Without sudo
sudo usermod -aG docker $USER
newgrp docker
docker ps
```

You need `git`, `docker`, and `docker compose` available.

## 4. Clone the repo and prepare config files

```bash
git clone https://github.com/Freshwater-Cottages/bookings-platform.git
cd bookings-platform
cp .env.example .env
cp config/club.example.json config/club.json
```

## 5. Configure `.env` and `config/club.json`

Set at least these in `.env`:

- `DB_PASSWORD`
- `DATABASE_URL`
- `AUTH_SECRET`
- `NEXTAUTH_SECRET`
- `CRON_SECRET`
- `NEXTAUTH_URL`
- `AUTH_TRUST_HOST=true`
- `DOMAIN`
- `NEXT_PUBLIC_CONTACT_EMAIL`
- `SEED_ADMIN_EMAIL`
- `SEED_ADMIN_PASSWORD`
- `SEED_LODGE_PASSWORD`

Guidance:

- Keep Stripe/Xero/SES/Sentry on test/sandbox credentials until ready.
- In `config/club.json`, set club identity, beds, and rates (money values stay integer cents).

## 6. Bootstrap services

```bash
docker compose up -d --build postgres
```

```bash
# So it doesn't try and build it on the lightsail instance...
echo 'export GHCR_READ_TOKEN=your_token_here' >> ~/.bashrc
source ~/.bashrc

# 1. Authenticate (one-time, on the Lightsail host)
echo $GHCR_READ_TOKEN | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin

# 2. Resolve the SHA you want to deploy
SHA=$(git -C ~/bookings-platform rev-parse origin/ci-cd)
# or: origin/main once merged

# 3. Set MIGRATE_IMAGE in .env (or export inline)
echo "MIGRATE_IMAGE=ghcr.io/freshwater-cottages/bookings-platform-migrate:${SHA}" >> .env
echo "APP_IMAGE=ghcr.io/freshwater-cottages/bookings-platform-app:${SHA}" >> .env

# 4. Run migrate — now pulls instead of builds
docker compose run --rm migrate
```

```bash
# .env must include APP_IMAGE=ghcr.io/.../bookings-platform-app:<sha-or-latest>
docker compose pull app app_blue app_green caddy
docker compose up -d --no-build app app_blue app_green caddy
# docker compose up -d --build app app_blue app_green caddy
```

```bash
docker compose ps
```

## 7. Seed initial admin and lodge accounts

```bash
# from repo root on host
set -a; . ./.env; set +a

docker compose --profile migrate run --rm \
  -e SEED_ADMIN_EMAIL \
  -e SEED_ADMIN_PASSWORD \
  -e SEED_LODGE_PASSWORD \
  --entrypoint sh migrate -lc "npx tsx prisma/seed.ts"

# docker compose exec app npx tsx prisma/seed.ts
```

## 8. Smoke test

```bash
curl -fsS https://<your-domain>/api/health
curl -fsS https://<your-domain>/api/health/ready
```

Then sign in with the seeded admin, complete `/admin/setup`, and rotate seeded passwords immediately.

## 9. Post-bootstrap setup

- Configure provider webhooks on your live domain:
  - `/api/webhooks/stripe`
  - `/api/webhooks/xero`
  - `/api/webhooks/ses-sns`
- Enable only the modules you need in **Admin > Modules**.

## 10. Ongoing deploys

For routine production updates, use:

```bash
./scripts/run-production-blue-green-deploy.sh
```

This is the supported repo deploy path (typically with GHCR images).
