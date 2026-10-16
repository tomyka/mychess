import { describe, expect, it } from 'vitest';
import { parseDecadePage } from './eco-lt-parse';

// Trimmed from the real `?id=E0` markup. The shape that matters: the code and
// its name share one `<h3>`, the name inside an italic `<span>` prefixed by
// `- `. A bold moves line and a `- be …` ("without") qualifier follow, and the
// volume nav repeats a code-shaped string (`E00 - E99`) that is not a code.
const FIXTURE = `
<div style="float:left;"><a href="?id=E">&nbsp;E00 - E99</a></div>
<h3>E00 <span style="font-weight:normal; font-style: italic;"> - Valdovės pėstininko debiutas</span></h3>
<div><b>1. d4 Žf6 2. c4 e6</b><br />- be 3. g3, 3. Žf3, 3. Žc3</div>
<h3>E01 <span style="font-weight:normal; font-style: italic;"> - Kataloniškas debiutas, Uždaras variantas</span></h3>
<div><b>1. d4 Žf6 2. c4 e6 3. g3 d5</b><br />- su 4. Rg2</div>
<h3>E04 <span style="font-weight:normal; font-style: italic;"> - Kataloniškas debiutas, Atviras variantas 5.Žf3</span></h3>
<script>var next = "E99";</script>
`;

describe('parseDecadePage', () => {
  it('maps each ECO code to the Lithuanian name that follows it', () => {
    expect(parseDecadePage(FIXTURE, 'E0')).toEqual({
      E00: 'Valdovės pėstininko debiutas',
      E01: 'Kataloniškas debiutas, Uždaras variantas',
      E04: 'Kataloniškas debiutas, Atviras variantas 5.Žf3',
    });
  });

  it('ignores codes outside the requested decade', () => {
    const html =
      '<h3>E00 <span> - Vienas</span></h3><h3>D50 <span> - Kitas</span></h3>';
    expect(parseDecadePage(html, 'E0')).toEqual({ E00: 'Vienas' });
  });

  it('does not read the volume nav range as a code', () => {
    expect(
      parseDecadePage('<a href="?id=E">&nbsp;E00 - E99</a>', 'E0'),
    ).toEqual({});
  });

  it('skips a move qualifier standing where a name would be', () => {
    const html =
      '<h3>E00 <span> - be 3. g3</span></h3><span> - Valdovės pėstininko debiutas</span>';
    expect(parseDecadePage(html, 'E0')).toEqual({
      E00: 'Valdovės pėstininko debiutas',
    });
  });

  it('keeps the first name when a code appears twice', () => {
    const html =
      '<h3>E00 <span> - Pirmas</span></h3><h3>E00 <span> - Antras</span></h3>';
    expect(parseDecadePage(html, 'E0')).toEqual({ E00: 'Pirmas' });
  });

  it('leaves a code out when no name follows within two lines', () => {
    const html = '<h3>E00</h3><b>1. d4</b><i>Žf6</i><span> - Per toli</span>';
    expect(parseDecadePage(html, 'E0')).toEqual({});
  });

  it('returns an empty object when the markup carries no codes', () => {
    expect(parseDecadePage('<p>Nieko čia nėra</p>', 'E0')).toEqual({});
  });

  it('decodes numeric character references in names', () => {
    expect(
      parseDecadePage(
        '<h3>E00 <span> - Nimcovi&#269;iaus &#039;gynyba&#39;</span></h3>',
        'E0',
      ),
    ).toEqual({ E00: "Nimcovičiaus 'gynyba'" });
  });

  it('decodes HTML entities in names', () => {
    expect(
      parseDecadePage(
        '<h3>E00 <span> - Karaliaus &amp; valdovės debiutas</span></h3>',
        'E0',
      ),
    ).toEqual({
      E00: 'Karaliaus & valdovės debiutas',
    });
  });
});
