// Battle for Sunshine: rendering, camera, input (mouse/keyboard/touch), HUD, minimap, saved groups.
import * as THREE from '../vendor/three.module.min.js';
import { GameMap } from './map.js';
import { Game, TYPES, BASES } from './game.js';
import { SIDES } from './models.js';

const VERSION = 'v1';
const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');
const $ = (id) => document.getElementById(id);
if (matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0) document.body.classList.add('touch');
addEventListener('pointerdown', e => { if (e.pointerType === 'touch') document.body.classList.add('touch'); }, true);

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(innerWidth, innerHeight);
$('view').appendChild(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x9fb3c4); scene.fog = new THREE.Fog(0x9fb3c4, 1600, 3400);
scene.add(new THREE.HemisphereLight(0xdfe8f0, 0x4a4a3a, 1.6));
const sun = new THREE.DirectionalLight(0xfff1d6, 1.5); sun.position.set(400, 800, 300); scene.add(sun);
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 5, 6000);
const overlay = $('overlay'), octx = overlay.getContext('2d');
function resize() {
  renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  overlay.width = innerWidth * devicePixelRatio; overlay.height = innerHeight * devicePixelRatio; octx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
}
addEventListener('resize', resize); resize();

// ---------- camera rig: fixed 45° pitch, rotate / zoom / pan ----------
const cam = { x: 0, z: 0, yaw: 0, dist: 520 };
const PITCH = Math.PI / 4;
function applyCam() {
  if (map) { cam.x = Math.max(-map.W / 2, Math.min(map.W / 2, cam.x)); cam.z = Math.max(-map.H / 2, Math.min(map.H / 2, cam.z)); }
  cam.dist = Math.max(45, Math.min(1500, cam.dist));
  const h = cam.dist * Math.cos(PITCH);
  camera.position.set(cam.x + Math.sin(cam.yaw) * h, cam.dist * Math.sin(PITCH), cam.z + Math.cos(cam.yaw) * h);
  camera.lookAt(cam.x, 0, cam.z);
}
function pan(fwd, right) {
  const s = cam.dist / 520;
  cam.x += (-Math.sin(cam.yaw) * fwd + Math.cos(cam.yaw) * right) * s;
  cam.z += (-Math.cos(cam.yaw) * fwd - Math.sin(cam.yaw) * right) * s;
}
const ray = new THREE.Raycaster(), ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
function screenToGround(sx, sy) {
  ray.setFromCamera(new THREE.Vector2(sx / innerWidth * 2 - 1, -(sy / innerHeight) * 2 + 1), camera);
  const p = new THREE.Vector3(); return ray.ray.intersectPlane(ground, p) ? p : null;
}
const _v = new THREE.Vector3();
function toScreen(x, y, z) { _v.set(x, y, z).project(camera); return [(_v.x + 1) / 2 * innerWidth, (1 - _v.y) / 2 * innerHeight, _v.z < 1]; }

// ---------- loading ----------
let map = null, game = null, layer = null, satImg = null, speed = Number(params.get('speed')) || 1, paused = false;
const selection = new Set(), groups = {}; let armed = null, boxMode = false, saveArmed = false;
async function load() {
  const [data, tex] = await Promise.all([
    fetch('data/map.json').then(r => r.json()),
    new THREE.TextureLoader().loadAsync('data/sunshine_sat.jpg'),
  ]);
  map = new GameMap(data); map.build(scene, tex);
  satImg = new Image(); satImg.src = 'data/minimap.jpg';
  $('loading').textContent = 'Map ready: Sunshine, Victoria (' + data.buildings.length + ' buildings from OpenStreetMap)';
  cam.x = 0; cam.z = 0; cam.dist = 1300; applyCam();
  if (params.get('autostart')) start(params.get('autostart'));
}
load().catch(e => { $('loading').textContent = 'Failed to load map: ' + e.message; console.error(e); });

