// Pure game rules for the imposter Dixit game. No networking in here, so it is easy to test.
//
// Round flow:  word -> picking -> voting -> results -> (next round) word ...
//   word        the chooser types a word or phrase
//   picking     everyone except the chooser plays a card; one random player (the imposter) sees "???"
//   voting      all cards and the real word are shown. The group talks, and anyone can vote at any time
//               (changing their vote until the last vote is in). The round ends once everyone has voted.
//   results     the imposter is revealed and points are awarded
//
// Two judging methods, chosen by the host in the lobby:
//   'everyone'  every player votes. The group is correct only if the imposter has strictly the most votes (a tie
//               counts as wrong). If correct, each player who voted for the imposter scores POINTS_PER_VOTE. If
//               wrong, the imposter scores POINTS_PER_VOTE for each other player who didn't vote for them.
//   'chooser'   only the word-chooser votes. If they spot the imposter the chooser scores
//               CHOOSER_CORRECT_POINTS; if they are fooled the imposter scores CHOOSER_FOOLED_POINTS.
//
// The deck is built from the categories the host selects (cards come in categories; see getCategories below).

export const POINTS_PER_VOTE = 100;
export const CHOOSER_CORRECT_POINTS = 100;
export const CHOOSER_FOOLED_POINTS = 500;
export const JUDGING_MODES = ['everyone', 'chooser'];
export const MIN_PLAYERS = 3;
export const MIN_HAND_SIZE = 3;
export const MAX_HAND_SIZE = 12;
export const DEFAULT_HAND_SIZE = 8;
export const MAX_NAME_LENGTH = 20;
export const MAX_WORD_LENGTH = 60;

export class GameError extends Error {}
const fail = (message) => {
  throw new GameError(message);
};

export function shuffle(items, rng = Math.random) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

const newPublicId = () => Math.random().toString(36).slice(2, 10);

export class Game {
  /**
   * @param {object} options
   * @param {() => {key: string, label: string, description?: string, ids: number[]}[]} [options.getCategories]
   *        the cards currently available, grouped into categories
   * @param {() => number[]} [options.getCardIds] shortcut for a single category containing every card
   * @param {string[]} options.hints word/phrase suggestions for the chooser
   * @param {() => number} [options.rng]
   * @param {object} [options.saved] a previously saved state (see toJSON)
   */
  constructor({ getCategories, getCardIds, hints = [], rng = Math.random, saved = null }) {
    this.getCategories =
      getCategories ?? (() => [{ key: 'all', label: 'All cards', description: '', ids: getCardIds ? getCardIds() : [] }]);
    this.hints = hints;
    this.rng = rng;
    this.hintPool = [];
    this.s = { ...Game.blankState(), ...(saved ?? {}) };
    if (this.s.phase === 'discussion') this.s.phase = 'voting'; // saved by an older version that had a separate step
    delete this.s.ready;
    this.normaliseSettings();
    this.syncCards();
  }

  static blankState() {
    return {
      phase: 'lobby',
      players: [], // { id, token, name, score, hand: number[], waiting: boolean }
      hostId: null,
      handSize: DEFAULT_HAND_SIZE,
      judging: 'everyone',
      categories: null, // selected category keys; null means "all of them"
      round: 0,
      nextChooserIdx: 0,
      chooserId: null,
      draw: [],
      discard: [],
      word: null,
      imposterId: null,
      picks: {}, // playerId -> cardId
      tableOrder: [], // playerIds, shuffled once all cards are in
      votes: {}, // playerId -> playerId
      results: null,
    };
  }

  toJSON() {
    return this.s;
  }

  // ---------- lookups ----------

  player(id) {
    return this.s.players.find((p) => p.id === id) ?? null;
  }

  findByToken(token) {
    return this.s.players.find((p) => p.token === token) ?? null;
  }

  requirePlayer(id) {
    return this.player(id) ?? fail('You are not in this game.');
  }

  isHost(id) {
    return this.s.hostId === id;
  }

  /** Players taking part in the current round (everyone except late joiners). */
  inRound() {
    return this.s.players.filter((p) => !p.waiting);
  }

  /** Players who play a card this round (everyone in the round except the chooser). */
  cardPlayers() {
    return this.inRound().filter((p) => p.id !== this.s.chooserId);
  }

  // ---------- deck ----------

  /** Makes sure the saved settings are valid for the categories that exist now. */
  normaliseSettings() {
    const s = this.s;
    if (!JUDGING_MODES.includes(s.judging)) s.judging = 'everyone';
    const known = this.getCategories().map((c) => c.key);
    const chosen = Array.isArray(s.categories) ? s.categories.filter((key) => known.includes(key)) : [];
    s.categories = chosen.length ? chosen : known;
  }

