<script setup>
import { computed } from 'vue';
import { isHost, players, send, store, showToast } from '../store.js';

const state = computed(() => store.state);
const missingPlayers = computed(() => Math.max(0, state.value.minPlayers - players.value.length));
const cardsNeeded = computed(() => players.value.length * state.value.handSize);
const enoughCards = computed(() => state.value.availableCards >= cardsNeeded.value);
const selected = computed(() => state.value.categories.filter((c) => c.selected));

const judgingOptions = computed(() => [
  {
    mode: 'everyone',
    title: 'Everyone votes',
    text: `Everybody votes for who was in the dark. If the group spots them, each player who voted for them scores ${state.value.pointsPerVote}. If the group is fooled, the imposter scores ${state.value.pointsPerVote} for every player who missed them.`,
  },
  {
    mode: 'chooser',
    title: 'Only the chooser decides',
    text: `Only the word-chooser guesses who was in the dark. Guess right and the chooser scores ${state.value.pointsChooserCorrect}. Get fooled and the imposter scores ${state.value.pointsFooledChooser}.`,
  },
]);
const currentJudging = computed(() => judgingOptions.value.find((o) => o.mode === state.value.judging));

function toggleCategory(key) {
  const keys = state.value.categories.filter((c) => (c.key === key ? !c.selected : c.selected)).map((c) => c.key);
  send('setCategories', { keys });
}

async function copyLink() {
  try {
    await navigator.clipboard.writeText(window.location.href);
    showToast('Link copied. Send it to your friends.');
  } catch {
    showToast(window.location.href);
  }
}
</script>

<template>
  <section class="panel stack">
    <h2>Waiting for players</h2>
    <p class="muted">Share this page with your friends so they can join. You need at least {{ state.minPlayers }} players.</p>
    <div class="row">
      <button @click="copyLink">Copy invite link</button>
    </div>
  </section>

  <section class="panel stack">
    <h2>Judging</h2>
    <template v-if="isHost">
      <div class="options" role="radiogroup" aria-label="Judging method">
        <label v-for="option in judgingOptions" :key="option.mode" class="option" :class="{ on: state.judging === option.mode }">
          <input
            type="radio"
            name="judging"
            :value="option.mode"
            :checked="state.judging === option.mode"
            @change="send('setJudging', { mode: option.mode })"
          />
          <span>
            <strong>{{ option.title }}</strong>
            <span class="muted">{{ option.text }}</span>
          </span>
        </label>
      </div>
    </template>
    <p v-else>
      <strong>{{ currentJudging.title }}.</strong> <span class="muted">{{ currentJudging.text }}</span>
    </p>
  </section>

  <section class="panel stack">
    <h2>Card categories</h2>
    <template v-if="isHost">
      <p class="muted">Pick which kinds of cards go into the deck.</p>
      <div class="categories">
        <label v-for="c in state.categories" :key="c.key" class="category" :class="{ on: c.selected }">
          <input type="checkbox" :checked="c.selected" @change="toggleCategory(c.key)" />
          <span>
            <strong>{{ c.label }}</strong>
            <span class="muted">{{ c.description }}</span>
            <span class="count">{{ c.count }} cards</span>
          </span>
        </label>
      </div>
    </template>
    <p v-else class="muted">
      <template v-if="selected.length">{{ selected.map((c) => c.label).join(', ') }}</template>
      <template v-else>No categories available</template>
    </p>
    <p class="muted">
      {{ state.availableCards }} cards in the deck.
      <span v-if="!enoughCards" class="warn">
        That isn't enough for {{ players.length }} players with {{ state.handSize }} cards each ({{ cardsNeeded }} needed).
      </span>
    </p>
  </section>

  <section class="panel stack">
    <template v-if="isHost">
      <label class="row">
        Cards per hand
        <input
          type="number"
          class="num"
          min="3"
          max="12"
          :value="state.handSize"
          @change="send('setHandSize', { size: $event.target.value })"
        />
      </label>
      <button class="primary" :disabled="missingPlayers > 0 || !enoughCards" @click="send('start')">
        <template v-if="missingPlayers > 0">Need {{ missingPlayers }} more player{{ missingPlayers === 1 ? '' : 's' }}</template>
        <template v-else-if="!enoughCards">Choose more categories</template>
        <template v-else>Start the game</template>
      </button>
    </template>
    <p v-else class="muted">Waiting for the host to start the game. Hands will be {{ state.handSize }} cards.</p>
  </section>

  <section class="panel rules">
    <h3>How it works</h3>
    <ol>
      <li>Each round one player thinks of a word or phrase and types it in.</li>
      <li>Everyone else sees it, except one random player who just sees ???.</li>
      <li>They all play the card from their hand that best fits the word. The player in the dark has to bluff.</li>
      <li>The cards and the word are revealed. Talk it through and justify your choices.</li>
      <li>Then the vote: {{ state.judging === 'chooser' ? 'the chooser decides who they think was in the dark.' : 'everyone votes for who they think was in the dark.' }}</li>
    </ol>
  </section>
</template>

<style scoped>
.num {
  width: 5rem;
}
.options,
.categories {
  display: grid;
  gap: 0.6rem;
}
.categories {
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
}
.option,
.category {
  display: flex;
  gap: 0.7rem;
  align-items: flex-start;
  padding: 0.7rem 0.9rem;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--bg-sunken);
  cursor: pointer;
}
.option.on,
.category.on {
  border-color: var(--amber);
  background: color-mix(in srgb, var(--amber) 10%, var(--bg-sunken));
}
.option input,
.category input {
  width: auto;
  margin-top: 0.25rem;
  accent-color: var(--amber);
}
.option > span,
.category > span {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}
.count {
  font-size: 0.8rem;
  color: var(--amber);
}
.warn {
  color: var(--danger);
}
.rules ol {
  margin: 0.6rem 0 0;
  padding-left: 1.2rem;
  display: grid;
  gap: 0.35rem;
  color: var(--muted);
}
</style>