function start(side) {
  if (!map) return;
  if (layer) scene.remove(layer);
  layer = new THREE.Group(); scene.add(layer);
  game = new Game(map, layer, side); selection.clear(); for (const k in groups) delete groups[k];
  armed = null; paused = false; boxMode = false; $('boxBtn').classList.remove('on');
  const [bx, bz] = BASES[side]; cam.x = bx; cam.z = bz + (side === 'allies' ? -30 : 30); cam.yaw = side === 'allies' ? 0 : Math.PI; cam.dist = 330; applyCam();
  $('title').hidden = true; $('end').hidden = true; $('pause').hidden = true; $('hud').hidden = false;
  renderGroups(); updatePanel();
}
$('playAllies').onclick = () => start('allies');
$('playAxis').onclick = () => start('axis');
function setPaused(p) { if (!game || game.over) return; paused = p; $('pause').hidden = !p; }
$('pauseBtn').onclick = () => setPaused(true);
$('resume').onclick = () => setPaused(false);
$('restart').onclick = () => start(game.player);
$('again').onclick = () => start(game.player);
const toTitle = () => { $('pause').hidden = true; $('end').hidden = true; $('hud').hidden = true; $('title').hidden = false; paused = false; if (layer) scene.remove(layer); game = null; cam.dist = 1300; cam.x = cam.z = 0; applyCam(); };
$('toTitle').onclick = toTitle; $('endTitleBtn').onclick = toTitle;
$('speedBtn').onclick = () => { speed = speed >= 4 ? 1 : speed * 2; $('speedBtn').textContent = speed + '×'; };

// ---------- selection & commands ----------
const mine = () => game ? game.units.filter(u => u.alive && !u.carrier && u.side === game.player) : [];
function select(units, add = false) {
  if (!add) selection.clear(); units.forEach(u => selection.add(u)); updatePanel();
}
function selected() { return [...selection].filter(u => u.alive && !u.carrier); }
function unitAt(sx, sy) {
  let best = null, bd = Infinity;
  for (const u of game.units) {
    if (!u.alive || u.carrier) continue;
    if (u.side !== game.player && !game.canSee(game.player, u)) continue;
    const [x, y, ok] = toScreen(u.x, (u.building ? u.building.h : 0) + 3, u.z); if (!ok) continue;
    const [x2] = toScreen(u.x + u.T.radius * 2.2, 0, u.z); const rpx = Math.max(16, Math.abs(x2 - x) * 1.2);
    const d = Math.hypot(x - sx, y - sy); if (d < rpx && d < bd) { bd = d; best = u; }
  }
  return best;
}
const markers = [];
function command(sx, sy, forceAmove = false) {
  const sel = selected(); if (!sel.length) return false;
  const u = unitAt(sx, sy), p = screenToGround(sx, sy);
  if (u && u.side !== game.player) { game.orderAttack(sel, u); markers.push({ x: u.x, z: u.z, t: performance.now(), c: '#ff5a4a' }); }
  else if (u && u.type === 'truck' && sel.every(s => s.type === 'infantry') && !forceAmove) { game.orderLoad(sel, u); markers.push({ x: u.x, z: u.z, t: performance.now(), c: '#7ad0ff' }); }
  else if (p) { game.orderMove(sel, p.x, p.z, forceAmove || armed === 'amove'); markers.push({ x: p.x, z: p.z, t: performance.now(), c: forceAmove || armed === 'amove' ? '#ffb347' : '#9cff7a' }); }
  armed = null; $('cmds').querySelector('[data-cmd=amove]').classList.remove('on');
  return true;
}
function boxSelect(x0, y0, x1, y1, add) {
  const [a, b, c, d] = [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)];
  const inBox = mine().filter(u => { const [x, y, ok] = toScreen(u.x, (u.building ? u.building.h : 0) + 2, u.z); return ok && x >= a && x <= c && y >= b && y <= d; });
  select(inBox, add); return inBox;
}
function doCmd(c) {
  if (!game) return; const sel = selected();
  if (c === 'amove') { armed = armed === 'amove' ? null : 'amove'; $('cmds').querySelector('[data-cmd=amove]').classList.toggle('on', !!armed); }
  if (c === 'hold') game.orderHold(sel);
  if (c === 'stop') game.orderStop(sel);
  if (c === 'unload') sel.filter(u => u.type === 'truck').forEach(t => game.unload(t));
  if (c === 'all') select(mine());
  if (c === 'box') { boxMode = !boxMode; $('boxBtn').classList.toggle('on', boxMode); }
  updatePanel();
}
$('cmds').addEventListener('click', e => { const b = e.target.closest('button'); if (b) doCmd(b.dataset.cmd); });

