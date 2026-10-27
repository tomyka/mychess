# Lithuanian glossary

One word for one thing in the Lithuanian UI. The domain terms are those of
[CONTEXT.md](CONTEXT.md); this file says which Lithuanian (and English) word
the UI shows for each. Owned by the `i18n-content` role.

The starting vocabulary is v1's Lithuanian catalogue
(`archive/v1/mychess/messages/lt.json`, paired with `en.json`; ruling Q14,
R-29). The **source** column names the v1 key a word comes from, or says
**proposed** when v1 had no word for it or v1's word does not fit the v2
meaning. Every **proposed** row is waiting for the owner's decision; until
then it is the word to use, and changing it later means changing every
catalogue key that uses it.

Opening names are not in this file: they come from šachmatai.lt's own
taxonomy (`data/openings/lt/`) and are not translated.

## Rules for writers

- Use the LT word in the table for the domain term, in every screen and
  email. Do not switch to a synonym for variety.
- Address the user with the polite plural (**jūs**: "Įveskite", "Jūsų"), as
  v1 did throughout.
- Plurals of a whole count have three forms, ICU `one`, `few`, `other`:
  1, 21, 31 ... (not 11) **repertuaras**; 2-9, 22-29 ... (not 12-19)
  **repertuarai**; 0, 10-20, 30, 40 ... **repertuarų**. Every counted
  string in `lt.json` carries all three. CLDR's `many` is for fractions
  only and never applies to a count; `other` is required by ICU.
- Lithuanian quotation marks are „...“, not "...". Dashes: " — ".
- Words in the "Avoid" column of CONTEXT.md have Lithuanian counterparts to
  avoid as well; they are listed in the note column where v1 used them.

## People and links

| Domain term | EN UI word | LT UI word | Source | Note |
| --- | --- | --- | --- | --- |
| Account | Account | paskyra | v1 `join_needs_profile_body`, `settings_connected_accounts_heading` | |
| Player | Player | žaidėjas | v1 `nav_players`, `settings_role_player` | Not **mokinys** (student), which v1 used on coach screens (`coach_students_heading`); Student is retired. |
| Coach | Coach | treneris | v1 `nav_coaches`, `coach_note_title` | Collides with the FIDE trainer title, adopted (R-74). |
| Coach (capability switch) | Coach mode (proposed) | trenerio režimas | proposed | v1 had a role choice ("Esu: žaidėjas / treneris", `settings_role_label`); v2 has no coach account, so the role wording does not carry over. |
| Display name | Display name | rodomas vardas | approved (R-91) | v1 asked for first and last name (`welcome_first_name_label` vardas, `welcome_last_name_label` pavardė); v2 has one field. Not **vartotojo vardas** (username). |
| Coach link | Coach link | ryšys su treneriu | proposed | v1 said "aktyvus ryšys" (`coaches_request_error_active_relationship`). Verbs: link **susieti**, unlink **atsieti**. Not **prisijungti** (v1 `join_*` used it for linking, but it is the sign-in verb). |
| Invite | Invite | kvietimas | v1 `coach_invite_heading`, `coach_dashboard_invite_links_heading` | Invite link: **kvietimo nuoroda**. Verb: **pakviesti**. Kinds: **asmeninis kvietimas** / **grupės kvietimas** ("Personal invite" / "Group invite"). States: **galioja**, **nebegalioja**, **panaudotas**, **atšauktas** ("Active", "Expired", "Used", "Revoked"). Revoke: **atšaukti** (same verb as Cancel; only used on an invite row). |
| Group | Group | grupė | proposed | Not **klasė**, **komanda**, **klubas** (CONTEXT avoid list). |
| Group member | Player in the group | grupės žaidėjas | approved (R-120) | Only Players are members of a Group, so the UI says **žaidėjas** and never **narys** (member): one word for one person. Heading: **Grupės žaidėjai** / "Players in the group"; count: **# žaidėjas / žaidėjai / žaidėjų**. Add / remove: **pridėti** / **pašalinti iš grupės**. |
| Admin | Admin | administratorius | proposed | |