  selectedCategories() {
    return this.getCategories().filter((c) => this.s.categories.includes(c.key));
  }

  /** Ids of every card in the selected categories. */
  availableIds() {
    return [...new Set(this.selectedCategories().flatMap((c) => c.ids))];
  }

  /** Keeps the deck in step with the cards on disk: new cards join the draw pile, missing ones vanish. */
  syncCards() {
    const available = new Set(this.availableIds());
    const s = this.s;
    const known = new Set();
    const keep = (id) => available.has(id) && !known.has(id) && known.add(id);
    s.draw = s.draw.filter(keep);
    s.discard = s.discard.filter(keep);
    for (const p of s.players) p.hand = p.hand.filter(keep);
    const fresh = [...available].filter((id) => !known.has(id));
    if (s.phase !== 'lobby' && fresh.length) {
      s.draw.push(...fresh);
      shuffle(s.draw, this.rng);
    }
  }

  drawUp(player) {
    const s = this.s;
    while (player.hand.length < s.handSize) {
      if (!s.draw.length) {
        if (!s.discard.length) return; // nothing left anywhere
        s.draw = shuffle(s.discard, this.rng);
        s.discard = [];
      }
      player.hand.push(s.draw.pop());
    }
  }

  // ---------- players and lobby ----------

  addPlayer(name, token) {
    const clean = String(name ?? '').trim().replace(/\s+/g, ' ');
    if (!clean) fail('Please enter a name.');
    if (clean.length > MAX_NAME_LENGTH) fail(`Names can be at most ${MAX_NAME_LENGTH} characters.`);
    if (this.s.players.some((p) => p.name.toLowerCase() === clean.toLowerCase())) {
      fail('Someone is already using that name.');
    }
    const player = {
      id: newPublicId(),
      token,
      name: clean,
      score: 0,
      hand: [],
      waiting: this.s.phase !== 'lobby', // late joiners wait for the next round
    };
    this.s.players.push(player);
    this.s.hostId ??= player.id;
    return player;
  }

  removePlayer(byId, targetId) {
    const s = this.s;
    if (byId !== targetId && !this.isHost(byId)) fail('Only the host can remove other players.');
    const index = s.players.findIndex((p) => p.id === targetId);
    if (index < 0) fail('That player is not in the game.');
    const [removed] = s.players.splice(index, 1);
    s.discard.push(...removed.hand);
    if (index < s.nextChooserIdx) s.nextChooserIdx--;
    if (s.hostId === targetId) s.hostId = s.players[0]?.id ?? null;
    if (!s.players.length) {
      Object.assign(s, Game.blankState(), { handSize: s.handSize, judging: s.judging, categories: s.categories });
      return;
    }
    if (s.phase === 'lobby') return;
    if (s.players.length < MIN_PLAYERS) {
      this.returnToLobby();
    } else if (!removed.waiting) {
      this.startRound(); // the round can't continue without them, so move on
    }
  }

  setHandSize(byId, size) {
    if (!this.isHost(byId)) fail('Only the host can change the hand size.');
    if (this.s.phase !== 'lobby') fail('The hand size can only be changed in the lobby.');
    const n = Math.round(Number(size));
    if (!(n >= MIN_HAND_SIZE && n <= MAX_HAND_SIZE)) {
      fail(`Hand size must be between ${MIN_HAND_SIZE} and ${MAX_HAND_SIZE}.`);
    }
    this.s.handSize = n;
  }

  setJudging(byId, mode) {
    if (!this.isHost(byId)) fail('Only the host can change how rounds are judged.');
    if (this.s.phase !== 'lobby') fail('The judging method can only be changed in the lobby.');
    if (!JUDGING_MODES.includes(mode)) fail('Unknown judging method.');
    this.s.judging = mode;
  }

  setCategories(byId, keys) {
    if (!this.isHost(byId)) fail('Only the host can choose the categories.');
    if (this.s.phase !== 'lobby') fail('The categories can only be changed in the lobby.');
    const known = this.getCategories();
    const wanted = [...new Set(Array.isArray(keys) ? keys : [])];
    if (wanted.some((key) => !known.some((c) => c.key === key))) fail('Unknown category.');
    if (!wanted.length) fail('Pick at least one category.');
    this.s.categories = known.filter((c) => wanted.includes(c.key)).map((c) => c.key); // keep the standard order
  }

