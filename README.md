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

### Tarteel AI — Quranic Universal Library (QUL)

Special thanks to [Tarteel AI](https://tarteel.ai/) for their [Quranic Universal Library](https://qul.tarteel.ai/), which provides the essential data powering this tool:

- **QCF font files** — per-page V1 and V2 glyph fonts
- **Word-by-word glyph codes** — mapping each Quranic word to its QCF code point
- **Mushaf layout data** — authoritative page/line/word mapping for both the 1405H (V1) and 1423H (V2) Madinah Mushaf editions

### Other Credits

- [quran.com-images](https://github.com/quran/quran.com-images) — inspiration and original approach
- [King Fahd Quran Printing Complex](https://qurancomplex.gov.sa/) — the original Madinah Mushaf calligraphy by Uthman Taha
- [tanzil.net](https://tanzil.net/) — Quran metadata

## License

MIT
