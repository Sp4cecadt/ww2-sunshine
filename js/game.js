// Simulation: units, orders, movement, combat, morale, fog of war, effects, surrender and the computer AI.
import * as THREE from '../vendor/three.module.min.js';
import { buildModel, SIDES } from './models.js';

export const TYPES = {
  infantry: { name: 'Infantry', hp: 100, speed: 6, range: 130, sight: 190, rof: 1.5, ammo: 80, value: 1, vehicle: false, radius: 7 },
  tank: { name: 'Tank', hp: 420, speed: 9, range: 230, sight: 170, rof: 4.5, ammo: 30, value: 2, vehicle: true, radius: 8 },
  artillery: { name: 'Artillery', hp: 120, speed: 5, range: 750, minRange: 70, sight: 110, rof: 8, ammo: 24, value: 1.5, vehicle: true, radius: 6 },
  truck: { name: 'Truck', hp: 150, speed: 14, range: 0, sight: 120, rof: 0, ammo: 0, value: 0.5, vehicle: true, radius: 7, capacity: 2 },
};
const ROSTER = [['infantry', 8], ['tank', 4], ['artillery', 3], ['truck', 3]];
export const BASES = { allies: [190, 620], axis: [-140, -640] };
const ENEMY = { allies: 'axis', axis: 'allies' };

let NEXT_ID = 1;
export class Game {
  constructor(map, scene, playerSide = 'allies') {
    this.map = map; this.scene = scene; this.player = playerSide; this.cpu = ENEMY[playerSide];
    this.units = []; this.time = 0; this.over = null; this.fx = new Effects(scene, map);
    this.visible = { allies: new Set(), axis: new Set() }; this.visTimer = 0; this.statTimer = 0;
    this.kills = { allies: 0, axis: 0 }; this.events = []; this.shots = { infantry: 0, tank: 0, artillery: 0 };
    for (const side of ['allies', 'axis']) this.spawnArmy(side);
    this.initial = {}; for (const s of ['allies', 'axis']) this.initial[s] = this.armyValue(s, true);
    this.ai = new AI(this, this.cpu);
  }
  spawnArmy(side) {
    const [bx, bz] = BASES[side], dir = side === 'allies' ? -1 : 1; let i = 0;
    for (const [type, n] of ROSTER) for (let k = 0; k < n; k++, i++) {
      const row = Math.floor(i / 6), col = i % 6;
      const x = bx + (col - 2.5) * 22, z = bz - dir * row * 24;
      this.addUnit(type, side, x, z, side === 'allies' ? Math.PI : 0);
    }
  }
  addUnit(type, side, x, z, heading = 0) {
    const T = TYPES[type]; [x, z] = this.map.nearestFree(x, z, T.vehicle);
    const mesh = buildModel(type, side); mesh.position.set(x, 0, z); mesh.rotation.y = heading; this.scene.add(mesh);
    const u = { id: NEXT_ID++, type, side, T, x, z, heading, hp: T.hp, morale: 100, ammo: T.ammo, cooldown: Math.random() * 2,
      order: { type: 'idle' }, mesh, alive: true, broken: false, passengers: [], carrier: null, building: null,
      lastHit: -99, lastFired: -99, moving: false, scanT: Math.random() * 0.4, target: null, group: 0 };
    this.units.push(u); return u;
  }
  alive(side) { return this.units.filter(u => u.alive && (!side || u.side === side)); }
  armyValue(side, all = false) { return this.units.filter(u => u.side === side && (all || u.alive)).reduce((s, u) => s + u.T.value, 0); }
  armyStatus(side) {
    const al = this.alive(side), lost = 1 - this.armyValue(side) / this.initial[side];
    const morale = al.length ? al.reduce((s, u) => s + u.morale * u.T.value, 0) / al.reduce((s, u) => s + u.T.value, 0) : 0;
    return { alive: al.length, lost, morale };
  }

