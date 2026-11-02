# Latin Cards

Latin flashcard practice with student profiles (name + PIN) and spaced repetition, running on Cloudflare Workers with a D1 database.

## How practice works

Each student has their own schedule for every card, using Leitner boxes:

A practice session is assumed to be about 20 minutes.

| Box | Comes back after |
|-----|------------------|
| 0 | 3 minutes (a miss: later in the same session) |
| 1 | 1 day |
| 2 | 3 days |
| 3 | 7 days (counts as "mastered") |
| 4 | 16 days |
| 5 | 35 days |

- **Got it** moves the card up one box. Every box above 0 is at least a day away, so a right answer never returns in the same session.
- **Missed it** drops the card to box 0, so it returns in about 3 minutes, within the same session.
- A card missed 3+ times is held at box 1 (one day) or below until the student gets it right 3 times in a row.
- Due cards are shown hardest-first (most misses relative to correct answers), then new cards are introduced.
- When nothing is due, students can choose **Extra practice**, which drills their weakest cards (never one they got right in the last 20 minutes).

- Students type a lesson range (e.g. 3 to 7) to choose what they study.
- A score bar tracks the current and best streak of right answers, today's right/missed counts, and cards mastered.

Keyboard: space to flip, `1` / ← for Missed it, `2` / → for Got it.

## Editing the deck

All cards live in `src/cards.js`:

```js
{ id: "p1-01", front: "amō, amāre", back: "to love", set: "Page 1" }
```

Never change an `id` once students have practiced — progress is keyed on it. Adding cards or fixing a typo in `front`/`back` is always safe.

## Deploying

The `wrangler.toml` is already bound to the `latin-flashcards` D1 database (schema in `schema.sql`, already applied).

Easiest: in the Cloudflare dashboard go to **Workers & Pages → Create → Import a repository**, pick this repo, and accept the defaults. Every push to `main` then redeploys automatically.

Or from a terminal: `npm install && npx wrangler deploy`.
