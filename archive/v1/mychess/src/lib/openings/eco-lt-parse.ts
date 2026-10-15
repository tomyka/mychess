// mychess/src/lib/openings/eco-lt-parse.ts
//
// Parses one decade page of šachmatai.lt's opening encyclopaedia
// (`debiutu_enciklopedija.php?id=E0`) into `code → Lithuanian name` pairs.
// Pure, so the shape of that site's markup is testable without fetching it —
// `scripts/generate-eco-data-lt.ts` does the fetching (GitHub issue #158).
//
// The page puts each code and its name in one `<h3>`, the name in an italic
// `<span>` prefixed by `- `. Two other `- ` lines appear nearby and are NOT
// names: `- be …` ("without") and `- su …` ("with") carry the move qualifiers
// that separate sibling codes.

/** Minimal entity decode. The pages are UTF-8, so Lithuanian letters arrive literal. */
function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, '&');
}

/**
 * `decade` is the two-character prefix the page covers, e.g. `E0` for
 * `E00`-`E09`. Codes from other decades are ignored: the pages carry
 * navigation listing every volume, and without this filter that navigation
 * would contribute bogus pairs.
 *
 * Matching a code requires the stripped line to be *exactly* the code, which
 * is also what keeps the volume nav's `E00 - E99` range label out of the
 * result — it survives tag-stripping as one line, not as a bare code.
 */
export function parseDecadePage(html: string, decade: string): Record<string, string> {
  const withoutScripts = html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ');
  const lines = decodeEntities(withoutScripts.replace(/<[^>]+>/g, '\n'))
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const codePattern = new RegExp(`^${decade}\\d$`);
  const names: Record<string, string> = {};

  for (const [index, line] of lines.entries()) {
    if (!codePattern.test(line)) continue;
    for (const candidate of lines.slice(index + 1, index + 3)) {
      if (!candidate.startsWith('- ')) continue;
      if (/^- (be|su)\b/.test(candidate)) continue;
      const name = candidate.slice(2).trim();
      if (name && !(line in names)) names[line] = name;
      break;
    }
  }

  return names;
}
