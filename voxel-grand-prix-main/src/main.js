// Voxel Grand Prix — bootstrapping, menu, game loop, visual sync.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { TRACKS, TRACK_ORDER } from './config.js';
import { CIRCUITS } from './data/circuits.js';
import { Track } from './track.js';
import { buildEnvironment } from './environment.js';
import { buildSculptedCar, buildCarInstance, clearCarCache } from './carSculpt.js';
import { TEAMS, TEAM_ORDER, loadSelectedTeam } from './teams.js';
import { CarPhysics } from './physics.js';
import { Garage } from './garage.js';
import { CameraRig, CAMERA_MODES } from './cameras.js';
import { Input } from './input.js';
import { GameAudio } from './audio.js';
import { Particles, SkidMarks } from './particles.js';
import { Hud, drawTrackMap } from './hud.js';
import { Race } from './race.js';
import { createProfile, loginProfile, logoutProfile, currentProfile, progressFor, recordWin } from './profile.js';
import { Multiplayer } from './multiplayer.js';

// ------------------------------------------------------------ renderer
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.getElementById('app').appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 6000);

const input = new Input();
const audio = new GameAudio();
const hud = new Hud();
const multiplayer = new Multiplayer();

let G = null; // current game session
let selTrack = TRACK_ORDER[0];
let selTeam = loadSelectedTeam();
let profile = currentProfile();
let selMode = localStorage.getItem('voxelf1-mode') === 'race' ? 'race' : 'time';
let paused = false;
const RACE_LOD = 0.022;
const RACE_LAPS = 3;

const garage = new Garage(
  renderer,
  teamId => { selTeam = teamId; refreshTeamChip(); garage.close(); hud.show('menu', true); },
  () => { garage.close(); hud.show('menu', true); }
);

function refreshTeamChip() {
  const t = TEAMS[selTeam];
  const chip = document.getElementById('selected-team');
  if (chip) chip.innerHTML = `<i style="background:${t.uiColor}"></i>${t.name} <b>#${t.number}</b>`;
}

function openGarage() {
  hud.show('menu', false);
  garage.open(selTeam);
}

function refreshProfileUI() {
  const progress = progressFor(profile, TRACK_ORDER, TEAM_ORDER);
  if (!progress.unlockedTracks.includes(selTrack)) selTrack = progress.unlockedTracks[0];
  if (!progress.unlockedTeams.includes(selTeam)) selTeam = progress.unlockedTeams[0];
  document.getElementById('profile-name').textContent = `${profile.username} · DRIVER PROFILE`;
  document.getElementById('profile-progress').textContent = `${profile.wins || 0} WINS · ${progress.unlockedTracks.length}/${TRACK_ORDER.length} TRACKS · ${progress.unlockedTeams.length}/${TEAM_ORDER.length} CARS`;
  garage.setUnlockedTeams(progress.unlockedTeams);
  refreshTeamChip();
}

function setupAuth() {
  const overlay = document.getElementById('auth');
  const form = document.getElementById('auth-form');
  const submit = document.getElementById('auth-submit');
  const switcher = document.getElementById('auth-switch');
  const error = document.getElementById('auth-error');
  let signIn = false;
  const refresh = () => {
    submit.textContent = signIn ? 'Sign In' : 'Create Profile';
    switcher.textContent = signIn ? 'Need a profile? Create one' : 'Already registered? Sign in';
    error.textContent = '';
  };
  switcher.addEventListener('click', () => { signIn = !signIn; refresh(); });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    try {
      profile = signIn
        ? await loginProfile(form.elements['auth-username'].value, form.elements['auth-password'].value)
        : await createProfile(form.elements['auth-username'].value, form.elements['auth-password'].value);
      overlay.classList.add('hidden');
      refreshProfileUI();
      setupMenu();
    } catch (err) { error.textContent = err.message; }
  });
  document.getElementById('btn-logout').addEventListener('click', () => {
    logoutProfile(); profile = null; overlay.classList.remove('hidden');
  });
  refresh();
  if (profile) { overlay.classList.add('hidden'); refreshProfileUI(); }
}

