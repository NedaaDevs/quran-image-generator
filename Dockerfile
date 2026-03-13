FROM oven/bun:latest AS build

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY src/ src/

RUN bun build src/cli.ts --compile --outfile quran-gen

FROM gcr.io/distroless/base-debian12

COPY --from=build /app/quran-gen /quran-gen

ENTRYPOINT ["/quran-gen"]
