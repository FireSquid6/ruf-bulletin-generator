FROM oven/bun:1.4.4 AS build
WORKDIR /app

COPY package.json bun.lock ./
COPY packages/cli/package.json packages/cli/package.json
COPY packages/frontend/package.json packages/frontend/package.json
COPY packages/generator/package.json packages/generator/package.json
COPY packages/server/package.json packages/server/package.json
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build \
    && rm -rf node_modules packages/*/node_modules \
    && bun install --frozen-lockfile --production

FROM oven/bun:1.4.4
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=bun:bun /app /app
USER bun
EXPOSE 3000
CMD ["bun", "run", "start"]
