# Imposter Dixit

A Dixit-style card game for friends, built with Vue 3 and a Node/Socket.IO server. One game at a time,
no logins: everyone just opens the page and types a name.

## How a round works

1. The chooser (rotating in join order) types a word or phrase. A **hint** button offers three suggestions
   from `../hints.txt`.
2. Everyone else sees it, **except one random player** who sees `???`. That player is the imposter.
3. Everyone except the chooser plays one card from their hand.
4. All cards and the real word are revealed (with the players' names). The group talks it through, and
   anyone can vote straight away.
5. Everyone, including the chooser and the imposter, votes for who they think the imposter was. You can't
   vote for yourself or for the chooser. Votes can be changed until the last one is in; the round ends once
   everyone has voted.
6. Scoring:
   - **Group correct** (the imposter has *strictly* the most votes): each player who voted for them scores 100.
   - **Group wrong** (anything else, so a tie counts as wrong): the imposter scores 100 for every other player who didn't vote for them.
7. Played cards are discarded, everyone draws back up to the hand size (default 8, set by the host in the
   lobby), and the next player chooses the word. When the draw pile runs out, the discard pile is reshuffled.

Players who join mid-round wait for the next round. The host can remove players, skip a round (no points)
or end the game. If someone's browser disconnects they can reopen the page and carry on (their browser
remembers them).

## Running it

```
npm install
..\.venv\Scripts\python.exe tools\optimise_cards.py   # make web-sized copies of ../cards (re-run any time)
npm run build                                          # build the client
npm start                                              # http://localhost:3000
```

Friends on the same network can use `http://<your-ip>:3000`; to play over the internet you need to expose
that port (e.g. with a tunnelling tool such as Cloudflare Tunnel or ngrok). Set `PORT` to change the port.

For development run `npm run dev` (server on 3000, Vite with hot reload on 5173).

Game state is saved to `data/game-state.json`, so restarting the server doesn't lose scores or hands. New
cards found in `cards/medium` are added to the deck whenever a game starts or a round begins.
Delete `data/game-state.json` to wipe the game.

## Bots

`bots/bot.js` is a stand-alone bot player. It is a separate process that uses only the same Socket.IO API
as the browser, so it can run on any machine that can reach the server, and you can run as many as you like
(one process per bot, each with its own name):

```
npm run bot -- --name Robin
npm run bot -- --name Sam --url http://192.168.1.20:3000
npm run bot -- --help
```

It picks a word from the game's own word list when it is the chooser, plays a random card from its hand,
and votes for a random player. It waits a random 1 to 4 seconds before each action so it doesn't act
instantly (`--delay MIN-MAX` to change that). It does not start the game or press "Next round", so a human
still does those. A bot remembers its identity in `bots/.bot-tokens.json`, so restarting a bot with the
same name rejoins as the same player. Stopping it (Ctrl+C) leaves the player in the game, shown as offline;
the host can remove it.

## Tests

`npm test` runs the rules tests (`server/game.test.js`) and an end-to-end test that plays full rounds with
real socket clients against a real server (`server/e2e.test.js`).

## Layout

- `server/game.js` pure rules and what each player is allowed to see (the server never sends the imposter,
  other hands or the word to anyone who shouldn't have it).
- `server/index.js` Express and Socket.IO wiring plus saving.
- `src/` the Vue client (`store.js` holds the socket and state; `components/` has one component per screen).
- `tools/optimise_cards.py` creates `cards/small` and `cards/medium` JPEGs from the generated PNGs.
