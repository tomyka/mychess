// Parses one decade page of šachmatai.lt's opening encyclopaedia
// (`debiutu_enciklopedija.php?id=E0`) into `code -> Lithuanian name` pairs.
// Pure, so the shape of that site's markup is testable without fetching it;
// `scripts/generate-eco-lt.mjs` does the fetching. Ported from v1
// (`src/lib/openings/eco-lt-parse.ts`, v1 issue #158).
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
    .replace(/&#(\d+);/g, (_match, code: string) =>
      String.fromCharCode(Number(code)),
    )
    .replace(/&amp;/g, '&');
}

/** The page's text, one trimmed non-empty line per tag-delimited run. */
function textLines(html: string): string[] {
  const withoutScripts = html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ');
  return decodeEntities(withoutScripts.replace(/<[^>]+>/g, '\n'))
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * The name among the two lines after a code: the first `- ` line that is not
 * a `- be …` / `- su …` move qualifier.
 */
function nameAfter(candidates: readonly string[]): string | undefined {
  const line = candidates.find(
    (candidate) =>
      candidate.startsWith('- ') && !/^- (be|su)\b/.test(candidate),
  );
  if (line === undefined) return undefined;
  const name = line.slice(2).trim();
  return name === '' ? undefined : name;
}

/**
 * `decade` is the two-character prefix the page covers, e.g. `E0` for
 * `E00`-`E09`. Codes from other decades are ignored: the pages carry
 * navigation listing every volume, and without this filter that navigation
 * would contribute bogus pairs.
 *
 * Matching a code requires the stripped line to be *exactly* the code, which
 * is also what keeps the volume nav's `E00 - E99` range label out of the
 * result: it survives tag-stripping as one line, not as a bare code.
 */
export function parseDecadePage(
  html: string,
  decade: string,
): Record<string, string> {
  const lines = textLines(html);
  const codePattern = new RegExp(`^${decade}\\d$`);
  const names: Record<string, string> = {};

  for (const [index, line] of lines.entries()) {
    if (!codePattern.test(line) || line in names) continue;
    const name = nameAfter(lines.slice(index + 1, index + 3));
    if (name !== undefined) names[line] = name;
  }

  return names;
}
