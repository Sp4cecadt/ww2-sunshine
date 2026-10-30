// Low/mid-poly unit models built from primitives. German markings: Balkenkreuz only (no party symbols).
import * as THREE from '../vendor/three.module.min.js';

export const SIDES = {
  allies: { name: 'Allies', body: 0x55603a, dark: 0x3c4429, cloth: 0x6b6a3e, accent: '#ffffff', ui: '#7fb069' },
  axis: { name: 'Germans', body: 0x6c6f68, dark: 0x4a4c47, cloth: 0x5f6658, accent: '#111111', ui: '#d9534f' },
};
const mats = new Map();
const mat = (c) => { if (!mats.has(c)) mats.set(c, new THREE.MeshLambertMaterial({ color: c })); return mats.get(c); };
const box = (w, h, d, c) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(c));
const cyl = (r1, r2, h, c, s = 10) => new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, s), mat(c));

function decalTexture(side) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64; const x = cv.getContext('2d');
  if (side === 'allies') {
    x.fillStyle = '#fff'; x.beginPath();
    for (let i = 0; i < 10; i++) { const r = i % 2 ? 12 : 30, a = -Math.PI / 2 + i * Math.PI / 5; x.lineTo(32 + r * Math.cos(a), 32 + r * Math.sin(a)); }
    x.closePath(); x.fill();
  } else { // Balkenkreuz: black cross with white edges
    x.fillStyle = '#fff'; x.fillRect(4, 22, 56, 20); x.fillRect(22, 4, 20, 56);
    x.fillStyle = '#111'; x.fillRect(8, 26, 48, 12); x.fillRect(26, 8, 12, 48);
  }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const decals = {};
function decal(side, size) {
  decals[side] ||= new THREE.MeshBasicMaterial({ map: decalTexture(side), transparent: true, depthWrite: false });
  return new THREE.Mesh(new THREE.PlaneGeometry(size, size), decals[side]);
}

function soldier(s, rifle = true) {
  const g = new THREE.Group();
  const legs = box(0.5, 0.9, 0.35, s.dark); legs.position.y = 0.45; g.add(legs);
  const body = box(0.6, 0.75, 0.4, s.cloth); body.position.y = 1.25; g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), mat(0xd8b48f)); head.position.y = 1.8; g.add(head);
  const helm = new THREE.Mesh(new THREE.SphereGeometry(0.27, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), mat(s.body)); helm.position.y = 1.86; g.add(helm);
  if (rifle) { const r = box(0.08, 0.08, 1.1, 0x3b2a1a); r.position.set(0.3, 1.3, 0.3); g.add(r); }
  return g;
}

export function buildModel(type, side) {
  const s = SIDES[side]; const g = new THREE.Group(); const S = 2.6; // visual exaggeration so units read on a 2 km map
  const inner = new THREE.Group(); inner.scale.setScalar(S); g.add(inner);
  const figures = [];
  if (type === 'infantry') {
    const offs = [[0, 0], [-1.6, -1.2], [1.6, -1.2], [-1.2, 1.4], [1.2, 1.4]];
    for (const [x, z] of offs) { const f = soldier(s); f.position.set(x, 0, z); inner.add(f); figures.push(f); }
  } else if (type === 'tank') {
    const hull = box(3.0, 1.1, 5.6, s.body); hull.position.y = 1.0; inner.add(hull);
    for (const x of [-1.5, 1.5]) { const t = box(0.7, 1.0, 6.0, 0x2b2b26); t.position.set(x, 0.55, 0); inner.add(t); }
    const tur = new THREE.Group(); tur.position.set(0, 2.0, -0.2); inner.add(tur);
    tur.add(box(2.0, 0.9, 2.4, s.body));
    const gun = cyl(0.14, 0.14, 3.4, s.dark, 8); gun.rotation.x = Math.PI / 2; gun.position.set(0, 0, 2.8); tur.add(gun);
    const cupola = cyl(0.35, 0.4, 0.4, s.dark); cupola.position.set(0.4, 0.6, -0.4); tur.add(cupola);
    g.userData.turret = tur; g.userData.gun = gun; g.userData.muzzle = new THREE.Vector3(0, 2.0 * S, 4.4 * S);
    if (side === 'allies') { const d = decal(side, 1.3); d.rotation.x = -Math.PI / 2; d.position.set(0, 0.47, -0.3); tur.add(d); }
    for (const x of [-1, 1]) { const d = decal(side, 0.9); d.rotation.y = x * Math.PI / 2; d.position.set(x * 1.52, 1.05, -0.8); inner.add(d); }
  } else if (type === 'artillery') {
    for (const x of [-0.9, 0.9]) { const w = cyl(0.6, 0.6, 0.25, 0x2b2b26, 12); w.rotation.z = Math.PI / 2; w.position.set(x, 0.6, 0); inner.add(w); }
    const shield = box(2.0, 1.2, 0.1, s.body); shield.position.set(0, 1.2, 0.3); inner.add(shield);
    const barrel = cyl(0.13, 0.17, 3.6, s.dark, 8); barrel.rotation.x = Math.PI / 2 - 0.35; barrel.position.set(0, 1.5, 1.4); inner.add(barrel);
    const trail = box(0.3, 0.2, 3.0, s.dark); trail.position.set(0, 0.3, -1.6); inner.add(trail);
    for (const [x, z] of [[-1.2, -1.8], [1.2, -1.6]]) { const f = soldier(s, false); f.scale.setScalar(0.9); f.position.set(x, 0, z); inner.add(f); figures.push(f); }
    g.userData.muzzle = new THREE.Vector3(0, 2.6 * S, 3.0 * S);
  } else if (type === 'truck') {
    const cab = box(2.2, 1.6, 1.8, s.body); cab.position.set(0, 1.5, 2.0); inner.add(cab);
    const bed = box(2.4, 0.4, 4.0, s.dark); bed.position.set(0, 1.0, -0.8); inner.add(bed);
    const tarp = box(2.3, 1.5, 3.8, s.cloth); tarp.position.set(0, 1.95, -0.8); inner.add(tarp);
    for (const [x, z] of [[-1.1, 2], [1.1, 2], [-1.1, -1.5], [1.1, -1.5]]) { const w = cyl(0.5, 0.5, 0.35, 0x1e1e1c, 10); w.rotation.z = Math.PI / 2; w.position.set(x, 0.5, z); inner.add(w); }
    for (const x of [-1, 1]) { const d = decal(side, 0.9); d.rotation.y = x * Math.PI / 2; d.position.set(x * 1.17, 2.0, -0.8); inner.add(d); }
  }
  // blob shadow + selection ring
  const rad = { infantry: 2.5, tank: 3.4, artillery: 2.6, truck: 3.2 }[type] * S;
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(rad * 0.9, 16), new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0.28, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.15; g.add(shadow);
  const ring = new THREE.Mesh(new THREE.RingGeometry(rad, rad + 0.9, 28), new THREE.MeshBasicMaterial({ color: 0x9cff7a, transparent: true, opacity: 0.9, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.3; ring.visible = false; g.add(ring);
  g.userData.ring = ring; g.userData.figures = figures; g.userData.radius = rad;
  return g;
}
