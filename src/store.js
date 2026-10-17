// Client-side game store: owns the socket connection and the latest personalised state from the server.
import { computed, reactive } from 'vue';
import { io } from 'socket.io-client';

const TOKEN_KEY = 'imposter-dixit-token';
const NAME_KEY = 'imposter-dixit-name';
const CODE_KEY = 'imposter-dixit-game';

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

/** The invite code in the address, for links like /invite?boss-aware-you (or /invite?code=boss-aware-you). */
function codeFromUrl() {
  if (window.location.pathname.replace(/\/+$/, '') !== '/invite') return '';
  return tidyCode(window.location.search);
}

/** Mirrors the server's tidying: "Boss Aware You", "?boss-aware-you" or a pasted link all become boss-aware-you. */
export function tidyCode(raw) {
  let code = String(raw ?? '').trim().toLowerCase();
  if (code.includes('?')) code = code.slice(code.lastIndexOf('?') + 1);
  return code.replace(/^code=/, '').replace(/[^a-z]+/g, '-').replace(/^-+|-+$/g, '');
}

export const inviteUrl = (code) => `${window.location.origin}/invite?${code}`;

function showAddress(code) {
  try {
    window.history.replaceState(null, '', code ? `/invite?${code}` : '/');
  } catch {
    // the address bar is only a convenience
  }
}

const urlCode = codeFromUrl();

export const store = reactive({
  connected: false,
  checkedSession: false, // true once the server has said whether we are already in the game
  state: null,
  code: urlCode || safeStorage((s) => s.getItem(CODE_KEY)) || '', // the game we are in, or the one an invite link points at
  codeExists: null, // for an invite link: does that game exist? (null until the server has said)
  toast: '',
  zoom: null, // { cardId, actions: [{ label, run, primary }] } for the card lightbox
  savedName: safeStorage((s) => s.getItem(NAME_KEY)) ?? '',
});

const socket = io();

socket.on('connect', async () => {
  store.connected = true;
  if (store.code) {
    const reply = await send('resume', { code: store.code, token }, { quiet: true });
    if (!reply.ok) await lookUpCode();
  }
  store.checkedSession = true;
});
socket.on('disconnect', () => {
  store.connected = false;
});
socket.on('state', (state) => {
  store.state = state;
  if (state) {
    store.code = state.code;
    safeStorage((s) => s.setItem(CODE_KEY, state.code));
    showAddress(state.code);
  } else {
    store.zoom = null;
    lookUpCode();
  }
});

/** Asks whether the game that store.code points at still exists (so an invite page can say so). */
async function lookUpCode() {
  store.codeExists = null;
  if (!store.code) return;
  const asked = store.code;
  const reply = await send('lookup', { code: asked }, { quiet: true });
  if (store.code === asked) store.codeExists = Boolean(reply.exists);
}

/** Back to the home page: forget the current code and show the create/join form. */
export function goHome() {
  store.code = '';
  store.codeExists = null;
  safeStorage((s) => s.removeItem(CODE_KEY));
  showAddress('');
}

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

function rememberName(name) {
  safeStorage((s) => s.setItem(NAME_KEY, name.trim()));
}

/** Starts a new game and joins it as its host. */
export async function createGame(name) {
  const reply = await send('create', { token, name });
  if (reply.ok) rememberName(name);
  return reply;
}

/** Joins the game with this invite code (typed in, or from an invite link). */
export async function join(name, code = store.code) {
  const reply = await send('join', { code, token, name });
  if (reply.ok) rememberName(name);
  return reply;
}

export const players = computed(() => store.state?.players ?? []);
export const nameOf = (id) => players.value.find((p) => p.id === id)?.name ?? '?';
export const chooser = computed(() => players.value.find((p) => p.isChooser) ?? null);
export const isHost = computed(() => store.state?.hostId === store.state?.me.id);

export const cardUrl = (cardId, size = 'medium') => `/cards/${size}/card_${String(cardId).padStart(4, '0')}.jpg`;