  start(byId) {
    const s = this.s;
    if (!this.isHost(byId)) fail('Only the host can start the game.');
    if (s.phase !== 'lobby') fail('The game has already started.');
    if (s.players.length < MIN_PLAYERS) fail(`You need at least ${MIN_PLAYERS} players.`);
    this.normaliseSettings();
    const cardIds = this.availableIds();
    if (cardIds.length < s.players.length * s.handSize) {
      fail('There are not enough cards in the chosen categories for that many players. Choose more categories.');
    }
    s.draw = shuffle([...cardIds], this.rng);
    s.discard = [];
    for (const p of s.players) {
      p.hand = [];
      p.score = 0;
    }
    s.round = 0;
    s.nextChooserIdx = 0;
    this.startRound();
  }

  returnToLobby(byId = null) {
    const s = this.s;
    if (byId && !this.isHost(byId)) fail('Only the host can end the game.');
    Object.assign(s, {
      phase: 'lobby',
      round: 0,
      chooserId: null,
      draw: [],
      discard: [],
      word: null,
      imposterId: null,
      picks: {},
      tableOrder: [],
      votes: {},
      results: null,
    });
    for (const p of s.players) {
      p.hand = [];
      p.waiting = false;
    }
  }

  // ---------- round flow ----------

  startRound() {
    const s = this.s;
    this.syncCards();
    for (const p of s.players) p.waiting = false;
    s.round++;
    const idx = s.nextChooserIdx % s.players.length;
    s.chooserId = s.players[idx].id;
    s.nextChooserIdx = idx + 1;
    Object.assign(s, { word: null, imposterId: null, picks: {}, tableOrder: [], votes: {}, results: null });
    for (const p of s.players) this.drawUp(p);
    s.phase = 'word';
  }

  /** Abandons the current round without scoring or discarding, and moves to the next chooser. */
  abortRound(byId) {
    if (!this.isHost(byId)) fail('Only the host can skip a round.');
    if (!['word', 'picking', 'voting'].includes(this.s.phase)) fail('There is no round to skip.');
    this.startRound();
  }

  nextHints(count = 3) {
    if (this.hintPool.length < count) {
      this.hintPool = shuffle([...this.hints], this.rng);
    }
    return this.hintPool.splice(-count, count);
  }

  submitWord(id, word) {
    const s = this.s;
    if (s.phase !== 'word') fail('It is not time to choose a word.');
    if (id !== s.chooserId) fail('Only the chooser can pick the word.');
    const clean = String(word ?? '').trim().replace(/\s+/g, ' ');
    if (!clean) fail('Type a word or phrase first.');
    if (clean.length > MAX_WORD_LENGTH) fail(`Keep it to ${MAX_WORD_LENGTH} characters or fewer.`);
    const candidates = this.cardPlayers();
    s.word = clean;
    s.imposterId = candidates[Math.floor(this.rng() * candidates.length)].id;
    s.phase = 'picking';
  }

  playCard(id, cardId) {
    const s = this.s;
    if (s.phase !== 'picking') fail('It is not time to play a card.');
    const player = this.requirePlayer(id);
    if (player.waiting || id === s.chooserId) fail('You do not play a card this round.');
    if (!player.hand.includes(cardId)) fail('That card is not in your hand.');
    s.picks[id] = cardId;
    if (this.cardPlayers().every((p) => p.id in s.picks)) {
      s.tableOrder = shuffle(this.cardPlayers().map((p) => p.id), this.rng);
      s.votes = {};
      s.phase = 'voting';
    }
  }

  vote(id, targetId) {
    const s = this.s;
    if (s.phase !== 'voting') fail('It is not time to vote.');
    const voter = this.requirePlayer(id);
    if (voter.waiting) fail('You are waiting for the next round.');
    if (s.judging === 'chooser' && id !== s.chooserId) fail('In this game only the word-chooser votes.');
    if (id === targetId) fail('You cannot vote for yourself.');
    if (!this.cardPlayers().some((p) => p.id === targetId)) fail('You can only vote for someone who played a card.');
    s.votes[id] = targetId;
    if (this.voters().every((p) => p.id in s.votes)) this.resolveVotes();
  }

  /** The players whose votes are needed before the round can end. */
  voters() {
    return this.s.judging === 'chooser' ? this.inRound().filter((p) => p.id === this.s.chooserId) : this.inRound();
  }