// saved groups
let lastRecall = { n: 0, t: 0 };
function saveGroup(n) { const s = selected(); if (!s.length) return; groups[n] = s; s.forEach(u => u.group = n); renderGroups(); flash(`Group ${n} saved (${s.length} units)`); }
function recallGroup(n) {
  const g = (groups[n] || []).filter(u => u.alive); if (!g.length) return;
  select(g.filter(u => !u.carrier));
  const now = performance.now(); if (lastRecall.n === n && now - lastRecall.t < 450) centreOn(g); lastRecall = { n, t: now };
}
function centreOn(us) { us = us.filter(u => !u.carrier); if (!us.length) return; cam.x = us.reduce((s, u) => s + u.x, 0) / us.length; cam.z = us.reduce((s, u) => s + u.z, 0) / us.length; }
function renderGroups() {
  const box = $('groupBtns');
  if (!box.children.length) for (let n = 1; n <= 9; n++) {
    const b = document.createElement('button'); b.dataset.g = n; box.appendChild(b);
    b.onclick = () => { if (saveArmed) { saveGroup(n); saveArmed = false; $('saveGroup').classList.remove('on'); } else recallGroup(n); };
  }
  for (const b of box.children) {
    const n = +b.dataset.g, cnt = (groups[n] || []).filter(u => u.alive).length, html = n + (cnt ? `<sup>${cnt}</sup>` : '');
    if (b.innerHTML !== html) { b.innerHTML = html; b.title = cnt ? `Recall group ${n} (${cnt} units)` : `Empty: Save then ${n}`; }
  }
}
$('saveGroup').onclick = () => { saveArmed = !saveArmed; $('saveGroup').classList.toggle('on', saveArmed); };

