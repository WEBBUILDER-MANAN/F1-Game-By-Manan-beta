const ACCOUNT_KEY = 'voxel-grand-prix-accounts';
const SESSION_KEY = 'voxel-grand-prix-session';
const ADMIN_USERNAME = 'MVManan';
const ADMIN_PASSWORD_HASH = '1e5816527fb5f02be7a9666e25fec11e208e3a2cd6a03258f5e6f7a8c81f22a3';

function readAccounts() {
  let accounts;
  try { accounts = JSON.parse(localStorage.getItem(ACCOUNT_KEY) || '{}'); }
  catch { accounts = {}; }
  const existingAdminKey = Object.keys(accounts).find(name => name.toLowerCase() === ADMIN_USERNAME.toLowerCase());
  if (!existingAdminKey) {
    accounts[ADMIN_USERNAME] = { username: ADMIN_USERNAME, passwordHash: ADMIN_PASSWORD_HASH, wins: 0, best: {}, isAdmin: true };
    localStorage.setItem(ACCOUNT_KEY, JSON.stringify(accounts));
  } else if (existingAdminKey !== ADMIN_USERNAME || !accounts[existingAdminKey].isAdmin) {
    accounts[ADMIN_USERNAME] = { ...accounts[existingAdminKey], username: ADMIN_USERNAME, passwordHash: ADMIN_PASSWORD_HASH, isAdmin: true };
    if (existingAdminKey !== ADMIN_USERNAME) delete accounts[existingAdminKey];
    localStorage.setItem(ACCOUNT_KEY, JSON.stringify(accounts));
  }
  return accounts;
}

async function hashPassword(password) {
  const data = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function currentProfile() {
  const username = localStorage.getItem(SESSION_KEY);
  if (!username) return null;
  const accounts = readAccounts();
  const key = Object.keys(accounts).find(name => name.toLowerCase() === username.toLowerCase());
  return key ? accounts[key] : null;
}

export function progressFor(profile, trackOrder, teamOrder) {
  if (profile?.isAdmin) return { unlockedTracks: [...trackOrder], unlockedTeams: [...teamOrder] };
  const trackCount = Math.min(trackOrder.length, Math.max(1, 1 + (profile?.wins || 0)));
  const teamCount = Math.min(teamOrder.length, Math.max(1, 1 + Math.floor((profile?.wins || 0) / 2)));
  return {
    unlockedTracks: trackOrder.slice(0, trackCount),
    unlockedTeams: teamOrder.slice(0, teamCount),
  };
}

export async function createProfile(username, password) {
  const name = username.trim();
  if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) throw new Error('Username must be 3-16 letters, numbers, or underscores.');
  if (password.length < 6) throw new Error('Password must be at least 6 characters.');
  const accounts = readAccounts();
  if (Object.keys(accounts).some(existing => existing.toLowerCase() === name.toLowerCase())) throw new Error('That username already exists.');
  accounts[name] = { username: name, passwordHash: await hashPassword(password), wins: 0, best: {}, isAdmin: false };
  localStorage.setItem(ACCOUNT_KEY, JSON.stringify(accounts));
  localStorage.setItem(SESSION_KEY, name);
  return accounts[name];
}

export async function loginProfile(username, password) {
  const name = username.trim();
  const accounts = readAccounts();
  const key = Object.keys(accounts).find(existing => existing.toLowerCase() === name.toLowerCase());
  const account = key ? accounts[key] : null;
  if (!account || account.passwordHash !== await hashPassword(password)) throw new Error('Username or password is incorrect.');
  localStorage.setItem(SESSION_KEY, account.username);
  return account;
}

export function logoutProfile() {
  localStorage.removeItem(SESSION_KEY);
}

export function recordWin() {
  const profile = currentProfile();
  if (!profile) return null;
  const accounts = readAccounts();
  accounts[profile.username] = { ...profile, wins: (profile.wins || 0) + 1 };
  localStorage.setItem(ACCOUNT_KEY, JSON.stringify(accounts));
  return accounts[profile.username];
}
