// End-to-end test for Battle for Sunshine (desktop + touch). BASE env selects local or live site.
import { chromium, devices } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:47621/ww2-sunshine/';
const OUT = '/workspace/ww2_sunshine/screens/';
const errs = [], res = [];
const ok = (c, m) => { res.push((c ? 'PASS ' : 'FAIL ') + m); console.log((c ? '✓ ' : '✗ ') + m); };
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
function watch(p, tag) {
  p.on('console', m => { if (m.type() === 'error') errs.push(`[${tag}] ${m.text()}`); });
  p.on('pageerror', e => errs.push(`[${tag}] pageerror ${e.message}`));
  p.on('response', r => { if (r.status() >= 400) errs.push(`[${tag}] http ${r.status()} ${r.url()}`); });
}
const ready = p => p.waitForFunction(() => document.getElementById('loading').textContent.startsWith('Map ready'), null, { timeout: 90000 });
const E = (p, f, a) => p.evaluate(f, a);

// ---------------- desktop ----------------
const p = await (await b.newContext({ viewport: { width: 1366, height: 820 } })).newPage(); watch(p, 'desktop');
await p.goto(BASE + '?debug=1&noedge=1'); await ready(p);
await p.screenshot({ path: OUT + '01-title.png' });
await p.click('#playAllies'); await p.waitForTimeout(800);
ok(await E(p, () => dbg.game.units.length) === 36, '36 units spawned (18 per side)');
await p.screenshot({ path: OUT + '02-start.png' });

// box-select a mixed group with a real mouse drag
const bb = await E(p, () => { const pts = dbg.game.alive('allies').map(u => dbg.toScreen(u.x, 2, u.z)).filter(q => q[2]); const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; });
// select only the front part (infantry + tanks rows) to prove partial/mixed selection
const midY = (bb[1] + bb[3]) / 2;
await p.mouse.move(bb[0] - 25, bb[1] - 25); await p.mouse.down(); await p.mouse.move((bb[0] + bb[2]) / 2, midY, { steps: 6 }); await p.mouse.move(bb[2] + 25, midY + 8, { steps: 6 });
await p.screenshot({ path: OUT + '03-box-select-drag.png' });
await p.mouse.up();
let sel = await E(p, () => dbg.selected().map(u => u.type));
ok(sel.length > 1 && sel.length < 18 && new Set(sel).size >= 2, `box-select picked a mixed group: ${sel.length} units (${[...new Set(sel)].join(', ')})`);
await p.keyboard.press('Control+1');
ok(await E(p, () => (dbg.groups[1] || []).length) === sel.length, 'Ctrl+1 saved group 1');
// whole army box -> Shift+2
await p.mouse.move(bb[0] - 25, bb[1] - 25); await p.mouse.down(); await p.mouse.move(bb[2] + 25, bb[3] + 25, { steps: 8 }); await p.mouse.up();
const all = await E(p, () => dbg.selected().length);
ok(all === 18, `box-select whole army: ${all} units`);
await p.keyboard.press('Shift+2');
ok(await E(p, () => (dbg.groups[2] || []).length) === 18, 'Shift+2 saved group 2');
await p.mouse.click(30, 300); // click empty ground -> deselect
ok(await E(p, () => dbg.selected().length) === 0, 'click on empty ground deselects');
await p.keyboard.press('1');
ok(await E(p, () => dbg.selected().length) === sel.length, 'key 1 recalls group 1');
await p.click('#groupBtns button[data-g="2"]');
ok(await E(p, () => dbg.selected().length) === 18, 'group bar button 2 recalls group 2');
await p.keyboard.press('1');
await p.screenshot({ path: OUT + '04-group1-selected.png' });