// ---------- pointer input ----------
const ptrs = new Map(); let gesture = null; let mouse = { x: -1, y: -1, in: false };
const cv = renderer.domElement;
cv.addEventListener('contextmenu', e => e.preventDefault());
cv.addEventListener('pointerdown', e => {
  if (e.pointerType === 'touch') document.body.classList.add('touch');
  cv.setPointerCapture(e.pointerId);
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now(), btn: e.button, type: e.pointerType });
  if (ptrs.size === 2) { gesture = { kind: 'two', ...twoInfo() }; clearTimeout(longPressT); return; }
  if (e.pointerType === 'touch') {
    gesture = { kind: boxMode ? 'box' : 'pending' };
    clearTimeout(longPressT);
    longPressT = setTimeout(() => { const p = ptrs.get(e.pointerId); if (p && gesture && gesture.kind === 'pending') { gesture.kind = 'box'; navigator.vibrate?.(15); } }, 380);
  } else gesture = { kind: e.button === 0 ? 'lpending' : e.button === 2 ? 'rpending' : 'mpan' };
});
let longPressT = 0;
function twoInfo() { const [a, b] = [...ptrs.values()]; return { d: Math.hypot(a.x - b.x, a.y - b.y), a: Math.atan2(b.y - a.y, b.x - a.x), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }; }
cv.addEventListener('pointermove', e => {
  if (e.pointerType === 'mouse') mouse = { x: e.clientX, y: e.clientY, in: true };
  const p = ptrs.get(e.pointerId); if (!p) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
  const moved = Math.hypot(p.x - p.x0, p.y - p.y0);
  if (!gesture) return;
  if (gesture.kind === 'two' && ptrs.size === 2) {
    const n = twoInfo(); cam.dist *= gesture.d / Math.max(1, n.d); cam.yaw -= (n.a - gesture.a);
    const s = cam.dist / innerHeight * 1.2; pan((n.my - gesture.my) * s, -(n.mx - gesture.mx) * s); Object.assign(gesture, n); return;
  }
  if (gesture.kind === 'pending' && moved > 10) { gesture.kind = 'pan'; clearTimeout(longPressT); }
  if (gesture.kind === 'lpending' && moved > 6) gesture.kind = 'box';
  if (gesture.kind === 'rpending' && moved > 6) gesture.kind = 'rotate';
  if (gesture.kind === 'pan' || gesture.kind === 'mpan') { const s = cam.dist / innerHeight * 1.2; pan(dy * s, -dx * s); }
  if (gesture.kind === 'rotate') cam.yaw -= dx * 0.008;
  if (gesture.kind === 'box') gesture.rect = [p.x0, p.y0, p.x, p.y];
});
const endPtr = e => {
  const p = ptrs.get(e.pointerId); if (!p) return; ptrs.delete(e.pointerId); clearTimeout(longPressT);
  if (!gesture || !game) { if (!ptrs.size) gesture = null; return; }
  const k = gesture.kind;
  if (k === 'two') { if (!ptrs.size) gesture = null; else gesture = { kind: 'none' }; return; }
  if (e.type === 'pointercancel') { gesture = null; return; }
  if (k === 'box' && gesture.rect) { const [a, b, c, d] = gesture.rect; if (Math.hypot(c - a, d - b) > 8) boxSelect(a, b, c, d, e.shiftKey); else tap(p, e); }
  else if (k === 'lpending' || k === 'pending' || (k === 'box' && !gesture.rect)) tap(p, e);
  else if (k === 'rpending') command(p.x, p.y);
  gesture = ptrs.size ? { kind: 'none' } : null;
};
cv.addEventListener('pointerup', endPtr); cv.addEventListener('pointercancel', endPtr);
function tap(p, e) {
  const u = unitAt(p.x, p.y), touch = p.type === 'touch';
  if (armed && selected().length) { command(p.x, p.y); return; }
  if (u && u.side === game.player) {
    if (touch && u.type === 'truck' && selected().length && selected().every(s => s.type === 'infantry')) { command(p.x, p.y); return; }
    if (e.shiftKey || (touch && boxMode)) { selection.has(u) ? selection.delete(u) : selection.add(u); updatePanel(); }
    else {
      const now = performance.now();
      if (lastTap.u === u && now - lastTap.t < 350) select(mine().filter(o => o.type === u.type && toScreen(o.x, 0, o.z)[2] && inView(o)));
      else select([u]); lastTap = { u, t: now };
    }
    return;
  }
  if (touch && selected().length) { command(p.x, p.y); return; }
  if (!touch && !e.shiftKey) select([]);
}
let lastTap = { u: null, t: 0 };
function inView(u) { const [x, y] = toScreen(u.x, 0, u.z); return x > 0 && y > 0 && x < innerWidth && y < innerHeight; }
cv.addEventListener('wheel', e => { e.preventDefault(); cam.dist *= Math.exp(e.deltaY * 0.0012); }, { passive: false });
cv.addEventListener('pointerleave', () => { mouse.in = false; });
addEventListener('blur', () => { mouse.in = false; keys.clear(); });

// ---------- keyboard ----------
const keys = new Set();
addEventListener('keydown', e => {
  if (!game) return;
  const c = e.code;
  if (/^Digit[1-9]$/.test(c)) { const n = +c.slice(5); if (e.ctrlKey || e.metaKey || e.shiftKey) { e.preventDefault(); saveGroup(n); } else recallGroup(n); return; }
  if (c === 'KeyP' || c === 'Escape') { if (c === 'Escape' && armed) { armed = null; return; } setPaused(!paused); return; }
  if (c === 'KeyF') doCmd('amove'); if (c === 'KeyH') doCmd('hold'); if (c === 'KeyX') doCmd('stop'); if (c === 'KeyU') doCmd('unload');
  if (c === 'Space') { e.preventDefault(); centreOn(selected()); }
  if (c === 'KeyA' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); doCmd('all'); return; }
  keys.add(c);
});
addEventListener('keyup', e => keys.delete(e.code));

