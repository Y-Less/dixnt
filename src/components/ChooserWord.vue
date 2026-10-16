<script setup>
import { ref } from 'vue';
import { send } from '../store.js';

const word = ref('');
const hints = ref([]);
const busy = ref(false);

async function getHints() {
  const reply = await send('hints');
  if (reply.ok) hints.value = reply.hints;
}

async function submit() {
  if (busy.value || !word.value.trim()) return;
  busy.value = true;
  await send('submitWord', { word: word.value });
  busy.value = false;
}
</script>

<template>
  <form class="panel stack" @submit.prevent="submit">
    <h2>Choose a word or phrase</h2>
    <p class="muted">
      Everyone else will see it, except one random player who sees ??? and has to bluff. Pick something open to
      interpretation.
    </p>
    <input v-model="word" maxlength="60" placeholder="Your word or phrase" aria-label="Your word or phrase" autofocus />
    <div class="row">
      <button type="button" @click="getHints">{{ hints.length ? 'More ideas' : 'Give me ideas' }}</button>
      <button
        v-for="hint in hints"
        :key="hint"
        type="button"
        class="chip"
        :class="{ picked: word === hint }"
        @click="word = hint"
      >
        {{ hint }}
      </button>
    </div>
    <button class="primary" :disabled="!word.trim() || busy">Lock it in</button>
  </form>
</template>

<style scoped>
.chip {
  border-style: dashed;
  background: transparent;
}
.chip.picked {
  border-style: solid;
  border-color: var(--amber);
  color: var(--amber);
}
</style>
