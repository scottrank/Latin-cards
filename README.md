# Latin Cards

Latin flashcard practice with student profiles (name + PIN) and spaced repetition, running on Cloudflare Workers with a D1 database.

## How practice works

Each student has their own schedule for every card, using Leitner boxes:

| Box | Comes back after a correct answer |
|-----|-----------------------------------|
| 0 | 1 minute (a couple of cards later) |
| 1 | 10 minutes |
| 2 | 1 day |
| 3 | 3 days |
| 4 | 7 days (counts as "mastered") |
| 5 | 16 days |
| 6 | 35 days |

- **Got it** moves the card up one box, so it shows up less and less.
- **Missed it** drops the card to box 0, so it comes right back.
- A card missed 3+ times is held at box 2 or below until the student gets it right 3 times in a row.
- Due cards are shown hardest-first (most misses relative to correct answers), then new cards are introduced.
- When nothing is due, students can choose **Extra practice**, which drills their weakest cards.

- Students type a lesson range (e.g. 3 to 7) to choose what they study.
- A score bar tracks XP (10 per right answer + streak bonus up to +10; 1 for a miss), level (every 250 XP), current and best streak, today's right/missed counts, and cards mastered.

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
