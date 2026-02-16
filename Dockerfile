# Build stage
FROM oven/bun:alpine AS builder

WORKDIR /app

COPY package.json bun.lock ./
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --frozen-lockfile

COPY src ./src
RUN bun run build:standalone

# Production stage - minimal alpine
FROM alpine:latest AS production

WORKDIR /app

RUN apk add --no-cache libstdc++ libgcc

COPY --from=builder /app/dist/bot ./bot

ENV NODE_ENV=production

CMD ["./bot"]
