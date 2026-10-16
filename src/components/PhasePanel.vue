<script setup>
import { computed } from 'vue';
import { chooser, players, store } from '../store.js';
import ChooserWord from './ChooserWord.vue';
import Table from './Table.vue';
import WordBanner from './WordBanner.vue';

const state = computed(() => store.state);

const inRound = computed(() => players.value.filter((p) => !p.waiting));
const waitingOnCards = computed(() => inRound.value.filter((p) => !p.isChooser && !p.hasPlayed));
const waitingOnVotes = computed(() => inRound.value.filter((p) => !p.hasVoted));
</script>

<template>
  <!-- 1. The chooser types a word -->
  <template v-if="state.phase === 'word'">
    <ChooserWord v-if="state.me.isChooser" />
    <section v-else class="panel waiting">
      <h2>{{ chooser?.name }} is choosing a word…</h2>
      <p class="muted">While you wait, have a look at your hand.</p>
    </section>
  </template>

  <!-- 2. Everyone plays a card -->
  <template v-else-if="state.phase === 'picking'">
    <WordBanner />
    <p v-if="state.me.waiting" class="panel muted">You’ve joined mid-round, so you’ll be dealt in next round.</p>
    <p v-else-if="state.me.isChooser" class="muted center">
      Waiting for {{ waitingOnCards.map((p) => p.name).join(', ') }}…
    </p>
    <p v-else-if="state.me.myPick !== null" class="muted center">
      Card played. You can swap it until everyone has played.
      <template v-if="waitingOnCards.length">Waiting for {{ waitingOnCards.map((p) => p.name).join(', ') }}…</template>
    </p>
  </template>

  <!-- 3. Cards revealed: talk it through and vote whenever you like -->
  <template v-else-if="state.phase === 'voting'">
    <WordBanner />
    <section class="panel stack">
      <h2>Who was in the dark?</h2>
      <p class="muted">
        Explain why you chose your card and listen to the others. You can vote at any time, and change your vote
        until everyone has voted. The round ends when the last vote is in.
      </p>
      <p class="status">
        <template v-if="state.me.waiting">You’ll join in next round.</template>
        <template v-else-if="state.me.myVote === null">You haven’t voted yet. Pick the player you think didn’t see the word.</template>
        <template v-else>Your vote is in. You can still change it.</template>
        <span v-if="waitingOnVotes.length" class="muted"> Still to vote: {{ waitingOnVotes.map((p) => p.name).join(', ') }}.</span>
      </p>
    </section>
    <Table />
  </template>
</template>

<style scoped>
.center {
  text-align: center;
}
.waiting {
  text-align: center;
}
.status {
  margin: 0;
}
</style>
