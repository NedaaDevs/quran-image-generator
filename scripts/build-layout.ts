import { Database } from "bun:sqlite";
import path from "path";

// Build layout DB for a font version from tarteel's mushaf layout + wbw glyph codes.
// Usage: bun scripts/build-layout.ts v1|v2|all

const ROOT = path.join(import.meta.dir, "..");

const VERSIONS: Record<string, { layout: string; wbw: string }> = {
  v1: {
    layout: "qpc-v1-15-lines.db",
    wbw: "qpc-v1-glyph-codes-wbw.db",
  },
  v2: {
    layout: "qpc-v2-15-lines.db",
    wbw: "qpc-v2.db",
  },
  // V4 tajweed uses V1 layout (same 1405H edition) with V4 color glyph codes
  v4: {
    layout: "qpc-v1-15-lines.db",
    wbw: "qpc-v4.db",
  },
};

// Map tarteel line_type → our type
const typeMap: Record<string, string> = {
  ayah: "text",
  surah_name: "surah-header",
  basmallah: "basmala",
};

const buildVersion = (version: string, cfg: { layout: string; wbw: string }) => {
  const layout = new Database(path.join(ROOT, "data", "all", cfg.layout), { readonly: true });
  const wbw = new Database(path.join(ROOT, "data", "all", cfg.wbw), { readonly: true });

  // Build word lookup by ID
  const allWords = wbw.query("SELECT id, surah, ayah, word, text FROM words ORDER BY id").all() as {
    id: number; surah: number; ayah: number; word: number; text: string;
  }[];
  const wordById = new Map(allWords.map((w) => [w.id, w]));

  // Detect markers: last word of each ayah
  const markerIds = new Set<number>();
  const ayahLastWord = new Map<string, number>();
  for (const w of allWords) {
    const key = `${w.surah}:${w.ayah}`;
    const prev = ayahLastWord.get(key);
    if (!prev || w.id > prev) ayahLastWord.set(key, w.id);
  }
  for (const id of ayahLastWord.values()) markerIds.add(id);

  // Create output DB
  const outPath = path.join(ROOT, "data", version, "quran-layout.db");
  const db = new Database(outPath);

  db.run("DROP TABLE IF EXISTS mushaf_layout");
  db.run("DROP TABLE IF EXISTS mushaf_words");
  db.run("DROP TABLE IF EXISTS surahs");
  db.run(
    "CREATE TABLE mushaf_layout (page INTEGER NOT NULL, line INTEGER NOT NULL, type TEXT NOT NULL, surah_number INTEGER, PRIMARY KEY (page, line))"
  );
  db.run(
    "CREATE TABLE mushaf_words (page INTEGER NOT NULL, line INTEGER NOT NULL, position INTEGER NOT NULL, surah_number INTEGER NOT NULL, ayah_number INTEGER NOT NULL, word_index INTEGER NOT NULL, text_qpc TEXT NOT NULL, PRIMARY KEY (page, line, position))"
  );
  db.run(
    "CREATE TABLE surahs (number INTEGER PRIMARY KEY, name_arabic TEXT NOT NULL, bismillah_pre INTEGER NOT NULL DEFAULT 1)"
  );

  const insertLayout = db.prepare("INSERT INTO mushaf_layout (page, line, type, surah_number) VALUES (?, ?, ?, ?)");
  const insertWord = db.prepare(
    "INSERT INTO mushaf_words (page, line, position, surah_number, ayah_number, word_index, text_qpc) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );

  db.run("BEGIN");

  const pages = layout.query(
    "SELECT page_number, line_number, line_type, first_word_id, last_word_id, surah_number FROM pages ORDER BY page_number, line_number"
  ).all() as {
    page_number: number; line_number: number; line_type: string;
    first_word_id: number | null; last_word_id: number | null;
    surah_number: number | null;
  }[];

  let wordCount = 0;
  for (const p of pages) {
    insertLayout.run(p.page_number, p.line_number, typeMap[p.line_type] ?? p.line_type, p.surah_number || null);

    if (p.line_type !== "ayah" || !p.first_word_id || !p.last_word_id) continue;

    let position = 1;
    for (let id = p.first_word_id; id <= p.last_word_id; id++) {
      const w = wordById.get(id);
      if (!w) continue;

      // Skip markers — they get merged with preceding word below
      if (markerIds.has(id)) continue;

      // Merge marker glyph with preceding word (space-separated) if next word is a marker on this line
      const nextId = id + 1;
      const next = wordById.get(nextId);
      const nextIsMarker = next && markerIds.has(nextId) && nextId <= p.last_word_id;
      const text = nextIsMarker ? `${w.text} ${next!.text}` : w.text;

      insertWord.run(p.page_number, p.line_number, position, w.surah, w.ayah, w.word, text);
      position++;
      wordCount++;
    }
  }

  // Populate surahs from metadata DB
  const metaDb = new Database(path.join(ROOT, "data", "all", "quran-metadata.db"), { readonly: true });
  const chapters = metaDb.query("SELECT id, name_arabic, bismillah_pre FROM chapters ORDER BY id")
    .all() as Array<{ id: number; name_arabic: string; bismillah_pre: number }>;
  metaDb.close();

  const insertSurah = db.prepare("INSERT INTO surahs (number, name_arabic, bismillah_pre) VALUES (?, ?, ?)");
  for (const c of chapters) {
    insertSurah.run(c.id, c.name_arabic, c.bismillah_pre);
  }

  db.run("COMMIT");

  const lc = db.query("SELECT COUNT(*) as c FROM mushaf_layout").get() as { c: number };
  const wc = db.query("SELECT COUNT(*) as c FROM mushaf_words").get() as { c: number };
  const pc = db.query("SELECT COUNT(DISTINCT page) as c FROM mushaf_layout").get() as { c: number };

  console.log(`${version}: ${outPath}`);
  console.log(`  Pages: ${pc.c}, Lines: ${lc.c}, Words: ${wc.c}`);

  db.close();
  layout.close();
  wbw.close();
};

// Parse args
const arg = process.argv[2] ?? "all";
const targets = arg === "all" ? Object.entries(VERSIONS) : [[arg, VERSIONS[arg]]];

if (!targets.every(([, v]) => v)) {
  console.error("Usage: bun scripts/build-layout.ts [v1|v2|v4|all]");
  process.exit(1);
}

for (const [version, cfg] of targets) {
  buildVersion(version!, cfg!);
}
