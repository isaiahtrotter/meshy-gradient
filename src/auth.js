// Accounts via Supabase Auth, Google only. Google sign-in creates the account on first use, so "Sign in" and
// "Sign up" start the same flow. Supabase keeps the session in localStorage and handles the OAuth redirect
// return on page load. Signed in, the top bar's Sign in / Sign up pair becomes a single Sign out.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { $, setStatus } from './dom.js';
import { askConfirm } from './confirm.js';

export const configured = !!(SUPABASE_URL && SUPABASE_ANON_KEY);
let client = null, resolveClient;
// Resolves with the Supabase client once it has loaded (never, if accounts are off), for modules that talk to the database.
export const whenClient = new Promise(r => { resolveClient = r; });
// onUser(cb) calls cb with the current user (or null) now and again on every sign-in or sign-out.
let currentUserNow = null;
const userListeners = new Set();
export function onUser(cb) { userListeners.add(cb); cb(currentUserNow); }

function render(user) {
  currentUserNow = user;
  for (const cb of userListeners) cb(user);
  const signedIn = !!user;
  $('signInBtn').hidden = signedIn;
  $('signUpBtn').hidden = signedIn;
  $('signOutBtn').hidden = !signedIn;
  $('accountEmail').value = user?.email || 'Not signed in';
  $('accountEmailNote').textContent = signedIn ? 'Signed in with Google.' : configured ? 'Sign in to save your account.' : "Sign-in isn't set up yet.";
  $('settingsSignOutBtn').hidden = !signedIn;
  $('deleteAccountBtn').hidden = !signedIn;
  $('settingsSignInBtn').hidden = signedIn;
  // first sign-in: seed the display name from the Google profile if the user hasn't typed one
  const name = user?.user_metadata?.display_name || user?.user_metadata?.full_name || user?.user_metadata?.name;
  const tw = user?.user_metadata?.twitter;
  if (tw && !$('prefTwitter').value) { $('prefTwitter').value = '@' + tw; $('prefTwitter').dispatchEvent(new Event('input')); }
  if (name && !$('prefName').value) { $('prefName').value = name; $('prefName').dispatchEvent(new Event('input')); }
}

async function signIn() {
  if (!client) { setStatus('Accounts are not configured yet.', true); return; }
  const { error } = await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname } });
  if (error) setStatus(error.message, true);
}
export const startSignIn = signIn;
async function signOut() {
  if (!client) return;
  const { error } = await client.auth.signOut();
  if (error) setStatus(error.message, true);
}

for (const id of ['signInBtn', 'signUpBtn', 'settingsSignInBtn']) $(id).addEventListener('click', signIn);
for (const id of ['signOutBtn', 'settingsSignOutBtn']) $(id).addEventListener('click', signOut);

// Deleting the account removes everything: the user, and through the database's cascade every gradient they saved or
// published (delete_my_account in supabase/schema.sql). It always asks first.
$('deleteAccountBtn').addEventListener('click', async () => {
  if (!client) return;
  const ok = await askConfirm({
    title: 'Delete your account?',
    text: 'This permanently deletes your account and everything in it, including every gradient you’ve saved and every gradient you’ve published to the community. Anyone who has a share link to one of them will lose access. This can’t be undone.',
    confirmLabel: 'Delete account', danger: true,
  });
  if (!ok) return;
  const { error } = await client.rpc('delete_my_account');
  if (error) {
    await askConfirm({ title: 'Couldn’t delete your account', text: error.message || 'Something went wrong. Please try again.', confirmLabel: 'OK', cancelLabel: null });
    return;
  }
  try { await client.auth.signOut(); } catch {} // the user no longer exists, so this may complain; the local session still needs clearing
  for (const k of ['meshGradientSavedHash.v1', 'meshGradientShareSlug.v1']) { try { localStorage.removeItem(k); } catch {} }
  location.replace(`${location.origin}/`); // a clean start, signed out
});
render(null);

if (configured) {
  // loaded lazily so a flaky CDN can never block the editor from booting
  import('https://esm.sh/@supabase/supabase-js@2').then(({ createClient }) => {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    resolveClient(client);
    client.auth.onAuthStateChange((_event, session) => render(session?.user ?? null));
  }).catch(() => setStatus('Could not load sign-in.', true));
}

export const currentUser = async () => (client ? (await client.auth.getUser()).data.user : null);