// ---------- minimap ----------
const mm = $('minimap'), mctx = mm.getContext('2d');
function mmXY(x, z) { return [(x / map.W + 0.5) * mm.width, (z / map.H + 0.5) * mm.height]; }
function drawMinimap() {
  mctx.clearRect(0, 0, mm.width, mm.height);
  if (satImg && satImg.complete) mctx.drawImage(satImg, 0, 0, mm.width, mm.height);
  mctx.fillStyle = 'rgba(0,0,0,.25)'; mctx.fillRect(0, 0, mm.width, mm.height);
  for (const u of game.units) {
    if (!u.alive || u.carrier) continue;
    const own = u.side === game.player; if (!own && !game.canSee(game.player, u)) continue;
    const [x, y] = mmXY(u.x, u.z); mctx.fillStyle = own ? (selection.has(u) ? '#fff' : '#8cff6a') : '#ff4a3a';
    const s = u.type === 'tank' ? 5 : 4; mctx.fillRect(x - s / 2, y - s / 2, s, s);
  }
  const pts = [[0, 0], [innerWidth, 0], [innerWidth, innerHeight], [0, innerHeight]].map(([x, y]) => screenToGround(x, y)).filter(Boolean);
  if (pts.length === 4) { mctx.strokeStyle = '#fff'; mctx.lineWidth = 1; mctx.beginPath(); pts.forEach((p, i) => { const [x, y] = mmXY(p.x, p.z); i ? mctx.lineTo(x, y) : mctx.moveTo(x, y); }); mctx.closePath(); mctx.stroke(); }
}
const mmJump = e => { const r = mm.getBoundingClientRect(); cam.x = ((e.clientX - r.left) / r.width - 0.5) * map.W; cam.z = ((e.clientY - r.top) / r.height - 0.5) * map.H; };
mm.addEventListener('pointerdown', e => { mmJump(e); mm.setPointerCapture(e.pointerId); mm.onpointermove = mmJump; });
mm.addEventListener('pointerup', () => { mm.onpointermove = null; });

// ---------- HUD ----------
function updatePanel() {
  if (!game) return;
  const sel = selected(); const info = $('selInfo');
  if (!sel.length) info.textContent = 'No units selected · drag a box to select a group';
  else if (sel.length === 1) {
    const u = sel[0];
    const st = u.broken ? 'BROKEN, retreating' : u.carrier ? 'in truck' : u.building ? 'in a building (cover)' : u.order.type;
    info.innerHTML = `<b>${u.T.name}</b> · health ${Math.ceil(u.hp)}/${u.T.hp} · morale ${Math.round(u.morale)}%` + (u.T.ammo ? ` · ammo ${Math.floor(u.ammo)}/${u.T.ammo}` : '') + (u.type === 'truck' ? ` · carrying ${u.passengers.length}/2` : '') + ` · ${st}` + (u.group ? ` · group ${u.group}` : '');
  } else {
    const c = {}; sel.forEach(u => c[u.T.name] = (c[u.T.name] || 0) + 1);
    info.innerHTML = `<b>${sel.length} units grouped</b>: ` + Object.entries(c).map(([k, v]) => `${v} ${k}`).join(', ') + ` · avg morale ${Math.round(sel.reduce((s, u) => s + u.morale, 0) / sel.length)}%`;
  }
  $('unloadBtn').disabled = !sel.some(u => u.type === 'truck' && u.passengers.length);
}
function updateArmies() {
  const rows = ['allies', 'axis'].map(s => {
    const st = game.armyStatus(s), me = s === game.player; const col = SIDES[s].ui;
    return `<div class="army"><span class="dot" style="background:${col}"></span><b style="min-width:60px">${SIDES[s].name}${me ? ' (you)' : ''}</b>
      <span>${me ? st.alive + ' units' : 'losses'}</span><span class="bar" title="losses"><i style="width:${Math.round(st.lost * 100)}%;background:#c0392b"></i></span>
      <span>${me ? 'morale ' + Math.round(st.morale) + '%' : Math.round(st.lost * 100) + '%'}</span></div>`;
  });
  $('armies').innerHTML = rows.join('');
  const now = game.time;
  $('log').innerHTML = game.events.filter(ev => now - ev.t < 8).slice(-4).map(ev => `<div style="color:${SIDES[ev.side].ui}">${ev.msg}</div>`).join('');
}
function flash(msg) { game.events.push({ t: game.time, side: game.player, msg }); }
function showEnd() {
  const o = game.over, won = o.winner === game.player, enemy = SIDES[o.loser].name;
  $('endTitle').textContent = won ? 'Victory' : 'Defeat';
  const why = o.reason === 'surrendered' ? (won ? `The ${enemy} surrendered after heavy casualties.` : `Your forces surrendered after heavy casualties.`) : (won ? `All ${enemy} combat units destroyed.` : 'Your army was wiped out.');
  const m = Math.floor(o.time / 60), s = Math.floor(o.time % 60);
  $('endText').innerHTML = `${why}<br>Battle time ${m}:${String(s).padStart(2, '0')} · You destroyed ${game.kills[game.player]} units and lost ${game.units.filter(u => u.side === game.player && !u.alive).length}.`;
  $('end').hidden = false; document.body.dataset.result = won ? 'victory' : 'defeat';
}

