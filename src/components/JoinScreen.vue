<script setup>
import { ref } from 'vue';
import { join, store } from '../store.js';

const name = ref(store.savedName);
const busy = ref(false);

async function submit() {
  if (busy.value) return;
  busy.value = true;
  await join(name.value);
  busy.value = false;
}
</script>

<template>
  <main class="join">
    <h1>Imposter Dixit</h1>
    <p class="muted tagline">One of you is in the dark. Can the rest of you work out who?</p>
    <form class="panel stack" @submit.prevent="submit">
      <label for="name">Your name</label>
      <input id="name" v-model="name" maxlength="20" autocomplete="nickname" placeholder="e.g. Alex" autofocus />
      <button class="primary" :disabled="!name.trim() || busy">Join the game</button>
    </form>
  </main>
</template>

<style scoped>
.join {
  max-width: 420px;
  margin: 0 auto;
  padding: 14vh 16px 2rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  text-align: center;
}
h1 {
  font-size: 2.4rem;
  color: var(--amber);
}
.tagline {
  margin: 0;
}
form {
  text-align: left;
}
label {
  font-size: 0.9rem;
  color: var(--muted);
}
</style>
