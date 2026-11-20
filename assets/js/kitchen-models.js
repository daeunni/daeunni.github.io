// Procedurally modelled kitchen furniture for scene3d.js: shaker cabinets with
// bevelled edges, undermount sink + gooseneck faucet, French-door fridge, pedestal
// table, Windsor chairs, a real window frame with a roman shade, and two plants.
// Everything is built in metres in the room's coordinates (back wall z = 0,
// left wall x = 0, floor y = 0) and merged per material to keep draw calls low.
import * as THREE from 'three';
import { mergeGeometries } from './vendor/three/utils/BufferGeometryUtils.js';

const V2 = THREE.Vector2, V3 = THREE.Vector3;

// Box with softly rounded front/back edges (extruded rectangle with a bevel), centred.
export function rboxGeo(w, h, d, r = 0.004) {
  r = Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4);
  if (r < 0.0008) return new THREE.BoxGeometry(w, h, d);
  const s = new THREE.Shape([new V2(-w / 2 + r, -h / 2 + r), new V2(w / 2 - r, -h / 2 + r), new V2(w / 2 - r, h / 2 - r), new V2(-w / 2 + r, h / 2 - r)]);
  const g = new THREE.ExtrudeGeometry(s, { depth: d - 2 * r, bevelEnabled: true, bevelThickness: r, bevelSize: r, bevelSegments: 2, curveSegments: 1 });
  g.translate(0, 0, -(d - 2 * r) / 2);
  return g;
}

const mesh = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); return m; };
// Box from min/max corners (easier to keep joints exact).
const slab = (mat, x0, y0, z0, x1, y1, z1, r = 0.003) => mesh(rboxGeo(x1 - x0, y1 - y0, z1 - z0, r), mat, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
// Tapered rod between two points.
function rod(a, b, r0, r1, mat, seg = 10) {
  const dir = new V3().subVectors(b, a), len = dir.length();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, len, seg), mat);
  m.position.copy(a).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(new V3(0, 1, 0), dir.normalize());
  return m;
}
const lathe = (pts, mat, seg = 48) => new THREE.Mesh(new THREE.LatheGeometry(pts.map(([x, y]) => new V2(x, y)), seg), mat);

// Merge all meshes of a group by material (keeps transforms relative to the group).
export function bake(group, { shadow = true } = {}) {
  group.updateMatrixWorld(true);
  const inv = group.matrixWorld.clone().invert();
  const buckets = new Map();
  group.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    g.clearGroups();
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    if (!buckets.has(o.material)) buckets.set(o.material, []);
    buckets.get(o.material).push(g);
  });
  const out = new THREE.Group();
  for (const [mat, list] of buckets) {
    const m = new THREE.Mesh(mergeGeometries(list), mat);
    m.castShadow = shadow && !mat.transparent;
    m.receiveShadow = true;
    if (mat.userData.noRay) m.userData.noRay = true;
    out.add(m);
  }
  out.position.copy(group.position); out.quaternion.copy(group.quaternion); out.scale.copy(group.scale);
  return out;
}