// ---------- overlay: health/morale bars, selection box, markers ----------
function drawOverlay() {
  octx.clearRect(0, 0, innerWidth, innerHeight);
  if (!game) return;
  for (const u of game.units) {
    if (!u.alive || u.carrier) continue;
    const own = u.side === game.player; if (!own && !game.canSee(game.player, u)) continue;
    const [x, y, ok] = toScreen(u.x, (u.building ? u.building.h : 0) + 12, u.z); if (!ok || x < -20 || y < -20 || x > innerWidth + 20 || y > innerHeight + 20) continue;
    const w = 26, sel = selection.has(u);
    if (!own && cam.dist > 900) continue;
    octx.fillStyle = 'rgba(0,0,0,.6)'; octx.fillRect(x - w / 2 - 1, y - 1, w + 2, own ? 7 : 5);
    const hp = u.hp / u.T.hp; octx.fillStyle = hp > 0.6 ? '#5ad25a' : hp > 0.3 ? '#f0c040' : '#e04030'; octx.fillRect(x - w / 2, y, w * hp, 3);
    if (own) { octx.fillStyle = u.broken ? '#ff3a3a' : '#5ab0ff'; octx.fillRect(x - w / 2, y + 4, w * u.morale / 100, 2); }
    if (!own) { octx.strokeStyle = '#ff4a3a'; octx.strokeRect(x - w / 2 - 1, y - 1, w + 2, 5); }
    octx.font = 'bold 10px system-ui'; octx.textAlign = 'center';
    if (u.group && own) { octx.fillStyle = sel ? '#fff' : '#cfe0b8'; octx.fillText(u.group, x + w / 2 + 6, y + 6); }
    if (u.broken) { octx.fillStyle = '#ff5040'; octx.fillText('!', x - w / 2 - 6, y + 6); }
    if (u.passengers.length) { octx.fillStyle = '#7ad0ff'; octx.fillText('+' + u.passengers.length, x, y - 3); }
    if (own && u.T.ammo && u.ammo < u.T.ammo * 0.2) { octx.fillStyle = '#ffb347'; octx.fillText('ammo', x, y - 3); }
  }
  const now = performance.now();
  for (let i = markers.length - 1; i >= 0; i--) {
    const m = markers[i], k = (now - m.t) / 700; if (k > 1) { markers.splice(i, 1); continue; }
    const [x, y, ok] = toScreen(m.x, 0, m.z); if (!ok) continue;
    octx.strokeStyle = m.c; octx.globalAlpha = 1 - k; octx.lineWidth = 2; octx.beginPath(); octx.ellipse(x, y, 16 * (1 - k) + 4, 8 * (1 - k) + 2, 0, 0, Math.PI * 2); octx.stroke(); octx.globalAlpha = 1;
  }
  if (gesture && gesture.kind === 'box' && gesture.rect) {
    const [a, b, c, d] = gesture.rect; octx.strokeStyle = '#9cff7a'; octx.lineWidth = 1.5; octx.fillStyle = 'rgba(156,255,122,.12)';
    octx.fillRect(a, b, c - a, d - b); octx.strokeRect(a, b, c - a, d - b);
    // live highlight of units inside the box
    const [x0, y0, x1, y1] = [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)];
    for (const u of mine()) { const [x, y, ok] = toScreen(u.x, 2, u.z); if (ok && x >= x0 && x <= x1 && y >= y0 && y <= y1) { octx.strokeStyle = '#fff'; octx.beginPath(); octx.arc(x, y, 9, 0, Math.PI * 2); octx.stroke(); } }
  }
  if (armed) { octx.fillStyle = '#ffb347'; octx.font = 'bold 13px system-ui'; octx.textAlign = 'center'; octx.fillText('Attack-move: click/tap a destination', innerWidth / 2, 64); }
}

