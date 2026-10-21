FROM node:22-bookworm-slim

ENV CI=true \
    WRANGLER_SEND_METRICS=false \
    npm_config_update_notifier=false

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git python3 \
    && rm -rf /var/lib/apt/lists/*

# The scanner expects the checkout and installed dependencies at /src.
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .

# Bundle the Worker without deploying or requiring Cloudflare credentials.
RUN npm run lint \
    && npm test \
    && ./node_modules/.bin/wrangler deploy --dry-run --outdir /tmp/e-zer0-worker

CMD ["bash"]