  // ---------- orders ----------
  orderMove(units, x, z, attackMove = false) {
    units = units.filter(u => u.alive && !u.carrier); if (!units.length) return;
    const rank = { tank: 0, infantry: 1, truck: 2, artillery: 3 };
    units.sort((a, b) => rank[a.type] - rank[b.type] || a.id - b.id);
    let cx = 0, cz = 0; units.forEach(u => { cx += u.x; cz += u.z; }); cx /= units.length; cz /= units.length;
    let dx = x - cx, dz = z - cz; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
    const px = -dz, pz = dx, cols = Math.max(1, Math.ceil(Math.sqrt(units.length * 1.6))), sp = 20;
    const group = { speed: Math.min(...units.map(u => u.T.speed)), field: null, size: units.length };
    const vehicles = units.filter(u => u.T.vehicle);
    if (vehicles.length) group.field = this.map.flowField(x, z, vehicles.map(u => [u.x, u.z]));
    units.forEach((u, i) => {
      const r = Math.floor(i / cols), c = i % cols, rowN = Math.min(cols, units.length - r * cols);
      let sx = x + px * (c - (rowN - 1) / 2) * sp - dx * r * sp, sz = z + pz * (c - (rowN - 1) / 2) * sp - dz * r * sp;
      if (units.length === 1) { sx = x; sz = z; }
      if (u.T.vehicle) [sx, sz] = this.map.nearestFree(sx, sz, true);
      u.order = { type: attackMove ? 'amove' : 'move', x: sx, z: sz, group, face: Math.atan2(dx, dz) };
      u.target = null;
    });
  }
  orderAttack(units, target) {
    units = units.filter(u => u.alive && !u.carrier && u.type !== 'truck'); if (!units.length || !target.alive) return;
    const vehicles = units.filter(u => u.T.vehicle);
    const field = vehicles.length ? this.map.flowField(target.x, target.z, vehicles.map(u => [u.x, u.z])) : null;
    units.forEach(u => { u.order = { type: 'attack', target, field, fx: target.x, fz: target.z }; u.target = target; });
  }
  orderHold(units) { units.forEach(u => { if (u.alive) u.order = { type: 'hold' }; }); }
  orderStop(units) { units.forEach(u => { if (u.alive) { u.order = { type: 'idle' }; u.target = null; } }); }
  orderLoad(units, truck) {
    units.filter(u => u.alive && u.type === 'infantry' && !u.carrier).forEach(u => { u.order = { type: 'load', truck }; });
  }
  unload(truck) {
    truck.passengers.forEach((p, i) => {
      const a = truck.heading + Math.PI + (i - 0.5) * 0.9; p.carrier = null;
      p.x = truck.x + Math.sin(a) * 14; p.z = truck.z + Math.cos(a) * 14; p.mesh.visible = true; p.order = { type: 'idle' };
    });
    truck.passengers = [];
  }

