# Lithuanian Lichess broadcast organisers (research for R-196)

Researched 2026-11-10. Sources: Lichess public JSON API (`/api/broadcast/{tourId}`,
`/api/broadcast/{slug}/{roundSlug}/{roundId}`, `/api/broadcast/by/{user}`,
`/api/broadcast/search?q=`), about 30 requests, spaced 1.2 s apart, User-Agent
"MyChess research (+https://mychess.lt)". No 429s. No Lichess HTML, no profiles, no games.
Also used WebSearch, chessfed.lt, chesslive.lt and a few chess-results pages.

## Method notes (important for the design)

- `GET /api/broadcast/round/{roundId}` returned non-JSON; the slug form
  `/api/broadcast/{tourSlug}/{roundSlug}/{roundId}` and `/api/broadcast/{tourId}` work.
- **An official (tier-set) tour hides its owner**: `communityOwner` is absent on
  official tours, e.g. Vilnius Open 2025 Open A (tier 3, no owner), even though it shows up in
  `by/paulauskas` (https://lichess.org/api/broadcast/V5lhrL5v,
  https://lichess.org/api/broadcast/by/paulauskas).
- **`/api/broadcast/by/{user}` lists official tours as well as community ones**, with `tier` set on
  promoted ones. So all three organisers below have had some tours promoted to official.
- **`/api/broadcast/search` returned only official tours** in 16 Lithuanian-term queries
  (Lithuania, Vilnius, Kaunas, Klaipeda, Palanga, Druskininkai, LTU, sachmatu ...): every hit had
  `tier: 3` and no community tour showed up, e.g. Vilnius Open 2026 (community) did not. So search can't find
  community broadcasts, and the organiser list is the only way to reach them.
- The same event can exist twice: "Atviras 2025 m. Lietuvos greitųjų šachmatų čempionatas"
  has a community copy by kesnor7 (wExcSV4S) and a separate official tour (jp4eA1Fe). Dedupe is
  needed (https://lichess.org/api/broadcast/wExcSV4S, https://lichess.org/api/broadcast/jp4eA1Fe).
- chesslive.lt (still linked from chessfed.lt as "Partijų transliacija") archives only
  2018-2023 (http://chesslive.lt/). Lithuanian broadcasting appears to have moved to Lichess
  from 2023/2024. That is an inference from the dates.

## Organiser table

| Organiser account | Who they appear to be (stated source) | LT community broadcasts 2025-2026 | LT official (promoted) 2025-2026 | Evidence |
|---|---|---|---|---|
| `vakarinis` (display name "Vakarinis") | Main broadcaster of LŠF national events. Its tours set `website: https://www.chessfed.lt/` on the leagues, Lithuanian Championship and women's championship. It also broadcasts regional opens: Panevėžys (`website: http://www.chesslyga.lt/`), Klaipėda "Jūros šventė" (`website: https://klaipedossachmatai.lt/`), Vilkaviškis (`https://www.sirvinta.puslapiai.lt/`), Plungė, Jonava, Marijampolė, Birštonas. It looks like the LŠF's own broadcaster or a person working for it. That is an inference: no page names the account's owner. | **28** (14 in 2025, 14 in 2026, of which 4 have no dates yet and 1 is upcoming). 2025: R. Banaičio turnyras (01-21), Aukščiausioji Lyga 2025 (01-24..03-30), Moterų Lyga 2025 (01-25..03-30), LTU pusfinalis 2025 (03-11..16), Lithuanian women Ch 2025 (05-03..07), Lithuanian Ch 2025 Final (05-03..10), Vaikų Grand Prix 2025 Birštonas (06-07), Plungė 2025 A/B (07-15..20), Jūros šventė 2025 A/B (07-21..27), Panevėžys Open A/B 2025 (08-18..24), Medicinos darbuotojų ch 2025 (11-08). 2026: Banaičio turnyras A (01-10), Vilkaviškis Mayor's Cup (03-14..15), Suvalkijos pavasaris (04-26), Panevėžys Amateur Open (05-02..05), Jūros šventė 2026 A/B (07-20..26), Panevėžys Open A (08-12..16), In memoriam N. A. Buzas (08-22), LT greitųjų ch 2026 Jonava (09-05), Medicinos darbuotojų ch 2026 Klaipėda (11-14, upcoming), LT jaunių greitųjų U12/U14/U16/U18 (no dates) | **5**: Open Lithuanian Amateur Ch 2025 (11-20..23), LŠL 2026 Aukščiausioji and Moterų (2026-01-31..03-22), Lithuanian Ch 2026 Open and Women, Klaipėda (03-28..04-02) | https://lichess.org/api/broadcast/by/vakarinis , https://lichess.org/api/broadcast/by/vakarinis?page=2 (41 tours in all, all Lithuanian, 2023-2026), https://lichess.org/api/broadcast/oYMBTfxm , https://lichess.org/api/broadcast/TiFTMJeI |
| `kesnor7` | South-west Lithuania and resort events plus some LŠF events. Druskininkai tours give `website: https://juodabalta.org/`, and chessfed.lt names the Druskininkai congress organiser as 'Sporto ir meno klubas "Juoda - balta"' (https://www.chessfed.lt/varzybos/sachmatu-kongresas-druskininkuose-2027/). It also runs Baltija Cup Palanga, LŠF youth championships and the LŠF rapid/blitz championships (`website: https://www.chessfed.lt/`), plus Vilkaviškis, Marijampolė (Buzas memorial) and 1 lyga Pietvakariai. It looks like an arbiter or broadcaster serving several organisers. That is an inference. | **11** (all 2025): Druskininkai Open Blitz (01-03) and Rapid (01-04..05), 1 lyga Pietvakariai (02-01..03-01), LT jaunių ch BM10-16 (02-15..19), Vilkaviškis Mayor's Cup (04-05..06), LŠL pereinamasis mačas Kaunas (05-25), Baltija Cup 2025 Open B (06-16..19), Baltija Blitz I 2025 (06-18), Buzas memorial Marijampolė (08-23), Atviras LT greitųjų ch (11-15; an official duplicate exists), Atviras LT žaibo ch (11-16) | **6** (all 2026): Malsena Blitz Druskininkai (01-02), Druskininkai Rapid Open (01-03..04), LT jaunių ch BM10-18 Birštonas (02-13..17), Baltija Cup 2026 Blitz I, Open B, Blitz II (06-12..16) | https://lichess.org/api/broadcast/by/kesnor7 (23 tours, all Lithuanian, 2024-2026), https://lichess.org/api/broadcast/wExcSV4S |
| `paulauskas` | Vilnius Open / Vilnius Chess Club. Tours give `website: https://vilniuschess.lt/`, and the chess-results page of Vilnius Open 2026 lists "Vilnius Chess Club" as organiser (https://s1.chess-results.com/tnr1369713.aspx?lan=1&turdet=YES). | **2** (2026): Vilnius Open 2026 (07-03..06), Vilnius Invitational 2026 - IM (07-02..06) | **2** (2025): Vilnius Open 2025 Open A (07-07..13), Open B (07-10..13) | https://lichess.org/api/broadcast/8PbrZM5O , https://lichess.org/api/broadcast/by/paulauskas (4 tours) |

All three accounts broadcast only Lithuanian events. No foreign tours appear in their
by-lists.

## Coverage estimate (last 12 months: 2025-11-10 .. 2026-11-10)

Found **24 Lithuanian tours** with past dates in the window, after merging the duplicate
rapid championship. Upcoming, undated or older tours are not counted.

- Official (tier set, in the official dumps): **12 / 24 = 50%**. These are Amateur Ch 2025,
  LT rapid Ch 2025 (official copy), Malsena Blitz, Druskininkai Rapid, LŠL 2026 x2, youth Ch 2026,
  LT Ch 2026 x2 and Baltija Cup 2026 x3.
- Community, owned by vakarinis, kesnor7 or paulauskas: **12 / 24**. vakarinis owns 9: Banaitis
  2026, Vilkaviškis 2026, Suvalkijos, Panevėžys Amateur, Jūros šventė A/B, Panevėžys A 2026,
  Buzas 2026 and LT rapid Ch 2026. kesnor7 owns 1: LT blitz Ch 2025. paulauskas owns 2: Vilnius Open
  2026 and Vilnius Invitational 2026.
- **Official dumps plus these 3 organisers: 24 / 24 = 100% of what was found.**
- **Caveat: selection bias.** Most tours were found *through* these accounts' by-lists, and
  Lichess search sees only official tours, so 100% is an upper bound. The independent sample
  points the same way. Every Lithuanian broadcast that web search surfaced on its own (Aukščiausioji Lyga 2025,
  Druskininkai 2024, Amateur Ch 2025, LT Ch finals, Vilnius Open) belonged to one of these three
  accounts or was official. A realistic estimate is that **the 3 accounts plus the official dumps cover
  roughly 90%+ of Lithuanian OTB events broadcast on Lichess**.
- Lithuanian broadcasts found whose owner could not be determined: **only the official
  ones**, because official tours hide the owner. One example is jp4eA1Fe (official copy of LT rapid
  Ch 2025, https://lichess.org/api/broadcast/jp4eA1Fe). Older official tours like "Lithuania Chess
  Championship Finals" 2023 (MBvMmpy7), "Lithuanian Chess League 2024" (FnPwrJsC, nf1ievsf),
  "Lithuanian Championship 2024 Final" (UNoGQ9vS, RVn7WE1l) and "Vilnius Chess Championship 2024"
  (ebjoduY6, vK58RdqN) also have no owner shown. That does not matter for R-196, since the official dumps cover them.
  No community Lithuanian broadcast with an unknown owner was found.

## Notable Lithuanian events found with no Lichess broadcast (not exhaustive)

- XI Ararat Cup 2026, Klaipėda, 2026-11-06..08. Organisers are Chacatrian Armenak and Klaipėdos miesto
  šachmatų federacija. There is no live link on chess-results and no tour in the three by-lists
  (https://www.chessfed.lt/varzybos/ararat-cup-open-2026/ ,
  https://s2.chess-results.com/tnr1527341.aspx?lan=1&turdet=YES&SNode=S0).
- 2026 Pirma lyga final, Vilnius, 2026-04-18..19. Not found on Lichess
  (https://s1.chess-results.com/tnr1391566.aspx?lan=25).
- Plungė City Championship 2026, Klaipėda city finals 2026, Vilniaus senjorai 2026 and LAS Men Ch
  2026 (Vilnius, 02-18..22) are listed on chessstats.app but not found on Lichess
  (https://chessstats.app/tournament/471289 , https://chessstats.app/tournament/473289 ,
  https://chessstats.app/tournament/464319 , https://chessstats.app/tournament/466898).
- 2026 counterparts of events broadcast in 2025 were not found: the LT Ch semifinal (2025 by vakarinis),
  the 45th Plungė international (the 44th in 2025 was by vakarinis), the LŠL pereinamasis mačas and the 1 lyga regional
  groups (2025 by kesnor7). They may simply not have been broadcast.
- Baltija Cup 2026 Open A was not found. Only Open B and the blitz events were broadcast (kesnor7, official).
- chessfed.lt event pages never link Lichess. They link only the old http://chesslive.lt/, so
  chessfed.lt is not a usable discovery source (e.g.
  https://www.chessfed.lt/varzybos/atviras-lietuvos-megeju-sachmatu-cempionatas-2026-s50-ir-s65-cempionato-iskaitos/).
  The LŠF 2026 calendar exists only as a PDF
  (https://www.chessfed.lt/wp-content/uploads/LSF-VARZYBU-KALENDORIUS-2026-1.pdf, not read).
