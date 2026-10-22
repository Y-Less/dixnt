<script setup>
import { computed, ref } from 'vue';
import { createGame, goHome, join, store, tidyCode } from '../store.js';

const name = ref(store.savedName);
const typedCode = ref('');
const busy = ref(false);

const invited = computed(() => Boolean(store.code)); // an invite link (or a game we were in) points at a game
const typed = computed(() => tidyCode(typedCode.value));

async function run(task) {
  if (busy.value) return;
  busy.value = true;
  await task();
  busy.value = false;
}

const create = () => run(() => createGame(name.value));
const joinInvited = () => run(() => join(name.value, store.code));
const joinTyped = () => run(() => join(name.value, typed.value));
</script>

<template>
  <main class="home">
    <h1>Dixnt</h1>
    <p class="muted tagline">One of you is in the dark. Can the rest of you work out who?</p>

    <div class="panel stack">
      <div>
        <label for="name">Your name</label>
        <input id="name" v-model="name" maxlength="20" autocomplete="nickname" placeholder="e.g. Alex" autofocus />
      </div>

      <template v-if="invited">
        <p class="invite">
          You have been invited to the game <strong class="code">{{ store.code }}</strong>
        </p>
        <p v-if="store.codeExists === false" class="muted">That game doesn't exist any more. Ask your friend for a fresh link.</p>
        <form @submit.prevent="joinInvited">
          <button class="primary wide" :disabled="!name.trim() || busy || store.codeExists === false">Join this game</button>
        </form>
        <button class="quiet" type="button" @click="goHome">Start a new game or use a different code</button>
      </template>

      <template v-else>
        <button class="primary wide" :disabled="!name.trim() || busy" @click="create">Start a new game</button>
        <p class="muted or">or join a friend's game</p>
        <form class="join-row" @submit.prevent="joinTyped">
          <input v-model="typedCode" aria-label="Game code" placeholder="e.g. boss-aware-you" autocomplete="off" autocapitalize="none" spellcheck="false" />
          <button :disabled="!name.trim() || !typed || busy">Join</button>
        </form>
      </template>
    </div>
  </main>
</template>

<style scoped>
.home {
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
.panel {
  text-align: left;
}
label {
  font-size: 0.9rem;
  color: var(--muted);
}
.wide {
  width: 100%;
}
.or {
  text-align: center;
  margin: 0;
}
.join-row {
  display: flex;
  gap: 0.5rem;
}
.join-row input {
  flex: 1;
}
.invite {
  margin: 0;
}
.code {
  color: var(--amber);
  overflow-wrap: anywhere;
}
</style>
