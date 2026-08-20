# Build stage
FROM oven/bun:slim AS builder

WORKDIR /app

COPY package.json bun.lock ./
COPY patches ./patches
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --frozen-lockfile

COPY src ./src
RUN bun run build:ws:standalone

# Production stage
FROM debian:bookworm-slim AS production

WORKDIR /app

RUN groupadd -g 10001 botgroup && useradd -u 10001 -g botgroup -m -s /sbin/nologin botuser

COPY --from=builder --chown=botuser:botgroup /app/dist/discord-ws ./discord-ws

USER botuser

ENV NODE_ENV=production

CMD ["./discord-ws", "--title=Honeypot-WS"]