// ------------------------------------------------------------ menu
function setupMenu() {
  const cards = document.getElementById('track-cards');
  cards.innerHTML = '';
  const progress = progressFor(profile, TRACK_ORDER, TEAM_ORDER);
  for (const id of TRACK_ORDER) {
    const cfg = TRACKS[id];
    const card = document.createElement('div');
    const locked = !progress.unlockedTracks.includes(id);
    card.className = 'track-card' + (id === selTrack ? ' selected' : '') + (locked ? ' locked' : '');
    card.dataset.id = id;
    card.innerHTML = `
      <canvas width="240" height="180"></canvas>
      <div class="tc-name">${cfg.flag} ${cfg.name}${locked ? '<span class="tc-lock">LOCKED</span>' : ''}<span class="tc-full">${cfg.fullName}</span></div>
      <div class="tc-stats">${(CIRCUITS[id].length / 1000).toFixed(3)} km · ${cfg.corners.length} corners</div>
      <div class="tc-desc">${cfg.desc}</div>`;
    cards.appendChild(card);
    const cv = card.querySelector('canvas');
    drawTrackMap(cv.getContext('2d'), CIRCUITS[id].pts, 240, 180, cfg.minimapRot, { width: 3.5, color: '#e8ecf4', pad: 14 });
    card.addEventListener('click', () => {
      if (locked) return;
      selTrack = id;
      cards.querySelectorAll('.track-card').forEach(c => c.classList.toggle('selected', c.dataset.id === id));
    });
  }
  refreshTeamChip();
  const sensitivity = document.getElementById('steering-sensitivity');
  const sensitivityValue = document.getElementById('steering-sensitivity-value');
  const refreshSensitivity = () => {
    const percent = Math.round(input.steeringSensitivity * 100);
    if (sensitivity) sensitivity.value = String(percent);
    if (sensitivityValue) sensitivityValue.textContent = `${percent}%`;
  };
  sensitivity?.addEventListener('input', () => {
    input.setSteeringSensitivity(Number(sensitivity.value) / 100);
    refreshSensitivity();
  });
  refreshSensitivity();
  const onlineStatus = document.getElementById('online-status');
  const onlineRoom = document.getElementById('online-room');
  multiplayer.onStatus = text => { if (onlineStatus) onlineStatus.textContent = text; };
  multiplayer.onMessage = message => {
    if (message.type === 'room') {
      multiplayer.code = message.code;
      if (onlineRoom) onlineRoom.textContent = message.code;
      if (onlineStatus) onlineStatus.textContent = message.host ? 'Room created' : 'Joined room';
    } else if (message.type === 'state') updateRemotePlayer(message.state);
    else if (message.type === 'peer-joined' && onlineStatus) onlineStatus.textContent = 'Friend joined';
    else if (message.type === 'peer-left' && onlineStatus) onlineStatus.textContent = 'Friend left';
    else if (message.type === 'error' && onlineStatus) onlineStatus.textContent = message.message;
  };
  document.getElementById('online-create')?.addEventListener('click', () => multiplayer.create());
  document.getElementById('online-join')?.addEventListener('click', () => multiplayer.join(document.getElementById('online-code').value));
  const refreshMode = () => {
    document.querySelectorAll('.mode-chip').forEach(c => c.classList.toggle('on', c.dataset.mode === selMode));
    const btn = document.getElementById('btn-start');
    if (btn) btn.textContent = selMode === 'race' ? `Race Start · ${RACE_LAPS} laps` : 'Enter Track · LIGHTS OUT';
  };
  document.querySelectorAll('.mode-chip').forEach(c => c.addEventListener('click', () => {
    selMode = c.dataset.mode === 'race' ? 'race' : 'time';
    localStorage.setItem('voxelf1-mode', selMode);
    refreshMode();
  }));
  refreshMode();
  document.getElementById('btn-garage').addEventListener('click', () => {
    audio.init(); audio.resume();
    openGarage();
  });
  document.getElementById('btn-start').addEventListener('click', () => {
    audio.init(); audio.resume();
    startGame(selTrack, selTeam);
  });
  document.getElementById('btn-resume').addEventListener('click', () => setPaused(false));
  document.getElementById('btn-restart').addEventListener('click', () => { setPaused(false); startGame(selTrack, selTeam); });
  document.getElementById('btn-menu').addEventListener('click', () => { setPaused(false); toMenu(); });
  document.getElementById('btn-res-again').addEventListener('click', () => { hud.show('results', false); startGame(selTrack, selTeam); });
  document.getElementById('btn-res-menu').addEventListener('click', () => { hud.show('results', false); toMenu(); });
}

async function updateRemotePlayer(state) {
  if (!G || !state?.id || state.id === profile?.username) return;
  let remote = G.remotePlayers?.get(state.id);
  if (!remote) {
    G.remotePlayers ??= new Map();
    const team = TEAMS[state.team] || TEAMS.redbull;
    const car = await buildCarInstance(team, RACE_LOD, () => {}, 'race');
    car.group.rotation.order = 'YXZ';
    G.scene.add(car.group);
    remote = { car };
    G.remotePlayers.set(state.id, remote);
  }
  remote.car.group.position.set(state.x, state.y, state.z);
  remote.car.group.rotation.y = state.heading;
  remote.car.group.rotation.x = state.pitch || 0;
  remote.car.tilt.rotation.z = state.roll || 0;
  remote.car.tilt.rotation.x = state.dive || 0;
}

