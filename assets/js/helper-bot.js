// Cute hovering helper robot for scene3d.js, built in code (no skeleton): an egg
// body, a black-glass face screen with glowing expressions, pink ears, a sensor
// antenna and two little arms. Reactions are procedural and use the same names as
// the old skeletal clips: Idle, Walking, Wave, ThumbsUp, Dance, Jump, Yes.
import * as THREE from 'three';

const DUR = { Wave: 2.0, ThumbsUp: 1.6, Dance: 2.4, Jump: 1.15, Yes: 1.4 };
const FACE = { Idle: 'idle', Walking: 'idle', Wave: 'happy', ThumbsUp: 'wink', Dance: 'heart', Jump: 'happy', Yes: 'happy' };

export function createBot({ accent = '#e8a3bc', eye = '#9af2e2' } = {}) {
  const V2 = THREE.Vector2;
  const shell = new THREE.MeshPhysicalMaterial({ color: '#fbfaf8', roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.12 });
  const pink = new THREE.MeshPhysicalMaterial({ color: accent, roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.2 });
  const joint = new THREE.MeshStandardMaterial({ color: '#d9d6dc', roughness: 0.4, metalness: 0.3 });
  const visor = new THREE.MeshPhysicalMaterial({ color: '#121118', roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.03 });
  const glow = (c, k = 1) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: k, roughness: 0.4 });
  const m = (geo, mat, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); return o; };

  const obj = new THREE.Group();          // root: stays on the floor (path following moves this)
  const float = new THREE.Group();        // hover bob / tilt / spin
  obj.add(float);

  // Egg body with a pink belt and a little heart light.
  float.add(new THREE.Mesh(new THREE.LatheGeometry([[0, 0.085], [0.1, 0.092], [0.165, 0.13], [0.198, 0.21], [0.2, 0.31], [0.182, 0.41],
    [0.135, 0.49], [0.07, 0.528], [0, 0.534]].map(([x, y]) => new V2(x, y)), 48), shell));
  const belt = m(new THREE.TorusGeometry(0.2, 0.011, 12, 64), pink, 0, 0.29, 0);
  belt.rotation.x = Math.PI / 2;
  const heartShape = new THREE.Shape();
  heartShape.moveTo(0, -0.02); heartShape.bezierCurveTo(-0.034, 0.002, -0.018, 0.03, 0, 0.012); heartShape.bezierCurveTo(0.018, 0.03, 0.034, 0.002, 0, -0.02);
  const heartMat = glow('#ff8fb6', 1.2);
  const chest = m(new THREE.ExtrudeGeometry(heartShape, { depth: 0.006, bevelEnabled: false }), heartMat, 0, 0.385, 0.178);
  chest.rotation.x = -0.32;
  float.add(belt, chest);
  // Hover ring underneath.
  const ringMat = glow('#f2b6d0', 1.4);
  const ring = m(new THREE.TorusGeometry(0.085, 0.014, 10, 40), ringMat, 0, 0.085, 0);
  ring.rotation.x = Math.PI / 2;
  float.add(ring);

  // Head: rounded white shell, black glass face, glowing eyes on a canvas.
  const head = new THREE.Group();
  head.position.y = 0.66;
  float.add(m(new THREE.CylinderGeometry(0.045, 0.055, 0.07, 20), joint, 0, 0.55, 0), head);
  const skull = m(new THREE.SphereGeometry(0.19, 48, 32), shell);
  skull.scale.set(1.22, 0.86, 1);
  const face = m(new THREE.SphereGeometry(0.19, 48, 24, Math.PI * 0.14, Math.PI * 0.72, Math.PI * 0.27, Math.PI * 0.46), visor, 0, 0, 0.004);
  face.scale.set(1.235, 0.875, 1.025);   // a hair proud of the shell (no z-fighting at the rim)
  head.add(skull, face);
  const faceCanvas = document.createElement('canvas');
  faceCanvas.width = 256; faceCanvas.height = 128;
  const faceTex = new THREE.CanvasTexture(faceCanvas);
  faceTex.colorSpace = THREE.SRGBColorSpace;
  // Eyes live on a bent plane hugging the screen.
  const eyeGeo = new THREE.PlaneGeometry(0.3, 0.15, 16, 4);
  { const p = eyeGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {   // follow the visor ellipsoid, just in front of it
      const x = p.getX(i), y = p.getY(i) - 0.005, k = 1 - (x / (0.19 * 1.235)) ** 2 - (y / (0.19 * 0.875)) ** 2;
      p.setZ(i, 0.004 + 0.19 * 1.025 * Math.sqrt(Math.max(k, 0.02)) + 0.005);
    } }
  const eyes = new THREE.Mesh(eyeGeo, new THREE.MeshBasicMaterial({ map: faceTex, transparent: true, depthWrite: false, toneMapped: false }));
  eyes.position.y = -0.005;
  head.add(eyes);
  for (const s of [-1, 1]) {
    const ear = m(new THREE.CylinderGeometry(0.055, 0.055, 0.04, 32), pink, s * 0.228, 0, 0);
    ear.rotation.z = Math.PI / 2;
    const cap = m(new THREE.CylinderGeometry(0.03, 0.03, 0.012, 24), joint, s * 0.252, 0, 0);
    cap.rotation.z = Math.PI / 2;
    head.add(ear, cap);
  }
  const antennaMat = glow('#ff9ec4', 1.3);
  head.add(m(new THREE.CylinderGeometry(0.006, 0.008, 0.11, 10), joint, 0, 0.205, 0), m(new THREE.SphereGeometry(0.024, 20, 14), antennaMat, 0, 0.27, 0));

  // Arms: shoulder pivots so they can wave / dance.
  const arms = [-1, 1].map((s) => {
    const pivot = new THREE.Group();
    pivot.position.set(s * 0.198, 0.39, 0);
    pivot.add(m(new THREE.SphereGeometry(0.03, 16, 12), joint));
    pivot.add(m(new THREE.CapsuleGeometry(0.034, 0.09, 8, 16), shell, s * 0.012, -0.075, 0));
    pivot.add(m(new THREE.SphereGeometry(0.042, 20, 14), pink, s * 0.016, -0.16, 0));
    pivot.userData.side = s;
    float.add(pivot);
    return pivot;
  });

  obj.traverse((o) => { if (o.isMesh && !o.material.transparent) { o.castShadow = true; o.receiveShadow = true; } });

  // Soft glow on the floor under the hover ring (not clickable, not in the AO pass).
  const glowTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255, 170, 205, .55)'); gr.addColorStop(1, 'rgba(255, 170, 205, 0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const disc = m(new THREE.PlaneGeometry(0.5, 0.5), new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }), 0, 0.008, 0);
  disc.rotation.x = -Math.PI / 2;
  disc.raycast = () => {};
  obj.add(disc);

  // ---------- face drawing ----------
  let expr = '';
  function drawFace(kind) {
    if (kind === expr) return;
    expr = kind;
    const g = faceCanvas.getContext('2d'), W = 256, H = 128;
    g.clearRect(0, 0, W, H);
    g.shadowColor = eye; g.shadowBlur = 14;
    g.fillStyle = eye; g.strokeStyle = eye; g.lineCap = 'round'; g.lineWidth = 13;
    const eyeAt = [[82, 60], [174, 60]];
    eyeAt.forEach(([x, y], i) => {
      const k = kind === 'wink' && i === 1 ? 'happy' : kind === 'wink' ? 'idle' : kind;
      g.beginPath();
      if (k === 'idle') { g.ellipse(x, y, 20, 27, 0, 0, Math.PI * 2); g.fill(); g.fillStyle = 'rgba(255,255,255,.85)'; g.shadowBlur = 0; g.beginPath(); g.arc(x + 6, y - 9, 5, 0, 7); g.fill(); g.fillStyle = eye; g.shadowBlur = 14; }
      else if (k === 'blink') { g.moveTo(x - 17, y + 4); g.lineTo(x + 17, y + 4); g.stroke(); }
      else if (k === 'happy') { g.arc(x, y + 12, 19, Math.PI * 1.15, Math.PI * 1.85); g.stroke(); }
      else if (k === 'heart') {
        g.fillStyle = '#ff8fb6'; g.shadowColor = '#ff8fb6';
        g.moveTo(x, y + 20); g.bezierCurveTo(x - 30, y, x - 16, y - 26, x, y - 10); g.bezierCurveTo(x + 16, y - 26, x + 30, y, x, y + 20); g.fill();
        g.fillStyle = eye; g.shadowColor = eye;
      }
    });
    if (kind !== 'heart') { g.lineWidth = 7; g.beginPath(); g.arc(128, 84, 12, Math.PI * 0.15, Math.PI * 0.85); g.stroke(); }   // little smile
    g.shadowBlur = 8; g.fillStyle = 'rgba(255, 150, 190, .55)'; g.shadowColor = 'rgba(255, 150, 190, .8)';   // blush
    g.beginPath(); g.ellipse(46, 92, 15, 7, 0, 0, 7); g.fill();
    g.beginPath(); g.ellipse(210, 92, 15, 7, 0, 0, 7); g.fill();
    faceTex.needsUpdate = true;
  }
  drawFace('idle');

  // ---------- animation ----------
  const st = { name: 'Idle', t: 0, once: false };
  let time = 0, look = 0, blinkIn = 2.5, moving = 0;
  const api = { obj, onFinish: null };
  api.play = (name, once) => {
    if (name === st.name && !once) return;
    st.name = DUR[name] || name === 'Walking' ? name : 'Idle';
    st.t = 0; st.once = !!once;
  };
  api.setLook = (yaw) => { look = yaw; };
  const ease = (x) => x * x * (3 - 2 * x);
  const env = (t, d, a = 0.25) => Math.max(0, Math.min(1, t / a, (d - t) / a));
  api.update = (dt) => {
    time += dt; st.t += dt;
    const dur = DUR[st.name];
    if (dur && st.t >= dur) {
      const done = st.name;
      st.name = 'Idle'; st.t = 0;
      if (api.onFinish) api.onFinish(done);
    }
    const n = st.name, t = st.t;
    moving += ((n === 'Walking' ? 1 : 0) - moving) * Math.min(1, dt * 6);
    // base hover
    let y = 0.035 + Math.sin(time * 2.1) * 0.014 * (1 - moving) + Math.abs(Math.sin(time * 7)) * 0.02 * moving;
    let tiltX = 0.16 * moving, spin = 0, sq = 1;
    let armZ = [0.18, 0.18], armX = [Math.sin(time * 7) * 0.45 * moving, -Math.sin(time * 7) * 0.45 * moving];
    let nod = 0;
    if (n === 'Wave') { const e = env(t, dur); armZ[1] = 0.18 + e * (2.45 + Math.sin(t * 13) * 0.32); }
    else if (n === 'ThumbsUp') { const e = env(t, dur); armX[1] = -2.0 * e + Math.sin(t * 9) * 0.12 * e; armZ[1] = 0.18 + 0.25 * e; }
    else if (n === 'Dance') { const e = env(t, dur); spin = Math.PI * 2 * ease(t / dur); armZ = [0.18 + e * (1.2 + Math.sin(t * 10) * 0.6), 0.18 + e * (1.2 - Math.sin(t * 10) * 0.6)]; y += Math.abs(Math.sin(t * 10)) * 0.04 * e; }
    else if (n === 'Jump') {
      const p = t / dur;
      if (p < 0.18) sq = 1 - 0.12 * Math.sin(p / 0.18 * Math.PI);
      else if (p < 0.82) { const q = (p - 0.18) / 0.64; y += 0.32 * Math.sin(q * Math.PI); armZ = [0.18 + 1.6 * Math.sin(q * Math.PI), 0.18 + 1.6 * Math.sin(q * Math.PI)]; }
      else sq = 1 - 0.1 * Math.sin((p - 0.82) / 0.18 * Math.PI);
    }
    else if (n === 'Yes') { nod = Math.sin(t * 9) * 0.28 * env(t, dur); }
    float.position.y = y;
    float.rotation.set(tiltX, spin, 0);
    float.scale.set(1 + (1 - sq) * 0.5, sq, 1 + (1 - sq) * 0.5);
    arms.forEach((a, i) => {
      a.rotation.z += (a.userData.side * armZ[i] - a.rotation.z) * Math.min(1, dt * 12);
      a.rotation.x += (armX[i] - a.rotation.x) * Math.min(1, dt * 12);
    });
    head.rotation.y += (look - head.rotation.y) * Math.min(1, dt * 6);
    head.rotation.x = nod + Math.sin(time * 1.3) * 0.03;
    // face + lights
    blinkIn -= dt;
    let kind = FACE[n] || 'idle';
    if (kind === 'idle' && blinkIn < 0) { kind = 'blink'; if (blinkIn < -0.13) blinkIn = 2.2 + Math.random() * 3; }
    drawFace(kind);
    const pulse = 0.9 + 0.45 * Math.sin(time * 3);
    heartMat.emissiveIntensity = pulse;
    antennaMat.emissiveIntensity = 0.9 + 0.6 * Math.sin(time * 5);
    ringMat.emissiveIntensity = 1.1 + 0.3 * Math.sin(time * 4);
  };
  return api;
}
