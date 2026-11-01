// Interactive 3D kitchen for the research-vision section.
// Dana (wearing AR glasses) cooks while a helper robot assists; the scene
// follows the Sense -> Reason -> Act steps driven by main.js through the
// `.scene` element's data-step attribute and `off-<layer>` classes.
import * as THREE from 'three';
import { GLTFLoader } from './vendor/three/loaders/GLTFLoader.js';
import { RoomEnvironment } from './vendor/three/environments/RoomEnvironment.js';
import { mergeVertices } from './vendor/three/utils/BufferGeometryUtils.js';

const PACK = 0.556;             // Quaternius interior pack units -> meters
const ROOM = { w: 5, d: 4, h: 2.6 };
const GAZE = new THREE.Color('#e0607e');
const AUDIO = new THREE.Color('#e39a2d');
const LIDAR = new THREE.Color('#2fa58a');

export async function initScene(root) {
  // Follow the page's accent color (CSS --accent) so the scene matches the theme.
  const cssAccent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  const ACCENT = new THREE.Color(cssAccent || '#3a56c5');
  const robotTrim = '#' + ACCENT.clone().offsetHSL(0, -0.1, -0.08).getHexString();
  const host = root.querySelector('.scene-3d');
  const base = root.getAttribute('data-models');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;

  // Lights: soft sky fill plus warm sunlight through the window on the left wall.
  scene.add(new THREE.HemisphereLight('#fff8ef', '#b9a993', 1.1));
  const sun = new THREE.DirectionalLight('#fff1dc', 2.6);
  sun.position.set(-3.5, 5.5, 3.2);
  sun.target.position.set(2.4, 0, 2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -5; sun.shadow.camera.right = 5;
  sun.shadow.camera.top = 5; sun.shadow.camera.bottom = -5;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight('#dfe8ff', 0.5);
  fill.position.set(6, 4, 7);
  scene.add(fill);

  // ---------- camera: orthographic diorama view, drag to orbit ----------
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 60);
  const target = new THREE.Vector3(2.4, 0.9, 1.95);
  const view = { az: THREE.MathUtils.degToRad(42), el: THREE.MathUtils.degToRad(31), zoom: 1 };
  const goal = { az: view.az, el: view.el };
  function placeCamera() {
    const r = 20;
    camera.position.set(
      target.x + Math.sin(view.az) * Math.cos(view.el) * r,
      target.y + Math.sin(view.el) * r,
      target.z + Math.cos(view.az) * Math.cos(view.el) * r);
    camera.lookAt(target);
  }
  function resize() {
    const w = host.clientWidth, h = host.clientHeight;
    renderer.setSize(w, h, false);
    const half = 2.75, aspect = w / h;
    camera.left = -half * aspect; camera.right = half * aspect;
    camera.top = half; camera.bottom = -half;
    camera.zoom = view.zoom;
    camera.updateProjectionMatrix();
  }

  // ---------- procedural textures ----------
  function canvasTex(w, h, draw, repeat) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
    return t;
  }
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

  const woodTex = canvasTex(1024, 1024, (g, w, h) => {
    const rows = 12, rh = h / rows;
    for (let r = 0; r < rows; r++) {
      let x = -rand() * 300;
      while (x < w) {
        const len = 260 + rand() * 260;
        const l = 62 + rand() * 10, hue = 30 + rand() * 6;
        g.fillStyle = `hsl(${hue}, 38%, ${l}%)`;
        g.fillRect(x, r * rh, len, rh);
        g.strokeStyle = 'rgba(90, 60, 35, .12)';
        g.lineWidth = 1;
        for (let k = 0; k < 7; k++) {
          const y = r * rh + rand() * rh;
          g.beginPath(); g.moveTo(x, y);
          g.bezierCurveTo(x + len * .3, y + rand() * 6 - 3, x + len * .7, y + rand() * 6 - 3, x + len, y);
          g.stroke();
        }
        g.fillStyle = 'rgba(70, 45, 25, .35)';
        g.fillRect(x, r * rh, 2, rh);
        x += len;
      }
      g.fillStyle = 'rgba(70, 45, 25, .3)';
      g.fillRect(0, r * rh, w, 2);
    }
  }, [2.2, 1.8]);

  const tileTex = canvasTex(512, 256, (g, w, h) => {
    g.fillStyle = '#d8d2c8'; g.fillRect(0, 0, w, h);
    const tw = 64, th = 32;
    for (let r = 0; r < h / th; r++) {
      for (let c = -1; c < w / tw + 1; c++) {
        const x = c * tw + (r % 2 ? tw / 2 : 0);
        const l = 95 + rand() * 3;
        g.fillStyle = `hsl(40, 20%, ${l}%)`;
        g.fillRect(x + 2, r * th + 2, tw - 4, th - 4);
      }
    }
  }, [4, 1.2]);

  const cerealTex = canvasTex(256, 384, (g, w, h) => {
    g.fillStyle = '#f2b134'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#e4572e'; g.fillRect(0, 0, w, 96);
    g.fillStyle = '#fff'; g.font = 'bold 54px sans-serif'; g.textAlign = 'center';
    g.fillText('OATS', w / 2, 70);
    g.fillStyle = '#7a4b1d';
    for (let i = 0; i < 40; i++) { g.beginPath(); g.arc(40 + rand() * 176, 150 + rand() * 200, 9 + rand() * 6, 0, 7); g.fill(); }
  });

  // ---------- room shell ----------
  const std = (color, rough = 0.85, metal = 0) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
  const floorMat = new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.6 });
  const slabSide = std('#8b6b4e', 0.9);
  const wallMat = std('#f2eee8', 0.95);
  const wallEdge = std('#e2dcd2', 0.95);

  const floor = new THREE.Mesh(new THREE.BoxGeometry(ROOM.w, 0.14, ROOM.d), [slabSide, slabSide, floorMat, slabSide, slabSide, slabSide]);
  floor.position.set(ROOM.w / 2, -0.07, ROOM.d / 2);
  floor.receiveShadow = true;
  scene.add(floor);

  const backWall = new THREE.Mesh(new THREE.BoxGeometry(ROOM.w + 0.12, ROOM.h, 0.12), [wallEdge, wallEdge, wallEdge, wallEdge, wallMat, wallEdge]);
  backWall.position.set(ROOM.w / 2 - 0.06, ROOM.h / 2 - 0.14, -0.06);
  const leftWall = new THREE.Mesh(new THREE.BoxGeometry(0.12, ROOM.h, ROOM.d), [wallMat, wallEdge, wallEdge, wallEdge, wallEdge, wallEdge]);
  leftWall.position.set(-0.06, ROOM.h / 2 - 0.14, ROOM.d / 2);
  for (const w of [backWall, leftWall]) { w.receiveShadow = true; scene.add(w); }

  const baseMat = std('#ffffff', 0.7);
  const bb1 = new THREE.Mesh(new THREE.BoxGeometry(ROOM.w, 0.08, 0.02), baseMat);
  bb1.position.set(ROOM.w / 2, 0.04, 0.01);
  const bb2 = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.08, ROOM.d), baseMat);
  bb2.position.set(0.01, 0.04, ROOM.d / 2);
  scene.add(bb1, bb2);

  // ---------- models ----------
  const loader = new GLTFLoader();
  const cache = {};
  const load = (name) => (cache[name] = cache[name] || loader.loadAsync(base + name + '.glb'));

  const RECOLOR = {
    Kitchen: ['#7d9886', 0.6, 0], KitchenTop: ['#ece6dc', 0.3, 0], White: null,
    DarkMetal: ['#3b3d42', 0.35, 0.8], LightMetal: ['#c9ccd1', 0.25, 0.9],
    Wood: ['#a0714a', 0.6, 0], Wood_Dark: ['#6e4a30', 0.6, 0],
    DarkRed: ['#c99a82', 0.95, 0], LightOrange: ['#efe2cf', 0.95, 0],
    Plant_Green: ['#5f9a4e', 0.8, 0], DarkGreen: ['#3f7a45', 0.8, 0], Black: ['#2e2e33', 0.6, 0],
    Hair_Brown: ['#3a2a22', 0.7, 0], Orange: ['#4e6385', 0.85, 0], Grey: ['#e9e6e1', 0.7, 0],
  };
  function dress(obj, overrides = {}) {
    obj.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => {
        const spec = overrides[m.name] !== undefined ? overrides[m.name] : RECOLOR[m.name];
        if (!spec) return;
        m.color.set(spec[0]); m.roughness = spec[1]; m.metalness = spec[2];
      });
    });
  }

  // Place a model: uniform scale, Y rotation, then align its bounding box.
  async function place(name, o) {
    const gltf = await load(name);
    const obj = o.clone ? gltf.scene.clone(true) : gltf.scene;
    obj.scale.multiplyScalar(o.s || PACK);
    if (o.sy) obj.scale.y *= o.sy;
    if (o.sz) obj.scale.z *= o.sz;
    obj.rotation.y = o.rot || 0;
    obj.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(obj);
    if (o.minX !== undefined) obj.position.x += o.minX - b.min.x;
    if (o.cx !== undefined) obj.position.x += o.cx - (b.min.x + b.max.x) / 2;
    if (o.minZ !== undefined) obj.position.z += o.minZ - b.min.z;
    if (o.cz !== undefined) obj.position.z += o.cz - (b.min.z + b.max.z) / 2;
    obj.position.y += (o.y || 0) - b.min.y;
    dress(obj, o.colors);
    scene.add(obj);
    return { obj, gltf };
  }

  const MOD = 1.01 * PACK;   // width of one kitchen module
  const run = ['Kitchen_2Drawers', 'Kitchen_Sink', 'Kitchen_3Drawers', 'Kitchen_Oven', 'Kitchen_1Drawers'];
  const runX0 = 0.75;
  const tasks = run.map((n, i) => place(n, { minX: runX0 + i * MOD, minZ: 0 }));
  tasks.push(place('Kitchen_Fridge', { minX: runX0 + run.length * MOD + 0.03, minZ: 0, colors: { White: ['#e4e7ea', 0.3, 0.35] } }));
  for (let i = 0; i < 3; i++) {
    tasks.push(place(i === 1 ? 'Kitchen_Cabinet2' : 'Kitchen_Cabinet1', { clone: true, minX: runX0 + i * MOD, minZ: 0, y: 1.5, s: PACK * 0.82, sz: 0.62 }));
  }
  tasks.push(place('Window_Large1', { rot: Math.PI / 2, minX: 0, cz: 1.55, y: 1.0, s: PACK * 1.15, colors: { White: ['#fbfaf7', 0.6, 0] } }));
  tasks.push(place('Shelf_Small1', { rot: Math.PI / 2, minX: 0, cz: 3.0, y: 1.12, colors: { White: ['#d9bf9b', 0.7, 0] } }));
  tasks.push(place('Houseplant_1', { minX: 0.08, minZ: 0.12, s: PACK * 2.1 }));
  tasks.push(place('Houseplant_3', { cx: 4.75, cz: 0.45, s: PACK * 1.9 }));
  tasks.push(place('Carpet_Round', { cx: 2.85, cz: 2.5, s: PACK * 1.7, y: 0.001 }));
  tasks.push(place('Table_RoundSmall', { cx: 2.85, cz: 2.5, s: PACK * 1.1 }));
  tasks.push(place('Chair_1', { clone: true, rot: Math.PI, cx: 2.85, cz: 3.28 }));
  tasks.push(place('Chair_1', { clone: true, rot: -Math.PI / 2, cx: 3.7, cz: 2.5 }));
  tasks.push(place('Plate_1', { cx: 2.7, cz: 2.45, y: 0.71, s: PACK * 1.2 }));

  // Dana (her own model, front faces +z) and the helper robot (animated).
  const danaP = place('Dana', { cx: 2.05, cz: 1.25, rot: 1.8, s: 1.3 / 2.7 });
  const robotP = place('RobotExpressive', { cx: 4.4, cz: 3.45, rot: -1.15, s: 1.0 / 4.79,
    colors: { Main: ['#f3f3f1', 0.35, 0.1], Grey: [robotTrim, 0.4, 0.3], Black: ['#1b1d24', 0.2, 0.3] } });

  // ---------- props built in code ----------
  const ovenTop = 0.9;
  const ovenCx = runX0 + 3.5 * MOD;
  const steel = new THREE.MeshStandardMaterial({ color: '#d7dadf', metalness: 0.95, roughness: 0.22 });

  const kettle = new THREE.Group();
  const kprof = [[0, 0], [0.085, 0], [0.095, 0.03], [0.09, 0.11], [0.06, 0.16], [0.02, 0.175], [0, 0.18]].map(([x, y]) => new THREE.Vector2(x, y));
  kettle.add(new THREE.Mesh(new THREE.LatheGeometry(kprof, 40), steel));
  const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.02, 0.12, 16), steel);
  spout.position.set(0.1, 0.1, 0); spout.rotation.z = -0.9;
  kettle.add(spout);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.01, 12, 30, Math.PI), std('#2e2e33', 0.5));
  handle.position.set(0, 0.17, 0);
  kettle.add(handle);
  kettle.position.set(ovenCx - 0.13, ovenTop + 0.005, 0.24);
  kettle.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  scene.add(kettle);

  const pot = new THREE.Group();
  const enamel = new THREE.MeshStandardMaterial({ color: '#c8553d', roughness: 0.35, metalness: 0.1 });
  const potBody = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.1, 0.12, 40), enamel);
  potBody.position.y = 0.06;
  const lid = new THREE.Mesh(new THREE.SphereGeometry(0.112, 40, 12, 0, Math.PI * 2, 0, 0.5), steel);
  lid.position.y = 0.1;
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.015, 16, 12), std('#2e2e33', 0.5));
  knob.position.y = 0.17;
  pot.add(potBody, lid, knob);
  pot.position.set(ovenCx + 0.13, ovenTop + 0.005, 0.42);
  pot.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  scene.add(pot);

  // Medicine bottle hidden behind a cereal box on the wall shelf.
  const shelfTop = 1.12 + 0.58 * PACK;
  const bottle = new THREE.Group();
  const amber = new THREE.MeshPhysicalMaterial({ color: '#b5651d', roughness: 0.15, transmission: 0.35, thickness: 0.02, transparent: true, opacity: 0.92 });
  const bBody = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.11, 24), amber);
  bBody.position.y = 0.055;
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.037, 0.037, 0.03, 24), std('#ffffff', 0.4));
  cap.position.y = 0.125;
  const labelBand = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.05, 24, 1, true), std('#f7f4ee', 0.6));
  labelBand.position.y = 0.055;
  bottle.add(bBody, cap, labelBand);
  const bottleHome = new THREE.Vector3(0.1, shelfTop, 3.0);
  bottle.position.copy(bottleHome);
  bottle.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  scene.add(bottle);
  const cereal = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.3, 0.21),
    [std('#e0a32e'), std('#e0a32e'), std('#e4572e'), std('#e0a32e'), new THREE.MeshStandardMaterial({ map: cerealTex, roughness: 0.7 }), std('#e0a32e')]);
  cereal.rotation.y = Math.PI / 2;
  cereal.position.set(0.22, shelfTop + 0.15, 3.02);
  cereal.castShadow = true;
  scene.add(cereal);

  // Backsplash tiles between counter and wall cabinets.
  const splash = new THREE.Mesh(new THREE.PlaneGeometry(run.length * MOD, 0.6), new THREE.MeshStandardMaterial({ map: tileTex, roughness: 0.4 }));
  splash.position.set(runX0 + run.length * MOD / 2, 1.2, 0.003);
  splash.receiveShadow = true;
  scene.add(splash);

  // ---------- wait for models, then finish the characters ----------
  const [danaR, robotR] = await Promise.all([danaP, robotP, ...tasks]);

  // The model ships without normals: weld vertices and smooth-shade it.
  const dana = danaR.obj;
  const eyeBox = new THREE.Box3();
  dana.updateMatrixWorld(true);
  dana.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry = mergeVertices(o.geometry);
    o.geometry.computeVertexNormals();
    o.material.flatShading = false;
    o.material.metalness = 0;      // glTF defaults to fully metallic when unspecified
    o.material.roughness = 0.7;
    o.material.needsUpdate = true;
    if (/^eyeWhite/.test(o.name)) eyeBox.expandByObject(o);
  });
  // Colours: dark-chocolate hair, a slightly deeper pink dress.
  const HAIR = '#4a2b1f', DRESS = '#ec8fae';
  dana.traverse((o) => {
    if (!o.isMesh) return;
    if (/^(backhair|haircap|bang\d)/.test(o.name)) o.material.color.set(HAIR);
    if (/^(skirt|torso|arm)/.test(o.name)) o.material.color.set(DRESS);
    if (/^(pigtail|bang\d)/.test(o.name)) o.visible = false;   // replaced by braids / parted bangs below
  });

  // Two braids hanging down from her pink hair ties (built in the model's own units).
  const hairMat = new THREE.MeshStandardMaterial({ color: HAIR, roughness: 0.6 });
  const tieMat = new THREE.MeshStandardMaterial({ color: '#f79ab8', roughness: 0.5 });
  const danaModel = dana.children[0] || dana;
  for (const side of [-1, 1]) {
    const braid = new THREE.Group();
    const lobes = 7;
    for (let i = 0; i < lobes; i++) {
      const t = i / (lobes - 1);
      const r = 0.115 - t * 0.03;
      const lobe = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), hairMat);
      lobe.scale.set(1, 1.3, 0.85);
      lobe.position.set(side * (0.62 + t * 0.1) + (i % 2 ? 0.035 : -0.035), 2.2 - i * 0.15, -0.1 + t * 0.04);
      lobe.rotation.z = (i % 2 ? 0.38 : -0.38);
      lobe.castShadow = true;
      braid.add(lobe);
    }
    const endY = 2.2 - (lobes - 1) * 0.15;
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.025, 10, 24), tieMat);
    band.rotation.x = Math.PI / 2;
    band.position.set(side * 0.72, endY - 0.1, -0.06);
    const tuft = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.2, 16), hairMat);
    tuft.rotation.x = Math.PI;
    tuft.position.set(side * 0.72, endY - 0.22, -0.06);
    braid.add(band, tuft);
    danaModel.add(braid);
  }

  // Centre-parted, side-swept bangs: two shells hugging the head ellipsoid, lifted
  // at the part and sweeping down to the temples.
  const headC = new THREE.Vector3(0, 2.06, 0.08), headR = new THREE.Vector3(0.55, 0.58, 0.47);
  for (const side of [-1, 1]) {
    const nu = 28, nv = 16, pos = [], idx = [];
    for (let i = 0; i <= nu; i++) {
      const u = i / nu, th = side * (0.03 + u * 1.42);
      // Polar angle of the lower edge, with a few soft strand tips along it.
      const edge = 0.64 + 0.8 * (1 - (1 - u) ** 2) + 0.07 * Math.abs(Math.sin(u * Math.PI * 3.2)) * Math.min(u * 4, 1);
      const puff = 0.015 + 0.075 * Math.sin(Math.min(u * 3, 1) * Math.PI / 2);
      for (let j = 0; j <= nv; j++) {
        const v = j / nv, ph = 0.1 + v * (edge - 0.1);
        const k = 1.03 + puff * (1 - 0.7 * v * v);
        pos.push(headC.x + headR.x * k * Math.sin(ph) * Math.sin(th),
          headC.y + headR.y * k * Math.cos(ph),
          headC.z + headR.z * k * Math.sin(ph) * Math.cos(th));
      }
    }
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
      const a = i * (nv + 1) + j, b = a + nv + 1;
      if (side > 0) idx.push(a, a + 1, b, b, a + 1, b + 1);
      else idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const bangs = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: HAIR, roughness: 0.6, side: THREE.DoubleSide }));
    bangs.castShadow = true;
    danaModel.add(bangs);
  }
  dana.updateMatrixWorld(true);

  const eye = eyeBox.getCenter(new THREE.Vector3())
    .add(new THREE.Vector3(Math.sin(dana.rotation.y), 0, Math.cos(dana.rotation.y)).multiplyScalar(0.03));

  // Robot animation.
  const robot = robotR.obj;
  const mixer = new THREE.AnimationMixer(robot);
  const clips = {};
  robotR.gltf.animations.forEach((c) => { clips[c.name] = mixer.clipAction(c); });
  clips.Idle.timeScale = 0;   // hold a still pose while idling (no head bobbing)
  let current = clips.Idle;
  current.play();
  function playClip(name, once) {
    const next = clips[name];
    if (!next || next === current) return;
    next.reset();
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    next.clampWhenFinished = !!once;
    next.play();
    current.crossFadeTo(next, 0.35, false);
    current = next;
  }
  const robotHome = robot.position.clone();
  const robotHomeRot = robot.rotation.y;
  const route = [robotHome.clone(), new THREE.Vector3(4.0, 0, 3.78), new THREE.Vector3(1.5, 0, 3.78), new THREE.Vector3(0.62, 0, 3.05)]
    .map((p) => p.setY(robotHome.y));

  // ---------- sensor layers ----------
  const layers = {};
  function layer(name) {
    const g = new THREE.Group();
    g.userData.opacity = 1;
    g.userData.target = 1;
    layers[name] = g;
    scene.add(g);
    return g;
  }
  const fade = (m, base) => { m.transparent = true; m.depthWrite = false; m.userData.base = base; m.opacity = base; return m; };

  // Egocentric camera frustum from the AR glasses toward the stove.
  const camL = layer('cam');
  const look = new THREE.Vector3(ovenCx, ovenTop + 0.1, 0.3).sub(eye).normalize();
  const right = new THREE.Vector3().crossVectors(look, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, look).normalize();
  const far = 1.25, hw = 0.62, hh = 0.42;
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) =>
    eye.clone().addScaledVector(look, far).addScaledVector(right, a * hw).addScaledVector(up, b * hh));
  const fr = [];
  for (let i = 0; i < 4; i++) fr.push(eye, corners[i], corners[(i + 1) % 4]);
  const frGeo = new THREE.BufferGeometry().setFromPoints(fr);
  frGeo.computeVertexNormals();
  camL.add(new THREE.Mesh(frGeo, fade(new THREE.MeshBasicMaterial({ color: ACCENT, side: THREE.DoubleSide }), 0.1)));
  const edges = [];
  corners.forEach((c, i) => { edges.push(eye, c, c, corners[(i + 1) % 4]); });
  camL.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(edges), fade(new THREE.LineBasicMaterial({ color: ACCENT }), 0.7)));

  // Gaze: dashed scanpath kettle -> pot with fixation rings.
  const gazeL = layer('gaze');
  const kettleTop = kettle.position.clone().add(new THREE.Vector3(0, 0.19, 0));
  const potTop = pot.position.clone().add(new THREE.Vector3(0, 0.18, 0));
  const gazeLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([kettleTop, eye, potTop]),
    fade(new THREE.LineDashedMaterial({ color: GAZE, dashSize: 0.04, gapSize: 0.03 }), 0.95));
  gazeLine.computeLineDistances();
  gazeL.add(gazeLine);
  const ringMat = fade(new THREE.MeshBasicMaterial({ color: GAZE, side: THREE.DoubleSide }), 0.85);
  const fixA = new THREE.Mesh(new THREE.RingGeometry(0.05, 0.065, 40), ringMat);
  fixA.rotation.x = -Math.PI / 2; fixA.position.copy(kettleTop);
  const fixB = new THREE.Mesh(new THREE.RingGeometry(0.09, 0.11, 40), ringMat.clone());
  fixB.material.userData.base = 0.9;
  fixB.rotation.x = -Math.PI / 2; fixB.position.copy(potTop);
  gazeL.add(fixA, fixB);

  // Audio: ripples expanding from the boiling kettle (billboards).
  const audioL = layer('audio');
  const ripples = [0, 1, 2].map((i) => {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.115, 48), fade(new THREE.MeshBasicMaterial({ color: AUDIO, side: THREE.DoubleSide }), 0.9));
    m.position.copy(kettle.position).add(new THREE.Vector3(0, 0.12, 0));
    m.userData.phase = i / 3;
    audioL.add(m);
    return m;
  });

  // Steam puffs (always on, part of the world).
  const steamTex = canvasTex(64, 64, (g) => {
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  });
  const steam = [...Array(10)].map((_, i) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: steamTex, transparent: true, depthWrite: false, opacity: 0 }));
    s.userData.phase = i / 10;
    scene.add(s);
    return s;
  });
  const spoutTip = kettle.position.clone().add(new THREE.Vector3(0.15, 0.16, 0));

  // LiDAR: real ray casts from the robot's sensor against the room geometry.
  const lidarL = layer('lidar');
  const skip = new Set();
  for (const g of [dana, robot]) g.traverse((o) => skip.add(o));
  const solids = [];
  scene.traverse((o) => { if (o.isMesh && !skip.has(o) && !o.parent?.userData?.opacity) solids.push(o); });
  const sensor = robotHome.clone().add(new THREE.Vector3(0, 0.85, 0));
  const ray = new THREE.Raycaster();
  const pos = [], ang = [];
  for (let a = 0; a < 220; a++) {
    const az = (a / 220) * Math.PI * 2;
    for (let e = 0; e < 26; e++) {
      const el = THREE.MathUtils.degToRad(-55 + e * 3.4);
      const dir = new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az));
      ray.set(sensor, dir);
      const hit = ray.intersectObjects(solids, false)[0];
      if (hit && hit.distance < 6.5) { pos.push(hit.point.x, hit.point.y + 0.004, hit.point.z); ang.push(az); }
    }
  }
  const lidarGeo = new THREE.BufferGeometry();
  lidarGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  lidarGeo.setAttribute('ang', new THREE.Float32BufferAttribute(ang, 1));
  const lidarMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uTime: { value: 0 }, uColor: { value: LIDAR }, uOpacity: { value: 1 }, uSize: { value: 3.2 * renderer.getPixelRatio() } },
    vertexShader: `attribute float ang; uniform float uTime; uniform float uSize; varying float vA;
      void main(){ float sweep = mod(uTime * 2.2, 6.2831853); float d = mod(sweep - ang + 6.2831853, 6.2831853);
        vA = 0.18 + 0.82 * exp(-d * 1.6); gl_PointSize = uSize * (0.8 + vA * 0.6);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 uColor; uniform float uOpacity; varying float vA;
      void main(){ vec2 c = gl_PointCoord - 0.5; if (dot(c, c) > 0.25) discard; gl_FragColor = vec4(uColor, vA * uOpacity); }`,
  });
  lidarMat.userData.base = 1;
  lidarL.add(new THREE.Points(lidarGeo, lidarMat));

  // Reason/act highlight rings.
  const reasonL = layer('reason');
  const qRing = new THREE.Mesh(new THREE.RingGeometry(0.12, 0.14, 40), fade(new THREE.MeshBasicMaterial({ color: '#c4483f', side: THREE.DoubleSide }), 0.9));
  qRing.rotation.y = Math.PI / 2; qRing.position.copy(bottleHome).add(new THREE.Vector3(0.25, 0.08, 0));
  reasonL.add(qRing);
  const actL = layer('act');
  const okRing = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.12, 40), fade(new THREE.MeshBasicMaterial({ color: '#1f8a6a', side: THREE.DoubleSide }), 0.9));
  okRing.rotation.x = -Math.PI / 2;
  actL.add(okRing);
  const pathPts = route.map((p) => p.clone().setY(0.01));
  const pathLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pathPts), fade(new THREE.LineDashedMaterial({ color: ACCENT, dashSize: 0.08, gapSize: 0.06 }), 0.9));
  pathLine.computeLineDistances();
  actL.add(pathLine);

  // ---------- HTML labels anchored to 3D points ----------
  const labelBox = root.querySelector('.scene-labels');
  const labels = [];
  function label(layerName, html, anchor, cls = '', dx = 0, dy = 0) {
    const el = document.createElement('div');
    el.className = 'scene3d-label ' + cls;
    el.setAttribute('data-layer', layerName);
    el.innerHTML = html;
    labelBox.appendChild(el);
    labels.push({ el, anchor, dx, dy, below: cls.includes('is-below') });
    return el;
  }
  label('cam', '📷 egocentric camera', corners[3], 'is-soft', 0, -10);
  label('cam', '🕶️ AR glasses', eye, 'is-soft', -60, -6);
  label('gaze', '👁️ gaze', potTop, 'is-soft', 30, 10);
  label('audio', '🎧 boiling sound', kettleTop.clone().add(new THREE.Vector3(0, 0.15, 0)), 'is-soft', -20, -14);
  label('lidar', '🛰️ LiDAR scan', sensor.clone().add(new THREE.Vector3(0, 0.45, 0)), 'is-soft', 0, -6);
  label('reason', 'kettle is boiling<span>→ she may not notice</span>', kettleTop.clone().add(new THREE.Vector3(0, 0.3, 0)), '', -95, -58);
  label('reason', 'she keeps looking at the pot<span>→ about to pour the water</span>', potTop.clone().add(new THREE.Vector3(0, 0.25, 0)), '', 45, -40);
  label('reason', '❓ the bottle is hidden<span>→ not enough evidence</span>', bottleHome.clone().add(new THREE.Vector3(0.1, -0.12, 0)), 'is-warn is-below', 0, 0);
  label('act', '🔔 “Your kettle is boiling!”<span>proactive AR alert</span>', eye.clone().add(new THREE.Vector3(0, 0.35, 0)), 'is-alert', 0, -10);
  label('act', 'moved for a clearer view<span>✋ touch confirms the right bottle ✓</span>', bottleHome.clone().add(new THREE.Vector3(0.1, -0.12, 0)), 'is-ok is-below', 0, 0);

  // ---------- step state from the DOM ----------
  let step = root.getAttribute('data-step') || 'sense';
  let walk = null;
  function syncState() {
    const prev = step;
    step = root.getAttribute('data-step') || 'sense';
    const sensorsOn = step === 'sense' ? 1 : step === 'reason' ? 0.3 : 0;
    for (const n of ['cam', 'gaze', 'audio', 'lidar']) {
      layers[n].userData.target = root.classList.contains('off-' + n) ? 0 : sensorsOn;
    }
    layers.reason.userData.target = step === 'reason' ? 1 : 0;
    layers.act.userData.target = step === 'act' ? 1 : 0;
    if (step === 'act' && prev !== 'act') startWalk();
    if (step !== 'act' && prev === 'act') resetAct();
    requestRender();
  }
  function startWalk() {
    resetAct();
    walk = { seg: 0, t: 0, done: false, wait: 0 };
    playClip('Walking');
  }
  function resetAct() {
    walk = null;
    robot.position.copy(robotHome);
    robot.rotation.y = robotHomeRot;
    bottle.position.copy(bottleHome);
    playClip('Idle');
  }
  new MutationObserver(syncState).observe(root, { attributes: true, attributeFilter: ['data-step', 'class'] });

  // ---------- interaction: drag to orbit ----------
  let drag = null;
  host.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, az: goal.az, el: goal.el }; host.setPointerCapture(e.pointerId); host.classList.add('is-dragging'); });
  host.addEventListener('pointermove', (e) => {
    if (!drag) return;
    goal.az = THREE.MathUtils.clamp(drag.az - (e.clientX - drag.x) * 0.006, THREE.MathUtils.degToRad(8), THREE.MathUtils.degToRad(80));
    goal.el = THREE.MathUtils.clamp(drag.el + (e.clientY - drag.y) * 0.004, THREE.MathUtils.degToRad(18), THREE.MathUtils.degToRad(55));
    requestRender();
  });
  const endDrag = () => { drag = null; host.classList.remove('is-dragging'); };

  host.addEventListener('pointerup', endDrag);
  host.addEventListener('pointercancel', endDrag);

  // ---------- render loop (only while visible) ----------
  const clock = new THREE.Clock();
  const tmp = new THREE.Vector3();
  let visible = false, raf = 0, elapsed = 0;
  function requestRender() { if (!raf && visible) raf = requestAnimationFrame(frame); }

  function frame(fixedDt) {
    raf = 0;
    const dt = fixedDt || Math.min(clock.getDelta(), 0.05);
    elapsed += reduceMotion ? 0 : dt;

    view.az += (goal.az - view.az) * 0.12;
    view.el += (goal.el - view.el) * 0.12;
    placeCamera();

    // Layer fades.
    for (const g of Object.values(layers)) {
      g.userData.opacity += (g.userData.target - g.userData.opacity) * 0.12;
      const o = g.userData.opacity;
      g.visible = o > 0.01;
      g.traverse((c) => {
        const m = c.material;
        if (!m) return;
        if (m.uniforms) m.uniforms.uOpacity.value = o;
        else m.opacity = m.userData.base * o;
      });
    }

    // Animated details.
    lidarMat.uniforms.uTime.value = elapsed;
    const pulse = 1 + 0.25 * Math.sin(elapsed * 4);
    fixB.scale.set(pulse, pulse, pulse);
    qRing.scale.setScalar(1 + 0.15 * Math.sin(elapsed * 5));
    ripples.forEach((r) => {
      const p = (elapsed * 0.6 + r.userData.phase) % 1;
      r.scale.setScalar(0.6 + p * 2.6);
      r.material.opacity = r.material.userData.base * (1 - p) * layers.audio.userData.opacity;
      r.quaternion.copy(camera.quaternion);
    });
    steam.forEach((s) => {
      const p = (elapsed * 0.35 + s.userData.phase) % 1;
      s.position.copy(spoutTip).add(tmp.set(Math.sin(p * 9 + s.userData.phase * 20) * 0.03 + p * 0.06, p * 0.45, 0));
      s.scale.setScalar(0.06 + p * 0.16);
      s.material.opacity = 0.55 * Math.sin(p * Math.PI);
    });

    // Robot walk along the route, then confirm the bottle.
    if (walk && !walk.done) {
      const a = route[walk.seg], b = route[walk.seg + 1];
      const len = a.distanceTo(b);
      walk.t += (dt * 0.95) / len;
      if (walk.t >= 1) { walk.seg++; walk.t = 0; }
      if (walk.seg >= route.length - 1) {
        walk.done = true;
        robot.position.copy(route[route.length - 1]);
        robot.rotation.y = -Math.PI / 2;
        playClip('Yes', true);
        walk.wait = 0;
      } else {
        const p0 = route[walk.seg], p1 = route[walk.seg + 1];
        robot.position.lerpVectors(p0, p1, walk.t);
        const want = Math.atan2(p1.x - p0.x, p1.z - p0.z);
        let d = want - robot.rotation.y;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        robot.rotation.y += d * 0.15;
      }
    }
    if (walk && walk.done) {
      walk.wait += dt;
      const k = Math.min(walk.wait / 0.8, 1);
      bottle.position.lerpVectors(bottleHome, tmp.set(0.2, shelfTop, 3.24), k * k * (3 - 2 * k));
    }
    okRing.position.copy(bottle.position).add(tmp.set(0, 0.003, 0));
    mixer.update(dt);

    renderer.render(scene, camera);

    // Labels follow their anchors.
    // Offsets shrink on narrow canvases and labels stay inside the frame.
    const w = host.clientWidth, h = host.clientHeight, k = Math.min(1, w / 620);
    for (const l of labels) {
      tmp.copy(l.anchor).project(camera);
      const half = l.el.offsetWidth / 2;
      const x = THREE.MathUtils.clamp(((tmp.x + 1) / 2) * w + l.dx * k, half + 4, w - half - 4);
      const y = ((1 - tmp.y) / 2) * h + l.dy * k;
      l.el.style.transform = `translate(${x - half}px, ${y}px) translateY(${l.below ? '0' : '-100%'})`;
    }

    if (visible) raf = requestAnimationFrame(frame);
  }

  new IntersectionObserver((entries) => {
    visible = entries[0].isIntersecting;
    if (visible) { clock.getDelta(); requestRender(); }
  }, { threshold: 0.01 }).observe(host);
  new ResizeObserver(() => { resize(); requestRender(); }).observe(host);

  root.classList.add('is-3d');   // show the canvas first so it has a real size
  resize();
  placeCamera();
  syncState();
  for (const g of Object.values(layers)) g.userData.opacity = g.userData.target;
  frame(1 / 60);   // paint once right away so labels and canvas are never blank
  // Test hook for driving the scene from scripts (only with #debug3d in the URL).
  if (location.hash.includes('debug3d')) {
    window.__scene3d = { THREE, scene, camera, target, dana, robot, view, goal, layers,  render: requestRender, step: (n) => { const v = visible; for (let i = 0; i < n; i++) { visible = false; frame(1 / 60); } visible = v; } };
  }
}