function toMenu() {
  if (G) disposeGame();
  garage.close();
  hud.show('menu', true);
  hud.show('hud', false);
  hud.show('lights', false);
}

function setPaused(v) {
  if (!G) return;
  paused = v;
  hud.show('pause', v);
  if (audio.ctx) { v ? audio.ctx.suspend() : audio.ctx.resume(); }
}

// ------------------------------------------------------------ game session
function disposeGame() {
  if (!G) return;
  G.race.cancelTimers();
  G.env.dispose();
  G.track.dispose();
  G.scene.remove(G.track.group);
  G.particles.dispose(G.scene);
  G.skids.dispose(G.scene);
  clearCarCache(); // cloned car geometries are disposed with the scene
  G.scene.traverse(o => { if (o.geometry) o.geometry.dispose(); });
  G = null;
  window.__game = null;
}

let starting = false;
async function startGame(trackId, teamId) {
  if (starting) return;
  starting = true;
  garage.close();
  hud.show('menu', false);
  hud.show('loading', true);
  try {
    await new Promise(r => setTimeout(r, 30));
    disposeGame();
    await buildGame(trackId, teamId);
    hud.show('loading', false);
    hud.show('hud', true);
    G.race.start();
  } finally {
    starting = false;
  }
}

async function buildGame(trackId, teamId) {
  const cfg = TRACKS[trackId];
  const team = TEAMS[teamId] || TEAMS.redbull;
  const loadMsg = document.getElementById('loading-msg');

  const scene = new THREE.Scene();
  renderer.toneMappingExposure = cfg.sky.exposure;

  if (loadMsg) loadMsg.textContent = 'Laying track…';
  const track = new Track(cfg);
  scene.add(track.group);
  if (loadMsg) loadMsg.textContent = 'Generating terrain and lighting…';
  await new Promise(r => setTimeout(r, 16));
  const env = buildEnvironment(scene, track, cfg, renderer);

  // night races render through a bloom composer so emissives glow
  let composer = null;
  if (cfg.sky.type === 'night') {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.55, 0.5, 0.68);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    composer.setSize(window.innerWidth, window.innerHeight);
  }

  // ---- cars: player (+ 7 AI in race mode, two per team) ----
  const car = await buildCarInstance(team, RACE_LOD, (f, label) => {
    if (loadMsg && label) loadMsg.textContent = label;
  }, 'race');
  car.group.rotation.order = 'YXZ';
  scene.add(car.group);
  const physics = new CarPhysics(track);
  const playerEntry = {
    physics, car, team, isPlayer: true, skill: 10.8, bias: 0,
    name: `${team.short} #${team.number} · You`, short: team.short,
    roll: 0, dive: 0,
  };

  const entries = [];
  if (selMode === 'race') {
    // full 2022 grid: every team fields one car; player takes their team's seat
    const slots = TEAM_ORDER.filter(id => id !== team.id);
    const skills = [0.985, 0.978, 0.971, 0.964, 0.957, 0.950, 0.942, 0.934, 0.926];
    for (let i = 0; i < slots.length; i++) {
      if (loadMsg) loadMsg.textContent = `Building AI car ${i + 1}/${slots.length}…`;
      await new Promise(r => setTimeout(r, 0));
      const t = TEAMS[slots[i]];
      const c = await buildCarInstance(t, RACE_LOD, () => {}, 'race');
      c.group.rotation.order = 'YXZ';
      scene.add(c.group);
      entries.push({
        physics: new CarPhysics(track), car: c, team: t, isPlayer: false,
        skill: skills[i], bias: (Math.random() * 2 - 1) * 1.1,
        name: `${t.short} #${t.number}`, short: t.short,
        roll: 0, dive: 0,
      });
    }
  }
  entries.push(playerEntry); // player starts at the back of the grid

  // grid placement (matches the painted slots)
  entries.forEach((e, i) => {
    const back = 9 + i * 9;
    e.physics.placeAt(((-back / track.length) % 1 + 1) % 1, (i % 2 === 0 ? 1 : -1) * track.width * 0.22);
    e.physics.locked = true;
  });

  const rig = new CameraRig(camera, car, physics, track);
  const particles = new Particles(scene);
  const skids = new SkidMarks(scene);
  const race = new Race(track, entries, hud, audio, { mode: selMode, laps: RACE_LAPS });
  race.onPlayerFinish = cls => showResults(cls);

  hud.setTrack(cfg, track);
  hud.setMode(selMode, RACE_LAPS);
  hud.setCameraLabel(CAMERA_MODES[0].label);

  G = {
    scene, track, env, car, physics, entries, rig, particles, skids, race, cfg, team, composer,
    accum: 0, smoke: { t: 0 }, lastGear: 1, wallCd: 0,
  };
  window.__game = G;
}