// right-click move: group moves together in formation
const before = await E(p, () => dbg.selected().map(u => [u.x, u.z]));
const tgt = await E(p, () => { const u = dbg.selected(); const cx = u.reduce((s, a) => s + a.x, 0) / u.length, cz = u.reduce((s, a) => s + a.z, 0) / u.length; return dbg.toScreen(cx, 0, cz - 260); });
await p.mouse.click(tgt[0], tgt[1], { button: 'right' });
ok(await E(p, () => dbg.selected().every(u => u.order.type === 'move')), 'right-click ground gives a move order to the whole group');
await E(p, () => dbg.step(25));
const after = await E(p, () => { const us = dbg.selected(); const cx = us.reduce((s, a) => s + a.x, 0) / us.length, cz = us.reduce((s, a) => s + a.z, 0) / us.length; return { pos: us.map(u => [u.x, u.z]), spread: Math.max(...us.map(u => Math.hypot(u.x - cx, u.z - cz))) }; });
const movedAvg = before.reduce((s, q, i) => s + Math.hypot(after.pos[i][0] - q[0], after.pos[i][1] - q[1]), 0) / before.length;
ok(movedAvg > 60, `group moved ${movedAvg.toFixed(0)} m on average`);
ok(after.spread < 120, `group stayed together (max ${after.spread.toFixed(0)} m from its centre)`);
await E(p, () => { const us = dbg.selected(); dbg.cam.x = us.reduce((s, a) => s + a.x, 0) / us.length; dbg.cam.z = us.reduce((s, a) => s + a.z, 0) / us.length; });
await p.waitForTimeout(400); await p.screenshot({ path: OUT + '05-group-moving.png' });

// camera: Q rotate, wheel zoom, W pan
const c0 = await E(p, () => ({ ...dbg.cam }));
await p.keyboard.down('KeyQ'); await p.waitForTimeout(300); await p.keyboard.up('KeyQ');
await p.mouse.move(700, 400); await p.mouse.wheel(0, 400); await p.waitForTimeout(100);
await p.keyboard.down('KeyW'); await p.waitForTimeout(300); await p.keyboard.up('KeyW');
const c1 = await E(p, () => ({ ...dbg.cam }));
ok(c1.yaw !== c0.yaw && c1.dist > c0.dist && (c1.x !== c0.x || c1.z !== c0.z), 'camera rotates (Q), zooms (wheel) and pans (W)');

// truck: load infantry by right-clicking a truck, then unload
const lt = await E(p, () => { const g = dbg.game; const tr = g.alive('allies').find(u => u.type === 'truck'); const inf = g.alive('allies').filter(u => u.type === 'infantry').sort((a, b) => Math.hypot(a.x - tr.x, a.z - tr.z) - Math.hypot(b.x - tr.x, b.z - tr.z)).slice(0, 2); dbg.select(inf); dbg.cam.x = tr.x; dbg.cam.z = tr.z; return tr.id; });
await p.waitForTimeout(200);
const trs = await E(p, id => { const tr = dbg.game.units.find(u => u.id === id); return dbg.toScreen(tr.x, 3, tr.z); }, lt);
await p.mouse.click(trs[0], trs[1], { button: 'right' });
await E(p, () => dbg.step(30));
ok(await E(p, id => dbg.game.units.find(u => u.id === id).passengers.length, lt) === 2, 'two infantry squads boarded the truck');
await E(p, id => dbg.select([dbg.game.units.find(u => u.id === id)]), lt); await p.keyboard.press('u');
ok(await E(p, id => dbg.game.units.find(u => u.id === id).passengers.length, lt) === 0, 'U unloads the truck');

