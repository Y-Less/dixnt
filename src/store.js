// Client-side game store: owns the socket connection and the latest personalised state from the server.
import { computed, reactive } from 'vue';
import { io } from 'socket.io-client';

const TOKEN_KEY = 'imposter-dixit-token';
const NAME_KEY = 'imposter-dixit-name';

function safeStorage(action) {
  try {
    return action(window.localStorage);
  } catch {
    return null; // private windows or blocked storage: the game still works, it just won't remember you
  }
}

function newToken() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes); // randomUUID() needs HTTPS, which a LAN game may not have
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

const token = safeStorage((s) => s.getItem(TOKEN_KEY)) ?? newToken();
safeStorage((s) => s.setItem(TOKEN_KEY, token));

export const store = reactive({
  connected: false,
  checkedSession: false, // true once the server has said whether we are already in the game
  state: null,
  toast: '',
  zoom: null, // { cardId, actions: [{ label, run, primary }] } for the card lightbox
  savedName: safeStorage((s) => s.getItem(NAME_KEY)) ?? '',
});

const socket = io();

socket.on('connect', async () => {
  store.connected = true;
  await send('resume', { token }, { quiet: true });
  store.checkedSession = true;
});
socket.on('disconnect', () => {
  store.connected = false;
});
socket.on('state', (state) => {
  store.state = state;
  // Close the lightbox if the card it shows is no longer relevant (e.g. the round moved on).
  if (!state) store.zoom = null;
});

let toastTimer = null;
export function showToast(message) {
  store.toast = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (store.toast = ''), 4000);
}

/** Sends an event to the server and resolves with its reply. Errors are shown as a toast. */
export function send(event, payload = {}, { quiet = false } = {}) {
  return new Promise((resolve) => {
    socket.emit(event, payload, (reply) => {
      if (reply && !reply.ok && !quiet) showToast(reply.error);
      resolve(reply ?? { ok: false });
    });
  });
}

export async function join(name) {
  const reply = await send('join', { token, name });
  if (reply.ok) safeStorage((s) => s.setItem(NAME_KEY, name.trim()));
  return reply;
}

export const players = computed(() => store.state?.players ?? []);
export const nameOf = (id) => players.value.find((p) => p.id === id)?.name ?? '?';
export const chooser = computed(() => players.value.find((p) => p.isChooser) ?? null);
export const isHost = computed(() => store.state?.hostId === store.state?.me.id);

export const cardUrl = (cardId, size = 'medium') => `/cards/${size}/card_${String(cardId).padStart(4, '0')}.jpg`;