  // ---------- simulation ----------
  step(dt) {
    if (this.over) return;
    this.time += dt;
    this.visTimer -= dt; if (this.visTimer <= 0) { this.visTimer = 0.25; this.updateVisibility(); }
    this.cohesionT = (this.cohesionT || 0) - dt; if (this.cohesionT <= 0) { this.cohesionT = 0.5; this.updateCohesion(); }
    for (const u of this.units) if (u.alive && !u.carrier) this.updateUnit(u, dt);
    this.separate();
    this.fx.step(dt, this);
    this.ai.step(dt);
    this.statTimer -= dt; if (this.statTimer <= 0) { this.statTimer = 0.5; this.checkEnd(); }
  }
  updateVisibility() {
    for (const side of ['allies', 'axis']) {
      const vis = this.visible[side]; vis.clear();
      const mine = this.units.filter(u => u.alive && !u.carrier && u.side === side);
      for (const e of this.units) {
        if (!e.alive || e.carrier || e.side === side) continue;
        const flash = this.time - e.lastFired < 2 ? 1.5 : 1;
        for (const m of mine) {
          const s = (m.T.sight + (m.building ? 50 : 0)) * flash * (e.building ? 0.75 : 1);
          const d = Math.hypot(e.x - m.x, e.z - m.z);
          if (d < s && (d < 40 || this.map.los(m.x, m.z, e.x, e.z))) { vis.add(e); break; }
        }
      }
    }
  }
  // Keep groups together: members well ahead of the group's laggard wait for it (unless the laggard is stuck).
  updateCohesion() {
    const groups = new Map();
    for (const u of this.units) {
      const o = u.order; if (!u.alive || u.carrier || !(o.type === 'move' || o.type === 'amove') || !o.group || o.group.size < 2) continue;
      let rem = Math.hypot(o.x - u.x, o.z - u.z);
      if (u.T.vehicle && o.group.field) { const c = this.map.cellOf(u.x, u.z); const fd = c >= 0 ? o.group.field.dist[c] * 4 : Infinity; if (isFinite(fd)) rem = Math.max(rem, fd); }
      u.remain = rem; if (!groups.has(o.group)) groups.set(o.group, []); groups.get(o.group).push(u);
    }
    for (const [g, us] of groups) {
      const max = Math.max(...us.map(u => u.remain));
      if (g.lastMax === undefined || max < g.lastMax - 3) { g.lastMax = max; g.stuckSince = this.time; }
      g.waitFor = this.time - g.stuckSince < 8 ? max : null;
    }
  }
  canSee(side, u) { return this.visible[side].has(u); }
  updateUnit(u, dt) {
    const T = u.T;
    // morale
    if (this.time - u.lastHit > 6) u.morale = Math.min(100, u.morale + (u.broken ? 4 : 2.5) * dt);
    if (!u.broken && u.morale < 22 && u.type !== 'truck') {
      u.broken = true; const [bx, bz] = BASES[u.side];
      u.order = { type: 'retreat', x: bx + (Math.random() - 0.5) * 120, z: bz + (Math.random() - 0.5) * 120, group: { speed: T.speed * 1.1 } };
      this.events.push({ t: this.time, side: u.side, msg: `${SIDES[u.side].name} ${T.name.toLowerCase()} broke and is retreating` });
    }
    if (u.broken && u.morale > 55) { u.broken = false; u.order = { type: 'idle' }; }
    // resupply from trucks
    if (T.ammo && u.ammo < T.ammo) for (const t of this.units) if (t.alive && t.type === 'truck' && t.side === u.side && !t.carrier && Math.hypot(t.x - u.x, t.z - u.z) < 50) { u.ammo = Math.min(T.ammo, u.ammo + T.ammo * 0.06 * dt); u.morale = Math.min(100, u.morale + 1 * dt); break; }
    // targeting
    u.scanT -= dt; u.cooldown -= dt;
    const o = u.order;
    if (o.type === 'attack' && !o.target.alive) { u.order = { type: 'idle' }; }
    if (u.scanT <= 0 && T.range && !u.broken) { u.scanT = 0.4; u.target = this.pickTarget(u); }
    // movement goal
    let gx = null, gz = null, field = null, speed = T.speed;
    if (o.type === 'move' || o.type === 'amove' || o.type === 'retreat') {
      gx = o.x; gz = o.z; field = o.group && o.group.field; speed = Math.min(T.speed, o.group ? o.group.speed : T.speed);
      if (o.type === 'retreat') speed = T.speed;
      else if (o.group && o.group.waitFor != null && u.remain !== undefined && u.remain < o.group.waitFor - 45) speed *= u.remain < o.group.waitFor - 90 ? 0 : 0.35;
      if (o.type === 'amove' && u.target && this.inRange(u, u.target)) gx = null; // stop to fight
    } else if (o.type === 'attack') {
      const t = o.target; const inR = this.inRange(u, t) && (u.type === 'artillery' ? this.canSee(u.side, t) : this.map.los(u.x, u.z, t.x, t.z));
      if (!inR && !(u.type === 'artillery' && Math.hypot(t.x - u.x, t.z - u.z) < T.range)) {
        gx = t.x; gz = t.z; field = o.field;
        if (u.T.vehicle && Math.hypot(t.x - o.fx, t.z - o.fz) > 40 && (!o.nextField || this.time > o.nextField)) {
          o.field = this.map.flowField(t.x, t.z, [[u.x, u.z]]); o.fx = t.x; o.fz = t.z; o.nextField = this.time + 3; field = o.field;
        }
      } else u.target = t;
    } else if (o.type === 'load') {
      const tr = o.truck;
      if (!tr.alive || tr.passengers.length >= TYPES.truck.capacity) u.order = { type: 'idle' };
      else if (Math.hypot(tr.x - u.x, tr.z - u.z) < 14) { tr.passengers.push(u); u.carrier = tr; u.mesh.visible = false; u.order = { type: 'idle' }; u.building = null; return; }
      else { gx = tr.x; gz = tr.z; }
    }
    u.moving = false;
    if (gx !== null) {
      const d = Math.hypot(gx - u.x, gz - u.z);
      if (d < 3 + (o.type === 'load' ? 8 : 0)) {
        if (o.type === 'move' || o.type === 'amove') { u.order = { type: 'idle' }; if (o.face !== undefined && !T.vehicle) u.heading = o.face; }
        else if (o.type === 'retreat') u.order = { type: 'hold' };
      } else {
        let tx = gx, tz = gz;
        if (T.vehicle) {
          u.lineT = (u.lineT || 0) - dt;
          if (u.lineT <= 0) { u.lineT = 0.5; u.lineClear = this.map.clearLine(u.x, u.z, gx, gz); }
          if (!u.lineClear && field) { const s = this.map.flowStep(field, u.x, u.z); if (s) [tx, tz] = s; }
          else if (!u.lineClear && !field && (!u.ownField || this.time > u.ownFieldT)) { u.ownField = this.map.flowField(gx, gz, [[u.x, u.z]]); u.ownFieldT = this.time + 4; }
          if (!u.lineClear && !field && u.ownField) { const s = this.map.flowStep(u.ownField, u.x, u.z); if (s) [tx, tz] = s; }
        }
        this.moveToward(u, tx, tz, speed * (u.morale < 40 && !u.broken ? 0.8 : 1), dt);
      }
    } else if (u.target && u.target.alive && T.vehicle) {
      const want = Math.atan2(u.target.x - u.x, u.target.z - u.z); if (u.type === 'artillery') this.turnToward(u, want, dt * 0.6);
    }
    // fire
    if (u.target && u.target.alive && u.cooldown <= 0 && u.ammo >= 1 && !u.broken) this.fire(u, u.target);
    // garrison state
    if (u.type === 'infantry') u.building = this.map.buildingAt(u.x, u.z);
    // sync mesh
    u.mesh.position.set(u.x, u.building ? u.building.h : 0, u.z); u.mesh.rotation.y = u.heading;
    if (u.mesh.userData.turret && u.target && u.target.alive) {
      u.mesh.userData.turret.rotation.y = Math.atan2(u.target.x - u.x, u.target.z - u.z) - u.heading;
    }
  }
  turnToward(u, want, dt) {
    let da = ((want - u.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI; const r = 1.6 * dt;
    u.heading += Math.max(-r, Math.min(r, da)); return Math.abs(da);
  }
  moveToward(u, tx, tz, speed, dt) {
    const want = Math.atan2(tx - u.x, tz - u.z); let f = 1;
    if (u.T.vehicle) { const da = this.turnToward(u, want, dt); f = da > 1.0 ? 0.15 : Math.cos(da); } else u.heading = want;
    const step = speed * f * dt, nx = u.x + Math.sin(u.heading) * step, nz = u.z + Math.cos(u.heading) * step;
    const v = u.T.vehicle;
    if (!this.map.blockedFor(v, nx, nz) && this.map.inBounds(nx, nz)) { u.x = nx; u.z = nz; }
    else if (!this.map.blockedFor(v, nx, u.z) && this.map.inBounds(nx, u.z)) u.x = nx;
    else if (!this.map.blockedFor(v, u.x, nz) && this.map.inBounds(u.x, nz)) u.z = nz;
    u.moving = step > 0.01;
  }
  separate() {
    const us = this.units.filter(u => u.alive && !u.carrier);
    for (let i = 0; i < us.length; i++) for (let j = i + 1; j < us.length; j++) {
      const a = us[i], b = us[j], dx = b.x - a.x, dz = b.z - a.z, r = (a.T.radius + b.T.radius) * 0.9, d2 = dx * dx + dz * dz;
      if (d2 > r * r || d2 < 1e-6) continue;
      const d = Math.sqrt(d2), push = (r - d) * 0.25 / d;
      for (const [u, s] of [[a, -1], [b, 1]]) {
        const nx = u.x + s * dx * push, nz = u.z + s * dz * push;
        if (!this.map.blockedFor(u.T.vehicle, nx, nz)) { u.x = nx; u.z = nz; }
      }
    }
  }
  inRange(u, t) {
    const d = Math.hypot(t.x - u.x, t.z - u.z); const r = u.T.range + (u.building ? 30 : 0);
    return d <= r && d >= (u.T.minRange || 0);
  }
  pickTarget(u) {
    const o = u.order;
    if (o.type === 'attack' && o.target.alive && this.inRange(u, o.target) && this.canSee(u.side, o.target) && (u.type === 'artillery' || this.map.los(u.x, u.z, o.target.x, o.target.z))) return o.target;
    if (o.type === 'load' || o.type === 'retreat') return null;
    let best = null, bs = Infinity;
    for (const e of this.visible[u.side]) {
      if (!e.alive || e.carrier || !this.inRange(u, e)) continue;
      if (u.type !== 'artillery' && !this.map.los(u.x, u.z, e.x, e.z)) continue;
      let s = Math.hypot(e.x - u.x, e.z - u.z);
      if (u.type === 'tank' && e.type === 'tank') s *= 0.6;
      if (u.type === 'infantry' && e.type === 'tank' && s > 45) s *= 3;
      if (u.type === 'artillery') s = -this.alive(e.side).filter(o => Math.hypot(o.x - e.x, o.z - e.z) < 30).length * 100 + s * 0.1;
      if (s < bs) { bs = s; best = e; }
    }
    return best;
  }
  fire(u, t) {
    const T = u.T, d = Math.hypot(t.x - u.x, t.z - u.z), mf = 0.5 + u.morale / 200, mv = u.moving ? 0.6 : 1;
    u.cooldown = T.rof * (0.85 + Math.random() * 0.3); u.ammo -= 1; u.lastFired = this.time; this.shots[u.type]++;
    u.heading = u.T.vehicle ? u.heading : Math.atan2(t.x - u.x, t.z - u.z);
    const muz = this.muzzle(u);
    if (u.type === 'infantry') {
      const at = t.type === 'tank' || t.type === 'artillery' || t.type === 'truck';
      for (let k = 0; k < 2; k++) this.fx.tracer(muz, [t.x + (Math.random() - 0.5) * 8, (t.building ? t.building.h : 0) + 2, t.z + (Math.random() - 0.5) * 8]);
      this.fx.flash(muz, 0.6);
      const p = 0.6 * mf * mv * (d > 90 ? 0.75 : 1);
      if (Math.random() < p) {
        if (t.type === 'tank') { if (d < 45) this.damage(t, 28, u, 'at'); else this.damage(t, 0.6, u, 'small'); }
        else this.damage(t, at ? 7 : 11, u, 'small');
      }
    } else if (u.type === 'tank') {
      this.fx.flash(muz, 2.2);
      const hit = Math.random() < 0.72 * mf * mv * (d > 160 ? 0.8 : 1);
      const ex = hit ? t.x : t.x + (Math.random() - 0.5) * 30, ez = hit ? t.z : t.z + (Math.random() - 0.5) * 30;
      this.fx.shell(muz, [ex, (t.building ? t.building.h : 0) + 2, ez], 320, () => {
        if (hit && t.alive) this.damage(t, t.type === 'tank' ? 75 : 48, u, 'shell');
        this.splash(ex, ez, 7, 18, u, hit ? t : null); this.fx.explosion(ex, ez, 0.8);
      });
    } else if (u.type === 'artillery') {
      this.fx.flash(muz, 3);
      const sc = 6 + d * 0.035, ex = t.x + (Math.random() - 0.5) * sc * 2, ez = t.z + (Math.random() - 0.5) * sc * 2;
      this.fx.arcShell(muz, [ex, 0, ez], 1 + d / 220, () => { this.splash(ex, ez, 18, 75, u, null); this.fx.explosion(ex, ez, 1.6); });
    }
  }
  muzzle(u) { const m = u.mesh.userData.muzzle; const v = m ? m.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), u.heading + (u.mesh.userData.turret ? u.mesh.userData.turret.rotation.y : 0)) : new THREE.Vector3(0, 3, 0); return [u.x + v.x, (u.building ? u.building.h : 0) + v.y, u.z + v.z]; }
  splash(x, z, r, dmg, src, skip) {
    for (const e of this.units) {
      if (!e.alive || e.carrier || e === skip) continue;
      const d = Math.hypot(e.x - x, e.z - z);
      if (d < r) this.damage(e, dmg * (1 - d / r) * (e.type === 'tank' ? 0.35 : 1), src, 'splash');
      if (d < r * 2.2) { e.morale -= 6; e.lastHit = this.time; }
    }
  }
  damage(t, dmg, src, kind) {
    if (!t.alive) return;
    if (t.building) dmg *= kind === 'splash' ? 0.6 : 0.5;
    if (t.type === 'tank' && src) { // armour: hit angle relative to hull facing
      const a = Math.atan2(src.x - t.x, src.z - t.z); const da = Math.abs(((a - t.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      dmg *= da < Math.PI / 4 ? 0.5 : da > Math.PI * 3 / 4 ? 1.6 : 1.0;
    }
    t.hp -= dmg; t.lastHit = this.time; t.morale -= dmg / t.T.hp * (t.T.vehicle ? 30 : 55);
    if (t.type !== 'tank' || kind !== 'small') t.attackedBy = src;
    if (t.hp <= 0) this.kill(t, src);
  }
  kill(u, src) {
    u.alive = false; u.hp = 0; u.target = null; if (src) this.kills[src.side] += 1;
    for (const o of this.units) if (o.alive && Math.hypot(o.x - u.x, o.z - u.z) < 130) o.morale += o.side === u.side ? -15 : 4;
    if (u.passengers.length) { const ps = u.passengers.slice(); this.unload(u); ps.forEach(p => this.damage(p, 50, src, 'splash')); }
    if (u.carrier) { u.carrier.passengers = u.carrier.passengers.filter(p => p !== u); u.carrier = null; }
    if (u.T.vehicle) { this.fx.explosion(u.x, u.z, 1.4); this.fx.wreck(u); }
    else { this.scene.remove(u.mesh); }
    u.mesh.userData.ring.visible = false;
    this.events.push({ t: this.time, side: u.side, msg: `${SIDES[u.side].name} ${u.T.name.toLowerCase()} destroyed` });
  }
  checkEnd() {
    for (const side of ['allies', 'axis']) {
      const s = this.armyStatus(side), combat = this.alive(side).filter(u => u.type !== 'truck').length;
      let reason = null;
      if (!s.alive || !combat) reason = 'destroyed';
      else if (s.lost >= 0.7 || (s.lost >= 0.35 && s.morale < 30)) reason = 'surrendered';
      if (reason) { this.over = { loser: side, winner: ENEMY[side], reason, time: this.time }; return; }
    }
  }
}

// ---------- computer opponent ----------
class AI {
  constructor(game, side) {
    this.g = game; this.side = side; this.t = 0; this.state = 'gather'; this.stateT = 0; this.memory = new Map();
    const mine = game.alive(side);
    const inf = mine.filter(u => u.type === 'infantry');
    this.defenders = new Set(inf.slice(0, 2));
    this.assault = new Set([...mine.filter(u => u.type === 'tank'), ...inf.slice(2)]);
    this.trucks = mine.filter(u => u.type === 'truck'); this.arty = mine.filter(u => u.type === 'artillery');
    // first truck carries two squads forward
    const riders = inf.slice(-2), tr = this.trucks[0];
    if (tr) riders.forEach(p => { tr.passengers.push(p); p.carrier = tr; p.mesh.visible = false; this.assault.delete(p); });
    this.riders = riders; this.objective = null; this.initialStrength = this.strength();
    game.orderHold(this.arty); game.orderHold([...this.defenders]);
  }
  strength() { let s = 0; for (const u of this.assault) if (u.alive) s += u.hp / u.T.hp * u.T.value; return s; }
  step(dt) {
    this.t += dt; if (this.t < 1.5) return; this.t = 0; this.stateT += 1.5; const g = this.g;
    for (const e of g.visible[this.side]) this.memory.set(e, { x: e.x, z: e.z, t: g.time });
    for (const [e, m] of this.memory) if (!e.alive || g.time - m.t > 40) this.memory.delete(e);
    const base = BASES[this.side], enemyBase = BASES[ENEMY[this.side]];
    const assault = [...this.assault].filter(u => u.alive && !u.broken && !u.carrier);
    const c = centroid(assault.length ? assault : g.alive(this.side));
    const known = [...this.memory.entries()].map(([e, m]) => ({ e, ...m }));
    // defend the base
    const threat = known.filter(k => Math.hypot(k.x - base[0], k.z - base[1]) < 380).sort((a, b) => dist(a, base) - dist(b, base))[0];
    if (threat) { const d = [...this.defenders].filter(u => u.alive && !u.broken && u.order.type !== 'attack'); if (d.length) g.orderAttack(d, threat.e); }
    // artillery: re-deploy forward when out of reach of everything we know about
    for (const a of this.arty) if (a.alive && !a.broken && a.order.type !== 'move' && a.order.type !== 'retreat') {
      const near = known.some(k => Math.hypot(k.x - a.x, k.z - a.z) < a.T.range * 0.95);
      if (!near && assault.length && Math.hypot(c[0] - a.x, c[1] - a.z) > 500) g.orderMove([a], a.x + (c[0] - a.x) * 0.45, a.z + (c[1] - a.z) * 0.45, true);
      else if (a.order.type === 'idle') g.orderHold([a]);
    }
    // assault state machine
    const str = this.strength() / this.initialStrength;
    if (this.state === 'gather' && this.stateT > 12) this.setState('advance');
    if (this.state === 'advance' && str < 0.4) { this.setState('regroup'); g.orderMove(assault, base[0], base[1]); }
    if (this.state === 'regroup' && this.stateT > 30 && assault.every(u => u.morale > 65)) {
      for (const u of this.defenders) if (u.alive && !threat) this.assault.add(u);
      this.initialStrength = Math.max(this.strength(), 0.5); this.setState('advance');
    }
    if (this.state === 'advance') {
      let obj = known.length ? known.sort((a, b) => dist(a, c) - dist(b, c))[0] : null;
      const tgt = obj ? [obj.x, obj.z] : (Math.hypot(c[0], c[1]) > 150 && !this.passedCentre ? [0, 0] : enemyBase);
      if (Math.hypot(c[0], c[1]) < 160) this.passedCentre = true;
      const idle = assault.filter(u => u.order.type === 'idle' || u.order.type === 'hold');
      if (!this.objective || Math.hypot(tgt[0] - this.objective[0], tgt[1] - this.objective[1]) > 70 || idle.length > assault.length / 2 || this.stateT - (this.lastOrder || 0) > 20) {
        this.objective = tgt; this.lastOrder = this.stateT; g.orderMove(assault, tgt[0], tgt[1], true);
      }
    }
    // trucks: transport, then supply behind the assault
    this.trucks.forEach((tr, i) => {
      if (!tr.alive) return;
      if (tr.passengers.length) {
        const danger = known.some(k => Math.hypot(k.x - tr.x, k.z - tr.z) < 260);
        if (danger || (this.state === 'advance' && Math.hypot(tr.x, tr.z) < 200)) { const ps = tr.passengers.slice(); g.unload(tr); ps.forEach(p => this.assault.add(p)); if (this.objective) g.orderMove(ps, this.objective[0], this.objective[1], true); }
        else if (this.state === 'advance' && tr.order.type === 'idle') g.orderMove([tr], 0, 0);
      } else if (assault.length && this.state !== 'gather') {
        const back = [c[0] + (base[0] - c[0]) * 0.15 + i * 12, c[1] + (base[1] - c[1]) * 0.15];
        if (Math.hypot(back[0] - tr.x, back[1] - tr.z) > 60 && tr.order.type === 'idle') g.orderMove([tr], back[0], back[1]);
      }
    });
  }
  setState(s) { this.state = s; this.stateT = 0; this.objective = null; }
}
const centroid = us => { let x = 0, z = 0; us.forEach(u => { x += u.x; z += u.z; }); return us.length ? [x / us.length, z / us.length] : [0, 0]; };
const dist = (a, b) => Math.hypot(a.x - (b[0] ?? b.x), a.z - (b[1] ?? b.z));

// ---------- visual effects ----------
class Effects {
  constructor(scene, map) {
    this.scene = scene; this.map = map; this.items = []; this.craters = [];
    const cv = document.createElement('canvas'); cv.width = cv.height = 64; const x = cv.getContext('2d');
    const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64); this.tex = new THREE.CanvasTexture(cv);
    this.craterMat = new THREE.MeshBasicMaterial({ color: 0x1c1a16, transparent: true, opacity: 0.55, depthWrite: false });
  }
  sprite(color, add, size) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, color, transparent: true, depthWrite: false, blending: add ? THREE.AdditiveBlending : THREE.NormalBlending }));
    s.scale.setScalar(size); this.scene.add(s); return s;
  }
  add(obj, life, upd) { this.items.push({ obj, life, max: life, upd }); }
  flash(p, s) { const sp = this.sprite(0xffd27a, true, 4 * s); sp.position.set(...p); this.add(sp, 0.09); }
  tracer(a, b) {
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...a), new THREE.Vector3(...b)]);
    const l = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.8 })); this.scene.add(l); this.add(l, 0.08);
  }
  shell(a, b, speed, done) {
    const s = this.sprite(0xffc060, true, 2.2); s.position.set(...a); const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), T = A.distanceTo(B) / speed;
    this.add(s, T, (o, k) => o.position.lerpVectors(A, B, k)); this.items[this.items.length - 1].done = done;
  }
  arcShell(a, b, T, done) {
    const s = this.sprite(0x222222, false, 2.5); const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), H = A.distanceTo(B) * 0.25;
    this.add(s, T, (o, k) => { o.position.lerpVectors(A, B, k); o.position.y += Math.sin(k * Math.PI) * H; }); this.items[this.items.length - 1].done = done;
  }
  explosion(x, z, s) {
    const f = this.sprite(0xff8a2a, true, 10 * s); f.position.set(x, 4 * s, z); this.add(f, 0.45, (o, k) => { o.scale.setScalar(10 * s * (1 + k * 1.5)); o.material.opacity = 1 - k; });
    for (let i = 0; i < 5; i++) {
      const sm = this.sprite(0x55524c, false, 7 * s); sm.position.set(x + (Math.random() - 0.5) * 6 * s, 3, z + (Math.random() - 0.5) * 6 * s);
      const vx = (Math.random() - 0.5) * 2, vy = 4 + Math.random() * 4; sm.material.opacity = 0.7;
      this.add(sm, 2.5 + Math.random() * 1.5, (o, k, dt) => { o.position.x += vx * dt; o.position.y += vy * dt; o.scale.setScalar(7 * s * (1 + k * 2)); o.material.opacity = 0.7 * (1 - k); });
    }
    const c = new THREE.Mesh(new THREE.CircleGeometry(3.5 * s, 12), this.craterMat); c.rotation.x = -Math.PI / 2; c.position.set(x, 0.08 + Math.random() * 0.04, z); this.scene.add(c);
    this.craters.push(c); if (this.craters.length > 120) this.scene.remove(this.craters.shift());
  }
  wreck(u) {
    const m = u.mesh; m.traverse(o => { if (o.isMesh && o !== m.userData.ring) { o.material = o.material.clone(); if (o.material.color) o.material.color.multiplyScalar(0.3); } });
    m.rotation.z = 0.08; let t = 0;
    const smoke = { obj: new THREE.Object3D(), life: 25, max: 25, upd: (o, k, dt) => { t += dt; if (t > 0.35) { t = 0; this.explosionSmoke(u.x, u.z); } } };
    this.items.push(smoke);
  }
  explosionSmoke(x, z) {
    const sm = this.sprite(0x2e2c29, false, 5); sm.position.set(x, 5, z); sm.material.opacity = 0.6;
    this.add(sm, 3, (o, k, dt) => { o.position.y += 6 * dt; o.position.x += 1.5 * dt; o.scale.setScalar(5 + k * 12); o.material.opacity = 0.6 * (1 - k); });
  }
  step(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i]; it.life -= dt; const k = Math.min(1, 1 - it.life / it.max);
      if (it.upd) it.upd(it.obj, k, dt);
      if (it.life <= 0) { if (it.done) it.done(); this.scene.remove(it.obj); it.obj.material?.dispose?.(); if (!it.obj.isSprite) it.obj.geometry?.dispose?.(); this.items.splice(i, 1); }
    }
  }
}