// battle: attack-move the army at the enemy, let the AI respond
await E(p, () => { const g = dbg.game; g.orderMove(g.alive('allies'), -140, -560, true); });
let st;
for (let i = 0; i < 40; i++) { st = await E(p, () => { dbg.step(10); const g = dbg.game; return { t: g.time, shots: g.shots, kills: g.kills, over: g.over, aiState: g.ai.state, axisMoved: g.alive('axis').filter(u => Math.hypot(u.x + 140, u.z + 640) > 200).length }; }); if (st.kills.allies + st.kills.axis >= 6) break; }
ok(st.shots.infantry > 0 && st.shots.tank > 0, `units fight: shots ${JSON.stringify(st.shots)}`);
ok(st.shots.artillery > 0, 'artillery fires at spotted targets');
ok(st.axisMoved > 3, `AI moved ${st.axisMoved} units out of its base (state ${st.aiState})`);
ok(st.kills.allies + st.kills.axis > 0, `casualties: Allies destroyed ${st.kills.allies}, Germans destroyed ${st.kills.axis}`);
// screenshot of the fight at real speed
await E(p, () => { const g = dbg.game; const vis = [...g.visible.allies].filter(u => u.alive); const f = vis[0] || g.alive('axis')[0]; dbg.cam.x = f.x; dbg.cam.z = f.z + 60; dbg.cam.dist = 300; dbg.select(g.alive('allies')); });
await p.waitForTimeout(2500); await p.screenshot({ path: OUT + '06-battle.png' });
await E(p, () => { dbg.cam.dist = 160; }); await p.waitForTimeout(1500); await p.screenshot({ path: OUT + '07-battle-close.png' });
ok(await E(p, () => [...dbg.game.visible.allies].length) >= 0 && await E(p, () => dbg.game.alive('axis').some(u => !dbg.game.canSee('allies', u))), 'fog of war: some enemy units are hidden');

// pause
await p.keyboard.press('p'); await p.waitForTimeout(200);
ok(await p.isVisible('#pause'), 'P pauses'); await p.screenshot({ path: OUT + '08-paused.png' });
await p.click('#resume');

// win: knock out most of the German army -> surrender
await E(p, () => { const g = dbg.game; const ax = g.alive('axis'); ax.slice(0, Math.ceil(ax.length * 0.75)).forEach(u => g.kill(u, g.alive('allies')[0])); dbg.step(2); });
await p.waitForTimeout(500);
ok(await E(p, () => dbg.game.over && dbg.game.over.winner === 'allies'), 'heavy German losses -> Germans surrender -> victory');
ok((await p.textContent('#endTitle')) === 'Victory', 'victory screen shown');
await p.screenshot({ path: OUT + '09-victory.png' });
// lose
await p.click('#again'); await p.waitForTimeout(500);
await E(p, () => { const g = dbg.game; g.alive('allies').forEach(u => g.kill(u, null)); dbg.step(1); }); await p.waitForTimeout(400);
ok((await p.textContent('#endTitle')) === 'Defeat', 'defeat screen shown when the player is wiped out');
await p.screenshot({ path: OUT + '10-defeat.png' });
// AI attacks a passive player (natural game, fast-forward)
await p.click('#again'); await p.waitForTimeout(400);
let nat;
for (let i = 0; i < 80; i++) { nat = await E(p, () => { dbg.step(15); const g = dbg.game; return { t: g.time | 0, over: g.over, kills: g.kills, ai: g.ai.state }; }); if (nat.over) break; }
ok(nat.kills.axis > 0, `AI attacks on its own: after ${nat.t}s it destroyed ${nat.kills.axis} Allied units (${nat.over ? 'game over: ' + nat.over.winner + ' won by ' + nat.over.reason : 'still fighting'})`);
if (nat.over) await p.screenshot({ path: OUT + '11-ai-wins-passive-player.png' });
// play as Germans
await p.goto(BASE + '?debug=1&noedge=1'); await ready(p); await p.click('#playAxis'); await p.waitForTimeout(800);
ok(await E(p, () => dbg.game.player === 'axis' && dbg.game.ai.side === 'allies'), 'can play as the Germans against an Allied AI');
await p.screenshot({ path: OUT + '12-play-as-germans.png' });

