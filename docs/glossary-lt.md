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
- Plurals have three forms (`one`, `few`, `many`): 1, 21, 31 ...
  **repertuaras**; 2-9, 22-29 ... **repertuarai**; 0, 10-20, 25-30 ...
  **repertuarų**. Every counted string in `lt.json` carries all three.
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
| Invite | Invite | kvietimas | v1 `coach_invite_heading`, `coach_dashboard_invite_links_heading` | Invite link: **kvietimo nuoroda**. Verb: **pakviesti**. |
| Group | Group | grupė | proposed | Not **klasė**, **komanda**, **klubas** (CONTEXT avoid list). |
| Admin | Admin | administratorius | proposed | |

## Repertoires

| Domain term | EN UI word | LT UI word | Source | Note |
| --- | --- | --- | --- | --- |
| Repertoire | Repertoire | repertuaras | v1 `nav_repertoires`, `learn_repertoire_fallback_name` | |
| Side | Side | spalva | v1 `pgn_import_color_label` | |
| White / Black (side) | White / Black | baltieji / juodieji | proposed | v1 used **balta / juoda** (`pgn_import_color_white`) and **baltaisiais / juodaisiais** (`prep_as_white`). "As White": **baltaisiais**. Adopted (R-74). |
| Chapter | Chapter | skyrius | v1 `coach_chapters_link`, `repertoire_tree_chapter_heading` | |
| Opening (a Chapter's subject) | Opening | debiutas | v1 `opening_picker_heading`, `coach_player_coverage_heading` | |
| Position | Position | padėtis | v1 `move_nav_jump_to_current`, `learn_explore_position` | Not **pozicija**. |
| Move | Move | ėjimas | v1 `repertoires_moves_count`, `games_moves_heading` | Plural: ėjimas / ėjimai / ėjimų. |
| Ply | Ply | pusėjimis | v1 `pgn_import_review_meta` | Counts only. |
| Line | Line | variantas | v1 `practice_session_line_progress`, `repertoire_tree_line_count` | v1 used both **variantas** and **linija** (`coach_chapters_meta`, `pgn_import_review_summary`); **variantas** is the chess word. Not **linija**. |
| Transposition | Transposition | ėjimų perstatymas | proposed | |
| Starter repertoire | Starter repertoire | pradinis repertuaras | proposed | Not **šablonas** (template). |
| Hint | Hint | užuomina | v1 `move_nav_show_hint` | |
| PGN | PGN | PGN | v1 `pgn_import_pgn_text_label` | Not translated. |

## Assignment and ownership

| Domain term | EN UI word | LT UI word | Source | Note |
| --- | --- | --- | --- | --- |
| Assignment | Assignment | priskyrimas | proposed (verb from v1 `coach_repertoires_assign_button` **priskirti**) | "Assigned by your coach": **priskyrė jūsų treneris** (v1 `repertoires_assigned_heading`). |
| Deadline (of an Assignment) | Deadline | terminas | proposed | |
| Fork | Make my own copy (proposed) | asmeninė kopija | proposed | Verb: **pasidaryti asmeninę kopiją**. EN UI word is also unsettled; "Fork" is a developer word. Not **klonas**. |
| Personal note | Personal note | asmeninė pastaba | proposed | Not **komentaras** (a comment is a Thread). |
| Coach note | Coach note | trenerio pastaba | v1 `coach_note_title` | |
| Reconciliation | (not shown) | (not shown) | - | The UI shows only its Notification: "Your coach updated this repertoire" / **Jūsų treneris atnaujino šį repertuarą** (v1 `practice_coach_update_notice`). |

## Training

| Domain term | EN UI word | LT UI word | Source | Note |
| --- | --- | --- | --- | --- |
| Learn pass | Learn | mokytis (nav), mokymasis (noun) | v1 `nav_learn`, `repertoires_action_learn` | |
| Review | Review | kartojimas (noun), kartoti (verb) | v1 `coach_player_stat_reviews` | Not **praktika** (v1 `nav_practice`; Practice is retired). Not **peržiūra** (that is "preview/look over"). |
| Review session | Review session | kartojimo sesija | proposed (v1 `practice_this_session_heading` **sesija**) | |
| Due | Due | laikas kartoti (status), kartotini (count) | proposed | "12 due": **12 kartotinų** (one: kartotinas, few: kartotini, many: kartotinų). |
| Lapse | Lapse | suklydimas | proposed | Not **klaida** (kept for Player mistake and for game analysis) and not **pažeminimas** (demotion, v1). |
| Learned (state) | Learned | išmokta | v1 `repertoire_row_status_learned` | |
| Free play | Free play | laisvas žaidimas | proposed | |
| Correct / wrong (drill feedback) | Correct / Not that move | teisingai / ne tas ėjimas | v1 `practice_status_correct`, `practice_status_wrong` | |
| Play it from memory | Play it from memory | sužaiskite iš atminties | v1 `practice_status_blind` | The blind retest of a Learn pass. |

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
| Thread | Conversation (proposed) | pokalbis | proposed | 1:1 thread: **pokalbis**; group thread: **grupės pokalbis**; move comment thread: **komentarai** (prie ėjimo). A single message: **žinutė**. Not **čatas**. |
| Notification | Notification | pranešimas | proposed (v1 `practice_dismiss_coach_notice_label`) | |
| Digest | Daily digest | dienos suvestinė | proposed | Not **naujienlaiškis** (newsletter). |
| Weak spot | Weak spot | silpnoji vieta | proposed | v1 had "klaidų vietos" (`coach_player_hotspots_heading`) for a similar view. |
| Coach dashboard | Coach dashboard | trenerio skydelis | v1 `coach_dashboard_heading` | |
| Progress | Progress | pažanga | v1 `learn_progress_heading` | |

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
| Dashboard | Dashboard | skydelis | v1 `nav_dashboard` | |
| Settings | Settings | nustatymai | v1 `nav_settings` | |
| Board | Board | lenta | v1 `settings_board_heading` | |
| Piece | Piece | figūra | v1 `chessboard_hint_move_this_piece` | |
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
   own copy", LT **asmeninė kopija**.
6. **Thread** in the UI: EN "Conversation", LT **pokalbis**. CONTEXT lists
   "conversation" under Avoid for domain talk; this is only the screen word.
7. **Due** count wording: **kartotini** ("12 kartotinų").
8. **Digest = dienos suvestinė**, **Display name = rodomas vardas**,
   **Group = grupė**, **Goal = tikslas**, **Deviation = nukrypimas**,
   **Starter repertoire = pradinis repertuaras**, **Weak spot = silpnoji
   vieta**: the remaining proposals, listed for one yes/no.
