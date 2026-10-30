// Map: satellite ground, OSM buildings/roads, navigation grid, line of sight, flow-field pathing.
import * as THREE from '../vendor/three.module.min.js';

export const CELL = 4;

export class GameMap {
  constructor(data) {
    this.data = data;
    [this.W, this.H] = data.size;
    this.NX = Math.ceil(this.W / CELL); this.NZ = Math.ceil(this.H / CELL);
    const N = this.NX * this.NZ;
    this.bld = new Uint16Array(N);      // building index + 1 per cell (0 = open)
    this.vblock = new Uint8Array(N);    // vehicle-blocked cells (buildings, dilated, water)
    this.buildings = data.buildings.map((b, i) => {
      const pts = []; for (let k = 0; k < b.p.length; k += 2) pts.push([b.p[k], b.p[k + 1]]);
      let cx = 0, cz = 0; pts.forEach(p => { cx += p[0]; cz += p[1]; });
      return { i, h: b.h, kind: b.k, pts, cx: cx / pts.length, cz: cz / pts.length };
    });
    this.buildings.forEach(b => this.fillPoly(b.pts, (c) => { this.bld[c] = b.i + 1; }));
    // dilate buildings by one cell for vehicles, then carve roads back open
    for (let z = 0; z < this.NZ; z++) for (let x = 0; x < this.NX; x++) {
      const c = z * this.NX + x; if (!this.bld[c]) continue;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, zz = z + dz; if (xx >= 0 && zz >= 0 && xx < this.NX && zz < this.NZ) this.vblock[zz * this.NX + xx] = 1;
      }
    }
    for (const r of data.roads) this.strokeLine(r.p, r.w, c => { if (!this.bld[c]) this.vblock[c] = 0; });
    for (const w of data.water) this.strokeLine(w, 6, c => { this.vblock[c] = 1; });
    for (let x = 0; x < this.NX; x++) { this.vblock[x] = 1; this.vblock[(this.NZ - 1) * this.NX + x] = 1; }
    for (let z = 0; z < this.NZ; z++) { this.vblock[z * this.NX] = 1; this.vblock[z * this.NX + this.NX - 1] = 1; }
    this.keepLargestRegion();
  }
  // Vehicles can only use the largest connected open area: close off isolated pockets (courtyards, enclosed yards).
  keepLargestRegion() {
    const N = this.NX * this.NZ, lab = new Int32Array(N).fill(-1), sizes = []; const q = new Int32Array(N);
    for (let s = 0; s < N; s++) {
      if (this.vblock[s] || lab[s] >= 0) continue;
      const id = sizes.length; let h = 0, t = 0; q[t++] = s; lab[s] = id;
      while (h < t) { const c = q[h++], x = c % this.NX;
        for (const n of [c - 1, c + 1, c - this.NX, c + this.NX]) {
          if (n < 0 || n >= N || (n === c - 1 && x === 0) || (n === c + 1 && x === this.NX - 1)) continue;
          if (!this.vblock[n] && lab[n] < 0) { lab[n] = id; q[t++] = n; } } }
      sizes.push(t);
    }
    const big = sizes.indexOf(Math.max(...sizes)); let open = 0;
    for (let c = 0; c < N; c++) if (lab[c] !== big) this.vblock[c] = 1; else open++;
    this.openFraction = open / N;
  }
  cellOf(x, z) {
    const cx = Math.floor((x + this.W / 2) / CELL), cz = Math.floor((z + this.H / 2) / CELL);
    if (cx < 0 || cz < 0 || cx >= this.NX || cz >= this.NZ) return -1;
    return cz * this.NX + cx;
  }
  cellCenter(c) { return [(c % this.NX + 0.5) * CELL - this.W / 2, (Math.floor(c / this.NX) + 0.5) * CELL - this.H / 2]; }
  inBounds(x, z, m = 8) { return x > -this.W / 2 + m && x < this.W / 2 - m && z > -this.H / 2 + m && z < this.H / 2 - m; }
  buildingAt(x, z) { const c = this.cellOf(x, z); return c < 0 ? null : (this.bld[c] ? this.buildings[this.bld[c] - 1] : null); }
  blockedFor(vehicle, x, z) { const c = this.cellOf(x, z); if (c < 0) return true; return vehicle ? !!this.vblock[c] : false; }
  fillPoly(pts, fn) {
    let minz = 1e9, maxz = -1e9; pts.forEach(p => { minz = Math.min(minz, p[1]); maxz = Math.max(maxz, p[1]); });
    const z0 = Math.max(0, Math.floor((minz + this.H / 2) / CELL)), z1 = Math.min(this.NZ - 1, Math.floor((maxz + this.H / 2) / CELL));
    for (let cz = z0; cz <= z1; cz++) {
      const zc = (cz + 0.5) * CELL - this.H / 2, xs = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        if ((a[1] <= zc) !== (b[1] <= zc)) xs.push(a[0] + (zc - a[1]) / (b[1] - a[1]) * (b[0] - a[0]));
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const x0 = Math.max(0, Math.round((xs[k] + this.W / 2) / CELL - 0.5)), x1 = Math.min(this.NX - 1, Math.round((xs[k + 1] + this.W / 2) / CELL - 0.5));
        for (let cx = x0; cx <= x1; cx++) fn(cz * this.NX + cx);
      }
      // tiny footprints: always mark the cell containing the centroid
    }
    let cx = 0, cz = 0; pts.forEach(p => { cx += p[0]; cz += p[1]; }); const c = this.cellOf(cx / pts.length, cz / pts.length); if (c >= 0) fn(c);
  }
  strokeLine(p, w, fn) {
    for (let k = 0; k + 3 < p.length; k += 2) {
      const ax = p[k], az = p[k + 1], bx = p[k + 2], bz = p[k + 3], len = Math.hypot(bx - ax, bz - az), n = Math.ceil(len / 2) + 1;
      for (let s = 0; s <= n; s++) {
        const x = ax + (bx - ax) * s / n, z = az + (bz - az) * s / n, r = Math.ceil(w / 2 / CELL);
        const c0 = this.cellOf(x, z); if (c0 < 0) continue;
        const cx = c0 % this.NX, cz = Math.floor(c0 / this.NX);
        for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
          const xx = cx + dx, zz = cz + dz; if (xx < 0 || zz < 0 || xx >= this.NX || zz >= this.NZ) continue;
          if ((dx * dx + dz * dz) * CELL * CELL <= (w / 2 + 1) * (w / 2 + 1)) fn(zz * this.NX + xx);
        }
      }
    }
  }
  // Line of sight: blocked if the ray crosses more than `allow` cells of buildings taller than the eye line.
  los(ax, az, bx, bz) {
    const d = Math.hypot(bx - ax, bz - az), n = Math.ceil(d / (CELL * 0.75));
    const sa = this.bld[this.cellOf(ax, az)] || -1, sb = this.bld[this.cellOf(bx, bz)] || -1;
    let hits = 0;
    for (let i = 1; i < n; i++) {
      const c = this.cellOf(ax + (bx - ax) * i / n, az + (bz - az) * i / n); if (c < 0) continue;
      const b = this.bld[c]; if (b && b !== sa && b !== sb) { if (++hits > 2) return false; }
    }
    return true;
  }
  // Straight-line passability for vehicles
  clearLine(ax, az, bx, bz) {
    const d = Math.hypot(bx - ax, bz - az), n = Math.ceil(d / (CELL * 0.5));
    for (let i = 1; i <= n; i++) if (this.blockedFor(true, ax + (bx - ax) * i / n, az + (bz - az) * i / n)) return false;
    return true;
  }
  nearestFree(x, z, vehicle = true) {
    const c0 = this.cellOf(Math.max(-this.W / 2 + 10, Math.min(this.W / 2 - 10, x)), Math.max(-this.H / 2 + 10, Math.min(this.H / 2 - 10, z)));
    if (!vehicle || !this.vblock[c0]) return this.cellCenter(c0);
    const cx = c0 % this.NX, cz = Math.floor(c0 / this.NX);
    for (let r = 1; r < 60; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      const xx = cx + dx, zz = cz + dz; if (xx < 1 || zz < 1 || xx >= this.NX - 1 || zz >= this.NZ - 1) continue;
      const c = zz * this.NX + xx; if (!this.vblock[c]) return this.cellCenter(c);
    }
    return [x, z];
  }
  // Dijkstra flow field (vehicles) from goal until all `starts` are reached (+ margin).
  flowField(gx, gz, starts) {
    const N = this.NX * this.NZ, dist = new Float64Array(N).fill(Infinity);
    const [fx, fz] = this.nearestFree(gx, gz, true); const g = this.cellOf(fx, fz);
    const need = new Set(starts.map(s => this.cellOf(s[0], s[1])).filter(c => c >= 0));
    const heap = new MinHeap(); dist[g] = 0; heap.push(g, 0); let settledNeeded = 0, extra = -1;
    const NX = this.NX, D = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
    while (heap.size) {
      const [c, d] = heap.pop(); if (d > dist[c]) continue;
      if (need.has(c)) { need.delete(c); settledNeeded++; if (!need.size) extra = d + 40; }
      if (extra >= 0 && d > extra) break;
      const cx = c % NX, cz = (c - cx) / NX;
      for (const [dx, dz, w] of D) {
        const xx = cx + dx, zz = cz + dz; if (xx < 0 || zz < 0 || xx >= NX || zz >= this.NZ) continue;
        const n = zz * NX + xx; if (this.vblock[n]) continue;
        if (dx && dz && (this.vblock[cz * NX + xx] || this.vblock[zz * NX + cx])) continue;
        const nd = d + w; if (nd < dist[n]) { dist[n] = nd; heap.push(n, nd); }
      }
    }
    return { dist, goal: [fx, fz] };
  }
  // Follow a flow field: returns a point a few cells further down-gradient.
  flowStep(field, x, z) {
    let c = this.cellOf(x, z); if (c < 0) return null;
    if (!isFinite(field.dist[c])) {  // off-field (e.g. pushed into a blocked cell): step to best neighbour
      let best = -1, bd = Infinity; const cx = c % this.NX, cz = Math.floor(c / this.NX);
      for (let r = 1; r <= 3 && best < 0; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        const xx = cx + dx, zz = cz + dz; if (xx < 0 || zz < 0 || xx >= this.NX || zz >= this.NZ) continue;
        const n = zz * this.NX + xx; if (field.dist[n] < bd) { bd = field.dist[n]; best = n; }
      }
      return best < 0 ? null : this.cellCenter(best);
    }
    for (let s = 0; s < 4; s++) {
      const cx = c % this.NX, cz = Math.floor(c / this.NX); let best = c, bd = field.dist[c];
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const xx = cx + dx, zz = cz + dz; if (xx < 0 || zz < 0 || xx >= this.NX || zz >= this.NZ) continue;
        const n = zz * this.NX + xx; if (field.dist[n] < bd) { bd = field.dist[n]; best = n; }
      }
      if (best === c) break; c = best;
    }
    return this.cellCenter(c);
  }

  // ---------- rendering ----------
  build(scene, satTex) {
    const g = new THREE.Group();
    satTex.colorSpace = THREE.SRGBColorSpace; satTex.anisotropy = 4;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(this.W, this.H), new THREE.MeshLambertMaterial({ map: satTex }));
    ground.rotation.x = -Math.PI / 2; ground.name = 'ground'; g.add(ground);
    // apron beyond the map edge so the horizon is not empty
    const apron = new THREE.Mesh(new THREE.PlaneGeometry(this.W * 4, this.H * 4), new THREE.MeshLambertMaterial({ color: 0x4d5440 }));
    apron.rotation.x = -Math.PI / 2; apron.position.y = -0.3; g.add(apron);
    g.add(this.buildingMesh());
    scene.add(g); return g;
  }
  buildingMesh() {
    const pos = [], col = [], norm = [];
    const roofs = [[0.62, 0.32, 0.25], [0.55, 0.28, 0.22], [0.48, 0.47, 0.46], [0.6, 0.58, 0.55], [0.42, 0.36, 0.33], [0.7, 0.68, 0.63]];
    const walls = [[0.78, 0.7, 0.58], [0.72, 0.6, 0.5], [0.8, 0.78, 0.72], [0.66, 0.52, 0.42]];
    const push = (p, n, c) => { pos.push(...p); norm.push(...n); col.push(...c); };
    for (const b of this.buildings) {
      const h = b.h, r = roofs[b.i % roofs.length], w = walls[(b.i * 7) % walls.length];
      const big = b.kind !== 'house' && b.h > 7; const rc = big ? [0.6, 0.6, 0.58] : r;
      const P = b.pts;
      for (let i = 0; i < P.length; i++) {
        const a = P[i], c = P[(i + 1) % P.length]; const dx = c[0] - a[0], dz = c[1] - a[1], L = Math.hypot(dx, dz) || 1;
        const n = [dz / L, 0, -dx / L]; const shade = 0.75 + 0.25 * Math.abs(n[0]);
        const wc = w.map(v => v * shade);
        push([a[0], 0, a[1]], n, wc); push([c[0], 0, c[1]], n, wc); push([c[0], h, c[1]], n, wc);
        push([a[0], 0, a[1]], n, wc); push([c[0], h, c[1]], n, wc); push([a[0], h, a[1]], n, wc);
      }
      const tris = THREE.ShapeUtils.triangulateShape(P.map(p => new THREE.Vector2(p[0], p[1])), []);
      for (const t of tris) for (const k of [t[0], t[2], t[1]]) push([P[k][0], h, P[k][1]], [0, 1, 0], rc);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    m.name = 'buildings'; return m;
  }
}

class MinHeap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(k, v) { const K = this.k, V = this.v; K.push(k); V.push(v); let i = K.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (V[p] <= v) break; K[i] = K[p]; V[i] = V[p]; i = p; } K[i] = k; V[i] = v; }
  pop() { const K = this.k, V = this.v, rk = K[0], rv = V[0], lk = K.pop(), lv = V.pop();
    if (K.length) { let i = 0; const n = K.length;
      while (true) { let l = 2 * i + 1, r = l + 1, m = i, mv = lv;
        if (l < n && V[l] < mv) { m = l; mv = V[l]; } if (r < n && V[r] < mv) { m = r; mv = V[r]; }
        if (m === i) break; K[i] = K[m]; V[i] = V[m]; i = m; }
      K[i] = lk; V[i] = lv; }
    return [rk, rv]; }
}