// ---------------- touch (iPhone landscape) ----------------
const tc = await b.newContext({ ...devices['iPhone 14 Pro Max landscape'] });
const t = await tc.newPage(); watch(t, 'touch');
await t.goto(BASE + '?debug=1'); await ready(t);
await t.screenshot({ path: OUT + '20-phone-title.png' });
await t.tap('#playAllies'); await t.waitForTimeout(800);
const cdp = await tc.newCDPSession(t);
const touch = async (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i })) });
const tb = await E(t, () => { const pts = dbg.game.alive('allies').map(u => dbg.toScreen(u.x, 2, u.z)).filter(q => q[2]); const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; });
ok(await t.isVisible('#boxBtn'), 'touch: ▢ Select button visible');
await t.tap('#boxBtn');
await touch('touchStart', [[tb[0] - 15, tb[1] - 15]]); for (let k = 1; k <= 8; k++) await touch('touchMove', [[tb[0] - 15 + (tb[2] - tb[0] + 30) * k / 8, tb[1] - 15 + (tb[3] - tb[1] + 30) * k / 8]]);
await t.screenshot({ path: OUT + '21-phone-box-select.png' });
await touch('touchEnd', []);
const tsel = await E(t, () => dbg.selected().length);
ok(tsel === 18, `touch: Select-mode drag selected ${tsel} units`);
await t.tap('#boxBtn');
await t.tap('#saveGroup'); await t.tap('#groupBtns button[data-g="3"]');
ok(await E(t, () => (dbg.groups[3] || []).length) === 18, 'touch: Save then 3 stores group 3');
await E(t, () => dbg.select([])); await t.tap('#groupBtns button[data-g="3"]');
ok(await E(t, () => dbg.selected().length) === 18, 'touch: tapping 3 recalls the group');
// long-press then drag (no select mode)
await E(t, () => dbg.select([]));
await touch('touchStart', [[tb[0] - 15, tb[1] - 15]]); await t.waitForTimeout(550);
for (let k = 1; k <= 6; k++) await touch('touchMove', [[tb[0] - 15 + (tb[2] - tb[0] + 30) * k / 6, (tb[1] + tb[3]) / 2]]);
await touch('touchEnd', []);
const lsel = await E(t, () => dbg.selected().length);
ok(lsel > 0, `touch: long-press + drag box-selected ${lsel} units`);
// tap ground to move the selection
const gpt = await E(t, () => { const u = dbg.selected(); const cx = u.reduce((s, a) => s + a.x, 0) / u.length, cz = u.reduce((s, a) => s + a.z, 0) / u.length; return dbg.toScreen(cx - 40, 0, cz - 150); });
await t.touchscreen.tap(gpt[0], gpt[1]);
ok(await E(t, () => dbg.selected().every(u => u.order.type === 'move')), 'touch: tap on ground moves the selected group');
// one-finger pan, pinch zoom + twist
const k0 = await E(t, () => ({ ...dbg.cam }));
await touch('touchStart', [[500, 200]]); for (let k = 1; k <= 5; k++) await touch('touchMove', [[500 - k * 30, 200 + k * 10]]); await touch('touchEnd', []);
const k1 = await E(t, () => ({ ...dbg.cam }));
ok(k1.x !== k0.x || k1.z !== k0.z, 'touch: one-finger drag pans');
await touch('touchStart', [[400, 200], [500, 200]]); for (let k = 1; k <= 5; k++) await touch('touchMove', [[400 - k * 15, 200 - k * 6], [500 + k * 15, 200 + k * 6]]); await touch('touchEnd', []);
const k2 = await E(t, () => ({ ...dbg.cam }));
ok(k2.dist < k1.dist && k2.yaw !== k1.yaw, `touch: pinch zooms (${k1.dist.toFixed(0)}→${k2.dist.toFixed(0)}) and twist rotates`);
await E(t, () => dbg.step(8)); await t.waitForTimeout(500);
await t.screenshot({ path: OUT + '22-phone-ingame.png' });

console.log('\nERRORS:\n' + (errs.join('\n') || 'none'));
console.log(`\n${res.filter(r => r.startsWith('PASS')).length}/${res.length} passed`);
await b.close();
process.exit(errs.length || res.some(r => r.startsWith('FAIL')) ? 1 : 0);
