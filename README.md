# Quran Image Generator

> **Warning:** This project is under active development and has **not been proofread** against a printed Mushaf. Do not use the output for production or distribution without thorough verification.

A CLI tool that generates per-line and per-page PNG/WebP images of the Quran using QCF (Quran Complex Font) page fonts.

Black glyphs on transparent background — enabling dark/light theming via tint color in consuming apps.

Supports font versions V1 (1405H), V2 (1423H), and V4 (Tajweed with embedded colors).

## Setup

```bash
bun install
```

## Usage

### Interactive

```bash
bun src/cli.ts
```

Prompts for version, mode, width, page range, format, and markers. Downloads assets from GitHub releases if missing.

### CLI args

```bash
bun src/cli.ts [startPage] [endPage] [width] [mode] [v1|v2|v4] [no-markers] [webp] [bounds] [json] [quantize]
```

Examples:
```bash
bun src/cli.ts 1 604 1440 line v2           # all pages, line mode, V2
bun src/cli.ts 1 10 1440 page v1 no-markers # pages 1-10, page mode, no markers
bun src/cli.ts 1 604 1440 line v4 webp      # V4 tajweed, WebP format
```

### Docker

```bash
docker compose build
docker compose run generator 1 604 1440 line v2
```

### Compiled binary

```bash
bun build src/cli.ts --compile --outfile quran-gen
./quran-gen 1 604 1440 line v2
```

## Output structure

```
output/{version}/{width}/
  lines/{page}/001..015.png    # per-line images (15 per page)
  pages/001..604.png           # full page images
  markers/surah-frame.png      # ornamental frame template
  bounds.db                    # glyph bounding boxes (SQLite)
```

## Data

Assets are downloaded automatically via the interactive CLI, or manually from [GitHub releases](https://github.com/NedaaDevs/quran-image-generator/releases):

```
data/
  common/fonts/                # surah name fonts, surah header font
  {v1,v2,v4}/
    quran-layout.db            # page/line/word layout + surah metadata
    fonts/p1..p604.ttf         # per-page QCF fonts
```

## Font versions

| Version | Edition | Layout | Notes |
|---------|---------|--------|-------|
| V1 | 1405H Madinah Mushaf | 604 pages, 15 lines | Uthman Taha calligraphy |
| V2 | 1423H Madinah Mushaf | 604 pages, 15 lines | Updated edition |
| V4 | Tajweed | Same as V1 | Embedded colors for tajweed rules |

## Credits

### Tarteel AI — Quranic Universal Library (QUL)

Special thanks to [Tarteel AI](https://tarteel.ai/) for their [Quranic Universal Library](https://qul.tarteel.ai/), which provides the essential data powering this tool:

- **QCF font files** — per-page V1, V2, and V4 glyph fonts
- **Word-by-word glyph codes** — mapping each Quranic word to its QCF codepoint
- **Mushaf layout data** — page/line/word mapping for the 1405H and 1423H Madinah Mushaf editions
- **Surah name ligature fonts** — version-matched calligraphic surah names

### Other Credits

- [quran.com-images](https://github.com/quran/quran.com-images) — inspiration and original approach
- [King Fahd Quran Printing Complex](https://qurancomplex.gov.sa/) — the original Madinah Mushaf calligraphy by Uthman Taha

## License

MIT