// Five-piece shaker front (frame + recessed centre panel). Back face at z = 0.
function shaker(w, h, mat, glass) {
  const g = new THREE.Group(), t = 0.02;
  const rail = Math.min(0.058, w * 0.2, h * 0.24);
  g.add(slab(mat, -w / 2, -h / 2, 0, -w / 2 + rail, h / 2, t), slab(mat, w / 2 - rail, -h / 2, 0, w / 2, h / 2, t),
    slab(mat, -w / 2 + rail, h / 2 - rail, 0, w / 2 - rail, h / 2, t), slab(mat, -w / 2 + rail, -h / 2, 0, w / 2 - rail, -h / 2 + rail, t));
  if (glass) g.add(slab(glass, -w / 2 + rail - 0.003, -h / 2 + rail - 0.003, t * 0.45, w / 2 - rail + 0.003, h / 2 - rail + 0.003, t * 0.55, 0));
  else g.add(slab(mat, -w / 2 + rail - 0.003, -h / 2 + rail - 0.003, 0, w / 2 - rail + 0.003, h / 2 - rail + 0.003, t * 0.55, 0.002));
  return g;
}
// Bar pull standing off the front (z = 0 is the front face).
function pull(len, mat, vertical) {
  const g = new THREE.Group();
  const bar = mesh(new THREE.CylinderGeometry(0.0055, 0.0055, len, 14), mat, 0, 0, 0.03);
  if (!vertical) bar.rotation.z = Math.PI / 2;
  g.add(bar);
  for (const s of [-1, 1]) {
    const p = mesh(new THREE.CylinderGeometry(0.004, 0.0045, 0.03, 10), mat, vertical ? 0 : s * (len / 2 - 0.012), vertical ? s * (len / 2 - 0.012) : 0, 0.015);
    p.rotation.x = Math.PI / 2;
    g.add(p);
  }
  return g;
}