  resolveVotes() {
    const s = this.s;
    if (s.judging === 'chooser') return this.resolveChooserVerdict();
    const tally = Object.fromEntries(this.cardPlayers().map((p) => [p.id, 0]));
    for (const target of Object.values(s.votes)) tally[target]++;

    const imposterVotes = tally[s.imposterId];
    const bestOther = Math.max(0, ...Object.entries(tally).filter(([id]) => id !== s.imposterId).map(([, n]) => n));
    const groupCorrect = imposterVotes > bestOther;

    const deltas = Object.fromEntries(this.inRound().map((p) => [p.id, 0]));
    const voters = this.inRound().filter((p) => p.id !== s.imposterId);
    if (groupCorrect) {
      for (const voter of voters) {
        if (s.votes[voter.id] === s.imposterId) deltas[voter.id] = POINTS_PER_VOTE;
      }
    } else {
      const fooled = voters.filter((v) => s.votes[v.id] !== s.imposterId).length;
      deltas[s.imposterId] = fooled * POINTS_PER_VOTE;
    }
    for (const p of this.inRound()) p.score += deltas[p.id];

    s.results = { judging: 'everyone', imposterId: s.imposterId, groupCorrect, tally, deltas, votes: { ...s.votes } };
    s.phase = 'results';
  }

  /** Chooser-only judging: spot the imposter and the chooser scores; get fooled and the imposter scores big. */
  resolveChooserVerdict() {
    const s = this.s;
    const accusedId = s.votes[s.chooserId];
    const groupCorrect = accusedId === s.imposterId; // here it means "the judge was correct"
    const deltas = Object.fromEntries(this.inRound().map((p) => [p.id, 0]));
    if (groupCorrect) deltas[s.chooserId] = CHOOSER_CORRECT_POINTS;
    else deltas[s.imposterId] = CHOOSER_FOOLED_POINTS;
    for (const p of this.inRound()) p.score += deltas[p.id];

    const tally = Object.fromEntries(this.cardPlayers().map((p) => [p.id, p.id === accusedId ? 1 : 0]));
    s.results = { judging: 'chooser', imposterId: s.imposterId, accusedId, groupCorrect, tally, deltas, votes: { ...s.votes } };
    s.phase = 'results';
  }

  nextRound(id) {
    const s = this.s;
    if (s.phase !== 'results') fail('The round is not over yet.');
    this.requirePlayer(id);
    // Played cards go to the discard pile; startRound() then tops everyone's hand back up.
    for (const p of this.inRound()) {
      const cardId = s.picks[p.id];
      if (cardId === undefined) continue;
      p.hand = p.hand.filter((c) => c !== cardId);
      s.discard.push(cardId);
    }
    this.startRound();
  }

  // ---------- what each player is allowed to see ----------

  viewFor(id, connectedIds = new Set()) {
    const s = this.s;
    const me = this.player(id);
    if (!me) return null;
    const inPlay = ['picking', 'voting', 'results'].includes(s.phase);
    const iAmImposter = id === s.imposterId;
    const wordRevealed = ['voting', 'results'].includes(s.phase);

    let word = null;
    if (s.word !== null && (wordRevealed || (s.phase === 'picking' && !iAmImposter))) word = s.word;

    const cardsOnTable = s.phase === 'picking' ? [] : s.tableOrder.map((pid) => ({ playerId: pid, cardId: s.picks[pid] }));

    return {
      phase: s.phase,
      round: s.round,
      handSize: s.handSize,
      chooserId: s.chooserId,
      hostId: s.hostId,
      minPlayers: MIN_PLAYERS,
      pointsPerVote: POINTS_PER_VOTE,
      pointsChooserCorrect: CHOOSER_CORRECT_POINTS,
      pointsFooledChooser: CHOOSER_FOOLED_POINTS,
      judging: s.judging,
      categories: this.getCategories().map((c) => ({
        key: c.key,
        label: c.label,
        description: c.description ?? '',
        count: c.ids.length,
        selected: s.categories.includes(c.key),
      })),
      availableCards: this.availableIds().length,
      drawCount: s.draw.length,
      discardCount: s.discard.length,
      word,
      wordHidden: s.phase === 'picking' && iAmImposter,
      me: {
        id: me.id,
        waiting: me.waiting,
        isChooser: id === s.chooserId,
        hand: me.waiting || s.phase === 'lobby' ? [] : me.hand,
        myPick: s.picks[id] ?? null,
        myVote: s.votes[id] ?? null,
        isImposter: s.phase === 'results' && iAmImposter,
      },
      players: s.players.map((p) => ({
        id: p.id,
        name: p.name,
        score: p.score,
        waiting: p.waiting,
        connected: connectedIds.has(p.id),
        isChooser: p.id === s.chooserId,
        hasPlayed: inPlay && p.id in s.picks,
        hasVoted: s.phase === 'voting' ? p.id in s.votes : false,
      })),
      table: cardsOnTable,
      voteTargets:
        s.phase === 'voting' && this.voters().some((v) => v.id === id)
          ? this.cardPlayers().filter((p) => p.id !== id).map((p) => p.id)
          : [],
      results: s.phase === 'results' ? s.results : null,
    };
  }
}
