# Imposter Dixit

A Dixit-style card game for friends, built with Vue 3 and a Node/Socket.IO server. No logins: everyone just
opens the page and types a name.

## Starting and joining games

Any number of games can run at once. Each game has an invite code made of three words from the hint list, such as
`boss-aware-you`, and a matching invite link, `/invite?boss-aware-you`.

- **Start a new game** from the home page (you become its host).
- **Join with the link:** open `/invite?boss-aware-you`, type a name and join.
- **Join with the code:** type the code into the box on the home page. Capitals, spaces and pasted links are fine.

The code and a copy-link button are shown in the game's header and lobby. A browser remembers which game it was in,
so reopening the page puts you back. A game closes when its last player leaves, and games nobody has touched for
two weeks are forgotten.

## How a round works

1. The chooser (rotating in join order) types a word or phrase. A **hint** button offers three suggestions
   from `../hints.txt`.
2. Everyone else sees it and plays one card from their hand that fits it. (In the two imposter styles one
   random player sees `???` instead and has to bluff.)
3. All cards and the real word are revealed (with the players' names). The group talks it through.
4. The round is judged according to the **play style** the host picked in the lobby:

   | Play style | Who decides | Scoring |
   | --- | --- | --- |
   | **Everyone votes** (imposter) | Every player votes for who they think was in the dark. Votes can be changed until the last one is in. You can't vote for yourself or the chooser. | The imposter must have *strictly the most votes* for the group to be right (a tie counts as wrong). Right: each player who voted for the imposter scores 100. Wrong: the imposter scores 100 for every other player who didn't vote for them. |
   | **Only the chooser decides** (imposter) | Only the chooser guesses who was in the dark. | Right: the chooser scores 100. Fooled: the imposter scores 500. |
   | **Favourite card** (no imposter) | Everybody sees the word. The chooser picks the card they like best. | The player who played it scores 200. |

   In the two chooser styles the chooser's pick ends the round immediately, so the browser asks them to
   confirm it first.
5. Played cards are discarded, everyone draws back up to the hand size (default 8, set by the host), and the
   next player chooses the word. When the draw pile runs out, the discard pile is reshuffled.

**Length:** the host sets how many times each player chooses the word (1 to 10, default 2). The game ends once
everyone has chosen that many times, then shows the final scores and the winner (or winners, if tied). Only
completed rounds count as a turn, so a skipped round doesn't use anyone's turn up. Anyone who joins late still
gets their turns, which makes the game longer.

**Categories:** cards come in categories (Fantasy, Fairy tales, Modern world, Sci-fi, Steampunk & Victorian,
Medieval, Games, Food). The host ticks which ones go into the deck when setting up the game.

Players who join mid-round wait for the next round. The host can remove players, skip a round (no points) or
end the game. If someone's browser disconnects they can reopen the page and carry on (their browser remembers
them).

## Running it

```
npm install
..\.venv\Scripts\python.exe tools\optimise_cards.py   # build the game's card images from the judged winners
npm run build                                          # build the client
npm start                                              # http://localhost:3000
```

Friends on the same network can use `http://<your-ip>:3000`; to play over the internet you need to expose
that port (e.g. with a tunnelling tool such as Cloudflare Tunnel or ngrok). Set `PORT` to change the port.

For development run `npm run dev` (server on 3000, Vite with hot reload on 5173).

Game state is saved to `data/games.json`, so restarting the server doesn't lose scores or hands. Delete that
file to wipe every game. (A single game saved by an older version in `data/game-state.json` is moved into the new
format under a fresh code the first time the server starts.) The server reads the card folder (`cards/`, or `CARDS_DIR`) at startup and again
every few seconds, so new cards appear in the lobby without a restart.

### Cards

`tools/optimise_cards.py` reads the judged winners (`../choices/`) and the candidate images (`../raw/`) and writes
`cards/small/`, `cards/medium/` and `cards/categories.json`. See `../STYLE_GUIDE.md` and `../JUDGING.md` for how
the cards are generated and chosen. Useful options: `--unjudged a` (preview with candidate A wherever nothing is
judged yet), `--min-fit 1` (leave out cards that still don't fit their prompt) and `--only fantasy,food`.

## Bots

`bots/bot.js` is a stand-alone bot player. It is a separate process that uses only the same Socket.IO API
as the browser, so it can run on any machine that can reach the server, and you can run as many as you like
(one process per bot, each with its own name). A bot can only join an existing game, with `--join` and the
game's invite code:

```
npm run bot -- --join boss-aware-you --name Robin
npm run bot -- --join boss-aware-you --name Sam --url http://192.168.1.20:3000
npm run bot -- --help
```

It picks a word from the game's own word list when it is the chooser, plays a random card from its hand,
and votes for a random player (when the play style lets it vote). It waits a random 1 to 4 seconds before each
action so it doesn't act instantly (`--delay MIN-MAX` to change that). It does not start the game or press
"Next round", so a human still does those. A bot remembers its identity in `bots/.bot-tokens.json`, so
restarting a bot with the same name and code rejoins as the same player. Stopping it (Ctrl+C) leaves the player in the
game, shown as offline; the host can remove it.

## Tests

`npm test` runs the rules tests (`server/*.test.js`) and end-to-end tests that play full games with real socket
clients and real bot processes against a real server, using a small set of fake cards (`server/e2e.test.js`).

## Layout

- `server/game.js` pure rules and what each player is allowed to see (the server never sends the imposter,
  other hands or the word to anyone who shouldn't have it).
- `server/index.js` Express and Socket.IO wiring, categories, and saving.
- `src/` the Vue client (`store.js` holds the socket and state; `components/` has one component per screen).
- `bots/bot.js` the stand-alone bot player.
- `tools/optimise_cards.py` builds `cards/` from the judged images.