export function buildKitchen(M, L) {
  const { runX0, MOD } = L;
  const out = {};
  const gap = 0.003;

  // ---------------- base run ----------------
  const base = new THREE.Group();
  const x0 = runX0, x1 = runX0 + 5 * MOD, frontZ = 0.58, topY = 0.86, D = 0.623;
  const sinkCx = x0 + 1.5 * MOD, sinkW = 0.44, sinkD = 0.36, sinkCz = 0.32, e = 0.004;
  // Carcass, left open around the sink so the basin has real depth.
  { const sy = topY - 0.21, hx0 = sinkCx - sinkW / 2 - 0.01, hx1 = sinkCx + sinkW / 2 + 0.01, hz0 = sinkCz - sinkD / 2 - 0.01, hz1 = sinkCz + sinkD / 2 + 0.01;
    base.add(slab(M.cab, x0, 0.1, 0, x1, sy, frontZ, 0.002));
    base.add(slab(M.cab, x0, sy, 0, hx0, topY, frontZ, 0.002), slab(M.cab, hx1, sy, 0, x1, topY, frontZ, 0.002),
      slab(M.cab, hx0, sy, 0, hx1, topY, hz0, 0), slab(M.cab, hx0, sy, hz1, hx1, topY, frontZ, 0)); }
  base.add(slab(M.plinth, x0 + 0.01, 0, 0, x1 - 0.01, 0.1, frontZ - 0.06, 0.001));
  const fronts = new THREE.Group();
  const addFront = (mx, my, w, h, opts = {}) => {
    const f = shaker(w, h, M.cab, null);
    f.position.set(mx, my, frontZ);
    fronts.add(f);
    if (opts.pull) {
      const p = pull(opts.pull, M.brass, opts.vertical);
      p.position.set(mx + (opts.px || 0), my + (opts.py || 0), frontZ + 0.02);
      fronts.add(p);
    }
  };
  const fy0 = 0.1 + gap, fy1 = topY - gap, FH = fy1 - fy0;
  const col = (i) => [x0 + i * MOD + gap, x0 + (i + 1) * MOD - gap];
  // m0: two drawers
  { const [a, b] = col(0), w = b - a, h = (FH - gap) / 2;
    addFront((a + b) / 2, fy1 - h / 2, w, h, { pull: 0.16 });
    addFront((a + b) / 2, fy0 + h / 2, w, h, { pull: 0.16 }); }
  // m1: sink — false front + pair of doors
  { const [a, b] = col(1), w = b - a, hTop = 0.15, hd = FH - hTop - gap, wd = (w - gap) / 2;
    addFront((a + b) / 2, fy1 - hTop / 2, w, hTop);
    addFront(a + wd / 2, fy0 + hd / 2, wd, hd, { pull: 0.12, vertical: true, px: wd / 2 - 0.04, py: hd / 2 - 0.1 });
    addFront(b - wd / 2, fy0 + hd / 2, wd, hd, { pull: 0.12, vertical: true, px: -wd / 2 + 0.04, py: hd / 2 - 0.1 }); }
  // m2: three graduated drawers
  { const [a, b] = col(2), w = b - a, hs = [0.2, 0.275, FH - 0.475 - 2 * gap];
    let y = fy1;
    for (const h of hs) { addFront((a + b) / 2, y - h / 2, w, h, { pull: 0.16 }); y -= h + gap; } }
  // m3: built-in oven (stainless door with black glass), drawer below, control strip above
  { const [a, b] = col(3), w = b - a, cx = (a + b) / 2;
    addFront(cx, fy0 + 0.05, w, 0.1, { pull: 0.16 });
    const dy0 = fy0 + 0.1 + gap, dy1 = fy1 - 0.1 - gap;
    fronts.add(slab(M.steel, a, dy0, frontZ, b, dy1, frontZ + 0.022, 0.006));
    fronts.add(slab(M.blackGlass, a + 0.045, dy0 + 0.06, frontZ + 0.02, b - 0.045, dy1 - 0.09, frontZ + 0.026, 0.004));
    const h = pull(w - 0.08, M.steel, false); h.position.set(cx, dy1 - 0.04, frontZ + 0.022); fronts.add(h);
    fronts.add(slab(M.blackGlass, a, fy1 - 0.1, frontZ, b, fy1, frontZ + 0.02, 0.004));
    for (let k = 0; k < 4; k++) {
      const kx = a + 0.07 + k * 0.085 + (k > 1 ? 0.07 : 0);
      const knob = mesh(new THREE.CylinderGeometry(0.017, 0.018, 0.022, 20), M.steel, kx, fy1 - 0.05, frontZ + 0.03);
      knob.rotation.x = Math.PI / 2;
      fronts.add(knob);
    }
    fronts.add(slab(M.display, cx - 0.04, fy1 - 0.062, frontZ + 0.02, cx + 0.04, fy1 - 0.038, frontZ + 0.0215, 0)); }
  // m4: drawer over door
  { const [a, b] = col(4), w = b - a, h = 0.18, hd = FH - h - gap;
    addFront((a + b) / 2, fy1 - h / 2, w, h, { pull: 0.16 });
    addFront((a + b) / 2, fy0 + hd / 2, w, hd, { pull: 0.12, vertical: true, px: -w / 2 + 0.045, py: hd / 2 - 0.1 }); }
  base.add(fronts);

  // Countertop: one marble slab with an eased edge and a cut-out for the undermount sink.
  const top = new THREE.Shape([new V2(x0 + e, -e), new V2(x1 - e, -e), new V2(x1 - e, -(D - e)), new V2(x0 + e, -(D - e))]);
  const hole = new THREE.Path();
  { const hx0 = sinkCx - sinkW / 2, hx1 = sinkCx + sinkW / 2, hy0 = -(sinkCz + sinkD / 2), hy1 = -(sinkCz - sinkD / 2), cr = 0.035;
    hole.moveTo(hx0 + cr, hy0); hole.lineTo(hx1 - cr, hy0); hole.absarc(hx1 - cr, hy0 + cr, cr, -Math.PI / 2, 0);
    hole.lineTo(hx1, hy1 - cr); hole.absarc(hx1 - cr, hy1 - cr, cr, 0, Math.PI / 2);
    hole.lineTo(hx0 + cr, hy1); hole.absarc(hx0 + cr, hy1 - cr, cr, Math.PI / 2, Math.PI);
    hole.lineTo(hx0, hy0 + cr); hole.absarc(hx0 + cr, hy0 + cr, cr, Math.PI, Math.PI * 1.5); }
  top.holes.push(hole);
  const topGeo = new THREE.ExtrudeGeometry(top, { depth: 0.04 - 2 * e, bevelEnabled: true, bevelThickness: e, bevelSize: e, bevelSegments: 2, curveSegments: 6 });
  topGeo.rotateX(-Math.PI / 2);   // shape y -> world -z, extrusion -> world +y
  topGeo.translate(0, topY + e, 0);
  out.counter = new THREE.Mesh(topGeo, M.marble);
  out.counter.castShadow = out.counter.receiveShadow = true;

  // Undermount stainless basin + drain.
  const sink = new THREE.Group();
  { const w = sinkW - 0.01, d = sinkD - 0.01, by = topY - 0.19, t = 0.006, cz = sinkCz;
    sink.add(slab(M.steel, sinkCx - w / 2, by, cz - d / 2, sinkCx + w / 2, by + t, cz + d / 2, 0));
    sink.add(slab(M.steel, sinkCx - w / 2, by, cz - d / 2 - t, sinkCx + w / 2, topY, cz - d / 2, 0));
    sink.add(slab(M.steel, sinkCx - w / 2, by, cz + d / 2, sinkCx + w / 2, topY, cz + d / 2 + t, 0));
    sink.add(slab(M.steel, sinkCx - w / 2 - t, by, cz - d / 2, sinkCx - w / 2, topY, cz + d / 2, 0));
    sink.add(slab(M.steel, sinkCx + w / 2, by, cz - d / 2, sinkCx + w / 2 + t, topY, cz + d / 2, 0));
    sink.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.003, 24), M.steel, sinkCx, by + t + 0.001, cz + 0.05));
    sink.add(mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.004, 24), M.dark, sinkCx, by + t + 0.0015, cz + 0.05)); }
  // Brass gooseneck faucet.
  { const fx = sinkCx, fz = 0.085, fy = topY + 0.04;
    sink.add(mesh(new THREE.CylinderGeometry(0.024, 0.027, 0.05, 24), M.brass, fx, fy + 0.025, fz));
    const neck = new THREE.CatmullRomCurve3([new V3(fx, fy + 0.04, fz), new V3(fx, fy + 0.22, fz), new V3(fx, fy + 0.33, fz + 0.04),
      new V3(fx, fy + 0.33, fz + 0.13), new V3(fx, fy + 0.27, fz + 0.2), new V3(fx, fy + 0.24, fz + 0.205)]);
    sink.add(new THREE.Mesh(new THREE.TubeGeometry(neck, 48, 0.0115, 14), M.brass));
    sink.add(mesh(new THREE.CylinderGeometry(0.014, 0.012, 0.025, 16), M.brass, fx, fy + 0.235, fz + 0.205));
    sink.add(rod(new V3(fx + 0.024, fy + 0.03, fz), new V3(fx + 0.075, fy + 0.07, fz + 0.01), 0.006, 0.005, M.brass)); }
  base.add(sink);
  out.base = bake(base);

  // ---------------- wall cabinets (middle one glass-fronted) ----------------
  const wall = new THREE.Group();
  const wx0 = runX0, wx1 = runX0 + 3 * MOD, wy0 = 1.5, wy1 = 2.22, wd = 0.31, t = 0.018;
  wall.add(slab(M.cab, wx0, wy0, 0, wx1, wy0 + t, wd, 0.002), slab(M.cab, wx0, wy1 - t, 0, wx1, wy1, wd, 0.002),
    slab(M.cabInner, wx0, wy0, 0, wx1, wy1, 0.012, 0));
  for (let i = 0; i <= 3; i++) {
    const x = wx0 + i * MOD;
    wall.add(slab(M.cab, Math.max(wx0, x - t / 2), wy0, 0, Math.min(wx1, x + t / 2), wy1, wd, 0.001));
  }
  wall.add(slab(M.cab, wx0 + MOD, (wy0 + wy1) / 2 - 0.009, 0.012, wx0 + 2 * MOD, (wy0 + wy1) / 2 + 0.009, wd - 0.01, 0.001));   // glass-cab shelf
  wall.add(slab(M.cab, wx0 - 0.012, wy1, 0, wx1 + 0.012, wy1 + 0.035, wd + 0.035, 0.006));   // crown
  wall.add(slab(M.cab, wx0, wy0 - 0.03, wd - 0.005, wx1, wy0, wd + 0.02, 0.003));           // light rail hides the LED strip
  for (let i = 0; i < 3; i++) {
    const a = wx0 + i * MOD + gap, b = wx0 + (i + 1) * MOD - gap, h = wy1 - wy0 - 2 * gap;
    const f = shaker(b - a, h, M.cab, i === 1 ? M.glass : null);
    f.position.set((a + b) / 2, (wy0 + wy1) / 2, wd);
    wall.add(f);
    const p = pull(0.12, M.brass, true);
    p.position.set(i === 2 ? a + 0.04 : b - 0.04, wy0 + 0.11, wd + 0.02);
    wall.add(p);
  }
  // Plates and glasses behind the glass door.
  { const cx = wx0 + 1.5 * MOD, sy = (wy0 + wy1) / 2 + 0.009;
    for (let k = 0; k < 4; k++) {
      const pl = mesh(new THREE.CylinderGeometry(0.105, 0.1, 0.012, 32), M.ceramic, cx - 0.12 + k * 0.014, sy + 0.115, 0.08 + k * 0.012);
      pl.rotation.x = Math.PI / 2 - 0.18; pl.rotation.z = 0.02 * k;
      wall.add(pl);
    }
    for (let k = 0; k < 3; k++) {
      wall.add(lathe([[0, 0], [0.032, 0], [0.034, 0.1], [0.031, 0.1], [0.029, 0.006], [0, 0.006]], M.jarGlass, 20).translateX(cx + 0.06 + k * 0.07).translateY(wy0 + t).translateZ(0.17));
      wall.add(lathe([[0, 0], [0.045, 0.002], [0.05, 0.03], [0.046, 0.03], [0, 0.008]], M.ceramic, 24).translateX(cx + 0.09 + k * 0.03).translateY(sy + 0.009 + k * 0.03).translateZ(0.16));
    } }
  out.wall = bake(wall);

  // ---------------- French-door fridge ----------------
  const fr = new THREE.Group();
  const fx0 = runX0 + 5 * MOD + 0.03, fx1 = fx0 + 0.72, fh = 1.84, fdz = 0.66;
  fr.add(slab(M.steelSide, fx0, 0.02, 0, fx1, fh, fdz, 0.012));
  fr.add(slab(M.dark, fx0 + 0.02, 0, 0, fx1 - 0.02, 0.05, fdz + 0.03, 0.002));
  const doorT = 0.05, dz0 = fdz, mid = (fx0 + fx1) / 2;
  fr.add(slab(M.steel, fx0, 0.79, dz0, mid - 0.002, fh - 0.004, dz0 + doorT, 0.014), slab(M.steel, mid + 0.002, 0.79, dz0, fx1, fh - 0.004, dz0 + doorT, 0.014),
    slab(M.steel, fx0, 0.055, dz0, fx1, 0.785, dz0 + doorT, 0.014));
  for (const s of [-1, 1]) {
    const hx = mid + s * 0.035, z = dz0 + doorT;
    fr.add(rod(new V3(hx, 1.02, z + 0.045), new V3(hx, 1.6, z + 0.045), 0.011, 0.011, M.steel, 16));
    for (const y of [1.06, 1.56]) fr.add(rod(new V3(hx, y, z), new V3(hx, y, z + 0.045), 0.007, 0.007, M.steel));
  }
  fr.add(rod(new V3(fx0 + 0.12, 0.72, dz0 + doorT + 0.045), new V3(fx1 - 0.12, 0.72, dz0 + doorT + 0.045), 0.011, 0.011, M.steel, 16));
  for (const x of [fx0 + 0.16, fx1 - 0.16]) fr.add(rod(new V3(x, 0.72, dz0 + doorT), new V3(x, 0.72, dz0 + doorT + 0.045), 0.007, 0.007, M.steel));
  out.fridge = bake(fr);

  // ---------------- pedestal table + Windsor chairs ----------------
  const TX = 2.85, TZ = 2.5;
  out.tableTop = 0.702;
  const table = new THREE.Group();
  table.add(lathe([[0, 0.668], [0.54, 0.668], [0.553, 0.672], [0.56, 0.684], [0.556, 0.697], [0.546, 0.702], [0, 0.702]], M.oak, 72));
  table.add(lathe([[0, 0.012], [0.25, 0.012], [0.262, 0.02], [0.258, 0.04], [0.2, 0.062], [0.1, 0.09], [0.066, 0.15], [0.078, 0.22], [0.056, 0.29],
    [0.05, 0.5], [0.06, 0.57], [0.09, 0.625], [0.17, 0.655], [0.2, 0.668], [0, 0.668]], M.oak, 48));
  table.position.set(TX, 0, TZ);
  out.table = bake(table);

  const chair = () => {
    const c = new THREE.Group(), sy = 0.45;
    c.add(slab(M.oak, -0.21, sy - 0.035, -0.2, 0.21, sy, 0.2, 0.012));
    const legs = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => [new V3(sx * 0.15, sy - 0.03, sz * 0.13), new V3(sx * 0.19, 0, sz * 0.17)]);
    legs.forEach(([a, b]) => c.add(rod(b, a, 0.015, 0.012, M.oak)));
    const at = (l, k) => new V3().lerpVectors(l[1], l[0], k);
    c.add(rod(at(legs[0], 0.35), at(legs[3], 0.35), 0.009, 0.009, M.oak), rod(at(legs[1], 0.35), at(legs[2], 0.35), 0.009, 0.009, M.oak));
    c.add(rod(at(legs[0], 0.35).lerp(at(legs[3], 0.35), 0.5), at(legs[1], 0.35).lerp(at(legs[2], 0.35), 0.5), 0.008, 0.008, M.oak));
    const crest = new THREE.QuadraticBezierCurve3(new V3(-0.2, 0.93, -0.22), new V3(0, 0.95, -0.3), new V3(0.2, 0.93, -0.22));
    c.add(new THREE.Mesh(new THREE.TubeGeometry(crest, 24, 0.018, 10), M.oak));
    for (const s of [-1, 1]) c.add(rod(new V3(s * 0.18, sy - 0.01, -0.17), new V3(s * 0.2, 0.93, -0.22), 0.013, 0.011, M.oak));
    for (let k = 1; k <= 5; k++) {
      const u = k / 6, p = crest.getPoint(u);
      c.add(rod(new V3(-0.18 + 0.36 * u, sy - 0.005, -0.165), p, 0.007, 0.006, M.oak, 8));
    }
    return c;
  };
  out.chairs = [[TX, 3.28, Math.PI], [3.7, TZ, -Math.PI / 2]].map(([x, z, ry]) => {
    const c = chair(); c.position.set(x, 0, z); c.rotation.y = ry;
    return bake(c);
  });

  // ---------------- window: lining, casing, sill, sash, glass, roman shade ----------------
  const { oy0, oy1, oz0, oz1 } = L.opening;
  const win = new THREE.Group(), lt = 0.015;
  win.add(slab(M.trim, -0.12, oy1 - lt, oz0, 0, oy1, oz1, 0), slab(M.trim, -0.12, oy0, oz0, 0, oy0 + lt, oz1, 0),
    slab(M.trim, -0.12, oy0, oz0, 0, oy1, oz0 + lt, 0), slab(M.trim, -0.12, oy0, oz1 - lt, 0, oy1, oz1, 0));
  const cw = 0.065, ct2 = 0.016;
  win.add(slab(M.trim, 0, oy1, oz0 - cw, ct2, oy1 + cw, oz1 + cw, 0.004),
    slab(M.trim, 0, oy0 - 0.02, oz0 - cw, ct2, oy1, oz0, 0.004), slab(M.trim, 0, oy0 - 0.02, oz1, ct2, oy1, oz1 + cw, 0.004));
  win.add(slab(M.trim, -0.02, oy0 - 0.026, oz0 - cw - 0.02, 0.11, oy0 + lt, oz1 + cw + 0.02, 0.006));       // sill / stool (deep enough for herb pots)
  win.add(slab(M.trim, 0, oy0 - 0.09, oz0 - cw + 0.005, 0.013, oy0 - 0.026, oz1 + cw - 0.005, 0.003));     // apron
  const sx0 = -0.075, sx1 = -0.035, fw = 0.045, mw = 0.022;
  const iy0 = oy0 + lt, iy1 = oy1 - lt, iz0 = oz0 + lt, iz1 = oz1 - lt;
  win.add(slab(M.trim, sx0, iy1 - fw, iz0, sx1, iy1, iz1, 0.003), slab(M.trim, sx0, iy0, iz0, sx1, iy0 + fw, iz1, 0.003),
    slab(M.trim, sx0, iy0, iz0, sx1, iy1, iz0 + fw, 0.003), slab(M.trim, sx0, iy0, iz1 - fw, sx1, iy1, iz1, 0.003));
  for (const k of [1, 2]) { const z = iz0 + fw + (iz1 - iz0 - 2 * fw) * k / 3; win.add(slab(M.trim, sx0 + 0.008, iy0, z - mw / 2, sx1 - 0.008, iy1, z + mw / 2, 0.002)); }
  { const y = (iy0 + iy1) / 2; win.add(slab(M.trim, sx0 + 0.008, y - mw / 2, iz0, sx1 - 0.008, y + mw / 2, iz1, 0.002)); }
  win.add(slab(M.paneGlass, -0.056, iy0 + fw, iz0 + fw, -0.054, iy1 - fw, iz1 - fw, 0));
  // Linen roman shade, inside-mounted at the top with two soft folds.
  const shadeY = iy1 - 0.2;
  win.add(slab(M.linen, -0.03, shadeY + 0.03, iz0 + 0.004, -0.018, iy1, iz1 - 0.004, 0.003));
  for (const [y, r] of [[shadeY + 0.035, 0.024], [shadeY + 0.09, 0.02]]) {
    const fold = mesh(new THREE.CylinderGeometry(r, r, iz1 - iz0 - 0.01, 20), M.linen, -0.022, y, (iz0 + iz1) / 2);
    fold.rotation.x = Math.PI / 2; fold.scale.set(0.75, 1, 1);
    win.add(fold);
  }
  out.window = bake(win);

  // ---------------- floating oak shelf (left wall) with cookbooks ----------------
  const shelf = new THREE.Group(), st = L.shelfTop;
  shelf.add(slab(M.oak, 0, st - 0.035, 2.5, 0.29, st, 3.5, 0.005));
  const books = [['#c9a0aa', 0.23, 0.035], ['#9fb3a2', 0.21, 0.03], ['#efe6d8', 0.24, 0.04], ['#8c96a8', 0.2, 0.028]];
  let bz = 2.56;
  books.forEach(([c, h, th], k) => {
    const b = slab(M.book(c), 0.03, st, bz, 0.2, st + h, bz + th, 0.002);
    if (k === 3) { b.rotation.x = -0.18; b.position.z += 0.02; }
    shelf.add(b); bz += th + 0.002;
  });
  shelf.add(lathe([[0, 0], [0.035, 0], [0.045, 0.05], [0.03, 0.12], [0.022, 0.15], [0.026, 0.16], [0, 0.155]], M.vase, 28).translateX(0.12).translateY(st).translateZ(3.36));
  out.shelf = bake(shelf);

  // ---------------- plants ----------------
  out.fig = plantFig(M);
  out.fig.position.set(0.36, 0, 0.4);
  out.snake = plantSnake(M);
  out.snake.position.set(4.74, 0, 0.42);
  return out;
}