function showResults(cls) {
  const box = document.getElementById('results-rows');
  if (!box) return;
  box.innerHTML = '';
  const playerRow = cls.find(r => r.isPlayer);
  if (selMode === 'race' && playerRow?.pos === 1) {
    profile = recordWin() || profile;
    refreshProfileUI();
  }
  document.getElementById('results-pos').textContent = `P${playerRow ? playerRow.pos : '-'}`;
  for (const r of cls) {
    const div = document.createElement('div');
    div.className = 'res-row' + (r.isPlayer ? ' me' : '');
    const gap = r.pos === 1 ? 'Winner' : (r.finished && r.gapMs != null ? `+${(r.gapMs / 1000).toFixed(2)}s` : '—');
    div.innerHTML = `<b>P${r.pos}</b><span class="rn">${r.name}</span><span class="rg">${gap}</span>`;
    box.appendChild(div);
  }
  if (G) G.rig.setMode('tv'); // victory-lap broadcast view behind the overlay
  hud.show('results', true);
}

// ------------------------------------------------------------ per-frame visual sync
const SMOKE_GRAY = new THREE.Color(0xcfd2d6);
const SPRAY_GREEN = new THREE.Color(0x69a04a);
const _wpos = new THREE.Vector3(), _f2 = new THREE.Vector3(), _l2 = new THREE.Vector3();

function syncCarVisual(e, dt) {
  const car = e.car, p = e.physics;
  car.group.position.copy(p.pos);
  car.group.rotation.y = p.heading;
  car.group.rotation.x = p.groundPitch;
  const rollT = THREE.MathUtils.clamp(p.latG * 0.026, -0.06, 0.06);
  const diveT = THREE.MathUtils.clamp(-p.longG * 0.014, -0.03, 0.045);
  e.roll = THREE.MathUtils.damp(e.roll, rollT, 9, dt);
  e.dive = THREE.MathUtils.damp(e.dive, diveT, 9, dt);
  car.tilt.rotation.z = e.roll;
  car.tilt.rotation.x = e.dive;
  car.tilt.position.y = p.surface === 'kerb' ? Math.sin(performance.now() * 0.09) * 0.012 : 0;
  for (const w of car.wheels) {
    if (w.isFront) w.steer.rotation.y = p.steer;
    w.spin.rotation.x += p.wheelSpin * dt;
  }
  const targetRot = p.drsOpen ? -0.72 : 0;
  car.drsPivot.rotation.x = THREE.MathUtils.damp(car.drsPivot.rotation.x, targetRot, 12, dt);
  car.rainLight.visible = p.brake > 0.12 || (p.throttle < 0.05 && p.speed > 30);
}

function syncVisuals(dt) {
  const { physics: p } = G;
  for (const e of G.entries) syncCarVisual(e, dt);

  // player-only feedback
  if (p.gear !== G.lastGear) { audio.shift(); G.lastGear = p.gear; }
  G.wallCd -= dt;
  if (p.wallHit > 1.6 && G.wallCd <= 0) { audio.wallHit(p.wallHit); G.wallCd = 0.25; }

  // particles + skid marks at rear wheels
  const slide = Math.max(Math.abs(p.slipRear) - 0.10, Math.abs(p.slipFront) - 0.13, 0);
  const F = p.forward(_f2), Lf = p.left(_l2);
  const onRoad = p.surface === 'road' || p.surface === 'kerb';
  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? 1 : -1;
    _wpos.copy(p.pos).addScaledVector(F, -1.8).addScaledVector(Lf, side * 0.8);
    _wpos.y = p.pos.y + 0.03;
    if (slide > 0.02 && p.speed > 8) {
      if (onRoad) {
        G.skids.add(i, _wpos, Math.min(slide * 6, 1));
        G.smoke.t += dt;
        if (G.smoke.t > 0.016) {
          G.smoke.t = 0;
          particlesSpawn(_wpos, SMOKE_GRAY, 0.8 + slide * 2, p);
        }
      } else {
        G.skids.breakStreak(i);
        if (Math.random() < 0.55) particlesSpawn(_wpos, SPRAY_GREEN, 0.65, p);
      }
    } else {
      G.skids.breakStreak(i);
    }
  }
  if (p.surface === 'grass' && p.speed > 12 && Math.random() < 0.4) {
    _wpos.copy(p.pos).addScaledVector(F, -2.0);
    particlesSpawn(_wpos, SPRAY_GREEN, 0.8, p);
  }

  G.particles.update(dt);

  // audio update
  audio.update(dt, {
    rpm: p.rpm, throttle: p.throttle,
    speed01: Math.min(p.speed / 92, 1),
    slide: slide * 5,
    onKerb: p.surface === 'kerb',
    onGrass: p.surface === 'grass',
    cockpit: G.rig.mode !== 'chase',
  });
}

