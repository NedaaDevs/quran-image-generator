# Quran Line Image Generator

A CLI tool that generates per-line and per-page PNG images of the Quran using QCF (Quran Complex Font) page fonts.

Black glyphs on transparent background — enabling dark/light theming via tint color in consuming apps.

Based on [quran.com-images](https://github.com/quran/quran.com-images), adding per-line image generation using Bun + TypeScript + @napi-rs/canvas + SQLite.

## Prerequisites

- [Bun](https://bun.sh) runtime
- QCF V1 or V2 font files (from [King Fahd Quran Complex](https://qurancomplex.gov.sa/)) placed in `fonts/`

## Setup

```bash
bun install
```

## Usage

```bash
bun run src/cli.ts
```

## Credits

- [quran.com-images](https://github.com/quran/quran.com-images) — inspiration and original approach
- [Tanzil](https://tanzil.net/) — Quran metadata source
- [King Fahd Quran Complex](https://qurancomplex.gov.sa/) — QCF font files

## License

MIT