// Leaf: a subdivided plane shaped by a width profile, cupped and bent.
function leafGeo(len, wid, profile, cup, bend, segW = 4, segL = 10) {
  const g = new THREE.PlaneGeometry(1, 1, segW, segL);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i) * 2, v = p.getY(i) + 0.5;   // u in [-1, 1] across, v in [0, 1] along
    const w = profile(v) * wid / 2;
    p.setXYZ(i, u * w, v * len, -cup * u * u * w - bend * v * v * len);
  }
  g.computeVertexNormals();
  return g;
}

function plantFig(M) {
  const g = new THREE.Group();
  g.add(lathe([[0, 0], [0.13, 0], [0.15, 0.02], [0.17, 0.28], [0.175, 0.3], [0.16, 0.3], [0.15, 0.06], [0, 0.06]], M.stoneware, 40));
  g.add(mesh(new THREE.CylinderGeometry(0.155, 0.155, 0.01, 32), M.soil, 0, 0.27, 0));
  const trunk = new THREE.CatmullRomCurve3([new V3(0, 0.25, 0), new V3(0.02, 0.6, 0.01), new V3(0.0, 0.95, 0.03), new V3(0.03, 1.32, 0.02)]);
  g.add(new THREE.Mesh(new THREE.TubeGeometry(trunk, 24, 0.016, 8), M.bark));
  const geo = leafGeo(0.24, 0.17, (v) => Math.pow(Math.sin(Math.PI * Math.min(v * 1.05, 1)), 0.6) * (0.75 + 0.4 * v), 0.25, 0.18);
  let s = 3;
  const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let k = 0; k < 30; k++) {
    const t = 0.42 + 0.58 * (k / 29), p = trunk.getPoint(t);
    const az = k * 2.4 + r() * 0.5, size = 0.75 + 0.35 * t + r() * 0.15;
    const l = new THREE.Mesh(geo, M.leaf);
    const reach = 0.03 + (1 - t) * 0.12 + r() * 0.04;   // lower leaves sit further out on short twigs
    l.position.copy(p).add(new V3(Math.sin(az) * reach, -reach * 0.3, Math.cos(az) * reach));
    if (reach > 0.06) g.add(rod(p, l.position, 0.006, 0.004, M.bark, 6));
    l.rotation.set(0.95 + r() * 0.45 - t * 0.4, az, (r() - 0.5) * 0.5, 'YXZ');
    l.scale.setScalar(size);
    g.add(l);
  }
  return bake(g);
}

function plantSnake(M) {
  const g = new THREE.Group();
  g.add(lathe([[0, 0], [0.1, 0], [0.12, 0.02], [0.135, 0.24], [0.14, 0.26], [0.128, 0.26], [0.12, 0.05], [0, 0.05]], M.terracotta, 36));
  g.add(mesh(new THREE.CylinderGeometry(0.125, 0.125, 0.01, 28), M.soil, 0, 0.235, 0));
  let s = 11;
  const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let k = 0; k < 10; k++) {
    const h = 0.42 + r() * 0.38, w = 0.05 + r() * 0.025;
    const blade = new THREE.Mesh(leafGeo(h, w, (v) => (1 - Math.pow(v, 3)) * (0.7 + 0.3 * Math.sin(v * Math.PI)), 0.35, 0.04 + r() * 0.06, 2, 10), M.snakeLeaf);
    const az = (k / 10) * Math.PI * 2 + r() * 0.4;
    blade.position.set(Math.cos(az) * 0.05, 0.23, Math.sin(az) * 0.05);
    blade.rotation.set(-0.08 - r() * 0.2, -az + Math.PI / 2, 0, 'YXZ');
    g.add(blade);
  }
  return bake(g);
}