## Repertoires

| Domain term | EN UI word | LT UI word | Source | Note |
| --- | --- | --- | --- | --- |
| Repertoire | Repertoire | repertuaras | v1 `nav_repertoires`, `learn_repertoire_fallback_name` | |
| Side | Side | spalva | v1 `pgn_import_color_label` | |
| White / Black (side) | White / Black | baltieji / juodieji | proposed | v1 used **balta / juoda** (`pgn_import_color_white`) and **baltaisiais / juodaisiais** (`prep_as_white`). "As White": **baltaisiais**. Adopted (R-74). |
| Chapter | Chapter | skyrius | v1 `coach_chapters_link`, `repertoire_tree_chapter_heading` | Plural: skyrius / skyriai / skyrių. A chapter too short to classify: **Skyrius N** / "Chapter N" (R-104, approved R-118); its place in the list: **Skyrius 2 iš 5** / "Chapter 2 of 5". |
| Chapter intro | Chapter intro | skyriaus įžanga | proposed | The PGN comment before a chapter's first move (read-only in S3, R-112). |
| Opening (a Chapter's subject) | Opening | debiutas | v1 `opening_picker_heading`, `coach_player_coverage_heading` | |
| Position | Position | padėtis | v1 `move_nav_jump_to_current`, `learn_explore_position` | Not **pozicija**. Plural: padėtis / padėtys / padėčių; "in this position": **šioje padėtyje**. Starting position (FEN): **pradinė padėtis**. |
| Move | Move | ėjimas | v1 `repertoires_moves_count`, `games_moves_heading` | Plural: ėjimas / ėjimai / ėjimų. Play a move: **atlikti ėjimą**. Legal / illegal: **leistinas / neleistinas**. |
| Ply | Half-move | pusėjimis (gen. pl. pusėjimių) | approved (R-120) | Counts only; player-facing English says "half-move", not "ply". |
| Line | Line | variantas | v1 `practice_session_line_progress`, `repertoire_tree_line_count` | v1 used both **variantas** and **linija** (`coach_chapters_meta`, `pgn_import_review_summary`); **variantas** is the chess word. Not **linija**. Plural: variantas / variantai / variantų. "End of line": **varianto pabaiga**. A PGN variation in parentheses is also **variantas**; nested: **įdėtas variantas**. |
| Transposition | Transposition | ėjimų perstatymas | proposed | Plural: ėjimų perstatymas / perstatymai / perstatymų. Not **perstata**. |
| Comment (on a Move) | Comment | komentaras | approved (R-118) | Belongs to the repertoire and is exported with it (R-102). Distinct from **asmeninis užrašas** (private) and **trenerio pastaba**. Takes **komentaras** away from comment threads: a move comment thread becomes **pokalbis apie ėjimą** (see Thread). |
| Builder | Edit | redaguoti (switch), redagavimas (the mode) | approved (R-118) | The switch on the repertoire screen reads **Redaguoti** / "Edit"; "turn it on": **įjungti redagavimą**. Not **kūrimo režimas**: the mode also removes moves and edits comments, which is editing, and the design sketch says "Edit". |
| Draw (marks on the board) | Draw / Done | piešti / baigti | proposed | The touch draw mode of the builder. |
| Mark | Mark | žymė | proposed | An arrow or a circle on a move. Arrow: **rodyklė**; circle: **apskritimas**. Colours as adjectives: **žalia, raudona, geltona, mėlyna**. |
| Starter repertoire | Starter repertoire | pradinis repertuaras | proposed | Not **šablonas** (template). |
| Hint | Hint | užuomina | v1 `move_nav_show_hint` | |
| PGN | PGN | PGN | v1 `pgn_import_pgn_text_label` | Not translated. File: **PGN failas**. Upload: **įkelti**; import: **importuoti**; drop a file: **nutempti**. |
| Import summary | What the file holds | Kas yra faile | proposed | The R-64 preview before saving: chapters, lines, positions, transpositions, moves. |
| Skipped game | Skipped game | praleista partija | proposed | Listed as **Partija N: {priežastis}** / "Game N: {reason}"; the reason is a lowercase fragment. Not "N partija", which reads as a count. |
| Download PGN | Download PGN | atsisiųsti PGN | proposed | Not **eksportuoti**, as for the data export. |
| Side picker options | White / Black | Baltieji / Juodieji | R-74 | Options under **Spalva**; list headings and "No repertoire as White" use **baltaisiais / juodaisiais**. |

## Assignment and ownership

| Domain term | EN UI word | LT UI word | Source | Note |
| --- | --- | --- | --- | --- |
| Assignment | Assignment | priskyrimas | proposed (verb from v1 `coach_repertoires_assign_button` **priskirti**) | Assign: **priskirti**; unassign: **panaikinti priskyrimą** / "Unassign" (not **atšaukti**, which is the dialog's Cancel; its cancel reads **Palikti** / "Keep it"). A row's assigner: **Priskyrė {name}** / "Assigned by {name}". The player's home section: **Jums priskirti repertuarai** / "From my coach" (not "Iš mano trenerio": a player may have several coaches; v1's **Priskyrė jūsų treneris** would repeat each row's "Priskyrė {name}"). |
| Deadline (of an Assignment) | Deadline | terminas | proposed | **Terminas: {date}** / "Deadline: {date}"; **Be termino** / "No deadline"; change / clear: **keisti terminą** / **panaikinti terminą**. |
| Overdue (badge) | Overdue | pradelsta | proposed | The standard word for a passed deadline (pradelstas terminas). Not **pavėluota** (late, of an arrival). Not used for a Due review. |
| Paused (badge) | Paused | pristabdyta | proposed | Verbs: **pristabdyti** / **tęsti** ("Pause" / "Resume"). |
| Updated (badge) | Updated | atnaujinta | proposed | Until the player opens it (R-133). What changed: **Pridėta: …**, **Pašalinta: …**, **Pakeisti # ėjimo / ėjimų komentarai ar žymės**; moves of chapters the coach deleted go under **Ištrinti skyriai** / "Deleted chapters". |
| Fork | Own copy; make my own copy (proposed) | asmeninė kopija | proposed | Verb: **pasidaryti asmeninę kopiją** / "Make my own copy". The coach's badge for a player who forked: **Pasidarė asmeninę kopiją** / "Made their own copy". "Fork" is a developer word in both languages. Not **klonas**. |
| Fork offer | Copies you can keep | pasiūlymas pasilikti kopiją | proposed | Section: **Kopijos, kurias galite pasilikti**; accept: **Pasilikti kopiją** / "Keep a copy"; decline: **Ne, ačiū** / "No, thanks"; time left: **Liko # diena / dienos / dienų**; "within 30 days": **per # dieną / dienas / dienų** (not "pasilikti … 30 dienų", which reads as keeping it only for 30 days). |
| Personal note | Personal note (UI: "My note") | asmeninis užrašas (UI: **Mano užrašas**) | approved (R-116, R-118; was proposed **asmeninė pastaba**) | R-116 names the button "Mano užrašas", so the UI uses **užrašas** throughout; **pastaba** stays for the Coach note, which keeps the two apart. Not **komentaras** (a Comment belongs to the repertoire). |
| Share (an own Repertoire with a linked Coach) | Share with a coach / Shared with N coaches / Not shared | bendrinti (su treneriu) / bendrinama su # treneriu, treneriais, trenerių / nebendrinama | approved (R-127) | The standard software verb (Google, Microsoft): **bendrinti**. Not **dalintis / pasidalinti** (v1 `coach_invite_share_label` used it for passing on a link, which is ordinary speech, not this access). State: **bendrinamas** (adj.), **bendrinama** (status line); stop sharing: **nebebendrinti**. Coach's list: **Bendrinami repertuarai** / "Shared repertoires". After **su** the count is instrumental for one and few (treneriu, treneriais) and genitive plural for other (0, 10-20: trenerių). |
| Coach note | Coach note (coach's own view: "My coach note") | trenerio pastaba (coach's own view: **Mano pastaba**) | v1 `coach_note_title` | Same word on an assigned and on a shared Repertoire (CONTEXT). Distinct from **komentaras** (Comment, R-118) and **užrašas** (Personal note). Shown to the player with the name after a dash, nominative: **Trenerio pastaba — {name}**. The coach's own label is **Mano pastaba**, not "Mano trenerio pastaba", which reads as "my coach's note". |
| Reconciliation | (not shown) | (not shown) | - | The UI shows only its Notification: "Your coach updated this repertoire" / **Jūsų treneris atnaujino šį repertuarą** (v1 `practice_coach_update_notice`). |

## Training

| Domain term | EN UI word | LT UI word | Source | Note |
| --- | --- | --- | --- | --- |
| Training (the page) | Training | treniruotė | R-148 | The page where both drills run, at `/treniruote` (`ROUTES.training`). Also the section title in settings and in the repertoire's "I know this" panel: **Treniruotė** / "Training". Loading: **Kraunama treniruotė…**. |
| Today's review | Today's review | Šiandienos kartojimas | persona journeys (U1-M1-3), R-148 | Review over every repertoire the player trains (R-142): the home block and the page title. Start: **Pradėti kartojimą** / "Start review". Count line: **# kartotinas / kartotini / kartotinų · apie N min.** / "N due · about N min". |
| Learn pass | Learn | mokytis (verb, button), mokymasis (noun, mode label) | v1 `nav_learn`, `repertoires_action_learn` | The button takes the genitive: **Mokytis # naujo ėjimo / # naujų ėjimų / # naujų ėjimų** / "Learn # new move(s)"; on a repertoire **Mokytis (N)**. Not **Išmokti** (perfective "learn completely", and a second verb for one thing). Page title: **Nauji ėjimai** / "New moves". |
| Arrows round (of a Learn pass) | (no name shown) "Play the move the arrow shows" | (no name shown) **Sužaiskite ėjimą, kurį rodo rodyklė** | R-148 | R-144's first round. In docs and talk: **ratas su rodyklėmis** / "arrows round". The UI shows only the prompt. |
| Blind round (of a Learn pass) | (no name shown) "Now without the arrow" | (no name shown) **Dabar be rodyklės** | proposed (S6; replaces v1 `practice_status_blind` "sužaiskite iš atminties") | R-144's second round. In docs and talk: **ratas be rodyklių** / "blind round". |
| Review | Review | kartojimas (noun), kartoti (verb) | v1 `coach_player_stat_reviews` | Not **praktika** (v1 `nav_practice`; Practice is retired). Not **peržiūra** (that is "preview/look over"). On a repertoire: **Kartoti (N)** / "Review (N)". |
| Review session | Session | sesija (kartojimo sesija in prose) | proposed (v1 `practice_this_session_heading` **sesija**) | End: **Baigti sesiją** / "End session"; done: **Sesija baigta** / "Session done". |
| Session size (setting) | Reviews per session | kartojimų per sesiją | R-148 | R-146. Hint **Nuo 10 iki 100.** |
| New moves a day (setting) | New moves a day | naujų ėjimų per dieną | R-148 | R-146. Hint **Nuo 0 iki 50; 0 — tik kartojimas.** / "0 means review only". Reached: **Šiandienos naujų ėjimų riba pasiekta** / "Today's new moves are done". |
| Due | Due | laikas kartoti (status), kartotini (count) | proposed | "12 due": **12 kartotinų** (one: kartotinas, few: kartotini, other: kartotinų). Nothing due: **Šiuo metu kartoti nieko nereikia** / "Nothing due now"; next: **Kitas kartojimas: {when}** / "Next review: {when}". |
| Lapse | Lapse | suklydimas | proposed | Not **klaida** (kept for Player mistake and for game analysis) and not **pažeminimas** (demotion, v1). In the drill the word is not shown; the panel says **Ne tas ėjimas. Sužaiskite ėjimą, kurį rodo rodyklė.** / "Not that move. Play the move the arrow shows." (same line for a wrong new move in a Learn pass). Done summary label: **suklydimai** / "lapses". |
| Learned (state) | Learned | išmokta | v1 `repertoire_row_status_learned` | Progress line: **N išmokta · # kartotinas/-i/-ų · N liko išmokti** / "N learned · N due · N to learn". |
| Free play | Free play | laisvas žaidimas | proposed | |
| Correct / wrong (drill feedback) | Correct / Not that move | teisingai / ne tas ėjimas | v1 `practice_status_correct`, `practice_status_wrong` | **Teisingai** / "Correct". Not **Ne šis ėjimas**. |
| Side to move (drill) | White to move / Black to move | Baltųjų ėjimas / Juodųjų ėjimas | R-148 | Genitive first, as Lithuanian chess texts write it; not "Ėjimas baltųjų". The prompt: **Jūsų ėjimas** / "Your move". |
| Opponent's reply (drill) | Opponent played {move}. | Varžovo atsakas: {move}. | R-148 | SAN cannot be declined, so the noun form avoids "suėjo {move}" (colloquial) and "atsakė {move}" (needs the instrumental). |
| Line so far (drill) | Line so far | iki šiol sužaistas variantas | R-148 | Screen-reader heading of the move list. |
| Hint (drill) | Hint | užuomina | v1 `move_nav_show_hint` | Button **Užuomina**; after it: **Užuomina: eikite paryškinta figūra.** / "Hint: move the highlighted piece." |
| Two answers (drill notice) | Your other repertoires play another move here: | Kituose jūsų repertuaruose čia žaidžiamas kitas ėjimas: | R-148 | No noun in the UI; each row **{repertuaras}: {ėjimas}**. In docs: "two answers". |
| I know this | I know this move / line / chapter | Žinau šį ėjimą / šį variantą / šį skyrių | R-148 | R-147. Confirm: **Pažymėti, kad žinote # ėjimą / # ėjimus / # ėjimų?** (button **Pažymėti** / "Mark as known"); done: **Pažymėta, kad žinote # ėjimą / ėjimus / ėjimų.** Not "pažymėti … kaip žinomus": with the genitive count (10 ėjimų) the adjective cannot agree. In a Learn pass, a known move: **Šį ėjimą jau žinote: sužaiskite jį.** (žinoti, not mokėti, to match the button). |
| Learn again | Learn again | mokytis iš naujo | R-148 | R-147. **Mokytis iš naujo (# ėjimas / ėjimai / ėjimų)**; done: **# ėjimas grąžintas / ėjimai grąžinti / ėjimų grąžinta mokytis iš naujo.** |
| Unsaved results (banner) | # results are not saved yet. We will keep trying. | # rezultatas dar neišsaugotas (few: rezultatai … neišsaugoti; other: rezultatų … neišsaugota). Bandysime toliau. | R-148 | R-60 queue. Retry: **Bandyti dabar** / "Try now". Not **nesinchronizuota** (developer word). |

## Real games

| Domain term | EN UI word | LT UI word | Source | Note |
| --- | --- | --- | --- | --- |
| Imported game | Imported game | importuota partija | v1 `nav_games` **partijos** | v1 also used **žaidimas** (`games_heading`, `settings_import_games_heading`); a chess game is **partija**. Not **žaidimas**. |
| Deviation | Deviation | nukrypimas | proposed | |
| Player mistake | Your mistake | jūsų klaida | proposed (v1 `games_mistake_count` **klaida**) | |
| Opponent left book | Opponent left your repertoire | varžovas išėjo iš repertuaro | proposed | Opponent: **varžovas**. |
| Explorer | Explorer | debiutų naršyklė | proposed | |
| Lichess / Chess.com account link | Connect | prijungti / atjungti | v1 `settings_connect_button`, `settings_disconnect_button` | |

## Coaching

| Domain term | EN UI word | LT UI word | Source | Note |
| --- | --- | --- | --- | --- |
| Goal | Goal | tikslas | proposed | Not **užduotis** (v1 quests, retired). |
| Habit goal | Habit goal | įpročio tikslas | proposed | |
| Mastery goal | Mastery goal | įvaldymo tikslas | proposed (v1 `repertoire_row_status_mastered` **įvaldyta**) | |
| Results goal | Results goal | rezultatų tikslas | proposed | |
| Thread | Conversation (proposed) | pokalbis | proposed | 1:1 thread: **pokalbis**; group thread: **grupės pokalbis**; move comment thread: **pokalbis apie ėjimą** (approved, R-118; was **komentarai**, now the word for a move Comment). A single message: **žinutė**. Not **čatas**. |
| Notification | Notification | pranešimas | proposed (v1 `practice_dismiss_coach_notice_label`) | |
| Digest | Daily digest | dienos suvestinė | proposed | Not **naujienlaiškis** (newsletter). |
| Weak spot | Weak spot | silpnoji vieta | proposed | v1 had "klaidų vietos" (`coach_player_hotspots_heading`) for a similar view. |
| Coach dashboard | Coach dashboard | trenerio skydelis | v1 `coach_dashboard_heading` | The coach's own pages at `/treneris` (players, groups, invites; later flags, goals, overdue assignments). The S4 spec calls it "Coach area"; the UI does not: one place, one word, as in v1, whose coach dashboard held the same players and invite links. Not **trenerio sritis**. |
| My coaches (player's settings section) | My coaches | Mano treneriai | S4 spec | |
| Progress | Progress | pažanga | v1 `learn_progress_heading`, S7 (#257) | The coach's page per Player and Repertoire (R-152) at `/treneris/zaidejai/<id>/pazanga/<id>` (`coachProgressPath`; slug without diacritics, as `zaidejai`, `grupes`, `treniruote`). Title **Pažanga** / "Progress", also the link to it from a shared repertoire; drill-down headings **Skyriai** / **Variantai**. Share: **{N} % išmokta** / "{N}% learned" (space before % in Lithuanian). No own moves: **Nėra ko mokytis** / "Nothing to learn" (genitive after **nėra**, not "nėra ką"). Not **progresas**. |
| Move states (coach view) | learned · due · marked as known · to learn | išmokta · kartotinas/-i/-ų · pažymėta „Žinau“ · liko išmokti | R-151, proposed (S7) | The four states as one count line: **{N} išmokta · # kartotinas / kartotini / kartotinų · {N} pažymėta „Žinau“ · {N} liko išmokti**, the player's progress line (Learned row) plus the skipped state. **išmokta**, **pažymėta**, **liko** are impersonal and fit every count, so they take no plural forms. |
| Skipped (state) | marked as known | pažymėta „Žinau“ | proposed (S7) | A move the player marked with **Žinau šį ėjimą / variantą / skyrių** (R-58, R-148) and has not reviewed yet. The quote names the button the player pressed; EN matches the confirm button "Mark as known". Not "praleista" (reads as a mistake) and not "pažymėta kaip žinoma" (cannot agree with a genitive count). Not "kad žinote": the coach is reading, not the player. |
| Mastered (badge) | Mastered | įvaldyta | v1 `repertoire_row_status_mastered`, R-56 | Badge on a line, chapter or repertoire, not a state (R-151). Neuter, like **Pristabdyta**, **Pradelsta**. Noun for the goal: **įvaldymas** (Mastery goal). |
| Last trained | Last trained today / yesterday / # days ago; Not trained yet | Paskutinį kartą treniravosi šiandien / vakar / prieš # dieną, dienas, dienų; Dar nesitreniravo | proposed (S7) | R-154. **treniruotis** matches the page **Treniruotė**. **prieš** takes the accusative for one and few (dieną, dienas) and the genitive plural for other (10-20 dienų). |
| Group progress grid | Group progress | grupės pažanga | proposed (S7) | R-153, on the group page. Column header **Žaidėjas** / "Player"; empty **Grupei dar nieko nepriskirta.** / "Nothing is assigned to the group yet."; a cell without an assignment **Nepriskirta** / "Not assigned". On the player page each repertoire row says **Priskirtas** / **Bendrinamas** / "Assigned" / "Shared" (masculine, agreeing with repertuaras). A forked cell shows only **Pasidarė asmeninę kopiją** (R-155). A cell links to the player's progress page; it shows **{N} % išmokta** and **# kartotinas / kartotini / kartotinų** ("{N} due"), and its screen-reader name wraps that visible text (WCAG 2.5.3): **{name}, {repertoire}: {N} % išmokta, # kartotini** ("Gabija, Karo-Kan gynyba: 88 % išmokta, 5 kartotini"), or **{name}, {repertoire}: Nėra ko mokytis** when there is nothing to learn. |

## Product structure

| Domain term | EN UI word | LT UI word | Source | Note |
| --- | --- | --- | --- | --- |
| Tier | Rating range (proposed) | reitingo grupė | proposed | Only if the UI ever names it. Not **lygis** (v1 bands, retired) and not **planas**. |
| Entitlement | (not shown) | (not shown) | - | |
| Milestone | (not shown) | (not shown) | - | |

## General UI words

| Concept | EN UI word | LT UI word | Source | Note |
| --- | --- | --- | --- | --- |
| Sign in / Sign out | Sign in / Sign out | prisijungti / atsijungti | v1 `nav_sign_in`, `nav_sign_out` | |
| Magic link | Sign-in link | prisijungimo nuoroda | v1 `login_email_magic_link` | Short form once the context is clear: **nuoroda** / "link". Signing in this way: **prisijungti el. paštu** / "sign in by email". |
| Email | Email | el. paštas | v1 `login_email_label` | Email address: **el. pašto adresas**. "We will email you": **atsiųsime el. paštu**. |
| Sign-in method (Google, Lichess, email) | Sign-in method | prisijungimo būdas | approved (R-91) | |
| Sign in with a provider | Sign in with Google | prisijungti Google paskyra | approved (R-91) (v1 `login_continue_with_google` "Tęsti su Google") | Instrumental case, as in **prisijungti el. paštu**. Not "per Google" or "su Google": common, but the plain instrumental is the standard way to say "by means of". |
| Link / unlink a sign-in method | Connect / Disconnect | prijungti / atjungti | v1 `settings_connect_button`, `settings_disconnect_button` | State: **prijungta / neprijungta** ("Connected / Not connected"). Same verbs as the Lichess / Chess.com link above. Not **susieti / atsieti** (those are for the Coach link). |
| Welcome (first visit) | Welcome! | Sveiki atvykę! | approved (R-91) | Greeting with a name: "Sveiki, {name}!" / "Hello, {name}!". |
| Profile (settings section) | Profile | profilis | approved (R-91) | |
| Language (setting) | Language | kalba | approved (R-91) | Language names are shown in their own language: **Lietuvių**, **English**. |
| Export account data | Download my data | atsisiųsti duomenis | approved (R-91) | Not **eksportuoti**. Section title: **Jūsų duomenys** / "Your data". |
| Delete account | Delete account | ištrinti paskyrą | v1 `repertoires_delete_button` (verb) | Section title: **Paskyros ištrynimas**. "Permanently": **visam laikui** / "permanently" (not "for good"). |
| "For your security" (reason given in a notice or refusal) | For your security | dėl saugumo | approved (R-91) | Not **saugumo sumetimais**: longer and bookish. |
| Dismiss a notice | Got it | supratau | approved (R-91) | |
| Dashboard | Dashboard | skydelis | v1 `nav_dashboard` | |
| Settings | Settings | nustatymai | v1 `nav_settings` | |
| Board | Board | lenta | v1 `settings_board_heading` | |
| Piece | Piece | figūra | v1 `chessboard_hint_move_this_piece` | |
| King, queen, rook, bishop, knight, pawn | King ... pawn | karalius, valdovė, bokštas, rikis, žirgas, pėstininkas | proposed | Standard Lithuanian chess names. Not **karalienė**, not **arklys**. With a side: **baltasis karalius**, **baltoji valdovė**, **juodasis žirgas**. |
| Promotion | Promote to | pėstininko virsmas | proposed | Dialog title; the options are the piece names in the nominative. |
| Square | Square | langelis | proposed | An empty square: **tuščias** (langelis). |
| Rating | Rating | reitingas | v1 `fide_lookup_rating_row_label` | |
| Classical / Rapid / Blitz | Classical / Rapid / Blitz | klasikinis / greitasis / žaibo | v1 `tournaments_tc_*` (blitz proposed) | v1 left **Blitz** and **Bullet** untranslated; proposed **žaibo** (šachmatai) for blitz. |
| Tournament | Tournament | turnyras | v1 `nav_tournaments` | M3. |
| Delete / Remove | Delete / Remove | ištrinti / pašalinti | v1 `repertoires_delete_button`, `coaches_remove_button` | Delete destroys; remove takes out of a list. |
| Cancel / Close | Cancel / Close | atšaukti / uždaryti | v1 `coaches_cancel_button`, `picker_close_aria` | |
| Accept / Decline | Accept / Decline | priimti / atmesti | v1 `coaches_accept_button` | |
| Import | Import | importuoti | v1 `pgn_import_importing_label` | |

## Owner decisions (adopted in R-74, #233)

1. **Coach vs the FIDE trainer title.** CONTEXT reserves "Trainer" for the
   FIDE title badge, but in Lithuanian both are **treneris** (FIDE Trainer =
   "FIDE treneris"). Proposal: keep **treneris** for Coach and always write
   the badge in full, "FIDE treneris" / "FIDE instruktorius", never bare.
2. **Line = variantas.** CONTEXT retired "Variation" as a unit, but
   **variantas** is the ordinary Lithuanian chess word for a line. Proposal:
   UI uses **variantas** for Line; **linija** is not used.
3. **Side words.** v1 mixed **balta/juoda** (colour adjectives) with
   **baltaisiais/juodaisiais**. Proposal: **baltieji / juodieji** as the side
   names, **baltaisiais / juodaisiais** for "as White / as Black".
4. **Lapse = suklydimas.** Needs a word distinct from Player mistake
   (**klaida**). Proposal: **suklydimas**.
5. **Fork** has no settled word in either language. Proposal: EN "Make my
   own copy", LT **asmeninė kopija**. (S5 uses it in the UI; see the
   Assignment and ownership table, still **proposed**.)
6. **Thread** in the UI: EN "Conversation", LT **pokalbis**. CONTEXT lists
   "conversation" under Avoid for domain talk; this is only the screen word.
7. **Due** count wording: **kartotini** ("12 kartotinų").
8. **Digest = dienos suvestinė**, **Display name = rodomas vardas**,
   **Group = grupė**, **Goal = tikslas**, **Deviation = nukrypimas**,
   **Starter repertoire = pradinis repertuaras**, **Weak spot = silpnoji
   vieta**: the remaining proposals, listed for one yes/no.