function particlesSpawn(pos, color, size, p) {
  _f2.set((Math.random() - 0.5) * 2, 0.5, (Math.random() - 0.5) * 2);
  G.particles.spawn(pos, _f2, color, size, 0.55 + Math.random() * 0.5);
}

// ------------------------------------------------------------ main loop
const FIXED = 1 / 120;
let lastT = performance.now();

function frame() {
  requestAnimationFrame(frame);
  const now = performance.now();
  const dt = Math.min((now - lastT) / 1000, 0.1);
  lastT = now;
  tick(dt);
}

function tick(dt, render = true) {
  // garage showroom has its own scene + camera
  if (garage.active) {
    for (const ev of input.takeEvents()) {
      if (ev === 'pause') { garage.close(); hud.show('menu', true); }
    }
    garage.update(dt);
    return;
  }

  // one-shot events work even in menus
  for (const ev of input.takeEvents()) {
    if (!G) continue;
    if (ev === 'camera') { const m = G.rig.cycle(); hud.setCameraLabel(m.label); }
    if (ev === 'reset' && !paused) G.race.reset();
    if (ev === 'pause') setPaused(!paused);
    if (ev === 'mute') { audio.setMuted(!audio.muted); hud.message(audio.muted ? '🔇 Muted' : '🔊 Sound On', 1000); }
    if (ev === 'autopilot') {
      G.race.autopilotActive = !G.race.autopilotActive;
      // demo mode watches from the trackside TV pods
      const m = G.rig.setMode(G.race.autopilotActive ? 'tv' : 'chase');
      hud.setCameraLabel(m.label);
      hud.message(G.race.autopilotActive ? '🤖 Demo Mode · Broadcast Camera' : '🎮 Manual Driving', 1400);
    }
  }

  if (G && !paused) {
    input.update(dt);
    G.accum = Math.min(G.accum + dt, FIXED * 8);
    const inp = { steer: input.steer, throttle: input.throttle, brake: input.brake };
    while (G.accum >= FIXED) {
      for (const e of G.entries) {
        const ein = G.race.inputFor(e, inp);
        e._lastInput = ein;
        e.physics.step(FIXED, ein);
      }
      G.accum -= FIXED;
    }
    if (G.entries.length > 1) G.race.resolveCollisions();
    G.race.update(dt, inp);
    syncVisuals(dt);
    multiplayer.sendState({
      id: profile?.username,
      team: selTeam,
      x: G.physics.pos.x, y: G.physics.pos.y, z: G.physics.pos.z,
      heading: G.physics.heading, pitch: G.physics.groundPitch,
      roll: G.entries.find(e => e.isPlayer)?.roll || 0,
      dive: G.entries.find(e => e.isPlayer)?.dive || 0,
    });
    G.rig.update(dt);
    G.env.update(dt, G.physics.pos);
    hud.update(G);
  }

  if (G && render) {
    if (G.composer) G.composer.render();
    else renderer.render(G.scene, camera);
  }
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (G && G.composer) G.composer.setSize(window.innerWidth, window.innerHeight);
  garage.resize(window.innerWidth, window.innerHeight);
});
document.addEventListener('visibilitychange', () => { if (document.hidden && G && !paused) setPaused(true); });

setupMenu();
setupAuth();
frame();

// ---- dev helpers (screenshot pipeline + programmatic control) ----
window.__renderer = renderer;
window.__camera = camera;
window.__startGame = startGame;
window.__tick = tick;
window.__setPaused = setPaused;
window.__garage = garage;
window.__shot = (name = `shot-${Date.now()}`) => {
  const scene = garage.active ? garage.scene : (G && G.scene);
  const cam = garage.active ? garage.camera : camera;
  if (!scene) return Promise.resolve('no scene');
  if (!garage.active && G && G.composer) G.composer.render();
  else renderer.render(scene, cam);
  const url = renderer.domElement.toDataURL('image/jpeg', 0.85);
  return fetch(`/__shot?name=${name}`, { method: 'POST', body: url }).then(r => r.text());
};
