<script setup>
import { computed } from 'vue';
import { nameOf, players, send, store } from '../store.js';
import Table from './Table.vue';
import WordBanner from './WordBanner.vue';

const state = computed(() => store.state);
const results = computed(() => state.value.results);
const standings = computed(() => [...players.value].filter((p) => !p.waiting).sort((a, b) => b.score - a.score));
const gained = (id) => results.value.deltas[id] ?? 0;
const chooserId = computed(() => state.value.chooserId);
const nextChooser = computed(() => {
  const list = players.value;
  const current = list.findIndex((p) => p.isChooser);
  return list[(current + 1) % list.length]?.name;
});
</script>

<template>
  <WordBanner />

  <section class="panel stack verdict" :class="results.groupCorrect ? 'caught' : 'escaped'">
    <h2>{{ nameOf(results.imposterId) }} was the imposter!</h2>
    <template v-if="results.judging === 'chooser'">
      <p v-if="results.groupCorrect">
        {{ nameOf(chooserId) }} guessed right and scores {{ state.pointsChooserCorrect }}.
      </p>
      <p v-else>
        {{ nameOf(chooserId) }} was fooled! {{ nameOf(results.imposterId) }} scores {{ state.pointsFooledChooser }}.
      </p>
    </template>
    <template v-else>
      <p v-if="results.groupCorrect">The group found them. Everyone who voted for them scores {{ state.pointsPerVote }}.</p>
      <p v-else>
        The group was fooled! {{ nameOf(results.imposterId) }} scores {{ gained(results.imposterId) }}
        ({{ state.pointsPerVote }} for each player who missed them).
      </p>
    </template>
  </section>

  <Table />

  <section class="panel stack">
    <h3>Standings</h3>
    <ol class="standings">
      <li v-for="p in standings" :key="p.id">
        <span class="name">{{ p.name }}</span>
        <span v-if="gained(p.id)" class="gain">+{{ gained(p.id) }}</span>
        <span class="score">{{ p.score }}</span>
      </li>
    </ol>
    <button class="primary" @click="send('nextRound')">Next round: {{ nextChooser }} chooses the word</button>
    <p class="muted small">Played cards are discarded and everyone draws back up to {{ state.handSize }} cards.</p>
  </section>
</template>

<style scoped>
.verdict {
  text-align: center;
}
.verdict p {
  margin: 0;
}
.caught {
  border-color: var(--moss);
}
.escaped {
  border-color: var(--rust);
}
.standings {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.4rem;
}
.standings li {
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
  border-bottom: 1px solid var(--line);
  padding-bottom: 0.35rem;
}
.name {
  flex: 1;
  font-weight: 600;
}
.gain {
  color: var(--moss);
  font-weight: 650;
}
.score {
  font-family: var(--display);
  font-size: 1.3rem;
  color: var(--amber);
  min-width: 3.5rem;
  text-align: right;
}
.small {
  margin: 0;
  font-size: 0.85rem;
}
</style>