// ---------- main loop ----------
let last = performance.now(), acc = 0, hudT = 0;
const STEP = 1 / 30;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  // camera keys / edge pan
  const kp = 520 * dt;
  if (keys.has('KeyW') || keys.has('ArrowUp')) pan(kp, 0); if (keys.has('KeyS') || keys.has('ArrowDown')) pan(-kp, 0);
  if (keys.has('KeyA') || keys.has('ArrowLeft')) pan(0, -kp); if (keys.has('KeyD') || keys.has('ArrowRight')) pan(0, kp);
  if (keys.has('KeyQ')) cam.yaw += 1.6 * dt; if (keys.has('KeyE')) cam.yaw -= 1.6 * dt;
  if (keys.has('Equal') || keys.has('NumpadAdd')) cam.dist *= 1 - dt * 1.5; if (keys.has('Minus') || keys.has('NumpadSubtract')) cam.dist *= 1 + dt * 1.5;
  if (game && mouse.in && !ptrs.size && !params.has('noedge') && document.hasFocus()) {
    const m = 8; if (mouse.x < m) pan(0, -kp); if (mouse.x > innerWidth - m) pan(0, kp); if (mouse.y < m) pan(kp, 0); if (mouse.y > innerHeight - m) pan(-kp, 0);
  }
  applyCam();
  if (game && !paused && !game.over) {
    acc += dt * speed; let n = 0;
    while (acc >= STEP && n < 12) { game.step(STEP); acc -= STEP; n++; }
    if (n >= 12) acc = 0;
    if (game.over) showEnd();
  }
  if (game) {
    for (const u of game.units) {
      if (u.alive) {
        u.mesh.visible = !u.carrier && (u.side === game.player || game.canSee(game.player, u));
        u.mesh.userData.ring.visible = selection.has(u) && u.mesh.visible;
        const f = u.mesh.userData.figures; if (u.type === 'infantry') f.forEach((m, i) => m.visible = i < Math.ceil(u.hp / 20));
      }
    }
    hudT -= dt; if (hudT <= 0) { hudT = 0.25; updateArmies(); updatePanel(); renderGroups(); }
    drawMinimap();
  }
  renderer.render(scene, camera);
  drawOverlay();
}
requestAnimationFrame(frame);

if (DEBUG) {
  window.dbg = {
    get game() { return game; }, get map() { return map; }, cam, selection, groups, start, select, selected, boxSelect, saveGroup, recallGroup, command, toScreen, screenToGround,
    setSpeed(s) { speed = s; }, version: VERSION,
    step(sec) { for (let t = 0; t < sec; t += STEP) { if (game.over) break; game.step(STEP); } if (game.over && $('end').hidden) showEnd(); },
    errors: [],
  };
}
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
