FROM oven/bun:latest

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY src/ src/

ENTRYPOINT ["bun", "src/cli.ts"]
