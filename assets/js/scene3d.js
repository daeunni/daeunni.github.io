// Interactive 3D kitchen for the research-vision section.
// Dana (wearing AR glasses) cooks while a helper robot assists; the scene
// follows the Sense -> Reason -> Act steps driven by main.js through the
// `.scene` element's data-step attribute and `off-<layer>` classes.
// Clicking a character switches to "play" mode: visitors can walk Dana or the
// robot around (A* on a floor grid), poke them for reactions, and go back to
// the story with the "back to story" button.
import * as THREE from 'three';
import { GLTFLoader } from './vendor/three/loaders/GLTFLoader.js';
import { RoomEnvironment } from './vendor/three/environments/RoomEnvironment.js';
import { mergeVertices } from './vendor/three/utils/BufferGeometryUtils.js';
import { EffectComposer } from './vendor/three/postprocessing/EffectComposer.js';
import { RenderPass } from './vendor/three/postprocessing/RenderPass.js';
import { GTAOPass } from './vendor/three/postprocessing/GTAOPass.js';
import { OutputPass } from './vendor/three/postprocessing/OutputPass.js';
import { buildKitchen, rboxGeo } from './kitchen-models.js';
import { createBot } from './helper-bot.js';

const PACK = 0.556;             // Quaternius interior pack units -> meters
const ROOM = { w: 5, d: 4, h: 2.6 };
const GAZE = new THREE.Color('#9b8bc0');
const AUDIO = new THREE.Color('#d6a06a');
const LIDAR = new THREE.Color('#7fae98');

export async function initScene(root) {
  // Follow the page's accent color (CSS --accent) so the scene matches the theme.
  const cssAccent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  const ACCENT = new THREE.Color(cssAccent || '#9f5f78');
  const host = root.querySelector('.scene-3d');
  const base = root.getAttribute('data-models');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Ambient occlusion only on desktop-class devices (opt out with ?ao=0).
  const FANCY = window.matchMedia('(hover: hover) and (pointer: fine)').matches && !/[?&#]ao=0/.test(location.href);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.7;

  // Lights: soft sky/bounce fill, plus low morning sun that only reaches the room
  // through the window (the walls and an invisible ceiling cast its shadows).
  const SUN_DIR = new THREE.Vector3(0.7, -0.66, 0.24).normalize();   // direction the sunlight travels
  scene.add(new THREE.HemisphereLight('#fbf6f0', '#d9cbbf', 1.15));
  const sun = new THREE.DirectionalLight('#ffeed2', 9);
  sun.target.position.set(2.0, 0.6, 2.0);
  sun.position.copy(sun.target.position).addScaledVector(SUN_DIR, -9);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -4.6; sun.shadow.camera.right = 4.6;
  sun.shadow.camera.top = 4.6; sun.shadow.camera.bottom = -4.6;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 20;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight('#f1e8f2', 0.8);   // skylight from the window side + room bounce
  fill.position.set(-2, 3.5, 4.5);
  scene.add(fill);
  const bounce = new THREE.DirectionalLight('#f3e6da', 0.55);
  bounce.position.set(6, 2.5, 6);
  scene.add(bounce);

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
    if (composer) composer.setSize(w, h);
  }

  // ---------- post-processing: soft ambient occlusion for contact shadows ----------
  let composer = null;
  if (FANCY) {
    composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
    composer.addPass(new RenderPass(scene, camera));
    const gtao = new GTAOPass(scene, camera, 1, 1);
    gtao.blendIntensity = 0.6;
    gtao.updateGtaoMaterial({ radius: 0.3, distanceExponent: 2, thickness: 1.2, distanceFallOff: 1, scale: 0.9, samples: 16, screenSpaceRadius: false });
    gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, radiusExponent: 1, rings: 2, samples: 16 });
    // Keep translucent overlays (sensor cones, rings, steam, hearts) out of the AO buffers.
    const hideLinesAndPoints = gtao.overrideVisibility.bind(gtao);
    gtao.overrideVisibility = function () {
      hideLinesAndPoints();
      scene.traverse((o) => { if ((o.isMesh || o.isSprite) && o.material && o.material.transparent) o.visible = false; });
    };
    composer.addPass(gtao);
    composer.addPass(new OutputPass());
  }

  // ---------- procedural textures ----------
  function canvasTex(w, h, draw, repeat, data) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    if (!data) t.colorSpace = THREE.SRGBColorSpace;   // bump / roughness maps stay linear
    t.anisotropy = 8;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if (repeat) t.repeat.set(repeat[0], repeat[1]);
    return t;
  }
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const rng = (a) => () => {   // small seeded PRNG (mulberry32) so textures look the same every visit
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const blob = (g, x, y, rad, rgb, a) => {   // soft round spot (radial gradient: much cheaper than ctx.filter blur)
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, `rgba(${rgb}, ${a})`); gr.addColorStop(1, `rgba(${rgb}, 0)`);
    g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  };
  const around = (w, h, fn) => { for (const dx of [-w, 0, w]) for (const dy of [-h, 0, h]) fn(dx, dy); };   // tileable drawing

  // The interior pack models have no UVs, so textured materials are projected from
  // world space (triplanar mapping) instead.
  function triplanar(mat, tex, scale) {
    mat.map = tex;
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.tpScale = { value: scale };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vTpPos;\nvarying vec3 vTpNrm;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTpPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvTpNrm = normalize(mat3(modelMatrix) * objectNormal);');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vTpPos;\nvarying vec3 vTpNrm;\nuniform float tpScale;')
        .replace('#include <map_fragment>', `vec3 tpW = pow(abs(normalize(vTpNrm)), vec3(4.0)); tpW /= tpW.x + tpW.y + tpW.z;
          diffuseColor *= texture2D(map, vTpPos.zy * tpScale) * tpW.x + texture2D(map, vTpPos.xz * tpScale) * tpW.y + texture2D(map, vTpPos.xy * tpScale) * tpW.z;`);
    };
    mat.customProgramCacheKey = () => 'triplanar';
    mat.needsUpdate = true;
    return mat;
  }

  // Oak floor: wide planks with grain, knots and bevelled joints (colour + bump + roughness share one layout).
  const planks = [];
  {
    const r = rng(11), W = 1024, rows = 10, rh = 1024 / rows;
    for (let row = 0; row < rows; row++) {
      const x0 = -r() * 500;
      let x = x0;
      while (x < x0 + W - 1) {
        let len = 380 + r() * 360;
        if (x0 + W - (x + len) < 180) len = x0 + W - x;   // close the row exactly so it tiles
        planks.push({ x, y: row * rh, len, h: rh, hue: 22 + r() * 6, sat: 32 + r() * 10, l: 33 + r() * 7, seed: (r() * 1e9) | 0, rough: r() });
        x += len;
      }
    }
  }
  const forPlanks = (fn) => planks.forEach((p) => [-1024, 0, 1024].forEach((ox) => { if (p.x + ox < 1024 && p.x + ox + p.len > 0) fn(p, p.x + ox); }));
  const woodTex = canvasTex(1024, 1024, (g) => {
    forPlanks((p, x) => {
      const pr = rng(p.seed);
      g.save(); g.beginPath(); g.rect(x, p.y, p.len, p.h); g.clip();
      g.fillStyle = `hsl(${p.hue}, ${p.sat}%, ${p.l}%)`; g.fillRect(x, p.y, p.len, p.h);
      for (let k = 0; k < 7; k++) {
        g.fillStyle = `hsla(${p.hue - 3}, 40%, ${p.l - 9}%, ${0.05 + pr() * 0.08})`;
        g.fillRect(x, p.y + pr() * p.h, p.len, 3 + pr() * 16);
      }
      g.lineWidth = 1;
      for (let k = 0; k < 30; k++) {
        const y0 = p.y + pr() * p.h, amp = 1 + pr() * 5, f = 0.004 + pr() * 0.01, ph = pr() * 6;
        g.strokeStyle = `hsla(${p.hue - 5}, 45%, ${p.l - 15}%, ${0.08 + pr() * 0.18})`;
        g.beginPath();
        for (let u = 0; u <= p.len; u += 16) { const y = y0 + Math.sin(u * f + ph) * amp; u ? g.lineTo(x + u, y) : g.moveTo(x + u, y); }
        g.stroke();
      }
      if (pr() < 0.55) {   // cathedral figure
        const cx = x + p.len * (0.25 + pr() * 0.5), cy = p.y + p.h * (0.35 + pr() * 0.3);
        g.strokeStyle = `hsla(${p.hue - 6}, 45%, ${p.l - 16}%, .18)`;
        for (let k = 0; k < 6; k++) { g.beginPath(); g.ellipse(cx, cy, 50 + k * 30, 5 + k * 5, 0, 0, Math.PI * 2); g.stroke(); }
      }
      if (pr() < 0.3) {   // knot
        const kx = x + pr() * p.len, ky = p.y + p.h * (0.25 + pr() * 0.5);
        const kg = g.createRadialGradient(kx, ky, 0, kx, ky, 9);
        kg.addColorStop(0, `hsla(${p.hue - 8}, 50%, 22%, .75)`); kg.addColorStop(1, `hsla(${p.hue}, 40%, 40%, 0)`);
        g.fillStyle = kg; g.beginPath(); g.ellipse(kx, ky, 12, 6, 0, 0, Math.PI * 2); g.fill();
      }
      g.restore();
      g.fillStyle = 'rgba(35, 20, 10, .55)';
      g.fillRect(x, p.y, p.len, 2); g.fillRect(x, p.y, 2, p.h);
    });
  }, [2.2, 1.8]);
  const woodBump = canvasTex(1024, 1024, (g) => {
    g.fillStyle = '#fff'; g.fillRect(0, 0, 1024, 1024);
    forPlanks((p, x) => {
      g.fillStyle = '#000'; g.fillRect(x, p.y, p.len, 3); g.fillRect(x, p.y, 3, p.h);
      g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(x, p.y + 3, p.len, 2); g.fillRect(x + 3, p.y, 2, p.h);
    });
  }, [2.2, 1.8], true);
  const woodRough = canvasTex(512, 512, (g) => {
    forPlanks((p, x) => {
      const v = 120 + p.rough * 50;
      g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(x / 2, p.y / 2, p.len / 2, p.h / 2);
      g.fillStyle = '#e6e6e6'; g.fillRect(x / 2, p.y / 2, p.len / 2, 1.5);
    });
  }, [2.2, 1.8], true);

  // Glazed subway tiles (running bond), bevelled edges in the bump map.
  const TILE = { cols: 8, rows: 8 };
  const drawTiles = (g, w, h, paint) => {
    const tw = w / TILE.cols, th = h / TILE.rows;
    for (let r = 0; r < TILE.rows; r++) for (let c = -1; c <= TILE.cols; c++) paint(c * tw + (r % 2 ? tw / 2 : 0), r * th, tw, th);
  };
  const tileTex = canvasTex(1024, 512, (g, w, h) => {
    const r = rng(3);
    g.fillStyle = '#d6d1ca'; g.fillRect(0, 0, w, h);
    drawTiles(g, w, h, (x, y, tw, th) => {
      const l = 94 + r() * 3.5;
      const gr = g.createLinearGradient(x, y, x, y + th);
      gr.addColorStop(0, `hsl(35, 18%, ${l + 1.5}%)`); gr.addColorStop(1, `hsl(35, 16%, ${l - 2}%)`);
      g.fillStyle = gr; g.fillRect(x + 3, y + 3, tw - 6, th - 6);
    });
  }, [2.36, 1]);
  const tileBump = canvasTex(256, 128, (g, w, h) => {   // low-res on purpose: magnification softens the bevel
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff';
    drawTiles(g, w, h, (x, y, tw, th) => g.fillRect(x + 1.5, y + 1.5, tw - 3, th - 3));
  }, [2.36, 1], true);

  // Honed white marble with soft grey veins (tileable, used triplanar on the counter).
  const marbleTex = canvasTex(1024, 1024, (g, w, h) => {
    const r = rng(21);
    g.fillStyle = '#f3f1ee'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 26; i++) {
      const x = r() * w, y = r() * h, rad = 90 + r() * 220, a = 0.04 + r() * 0.06;
      around(w, h, (dx, dy) => blob(g, x + dx, y + dy, rad, '150, 146, 155', a));
    }
    const veins = (n) => [...Array(n)].map(() => {
      const pts = [[r() * w, r() * h]], ang = 0.6 + r() * 0.5;
      for (let k = 0; k < 14; k++) {
        const [px, py] = pts[pts.length - 1], a = ang + (r() - 0.5) * 1.3;
        pts.push([px + Math.cos(a) * 60, py + Math.sin(a) * 60]);
      }
      return { pts, k: 0.5 + r() };
    });
    const stroke = (ctx, list, width, alpha, sc) => list.forEach(({ pts, k }) => around(w, h, (dx, dy) => {
      ctx.strokeStyle = `rgba(118, 114, 124, ${alpha * k})`; ctx.lineWidth = width * k;
      ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo((x + dx) * sc, (y + dy) * sc) : ctx.moveTo((x + dx) * sc, (y + dy) * sc))); ctx.stroke();
    }));
    // Broad, hazy veins: draw small and scale up (cheap blur).
    const lo = document.createElement('canvas'); lo.width = lo.height = 128;
    const lg = lo.getContext('2d');
    stroke(lg, veins(5), 1.4, 0.22, 0.125);
    g.imageSmoothingQuality = 'high';
    g.drawImage(lo, 0, 0, w, h);
    stroke(g, veins(7), 1.6, 0.45, 1);
    stroke(g, veins(14), 0.8, 0.32, 1);
  });

  // Fine oak for furniture (triplanar).
  const oakTex = canvasTex(512, 512, (g, w, h) => {
    const r = rng(31);
    g.fillStyle = '#c99a6c'; g.fillRect(0, 0, w, h);
    for (let k = 0; k < 40; k++) { g.fillStyle = `rgba(120, 75, 40, ${0.03 + r() * 0.06})`; const y = r() * h; around(w, h, (dx, dy) => g.fillRect(0, y + dy, w, 2 + r() * 8)); }
    g.lineWidth = 1;
    for (let k = 0; k < 90; k++) {
      const y0 = r() * h, amp = 1 + r() * 4, f = (Math.PI * 2 / w) * (1 + Math.floor(r() * 3)), ph = r() * 6, a = 0.06 + r() * 0.18;
      around(w, h, (dx, dy) => {
        g.strokeStyle = `rgba(90, 55, 30, ${a})`; g.beginPath();
        for (let x = 0; x <= w; x += 8) { const y = y0 + dy + Math.sin(x * f + ph) * amp; x ? g.lineTo(x, y) : g.moveTo(x, y); }
        g.stroke();
      });
    }
  });

  // Wallpaper: soft butter yellow with sparse little daisies.
  const wallpaperTex = canvasTex(512, 512, (g, w, h) => {
    const r = rng(41);
    g.fillStyle = '#fbf2d5'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 1800; i++) { g.fillStyle = `rgba(214, 190, 130, ${r() * 0.06})`; g.fillRect(r() * w, r() * h, 1.5, 1.5); }   // paper grain
    const daisy = (x, y, s, rot) => {
      g.save(); g.translate(x, y); g.rotate(rot);
      g.fillStyle = '#fffdf7'; g.strokeStyle = 'rgba(200, 175, 130, .45)'; g.lineWidth = 1.1;
      for (let k = 0; k < 8; k++) { g.save(); g.rotate(k * Math.PI / 4); g.beginPath(); g.ellipse(0, -s * 0.55, s * 0.2, s * 0.45, 0, 0, 7); g.fill(); g.stroke(); g.restore(); }
      g.fillStyle = '#f0bd45'; g.beginPath(); g.arc(0, 0, s * 0.24, 0, 7); g.fill();
      g.fillStyle = 'rgba(200, 140, 30, .35)'; g.beginPath(); g.arc(s * 0.05, s * 0.06, s * 0.14, 0, 7); g.fill();
      g.restore();
    };
    // Two daisies per row on a staggered grid, each nudged and turned a little.
    const cell = 256;
    for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
      const x = i * cell + cell / 2 + (j % 2 ? cell / 2 : 0) + (r() - 0.5) * 50, y = j * cell + cell / 2 + (r() - 0.5) * 50;
      const s = 28 + r() * 10, rot = r() * Math.PI;
      around(w, h, (dx, dy) => daisy(x + dx, y + dy, s, rot));
    }
  });
  // Cream beadboard for the lower walls.
  const beadTex = canvasTex(256, 64, (g, w, h) => {
    g.fillStyle = '#fbf6ee'; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 32) { g.fillStyle = 'rgba(150, 125, 105, .35)'; g.fillRect(x, 0, 2, h); g.fillStyle = 'rgba(255, 255, 255, .8)'; g.fillRect(x + 2, 0, 2, h); }
  }, [6.25, 1]);
  const beadBump = canvasTex(256, 8, (g, w, h) => {
    g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 32) { g.fillStyle = '#000'; g.fillRect(x, 0, 2, h); g.fillStyle = '#888'; g.fillRect(x + 2, 0, 2, h); g.fillRect(x - 2, 0, 2, h); }
  }, [6.25, 1], true);

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
  const floorMat = new THREE.MeshPhysicalMaterial({ map: woodTex, bumpMap: woodBump, bumpScale: 1.4, roughnessMap: woodRough, roughness: 1,
    clearcoat: 0.35, clearcoatRoughness: 0.32 });
  const slabSide = std('#5a3e2b', 0.9);
  const wallMat = triplanar(std('#ffffff', 0.85), wallpaperTex, 1.1);
  const wallEdge = std('#e2dcd2', 0.95);

  const floor = new THREE.Mesh(new THREE.BoxGeometry(ROOM.w, 0.14, ROOM.d), [slabSide, slabSide, floorMat, slabSide, slabSide, slabSide]);
  floor.position.set(ROOM.w / 2, -0.07, ROOM.d / 2);
  floor.receiveShadow = true;
  scene.add(floor);

  const backWall = new THREE.Mesh(new THREE.BoxGeometry(ROOM.w + 0.12, ROOM.h, 0.12), [wallEdge, wallEdge, wallEdge, wallEdge, wallMat, wallEdge]);
  backWall.position.set(ROOM.w / 2 - 0.06, ROOM.h / 2 - 0.14, -0.06);
  backWall.receiveShadow = backWall.castShadow = true;
  scene.add(backWall);
  // (the left wall is built once the window has loaded, with a real opening for the sunlight)

  const baseMat = std('#ffffff', 0.7);
  const bb1 = new THREE.Mesh(new THREE.BoxGeometry(ROOM.w, 0.08, 0.02), baseMat);
  bb1.position.set(ROOM.w / 2, 0.04, 0.01);
  const bb2 = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.08, ROOM.d), baseMat);
  bb2.position.set(0.01, 0.04, ROOM.d / 2);
  scene.add(bb1, bb2);
  // Beadboard wainscot + chair rail on the lower walls (cabinets simply cover it where they stand).
  const WAIN = 0.84;
  const beadMat = new THREE.MeshStandardMaterial({ map: beadTex, bumpMap: beadBump, bumpScale: 1.2, roughness: 0.55 });
  const beadMatL = beadMat.clone();
  beadMatL.map = beadTex.clone(); beadMatL.map.repeat.set(5, 1);
  beadMatL.bumpMap = beadBump.clone(); beadMatL.bumpMap.repeat.set(5, 1);
  const beadBack = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.w, WAIN), beadMat);
  beadBack.position.set(ROOM.w / 2, WAIN / 2, 0.004);
  const beadLeft = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.d, WAIN), beadMatL);
  beadLeft.rotation.y = Math.PI / 2;
  beadLeft.position.set(0.004, WAIN / 2, ROOM.d / 2);
  const railMat = std('#f8f3ea', 0.5);
  const railBack = new THREE.Mesh(rboxGeo(ROOM.w, 0.035, 0.028, 0.006), railMat);
  railBack.position.set(ROOM.w / 2, WAIN + 0.012, 0.014);
  const railLeft = new THREE.Mesh(rboxGeo(0.028, 0.035, ROOM.d, 0.006), railMat);
  railLeft.position.set(0.014, WAIN + 0.012, ROOM.d / 2);
  for (const m of [beadBack, beadLeft, railBack, railLeft]) { m.receiveShadow = true; m.castShadow = m.geometry.type !== 'PlaneGeometry'; scene.add(m); }

  // Invisible ceiling + front/right walls: they only cast shadows, so direct sun can
  // enter through the window alone (opacity 0 also keeps them out of the AO pass).
  const ghost = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
  for (const [w, h, d, x, y, z] of [[ROOM.w + 0.62, 0.05, ROOM.d + 1, (ROOM.w + 0.38) / 2, ROOM.h - 0.12, ROOM.d / 2],   // starts at the left wall so the whole window gets sun
    [ROOM.w + 1, ROOM.h, 0.05, ROOM.w / 2, ROOM.h / 2 - 0.14, ROOM.d + 0.1],
    [0.05, ROOM.h, ROOM.d + 1, ROOM.w + 0.1, ROOM.h / 2 - 0.14, ROOM.d / 2]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), ghost);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.userData.noRay = true;
    scene.add(m);
  }

  // ---------- models ----------
  const loader = new GLTFLoader();
  const cache = {};
  const load = (name) => (cache[name] = cache[name] || loader.loadAsync(base + name + '.glb'));

  // [colour, roughness, metalness, triplanar texture?, texture scale]
  const RECOLOR = {
    Kitchen: ['#7d9886', 0.55, 0], KitchenTop: ['#ffffff', 0.22, 0, marbleTex, 0.7], White: null,
    DarkMetal: ['#2c2e33', 0.3, 0.85], LightMetal: ['#c9ccd1', 0.22, 0.95],
    Wood: ['#ffffff', 0.55, 0, oakTex, 1.6], Wood_Dark: ['#9a7a62', 0.55, 0, oakTex, 1.6],
    DarkRed: ['#c99a82', 0.95, 0], LightOrange: ['#efe2cf', 0.95, 0],
    Plant_Green: ['#5f9a4e', 0.8, 0], DarkGreen: ['#3f7a45', 0.8, 0], Black: ['#2e2e33', 0.6, 0],
    Hair_Brown: ['#3a2a22', 0.7, 0], Orange: ['#977a8d', 0.85, 0], Grey: ['#e9e6e1', 0.7, 0],
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
        if (spec[3] && !m.map) triplanar(m, spec[3], spec[4]);
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
  // Window opening in the left wall (the frame itself is modelled in kitchen-models.js).
  const opening = { oy0: 1.04, oy1: 2.046, oz0: 1.004, oz1: 2.096 };

  // Dana (her own model, front faces +z) and the helper robot (animated).
  const danaP = place('Dana', { cx: 2.05, cz: 1.25, rot: 1.8, s: 1.3 / 2.7 });
  // Helper robot: modelled and animated in code (helper-bot.js).
  const bot = createBot({ accent: '#' + ACCENT.clone().offsetHSL(0, 0.05, 0.22).getHexString() });
  bot.obj.position.set(4.4, 0, 3.45);
  bot.obj.rotation.y = 0.35;   // turned toward the viewer
  scene.add(bot.obj);

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
  const splash = new THREE.Mesh(new THREE.PlaneGeometry(run.length * MOD, 0.6),
    new THREE.MeshPhysicalMaterial({ map: tileTex, bumpMap: tileBump, bumpScale: 2.2, roughness: 0.18, clearcoat: 0.8, clearcoatRoughness: 0.12 }));
  splash.position.set(runX0 + run.length * MOD / 2, 1.2, 0.003);
  splash.receiveShadow = true;
  scene.add(splash);

  // ---------- lived-in details ----------
  const shadowy = (o) => { o.traverse((c) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } }); return o; };
  const add = (o, x, y, z) => { o.position.set(x, y, z); scene.add(shadowy(o)); return o; };
  const lathe = (pts, mat, seg = 40) => new THREE.Mesh(new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg), mat);
  const brass = std('#c9a36c', 0.3, 1);
  const ceramic = std('#f5f2ee', 0.22);
  const oak = triplanar(std('#ffffff', 0.55), oakTex, 2.2);
  const brushed = new THREE.MeshStandardMaterial({ color: '#e4e6e9', metalness: 0.72, roughness: 0.32 });

  // Black glass cooktop with burner rings; the kettle's burner glows.
  const cookTex = canvasTex(512, 448, (g, w, h) => {
    g.fillStyle = '#111114'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(200, 200, 210, .35)'; g.lineWidth = 3;
    for (const [x, y, r] of [[0.27, 0.3, 0.17], [0.73, 0.33, 0.13], [0.27, 0.72, 0.13], [0.73, 0.7, 0.17]]) {
      g.beginPath(); g.arc(x * w, y * h, r * w, 0, 7); g.stroke();
      g.beginPath(); g.arc(x * w, y * h, r * w * 0.6, 0, 7); g.stroke();
    }
    g.fillStyle = 'rgba(200, 200, 210, .4)';
    for (let i = 0; i < 4; i++) g.fillRect(w * 0.36 + i * 34, h - 26, 18, 6);
  });
  const cooktop = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.008, 0.44),
    new THREE.MeshPhysicalMaterial({ color: '#ffffff', map: cookTex, roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.04 }));
  cooktop.rotation.y = Math.PI;   // texture's front edge toward the room
  add(cooktop, ovenCx, ovenTop + 0.001, 0.31);
  const hot = new THREE.Mesh(new THREE.RingGeometry(0.035, 0.085, 40),
    new THREE.MeshBasicMaterial({ color: '#ff5a2a', transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
  hot.rotation.x = -Math.PI / 2;
  hot.position.set(ovenCx - 0.13, ovenTop + 0.0065, 0.24);
  hot.userData.noRay = true;
  scene.add(hot);

  // Stainless chimney hood over the cooktop, with a warm light underneath.
  const hood = new THREE.Group();
  const canopyGeo = new THREE.CylinderGeometry(0.5, 1, 1, 4, 1);
  canopyGeo.rotateY(Math.PI / 4);
  const canopy = new THREE.Mesh(canopyGeo, brushed);
  canopy.scale.set(0.41, 0.17, 0.33);
  canopy.position.y = 0.115;
  const lip = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.03, 0.47), brushed);
  lip.position.y = 0.015;
  const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.26, ROOM.h - 0.14 - 1.7, 0.22), brushed);
  chimney.position.set(0, 0.2 + (ROOM.h - 0.14 - 1.7) / 2, -0.12);
  const hoodLamp = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.05), new THREE.MeshBasicMaterial({ color: '#fff2d6' }));
  hoodLamp.rotation.x = Math.PI / 2; hoodLamp.position.y = -0.001;
  hood.add(canopy, lip, chimney, hoodLamp);
  add(hood, ovenCx, 1.5, 0.235);
  const hoodLight = new THREE.SpotLight('#ffd9a8', 1.6, 1.6, 1.0, 1, 2);
  hoodLight.position.set(ovenCx, 1.49, 0.3);
  hoodLight.target.position.set(ovenCx, ovenTop, 0.3);
  scene.add(hoodLight, hoodLight.target);

  // Warm LED strip under the wall cabinets.
  const ledX0 = runX0 + 0.05, ledX1 = runX0 + 3 * MOD - 0.05;
  const led = new THREE.Mesh(new THREE.BoxGeometry(ledX1 - ledX0, 0.008, 0.015), new THREE.MeshBasicMaterial({ color: '#fff0d4' }));
  led.position.set((ledX0 + ledX1) / 2, 1.497, 0.27);
  led.userData.noRay = true;
  scene.add(led);
  const ledLight = new THREE.SpotLight('#ffe2b8', 2.2, 1.4, 1.25, 1, 2);
  ledLight.position.set((ledX0 + ledX1) / 2, 1.48, 0.25);
  ledLight.target.position.set((ledX0 + ledX1) / 2, ovenTop, 0.32);
  scene.add(ledLight, ledLight.target);

  // Open oak shelf with jars and bowls over the last drawer unit.
  const shelfX = runX0 + 4.5 * MOD;
  for (const y of [1.6, 1.98]) {
    add(new THREE.Mesh(new THREE.BoxGeometry(MOD - 0.04, 0.03, 0.22), oak), shelfX, y, 0.11);
  }
  const jarGlass = new THREE.MeshStandardMaterial({ color: '#eef3f2', roughness: 0.05, transparent: true, opacity: 0.35 });
  const jar = (fill, h) => {
    const g = new THREE.Group();
    const body = lathe([[0, 0], [0.042, 0], [0.045, 0.01], [0.045, h], [0.04, h + 0.008], [0, h + 0.008]], jarGlass, 28);
    const content = new THREE.Mesh(new THREE.CylinderGeometry(0.039, 0.039, h * 0.7, 24), std(fill, 0.9));
    content.position.y = h * 0.35 + 0.004;
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.046, 0.022, 28), oak);
    top.position.y = h + 0.019;
    g.add(content, body, top);
    return g;
  };
  add(jar('#e9d39a', 0.15), shelfX - 0.17, 1.615, 0.1);    // pasta
  add(jar('#8a5a3c', 0.12), shelfX - 0.06, 1.615, 0.1);    // coffee beans
  add(jar('#f2ece2', 0.17), shelfX + 0.05, 1.615, 0.1);    // flour
  for (let i = 0; i < 3; i++) {   // stacked bowls
    add(lathe([[0, 0], [0.04, 0], [0.075, 0.035], [0.08, 0.045], [0.074, 0.045], [0.068, 0.036], [0.035, 0.008], [0, 0.008]], ceramic), shelfX + 0.17, 1.615 + i * 0.022, 0.1);
  }
  const plates = new THREE.Group();   // plates leaning on the upper shelf
  for (let i = 0; i < 3; i++) {
    const pl = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.012, 40), ceramic);
    pl.rotation.x = Math.PI / 2 - 0.22;
    pl.position.set(i * 0.016 - 0.016, 0.1, 0.03 + i * 0.012);
    plates.add(pl);
  }
  add(plates, shelfX - 0.1, 1.995, 0.06);
  const trail = new THREE.Group();   // small trailing pothos
  const pot2 = lathe([[0, 0], [0.04, 0], [0.05, 0.08], [0.046, 0.08], [0, 0.075]], std('#d9b8a6', 0.8), 24);
  trail.add(pot2);
  const leafMat = new THREE.MeshStandardMaterial({ color: '#5f9a4e', roughness: 0.6, side: THREE.DoubleSide });
  const leafGeo = new THREE.SphereGeometry(0.022, 10, 8);
  leafGeo.scale(1, 0.25, 1.5);
  { const r = rng(5);
    for (let k = 0; k < 26; k++) {
      const t = k / 26, ang = r() * Math.PI * 2, drop = t * 0.32;
      const leaf = new THREE.Mesh(leafGeo, leafMat);
      leaf.position.set(Math.cos(ang) * (0.04 + t * 0.03), 0.08 - drop + r() * 0.03, Math.abs(Math.sin(ang)) * (0.04 + t * 0.05) + 0.01);
      leaf.rotation.set(r() * 1.2, ang, r() * 0.8);
      trail.add(leaf);
    } }
  add(trail, shelfX + 0.15, 2.0 + 0.015, 0.1);

  // ---------- modelled furniture (kitchen-models.js) ----------
  const brushedTex = canvasTex(256, 256, (g, w, h) => {   // fine brushing streaks for stainless steel
    const r = rng(51);
    g.fillStyle = '#f4f4f4'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 700; i++) { const v = 215 + r() * 40 | 0; g.fillStyle = `rgba(${v},${v},${v},${0.15 + r() * 0.25})`; g.fillRect(0, r() * h, w, 0.6 + r()); }
  });
  const leafTex = canvasTex(64, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, w, 0);
    gr.addColorStop(0, '#3f6d36'); gr.addColorStop(0.5, '#5b8a45'); gr.addColorStop(1, '#3f6d36');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(190, 215, 150, .22)';
    for (let y = 20; y < h; y += 22) {
      g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(w / 2, y + 14); g.quadraticCurveTo(w * 0.3, y + 6, 2, y - 4); g.stroke();
      g.beginPath(); g.moveTo(w / 2, y + 14); g.quadraticCurveTo(w * 0.7, y + 6, w - 2, y - 4); g.stroke();
    }
    g.fillStyle = 'rgba(200, 225, 160, .5)'; g.fillRect(w / 2 - 1, 0, 2, h);
  });
  const snakeTex = canvasTex(64, 256, (g, w, h) => {
    const r = rng(61);
    g.fillStyle = '#2d4b2b'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 7 + r() * 9) {
      g.strokeStyle = `rgba(140, 170, 115, ${0.25 + r() * 0.3})`; g.lineWidth = 2 + r() * 3;
      g.beginPath();
      for (let x = 0; x <= w; x += 8) { const yy = y + Math.sin(x * 0.2 + y) * 3; x ? g.lineTo(x, yy) : g.moveTo(x, yy); }
      g.stroke();
    }
    g.fillStyle = '#d6cd72'; g.fillRect(0, 0, 4, h); g.fillRect(w - 4, 0, 4, h);
  });
  const bookMats = {};
  const paneGlass = new THREE.MeshStandardMaterial({ color: '#eef4f7', roughness: 0.04, transparent: true, opacity: 0.12, depthWrite: false });
  paneGlass.userData.noRay = true;
  const stainless = triplanar(new THREE.MeshStandardMaterial({ color: '#eceef0', metalness: 0.7, roughness: 0.34 }), brushedTex, 2.5);
  const K = buildKitchen({
    cab: std('#7d9886', 0.5), plinth: std('#617a69', 0.7), cabInner: std('#eceee8', 0.8), brass, steel: stainless,
    steelSide: std('#d9dcdf', 0.4, 0.6), blackGlass: std('#131317', 0.06, 0.3), display: new THREE.MeshBasicMaterial({ color: '#9fdcc6' }),
    dark: std('#1f2023', 0.6), marble: triplanar(std('#ffffff', 0.2), marbleTex, 0.7),
    glass: new THREE.MeshStandardMaterial({ color: '#e8f0f2', roughness: 0.05, transparent: true, opacity: 0.16, depthWrite: false }),
    ceramic, jarGlass, oak, trim: std('#f8f6f2', 0.45), paneGlass, linen: std('#efe6da', 1),
    book: (c) => (bookMats[c] = bookMats[c] || std(c, 0.8)), vase: std('#c9a7b4', 0.35),
    stoneware: std('#e6dcd2', 0.55), terracotta: std('#d9b3a1', 0.75), soil: std('#3b2c22', 1), bark: std('#7a6a5a', 0.9),
    leaf: new THREE.MeshStandardMaterial({ map: leafTex, roughness: 0.45, side: THREE.DoubleSide }),
    snakeLeaf: new THREE.MeshStandardMaterial({ map: snakeTex, roughness: 0.5, side: THREE.DoubleSide }),
  }, { runX0, MOD, opening, shelfTop });
  for (const k of ['base', 'counter', 'wall', 'fridge', 'table', 'window', 'shelf', 'fig', 'snake']) scene.add(K[k]);
  K.chairs.forEach((c) => scene.add(c));
  const furniture = [K.base, K.fridge, K.table, ...K.chairs, K.fig, K.snake].map((obj) => ({ obj }));   // floor obstacles
  const plate = lathe([[0, 0], [0.07, 0], [0.11, 0.008], [0.125, 0.018], [0.119, 0.019], [0.1, 0.012], [0, 0.009]], ceramic, 48);
  add(plate, 2.7, K.tableTop, 2.45);

  // Cutting board with tomatoes, cucumber slices and a knife.
  const boardShape = new THREE.Shape();
  { const w = 0.34, d = 0.22, r = 0.03;
    boardShape.moveTo(-w / 2 + r, -d / 2); boardShape.lineTo(w / 2 - r, -d / 2); boardShape.quadraticCurveTo(w / 2, -d / 2, w / 2, -d / 2 + r);
    boardShape.lineTo(w / 2, d / 2 - r); boardShape.quadraticCurveTo(w / 2, d / 2, w / 2 - r, d / 2); boardShape.lineTo(-w / 2 + r, d / 2);
    boardShape.quadraticCurveTo(-w / 2, d / 2, -w / 2, d / 2 - r); boardShape.lineTo(-w / 2, -d / 2 + r); boardShape.quadraticCurveTo(-w / 2, -d / 2, -w / 2 + r, -d / 2); }
  const boardGeo = new THREE.ExtrudeGeometry(boardShape, { depth: 0.014, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 2 });
  boardGeo.rotateX(-Math.PI / 2);
  const board = new THREE.Group();
  board.add(new THREE.Mesh(boardGeo, oak));
  const tomatoMat = std('#d2402e', 0.22);
  const stemMat = std('#4f7d3a', 0.7);
  for (const [x, z, r] of [[-0.1, -0.04, 0.034], [-0.05, 0.05, 0.03], [0.17, -0.12, 0.032]]) {
    const t = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), tomatoMat);
    t.scale.y = 0.82; t.position.set(x, 0.022 + r * 0.82, z);
    const st = new THREE.Mesh(new THREE.ConeGeometry(r * 0.5, 0.008, 5), stemMat);
    st.position.set(x, 0.022 + r * 1.64, z);
    board.add(t, st);
  }
  const cuke = new THREE.MeshStandardMaterial({ color: '#cfe0a6', roughness: 0.5 });
  const cukeSkin = std('#3f6b34', 0.5);
  for (let i = 0; i < 5; i++) {
    const sl = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.006, 20), [cukeSkin, cuke, cuke]);
    sl.position.set(0.03 + i * 0.022, 0.025 + (i % 2) * 0.002, 0.03 - i * 0.006);
    sl.rotation.set(0.15 * (i % 2 ? 1 : -1), 0, 0.12);
    board.add(sl);
  }
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.003, 0.032), new THREE.MeshStandardMaterial({ color: '#e3e5e8', metalness: 1, roughness: 0.18 }));
  blade.position.set(0.04, 0.024, -0.06);
  const knifeHandle = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.016, 0.022), std('#3b2a20', 0.5));
  knifeHandle.position.set(-0.085, 0.03, -0.06);
  board.add(blade, knifeHandle);
  board.rotation.y = 0.12;
  add(board, runX0 + 2.5 * MOD, ovenTop, 0.33);

  // Utensil crock and olive oil by the hood.
  const crock = new THREE.Group();
  crock.add(lathe([[0, 0], [0.045, 0], [0.05, 0.02], [0.05, 0.13], [0.046, 0.13], [0.042, 0.02], [0, 0.02]], std('#e7d8cf', 0.35)));
  for (const [ang, tilt, kind] of [[0.3, 0.18, 0], [2.4, 0.22, 1], [4.4, 0.15, 0]]) {
    const u = new THREE.Group();
    const handleU = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.007, 0.24, 10), kind ? brushed : oak);
    handleU.position.y = 0.12;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.026, 16, 10), kind ? brushed : oak);
    head.scale.set(1, 1.5, 0.35); head.position.y = 0.26;
    u.add(handleU, head);
    u.rotation.set(Math.sin(ang) * tilt, 0, Math.cos(ang) * tilt);
    u.position.set(Math.cos(ang) * 0.015, 0.03, Math.sin(ang) * 0.015);
    crock.add(u);
  }
  add(crock, runX0 + 4 * MOD + 0.12, ovenTop, 0.13);
  const oil = new THREE.Group();
  oil.add(lathe([[0, 0], [0.032, 0], [0.034, 0.01], [0.034, 0.16], [0.02, 0.2], [0.011, 0.22], [0.011, 0.25], [0, 0.25]],
    new THREE.MeshStandardMaterial({ color: '#8c8f2c', roughness: 0.08, transparent: true, opacity: 0.8 }), 28));
  const cork = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.011, 0.025, 12), std('#c49a6c', 0.9));
  cork.position.y = 0.258;
  oil.add(cork);
  add(oil, runX0 + 4 * MOD + 0.26, ovenTop, 0.1);

  // Bowl of lemons on the left counter.
  const fruit = new THREE.Group();
  fruit.add(lathe([[0, 0], [0.05, 0], [0.11, 0.05], [0.115, 0.07], [0.108, 0.07], [0.1, 0.055], [0.045, 0.01], [0, 0.01]], ceramic));
  const lemonMat = std('#f1cf4a', 0.42);
  for (const [x, y, z, ry] of [[-0.035, 0.05, 0.01, 0.4], [0.035, 0.05, -0.02, 2], [0.0, 0.052, 0.045, 1.2], [0.01, 0.09, 0.0, 2.8]]) {
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.032, 20, 14), lemonMat);
    l.scale.set(1.3, 1, 1); l.rotation.y = ry; l.position.set(x, y, z);
    fruit.add(l);
  }
  add(fruit, runX0 + 0.43, ovenTop, 0.4);

  // Retro mint toaster.
  const toaster = new THREE.Group();
  const mint = new THREE.MeshStandardMaterial({ color: '#a9d8c6', roughness: 0.25, metalness: 0.15 });
  const tBody = new THREE.Mesh(rboxGeo(0.25, 0.17, 0.15, 0.045), mint);
  tBody.position.y = 0.095;
  const chromeM = new THREE.MeshStandardMaterial({ color: '#eceff2', metalness: 1, roughness: 0.12 });
  const tBase = new THREE.Mesh(rboxGeo(0.26, 0.018, 0.16, 0.008), chromeM);
  tBase.position.y = 0.009;
  toaster.add(tBody, tBase);
  for (const z of [-0.025, 0.025]) {
    const slot = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.004, 0.012), std('#2b2b2e', 0.7));
    slot.position.set(0, 0.18, z);
    toaster.add(slot);
  }
  const lever = new THREE.Mesh(rboxGeo(0.02, 0.012, 0.03, 0.004), chromeM);
  lever.position.set(0.135, 0.12, 0);
  toaster.add(lever);
  toaster.rotation.y = 0.15;
  add(toaster, runX0 + 0.17, ovenTop, 0.17);

  // Herb pots on the window sill (their shadows land in the sun patch).
  const terra = std('#cf8f72', 0.8);
  const herbMat = new THREE.MeshStandardMaterial({ color: '#6c9c4f', roughness: 0.6 });
  [[1.3, 0], [1.55, 1], [1.82, 2]].forEach(([z, k]) => {
    const hp = new THREE.Group();
    hp.add(lathe([[0, 0], [0.03, 0], [0.04, 0.065], [0.044, 0.07], [0.044, 0.08], [0.036, 0.08], [0, 0.075]], terra, 24));
    const rh = rng(70 + k);
    for (let i = 0; i < 16 + k * 4; i++) {
      const lf = new THREE.Mesh(new THREE.SphereGeometry(0.012 + rh() * 0.008, 8, 6), herbMat);
      const a = rh() * Math.PI * 2, rr = rh() * 0.035;
      lf.position.set(Math.cos(a) * rr, 0.085 + rh() * (0.06 + k * 0.02), Math.sin(a) * rr);
      lf.scale.set(1, 0.5, 1.4); lf.rotation.y = a;
      hp.add(lf);
    }
    add(hp, 0.055, opening.oy0 + 0.015, z);
  });

  // Pastel bunting across the window.
  const bunting = new THREE.Group();
  const flagCols = ['#f4b6c8', '#bfe3d3', '#f7e1a0', '#d5c8ee'];
  const flagGeo = new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(-0.045, 0), new THREE.Vector2(0.045, 0), new THREE.Vector2(0, -0.09)]));
  const bz0 = opening.oz0 - 0.25, bz1 = opening.oz1 + 0.25, by = opening.oy1 + 0.2, sag = 0.1;
  const sagAt = (u) => by - sag * 4 * u * (1 - u);
  const stringPts = [];
  for (let i = 0; i <= 24; i++) { const u = i / 24; stringPts.push(new THREE.Vector3(0.012, sagAt(u), bz0 + (bz1 - bz0) * u)); }
  bunting.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(stringPts), 48, 0.0025, 6), std('#e9dfd3', 0.9)));
  const nFlags = 13;
  for (let i = 0; i < nFlags; i++) {
    const u = (i + 0.5) / nFlags;
    const f = new THREE.Mesh(flagGeo, new THREE.MeshStandardMaterial({ color: flagCols[i % 4], roughness: 0.9, side: THREE.DoubleSide }));
    f.rotation.y = Math.PI / 2;
    f.position.set(0.014, sagAt(u), bz0 + (bz1 - bz0) * u);
    bunting.add(f);
  }
  scene.add(shadowy(bunting));

  // Kitsch striped runner in front of the sink.
  const runnerTex = canvasTex(512, 192, (g, w, h) => {
    g.fillStyle = '#f7efe4'; g.fillRect(0, 0, w, h);
    const bands = [['#e7a3b8', 18], ['#f7efe4', 10], ['#b9d9c8', 12], ['#f7efe4', 10], ['#f2d48a', 8]];
    let x = 30;
    for (const [c, bw] of bands) { g.fillStyle = c; g.fillRect(x, 0, bw, h); g.fillRect(w - x - bw, 0, bw, h); x += bw; }
    g.fillStyle = '#e7a3b8';
    for (let y = 18; y < h; y += 34) for (let xx = 120; xx < w - 120; xx += 34) { g.beginPath(); g.moveTo(xx, y - 8); g.lineTo(xx + 8, y); g.lineTo(xx, y + 8); g.lineTo(xx - 8, y); g.fill(); }
    const r = rng(81);
    for (let i = 0; i < 2500; i++) { g.fillStyle = `rgba(120, 90, 70, ${r() * 0.07})`; g.fillRect(r() * w, r() * h, 1, 2); }
    g.fillStyle = '#efe4d3'; for (let y = 0; y < h; y += 5) { g.fillRect(0, y, 14, 2); g.fillRect(w - 14, y, 14, 2); }   // fringe
  });
  runnerTex.wrapS = runnerTex.wrapT = THREE.ClampToEdgeWrapping;
  const runner = new THREE.Mesh(new THREE.PlaneGeometry(1.35, 0.5), new THREE.MeshStandardMaterial({ map: runnerTex, bumpMap: runnerTex, bumpScale: 1.5, roughness: 1,
    polygonOffset: true, polygonOffsetFactor: -2 }));
  runner.rotation.x = -Math.PI / 2;
  runner.position.set(1.55, 0.005, 0.95);
  runner.receiveShadow = true;
  scene.add(runner);

  // Striped linen towel over the oven door handle.
  const towelTex = canvasTex(128, 256, (g, w, h) => {
    g.fillStyle = '#f7f3ee'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#e6a3b9';
    for (const y of [40, 60, 190, 210]) g.fillRect(0, y, w, 8);
    for (let i = 0; i < 1500; i++) { g.fillStyle = `rgba(150,130,120,${Math.random() * 0.06})`; g.fillRect(Math.random() * w, Math.random() * h, 1, 2); }
  });
  const towelGeo = new THREE.PlaneGeometry(0.15, 0.3, 8, 12);
  { const a = towelGeo.attributes.position;
    for (let i = 0; i < a.count; i++) a.setZ(i, Math.sin(a.getX(i) * 60) * 0.006 + (0.15 - a.getY(i)) * 0.03); }
  towelGeo.computeVertexNormals();
  const towel = new THREE.Mesh(towelGeo, new THREE.MeshStandardMaterial({ map: towelTex, roughness: 0.95, side: THREE.DoubleSide }));
  towel.userData.oven = true;   // positioned once the oven model is measured

  // Tulips in a glass vase and a mug on the dining table.
  const tableTop = 0.702;
  const vase = new THREE.Group();
  vase.add(lathe([[0, 0], [0.04, 0], [0.045, 0.02], [0.034, 0.12], [0.03, 0.15], [0.036, 0.16], [0, 0.155]],
    new THREE.MeshStandardMaterial({ color: '#e8f0f0', roughness: 0.03, transparent: true, opacity: 0.3 }), 32));
  const stemM = std('#5c8a45', 0.6);
  const petal = new THREE.MeshStandardMaterial({ color: '#ee93b0', roughness: 0.5, side: THREE.DoubleSide });
  const tulipGeo = new THREE.LatheGeometry([[0, 0], [0.018, 0.006], [0.026, 0.025], [0.024, 0.045], [0.017, 0.058]].map(([x, y]) => new THREE.Vector2(x, y)), 6);
  { const r = rng(9);
    for (let k = 0; k < 6; k++) {
      const ang = (k / 6) * Math.PI * 2 + r() * 0.5, lean = 0.18 + r() * 0.2, len = 0.24 + r() * 0.08;
      const f = new THREE.Group();
      const st = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, len, 6), stemM);
      st.position.y = len / 2;
      const head = new THREE.Mesh(tulipGeo, petal);
      head.position.y = len;
      f.add(st, head);
      f.rotation.set(Math.sin(ang) * lean, 0, Math.cos(ang) * lean);
      f.position.y = 0.02;
      vase.add(f);
    }
    for (let k = 0; k < 3; k++) {
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.02, 10, 8), stemM);
      leaf.scale.set(0.5, 3.5, 0.15);
      const ang = k * 2.1;
      leaf.position.set(Math.cos(ang) * 0.03, 0.17, Math.sin(ang) * 0.03);
      leaf.rotation.set(Math.sin(ang) * 0.5, -ang, Math.cos(ang) * 0.5);
      vase.add(leaf);
    } }
  add(vase, 3.02, tableTop, 2.62);
  const mug = new THREE.Group();
  mug.add(lathe([[0, 0], [0.035, 0], [0.038, 0.01], [0.038, 0.09], [0.034, 0.09], [0.033, 0.012], [0, 0.012]], std('#efd9e1', 0.25)));
  const mugHandle = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.006, 8, 20, Math.PI), std('#efd9e1', 0.25));
  mugHandle.rotation.z = -Math.PI / 2; mugHandle.position.set(0.038, 0.048, 0);
  const coffee = new THREE.Mesh(new THREE.CircleGeometry(0.033, 24), std('#5a3a26', 0.2));
  coffee.rotation.x = -Math.PI / 2; coffee.position.y = 0.075;
  mug.add(mugHandle, coffee);
  mug.rotation.y = 2.4;
  add(mug, 2.62, tableTop, 2.72);

  // Braided jute rug with a dusty-pink border (replaces the low-poly carpet).
  const rugTex = canvasTex(1024, 1024, (g, w) => {
    const r = rng(17), c = w / 2;
    g.fillStyle = '#d8c3a2'; g.fillRect(0, 0, w, w);
    for (let rad = 8; rad < c; rad += 15) {
      const border = rad > c - 60 && rad < c - 28;
      g.strokeStyle = border ? '#d9a6b3' : `hsl(${34 + r() * 6}, ${28 + r() * 8}%, ${66 + r() * 8}%)`;
      g.lineWidth = 13; g.beginPath(); g.arc(c, c, rad, 0, Math.PI * 2); g.stroke();
      const n = Math.floor(rad * 0.75), dir = (rad / 15) % 2 ? 1 : -1;
      g.strokeStyle = 'rgba(80, 55, 35, .22)'; g.lineWidth = 1.6;
      for (let i = 0; i < n; i++) {   // braid ticks
        const a = (i / n) * Math.PI * 2;
        const x0 = c + Math.cos(a) * (rad - 6), y0 = c + Math.sin(a) * (rad - 6);
        const x1 = c + Math.cos(a + dir * 4 / rad) * (rad + 6), y1 = c + Math.sin(a + dir * 4 / rad) * (rad + 6);
        g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
      }
    }
  });
  rugTex.wrapS = rugTex.wrapT = THREE.ClampToEdgeWrapping;
  const rug = new THREE.Mesh(new THREE.CircleGeometry(1.08, 96), new THREE.MeshStandardMaterial({ map: rugTex, bumpMap: rugTex, bumpScale: 3, roughness: 1,
    polygonOffset: true, polygonOffsetFactor: -2 }));
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(2.85, 0.006, 2.5);
  rug.receiveShadow = true;
  scene.add(rug);

  // Plush teddy bear with a pink bow, sitting on the side chair (tap it for a squish + hearts).
  const furBump = canvasTex(128, 128, (g, w, h) => {
    const r = rng(91);
    g.fillStyle = '#808080'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) { const v = r() * 255 | 0; g.fillStyle = `rgba(${v},${v},${v},.5)`; g.fillRect(r() * w, r() * h, 1.5, 1.5); }
  }, [3, 3], true);
  const plush = (color, sheen) => new THREE.MeshPhysicalMaterial({ color, roughness: 0.95, bumpMap: furBump, bumpScale: 2.5,
    sheen: 1, sheenRoughness: 0.6, sheenColor: new THREE.Color(sheen) });
  const fur = plush('#b8875d', '#f3d7b8'), furLight = plush('#ecdcc4', '#fff4e4');
  const button = new THREE.MeshStandardMaterial({ color: '#241a17', roughness: 0.15 });
  const bowMat = new THREE.MeshPhysicalMaterial({ color: '#ea8fae', roughness: 0.4, sheen: 1, sheenColor: new THREE.Color('#ffd6e4') });
  const ball = (r, mat, x, y, z, sx = 1, sy = 1, sz = 1) => { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 32, 20), mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); return m; };
  const bear = new THREE.Group();
  const bearBody = new THREE.Group();
  bearBody.add(ball(0.085, fur, 0, 0.09, 0, 1, 1.12, 0.92), ball(0.05, furLight, 0, 0.085, 0.05, 1, 1.15, 0.6));
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 0.06, 8, 16), fur);
    leg.rotation.x = Math.PI / 2 - 0.15; leg.position.set(s * 0.048, 0.032, 0.07);
    const sole = ball(0.024, furLight, s * 0.048, 0.038, 0.118, 1, 1.1, 0.35);
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.024, 0.065, 8, 16), fur);
    arm.position.set(s * 0.083, 0.115, 0.03); arm.rotation.set(-0.6, 0, s * 0.45);
    bearBody.add(leg, sole, arm);
  }
  const bearHead = new THREE.Group();
  bearHead.position.y = 0.2;
  bearHead.add(ball(0.072, fur, 0, 0.02, 0, 1.05, 0.95, 0.95), ball(0.032, furLight, 0, 0.0, 0.06, 1.15, 0.82, 0.85),
    ball(0.011, button, 0, 0.012, 0.087, 1.4, 0.85, 0.8), ball(0.0085, button, -0.026, 0.035, 0.062), ball(0.0085, button, 0.026, 0.035, 0.062));
  for (const s of [-1, 1]) bearHead.add(ball(0.027, fur, s * 0.055, 0.075, -0.005, 1, 1, 0.55), ball(0.016, furLight, s * 0.055, 0.073, 0.008, 1, 1, 0.4));
  bearHead.rotation.set(0.12, 0, 0.1);
  const bow = new THREE.Group();
  bow.add(ball(0.022, bowMat, -0.024, 0, 0, 1.3, 0.8, 0.45), ball(0.022, bowMat, 0.024, 0, 0, 1.3, 0.8, 0.45), ball(0.011, bowMat, 0, 0, 0.006));
  bow.position.set(0, 0.162, 0.062);
  bear.add(bearBody, bearHead, bow);
  bear.scale.setScalar(1.5);
  bear.rotation.y = 0.8;   // sitting on the floor by the basket, facing into the room
  add(bear, 0.36, 0, 2.18);
  bear.userData.squish = 0;

  // Woven basket with a pink knit throw, under the wall shelf.
  const weaveTex = canvasTex(256, 128, (g, w, h) => {
    g.fillStyle = '#c9a274'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 16) for (let x = 0; x < w; x += 16) {
      const off = (y / 16) % 2 ? 8 : 0;
      g.fillStyle = 'rgba(255, 235, 200, .35)'; g.beginPath(); g.ellipse(x + off + 8, y + 8, 7, 5, 0, 0, 7); g.fill();
      g.fillStyle = 'rgba(90, 60, 30, .35)'; g.fillRect(x + off, y + 14, 16, 2);
    }
  }, [4, 2]);
  const basket = new THREE.Group();
  basket.add(lathe([[0, 0], [0.14, 0], [0.155, 0.02], [0.175, 0.26], [0.182, 0.27], [0.168, 0.27], [0.155, 0.03], [0, 0.03]],
    new THREE.MeshStandardMaterial({ map: weaveTex, bumpMap: weaveTex, bumpScale: 2, roughness: 0.9 }), 40));
  const knitTex = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#eeb3c4'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(150, 70, 95, .35)'; g.lineWidth = 2;
    for (let x = 0; x < w; x += 12) for (let y = 0; y < h; y += 12) { g.beginPath(); g.moveTo(x, y); g.lineTo(x + 6, y + 10); g.lineTo(x + 12, y); g.stroke(); }
  }, [3, 3]);
  const knit = new THREE.MeshStandardMaterial({ map: knitTex, bumpMap: knitTex, bumpScale: 2, roughness: 1, side: THREE.DoubleSide });
  basket.add(ball(0.16, knit, 0, 0.27, 0, 1, 0.45, 1));
  const drapeGeo = new THREE.PlaneGeometry(0.2, 0.24, 6, 10);
  { const a = drapeGeo.attributes.position;
    for (let i = 0; i < a.count; i++) { const y = a.getY(i), x = a.getX(i); a.setZ(i, Math.sin(x * 40) * 0.008 + Math.max(0, y - 0.06) * 0.9); } }
  drapeGeo.computeVertexNormals();
  const drape = new THREE.Mesh(drapeGeo, knit);
  drape.position.set(0.12, 0.17, 0.1); drape.rotation.y = Math.PI / 4;
  basket.add(drape);
  add(basket, 0.26, 0, 2.62);

  const lamp = new THREE.Group();
  const lampBase = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.14, 0.025, 40), brass);
  lampBase.position.y = 0.0125;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 1.38, 12), brass);
  pole.position.y = 0.7;
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 0.26, 48, 1, true),
    new THREE.MeshStandardMaterial({ color: '#f4ece0', roughness: 0.95, emissive: '#ffcf96', emissiveIntensity: 0.55, side: THREE.DoubleSide }));
  shade.position.y = 1.42;
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 12), new THREE.MeshBasicMaterial({ color: '#fff3dc' }));
  bulb.position.y = 1.38;
  lamp.add(lampBase, pole, shade, bulb);
  add(lamp, 0.32, 0, 3.66);
  shade.castShadow = false;
  const lampLight = new THREE.PointLight('#ffc98c', 2.4, 3.2, 2);
  lampLight.position.set(0.32, 1.4, 3.66);
  scene.add(lampLight);

  // Wall clock (shows the visitor's real local time) above the cereal shelf.
  const clockFace = canvasTex(256, 256, (g, w) => {
    g.fillStyle = '#fbf9f6'; g.beginPath(); g.arc(w / 2, w / 2, w / 2, 0, 7); g.fill();
    g.fillStyle = '#3a3338';
    for (let i = 0; i < 12; i++) {
      g.save(); g.translate(w / 2, w / 2); g.rotate((i / 12) * Math.PI * 2);
      g.fillRect(-2, -w / 2 + 14, 4, i % 3 ? 12 : 22); g.restore();
    }
  });
  const wallClock = new THREE.Group();
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.03, 48), [oak, new THREE.MeshStandardMaterial({ map: clockFace, roughness: 0.4 }), oak]);
  rim.rotation.x = Math.PI / 2;
  const handMat = std('#2e2a2d', 0.4);
  const mkHand = (len, wdt) => { const h = new THREE.Group(); const m = new THREE.Mesh(new THREE.BoxGeometry(wdt, len, 0.004), handMat); m.position.y = len / 2 - 0.012; h.add(m); h.position.z = 0.018; return h; };
  const hourHand = mkHand(0.065, 0.009), minHand = mkHand(0.1, 0.006), secHand = mkHand(0.11, 0.0025);
  secHand.children[0].material = std('#c2617f', 0.4);
  secHand.position.z = 0.021;
  wallClock.add(rim, hourHand, minHand, secHand);
  wallClock.rotation.y = Math.PI / 2;
  add(wallClock, 0.016, 1.98, 3.0);
  function updateClock() {
    const d = new Date(), s = d.getSeconds() + d.getMilliseconds() / 1000, m = d.getMinutes() + s / 60, h = (d.getHours() % 12) + m / 60;
    secHand.rotation.z = -(s / 60) * Math.PI * 2;
    minHand.rotation.z = -(m / 60) * Math.PI * 2;
    hourHand.rotation.z = -(h / 12) * Math.PI * 2;
  }
  updateClock();

  // Framed pastel print beside the fridge (same gradient family as the page).
  const artTex = canvasTex(256, 330, (g, w, h) => {
    g.fillStyle = '#fbf8f6'; g.fillRect(0, 0, w, h);
    for (const [x, y, r, c] of [[90, 120, 110, '239, 195, 211'], [170, 170, 115, '212, 203, 236'], [110, 230, 100, '198, 219, 232'], [180, 90, 75, '243, 217, 201']]) blob(g, x, y, r, c, 0.95);
    g.strokeStyle = 'rgba(159, 95, 120, .55)'; g.lineWidth = 2.5;
    g.beginPath(); g.arc(128, 165, 44, 0.3, 5.6); g.stroke();
  });
  const art = new THREE.Group();
  const artFrame = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.025), oak);
  const print = new THREE.Mesh(new THREE.PlaneGeometry(0.33, 0.43), new THREE.MeshStandardMaterial({ map: artTex, roughness: 0.9 }));
  print.position.z = 0.0131;
  art.add(artFrame, print);
  add(art, 4.62, 1.55, 0.0125);

  // ---------- wait for models, then finish the characters ----------
  const danaR = await danaP;

  // ---------- window: real opening in the left wall, glass, view outside, sunbeam ----------
  const { oy0, oy1, oz0, oz1 } = opening;
  const wallTop = ROOM.h - 0.14;
  // One extruded slab with a hole (separate boxes left visible seams in the AO pass).
  const wallShape = new THREE.Shape([[0, -0.14], [ROOM.d, -0.14], [ROOM.d, wallTop], [0, wallTop]].map(([x, y]) => new THREE.Vector2(x, y)));
  wallShape.holes.push(new THREE.Path([[oz0, oy0], [oz0, oy1], [oz1, oy1], [oz1, oy0]].map(([x, y]) => new THREE.Vector2(x, y))));
  const leftGeo = new THREE.ExtrudeGeometry(wallShape, { depth: 0.12, bevelEnabled: false });
  leftGeo.rotateY(-Math.PI / 2);   // shape x -> world z, extrusion -> world -x
  const leftWall = new THREE.Mesh(leftGeo, [wallMat, wallEdge]);
  leftWall.castShadow = leftWall.receiveShadow = true;
  scene.add(leftWall);
  // Bright garden view just outside the glass (unlit; hidden by the wall except through the window).
  const outside = canvasTex(256, 256, (g, w, h) => {
    const sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#dfe9f1'); sky.addColorStop(0.55, '#f4f1ea'); sky.addColorStop(1, '#eef0e4');
    g.fillStyle = sky; g.fillRect(0, 0, w, h);
    const r = rng(23);
    for (let i = 0; i < 40; i++) {
      const x = r() * w, y = h * (0.62 + r() * 0.35), rad = 18 + r() * 34;
      blob(g, x, y, rad, `${150 + r() * 30 | 0}, ${178 + r() * 25 | 0}, ${140 + r() * 20 | 0}`, 0.8);
    }
    blob(g, w * 0.3, h * 0.25, 70, '255, 250, 235', 0.8);
  });
  const bdTop = Math.min(oy1 + 0.05, wallTop - 0.25), bdBot = oy0 - 0.9, bdZ0 = oz0 - 1.0, bdZ1 = oz1 + 0.1;
  // (transparent flag only keeps it out of the AO buffers; colour > 1 reads as bright daylight)
  const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(bdZ1 - bdZ0, bdTop - bdBot),
    new THREE.MeshBasicMaterial({ map: outside, color: new THREE.Color(1.3, 1.3, 1.3), transparent: true }));
  backdrop.rotation.y = Math.PI / 2;
  backdrop.position.set(-0.15, (bdTop + bdBot) / 2, (bdZ0 + bdZ1) / 2);
  backdrop.userData.noRay = true;
  scene.add(backdrop);

  // Soft god-rays from the window to the floor, with drifting dust.
  const beamCorners = [[oy0, oz0], [oy1, oz0], [oy1, oz1], [oy0, oz1]].map(([y, z]) => new THREE.Vector3(0.02, y, z));
  const beamFloor = beamCorners.map((c) => c.clone().addScaledVector(SUN_DIR, c.y / -SUN_DIR.y));
  const bPos = [], bA = [];
  for (let i = 0; i < 4; i++) {
    const a = beamCorners[i], b = beamCorners[(i + 1) % 4], c = beamFloor[(i + 1) % 4], d = beamFloor[i];
    bPos.push(...a.toArray(), ...b.toArray(), ...c.toArray(), ...a.toArray(), ...c.toArray(), ...d.toArray());
    bA.push(1, 1, 0, 1, 0, 0);
  }
  const beamGeo = new THREE.BufferGeometry();
  beamGeo.setAttribute('position', new THREE.Float32BufferAttribute(bPos, 3));
  beamGeo.setAttribute('a', new THREE.Float32BufferAttribute(bA, 1));
  const beamMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: new THREE.Color('#fff1d6') }, uOpacity: { value: 0.11 } },
    vertexShader: 'attribute float a; varying float vA; void main(){ vA = a; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 uColor; uniform float uOpacity; varying float vA; void main(){ gl_FragColor = vec4(uColor * uOpacity * vA * vA, 1.0); }',
  });
  if (!composer) beamMat.uniforms.uOpacity.value *= 0.6;   // no HDR pass on mobile: additive light reads brighter
  const beam = new THREE.Mesh(beamGeo, beamMat);
  beam.userData.noRay = true;
  scene.add(beam);
  const dustPos = [], dustSeed = [];
  { const r = rng(29);
    for (let i = 0; i < 90; i++) {
      const t = 0.05 + r() * 0.75, u = r(), v = r();
      const top = new THREE.Vector3().lerpVectors(beamCorners[0], beamCorners[3], u).lerp(new THREE.Vector3().lerpVectors(beamCorners[1], beamCorners[2], u), v);
      const p = top.addScaledVector(SUN_DIR, t * top.y / -SUN_DIR.y);
      dustPos.push(p.x, p.y, p.z); dustSeed.push(r() * 100);
    } }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.Float32BufferAttribute(dustPos, 3));
  dustGeo.setAttribute('seed', new THREE.Float32BufferAttribute(dustSeed, 1));
  const dustMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uSize: { value: 1.7 * renderer.getPixelRatio() } },
    vertexShader: `attribute float seed; uniform float uTime; uniform float uSize; varying float vT;
      void main(){ vec3 p = position + vec3(sin(uTime * 0.21 + seed) * 0.05, sin(uTime * 0.13 + seed * 1.7) * 0.07, cos(uTime * 0.17 + seed) * 0.05);
        vT = 0.5 + 0.5 * sin(uTime * 0.8 + seed * 3.0); gl_PointSize = uSize * (0.6 + vT * 0.6);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }`,
    fragmentShader: `varying float vT; void main(){ vec2 c = gl_PointCoord - 0.5; float d = dot(c, c); if (d > 0.25) discard;
        gl_FragColor = vec4(vec3(1.0, 0.95, 0.85) * (1.0 - d * 4.0) * (0.12 + 0.3 * vT), 1.0); }`,
  });
  const dust = new THREE.Points(dustGeo, dustMat);
  scene.add(dust);

  // Towel over the oven door handle.
  towel.position.set(ovenCx + 0.11, 0.565, 0.64);
  const towelFold = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.025, 0.03), towel.material);
  towelFold.position.set(0, 0.155, -0.008);
  towel.add(towelFold);
  scene.add(shadowy(towel));
  furniture.push({ obj: lamp }, { obj: basket }, { obj: bear });   // floor lamp + basket are obstacles for click-to-walk too

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
  const braids = [], bangMeshes = [];
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
    const tie = new THREE.Vector3(side * 0.62, 2.2, -0.1);   // pivot at the hair tie so the braid can sway
    braid.children.forEach((c) => c.position.sub(tie));
    braid.position.copy(tie);
    braid.userData.side = side;
    braids.push(braid);
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
    bangMeshes.push(bangs);
    danaModel.add(bangs);
  }
  dana.updateMatrixWorld(true);

  const eye = eyeBox.getCenter(new THREE.Vector3())
    .add(new THREE.Vector3(Math.sin(dana.rotation.y), 0, Math.cos(dana.rotation.y)).multiplyScalar(0.03));

  // ---------- Dana rig: the model has no skeleton, so group her parts under pivots ----------
  const part = {};
  danaModel.traverse((o) => { if (o.isMesh && o.name) part[o.name] = o; });
  const localBox = (mesh) => { mesh.geometry.computeBoundingBox(); return mesh.geometry.boundingBox; };  // model space
  function rig(objs, pivotModel, parent = danaModel) {
    const g = new THREE.Group();
    parent.add(g);
    dana.updateMatrixWorld(true);
    g.position.copy(parent.worldToLocal(danaModel.localToWorld(pivotModel.clone())));
    g.updateMatrixWorld(true);
    objs.filter(Boolean).forEach((o) => g.attach(o));
    return g;
  }
  const hip = (m) => { const b = localBox(m); return new THREE.Vector3((b.min.x + b.max.x) / 2, b.max.y, (b.min.z + b.max.z) / 2); };
  const shoulder = (m, side) => { const b = localBox(m); return new THREE.Vector3(side > 0 ? b.min.x + 0.06 : b.max.x - 0.06, b.max.y - 0.06, (b.min.z + b.max.z) / 2); };
  const neckB = localBox(part.neck);
  const danaRig = {
    legs: [rig([part['leg-1'], part['sock-1'], part['shoe-1']], hip(part['leg-1'])),
           rig([part.leg1, part.sock1, part.shoe1], hip(part.leg1))],
    arms: [rig([part['arm-1'], part['hand-1']], shoulder(part['arm-1'], -1)),
           rig([part.arm1, part.hand1], shoulder(part.arm1, 1))],
    head: rig(['head', 'ear-1', 'ear1', 'haircap', 'backhair', 'tie-1', 'tie1', 'bow-1', 'bow1', 'eyeWhite-1', 'eyeShine-1',
      'eyeWhite1', 'eyeShine1', 'blush-1', 'blush1', 'nose', 'smile'].map((n) => part[n]).concat(bangMeshes, braids),
      new THREE.Vector3(0, neckB.max.y - 0.08, 0)),
  };
  danaRig.eyes = ['-1', '1'].map((k) => rig([part['eyeWhite' + k], part['eyeShine' + k]],
    localBox(part['eyeWhite' + k]).getCenter(new THREE.Vector3()), danaRig.head));
  // Open, smiling mouth (replaces the model's flat oval).
  {
    const smile = new THREE.Shape();
    smile.moveTo(-0.07, 0.006); smile.quadraticCurveTo(0, -0.008, 0.07, 0.006);
    smile.bezierCurveTo(0.065, -0.07, -0.065, -0.07, -0.07, 0.006);
    const tongue = new THREE.Shape();
    tongue.moveTo(-0.035, -0.035); tongue.bezierCurveTo(-0.02, -0.012, 0.02, -0.012, 0.035, -0.035);
    tongue.bezierCurveTo(0.025, -0.052, -0.025, -0.052, -0.035, -0.035);
    const mouth = new THREE.Mesh(new THREE.ShapeGeometry(smile, 16), new THREE.MeshStandardMaterial({ color: '#b5566f', roughness: 0.5 }));
    const tg = new THREE.Mesh(new THREE.ShapeGeometry(tongue, 12), new THREE.MeshStandardMaterial({ color: '#f39ab0', roughness: 0.5 }));
    tg.position.z = 0.002;
    mouth.add(tg);
    mouth.position.set(0, 1.9, 0.548);
    mouth.rotation.x = -0.12;
    part.smile.visible = false;
    danaModel.add(mouth);
    danaRig.head.attach(mouth);
  }
  const headRestY = danaRig.head.position.y;
  const neckModel = new THREE.Vector3(0, neckB.max.y, 0);
  const anim = { phase: 0, moving: 0, wave: 0, blink: 2.5, yaw: 0, pitch: 0 };
  const WAVE_TIME = 1.9;

  function updateDana(dt, moving) {
    anim.moving += ((moving ? 1 : 0) - anim.moving) * Math.min(1, dt * 8);
    const mv = anim.moving;
    anim.phase += dt * 9 * mv;
    const s = Math.sin(anim.phase);
    danaRig.legs[0].rotation.x = s * 0.5 * mv;
    danaRig.legs[1].rotation.x = -s * 0.5 * mv;
    danaRig.arms[0].rotation.x = -s * 0.42 * mv;
    danaRig.arms[1].rotation.x = s * 0.42 * mv;
    danaModel.position.y = Math.abs(Math.cos(anim.phase)) * 0.05 * mv;
    // breathing
    danaRig.head.position.y = headRestY + Math.sin(elapsed * 2.2) * 0.012;
    // wave with the right arm (model +x side)
    if (anim.wave > 0) anim.wave = Math.max(0, anim.wave - dt);
    const env = anim.wave > 0 ? Math.min(1, (WAVE_TIME - anim.wave) / 0.25, anim.wave / 0.25) : 0;
    danaRig.arms[1].rotation.z = env * (2.35 + 0.32 * Math.sin(elapsed * 13));
    danaRig.arms[1].rotation.x *= 1 - env;
    // blink every few seconds
    anim.blink -= dt;
    const closed = anim.blink < 0 ? THREE.MathUtils.clamp(Math.abs(anim.blink + 0.07) / 0.07, 0.08, 1) : 1;
    danaRig.eyes.forEach((e) => { e.scale.y = closed; });
    if (anim.blink < -0.14) anim.blink = 2.2 + Math.random() * 3;   // (closed is clamped below too)
    // braids sway (more while walking)
    braids.forEach((b) => {
      b.rotation.z = Math.sin(elapsed * 1.7 + b.userData.side) * 0.05 + Math.sin(anim.phase) * 0.12 * mv;
      b.rotation.x = 0.18 * mv;
    });
    // head: look toward the cursor, tilt a little while waving
    danaRig.head.rotation.y += (anim.yaw - danaRig.head.rotation.y) * Math.min(1, dt * 6);
    danaRig.head.rotation.x += (anim.pitch - danaRig.head.rotation.x) * Math.min(1, dt * 6);
    danaRig.head.rotation.z = env * 0.12;
  }

  // Robot animation.
  const robot = bot.obj;
  const playClip = (name, once) => bot.play(name, once);
  let robotYaw = 0, robotYawGoal = 0;
  const REACTIONS = ['Wave', 'ThumbsUp', 'Dance', 'Jump', 'Yes'];
  bot.onFinish = () => { if (play && !movers.robot.path) playClip('Idle'); };
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
  scene.traverse((o) => { if (o.isMesh && !skip.has(o) && !o.userData.noRay && !o.parent?.userData?.opacity) solids.push(o); });
  const sensor = robotHome.clone().add(new THREE.Vector3(0, 0.95, 0));   // antenna tip
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
  let play = false;
  function syncState() {
    const prev = step;
    step = root.getAttribute('data-step') || 'sense';
    if (play && step !== prev) exitPlay();   // picking a story step ends play mode
    const story = play ? 0 : 1;
    const sensorsOn = (step === 'sense' ? 1 : step === 'reason' ? 0.3 : 0) * story;
    for (const n of ['cam', 'gaze', 'audio', 'lidar']) {
      layers[n].userData.target = root.classList.contains('off-' + n) ? 0 : sensorsOn;
    }
    layers.reason.userData.target = step === 'reason' ? story : 0;
    layers.act.userData.target = step === 'act' ? story : 0;
    if (!play && step === 'act' && prev !== 'act') startWalk();
    if (!play && step !== 'act' && prev === 'act') resetAct();
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

  // ---------- play mode: walk the characters around ----------
  const movers = {
    robot: { obj: robot, speed: 0.95, radius: 0.2, path: null, home: robotHome.clone(), homeRot: robotHomeRot, turn: null },
    dana: { obj: dana, speed: 0.72, radius: 0.18, path: null, home: dana.position.clone(), homeRot: dana.rotation.y, turn: null },
  };
  let selected = movers.robot;

  // Floor obstacles: footprints of furniture standing on the floor.
  const obstacles = furniture.map((r) => new THREE.Box3().setFromObject(r.obj))
    .filter((b) => b.min.y < 0.4 && b.max.y > 0.05);
  const NAV = { x0: 0.14, z0: 0.14, cell: 0.08 };
  NAV.nx = Math.floor((ROOM.w - 0.1 - NAV.x0) / NAV.cell);
  NAV.nz = Math.floor((ROOM.d - 0.1 - NAV.z0) / NAV.cell);
  const cellX = (i) => NAV.x0 + (i + 0.5) * NAV.cell, cellZ = (j) => NAV.z0 + (j + 0.5) * NAV.cell;
  const toCell = (p) => [THREE.MathUtils.clamp(Math.floor((p.x - NAV.x0) / NAV.cell), 0, NAV.nx - 1),
                         THREE.MathUtils.clamp(Math.floor((p.z - NAV.z0) / NAV.cell), 0, NAV.nz - 1)];
  function navGrid(m) {
    const other = m === movers.robot ? movers.dana : movers.robot;
    const op = other.obj.position, keep = other.radius + m.radius + 0.06;
    const g = new Uint8Array(NAV.nx * NAV.nz);
    for (let j = 0; j < NAV.nz; j++) for (let i = 0; i < NAV.nx; i++) {
      const x = cellX(i), z = cellZ(j);
      let hit = Math.hypot(x - op.x, z - op.z) < keep;
      for (const b of obstacles) {
        if (hit) break;
        hit = x > b.min.x - m.radius && x < b.max.x + m.radius && z > b.min.z - m.radius && z < b.max.z + m.radius;
      }
      g[j * NAV.nx + i] = hit ? 1 : 0;
    }
    return g;
  }
  function findPath(m, goalP) {
    const g = navGrid(m), N = NAV.nx;
    const [si, sj] = toCell(m.obj.position);
    let [gi, gj] = toCell(goalP);
    g[sj * N + si] = 0;
    if (g[gj * N + gi]) {   // clicked inside furniture: walk to the nearest free spot
      const seen = new Uint8Array(g.length), q = [[gi, gj]]; seen[gj * N + gi] = 1;
      let found = null;
      while (q.length && !found) {
        const [ci, cj] = q.shift();
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ni = ci + di, nj = cj + dj;
          if (ni < 0 || nj < 0 || ni >= N || nj >= NAV.nz || seen[nj * N + ni]) continue;
          seen[nj * N + ni] = 1;
          if (!g[nj * N + ni]) { found = [ni, nj]; break; }
          q.push([ni, nj]);
        }
      }
      if (!found) return null;
      [gi, gj] = found;
    }
    // A* (8-connected, no corner cutting)
    const start = sj * N + si, end = gj * N + gi;
    const cost = new Float32Array(g.length).fill(Infinity), from = new Int32Array(g.length).fill(-1);
    const open = [[0, start]]; cost[start] = 0;
    const h = (k) => { const dx = Math.abs(k % N - gi), dz = Math.abs(((k / N) | 0) - gj); return Math.max(dx, dz) + 0.414 * Math.min(dx, dz); };
    while (open.length) {
      let bi = 0;
      for (let k = 1; k < open.length; k++) if (open[k][0] < open[bi][0]) bi = k;
      const [, cur] = open.splice(bi, 1)[0];
      if (cur === end) break;
      const ci = cur % N, cj = (cur / N) | 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = ci + di, nj = cj + dj;
        if (ni < 0 || nj < 0 || ni >= N || nj >= NAV.nz) continue;
        const nk = nj * N + ni;
        if (g[nk] || (di && dj && (g[cj * N + ni] || g[nj * N + ci]))) continue;
        const c = cost[cur] + (di && dj ? 1.414 : 1);
        if (c < cost[nk]) { cost[nk] = c; from[nk] = cur; open.push([c + h(nk), nk]); }
      }
    }
    if (end !== start && from[end] < 0) return null;
    const cells = [];
    for (let k = end; k !== -1 && k !== start; k = from[k]) cells.unshift(k);
    // String-pull: keep only the waypoints needed for straight, unobstructed segments.
    const pt = (k) => new THREE.Vector3(cellX(k % N), m.obj.position.y, cellZ((k / N) | 0));
    const clear = (a, b) => {
      const n = Math.ceil(a.distanceTo(b) / (NAV.cell * 0.5));
      for (let t = 1; t < n; t++) {
        const [ci, cj] = toCell(tmp2.lerpVectors(a, b, t / n));
        if (g[cj * N + ci]) return false;
      }
      return true;
    };
    const path = [];
    let anchor = m.obj.position.clone(), k = 0;
    while (k < cells.length) {
      let far = k;
      while (far + 1 < cells.length && clear(anchor, pt(cells[far + 1]))) far++;
      anchor = pt(cells[far]);
      path.push(anchor);
      k = far + 1;
    }
    return path;
  }
  function moveTo(m, p) {
    const path = findPath(m, p);
    if (!path || !path.length) return false;
    m.path = path;
    m.turn = null;
    if (m === movers.robot) playClip('Walking');
    return true;
  }
  const yawTo = (from, to) => Math.atan2(to.x - from.x, to.z - from.z);
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  function faceCamera(m) { m.turn = yawTo(m.obj.position, camera.position); }

  // Selection ring, click pin and floating hearts.
  const selRing = new THREE.Mesh(new THREE.RingGeometry(0.25, 0.29, 56),
    new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
  selRing.rotation.x = -Math.PI / 2;
  scene.add(selRing);
  const pin = new THREE.Mesh(new THREE.RingGeometry(0.05, 0.075, 40),
    new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
  pin.rotation.x = -Math.PI / 2;
  pin.userData.age = 9;
  scene.add(pin);
  const heartTex = canvasTex(64, 64, (g) => {
    g.fillStyle = '#e886ad';
    g.beginPath(); g.moveTo(32, 56);
    g.bezierCurveTo(4, 36, 6, 10, 22, 10); g.bezierCurveTo(28, 10, 32, 16, 32, 21);
    g.bezierCurveTo(32, 16, 36, 10, 42, 10); g.bezierCurveTo(58, 10, 60, 36, 32, 56); g.fill();
  });
  const hearts = [];
  function spawnHearts(at) {
    const top = at || danaRig.head.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.45, 0));
    for (let i = 0; i < 6; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: heartTex, transparent: true, depthWrite: false }));
      sp.position.copy(top).add(new THREE.Vector3((Math.random() - 0.5) * 0.45, Math.random() * 0.12, (Math.random() - 0.5) * 0.45));
      sp.userData = { age: -i * 0.12, drift: (Math.random() - 0.5) * 0.25 };
      sp.scale.setScalar(0.001);
      scene.add(sp);
      hearts.push(sp);
    }
  }

  function react(m) {
    faceCamera(m);
    if (m === movers.robot) {
      if (m.path) return;
      playClip(REACTIONS[Math.floor(Math.random() * REACTIONS.length)], true);
    } else {
      anim.wave = WAVE_TIME;
      spawnHearts();
    }
  }
  function enterPlay() {
    if (play) return;
    play = true;
    if (walk) { walk = null; playClip('Idle'); }   // stop the story's walk where it is
    root.classList.add('is-play');
    root.dispatchEvent(new CustomEvent('scene:play', { bubbles: true }));
    syncState();
  }
  function exitPlay() {
    if (!play) return;
    play = false;
    root.classList.remove('is-play');
    for (const m of Object.values(movers)) {
      m.path = null; m.turn = null;
      m.obj.position.copy(m.home);
      m.obj.rotation.y = m.homeRot;
    }
    anim.wave = 0;
    selected = movers.robot;
    playClip('Idle');
  }
  const storyBtn = root.querySelector('.scene-story');
  if (storyBtn) storyBtn.addEventListener('click', () => {
    exitPlay();
    root.dispatchEvent(new CustomEvent('scene:story', { bubbles: true }));
    syncState();
  });

  // ---------- pointer: drag to orbit, click to play ----------
  const ndc = new THREE.Vector2();
  const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const lookPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.9);
  const tmp2 = new THREE.Vector3();
  let pointerIn = false, pointerDirty = false;
  const setNdc = (e) => {
    const r = host.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  };
  const owner = (o) => { for (; o; o = o.parent) { if (o === robot) return movers.robot; if (o === dana) return movers.dana; } return null; };
  function pick() {
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects([dana, robot], true).find((h) => h.object.visible);
    return hit ? owner(hit.object) : null;
  }
  function handleClick() {
    const who = pick();
    if (who) { enterPlay(); selected = who; react(who); return; }
    if (ray.intersectObject(bear, true).length) { bear.userData.squish = 1; spawnHearts(bear.localToWorld(new THREE.Vector3(0, 0.38, 0))); return; }
    const p = ray.ray.intersectPlane(floorPlane, new THREE.Vector3());
    if (!p || p.x < 0 || p.z < 0 || p.x > ROOM.w || p.z > ROOM.d) return;
    enterPlay();
    if (moveTo(selected, p)) { pin.position.set(p.x, 0.012, p.z); pin.userData.age = 0; }
  }

  let drag = null;
  host.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY, az: goal.az, el: goal.el, t: performance.now(), moved: false };
    host.setPointerCapture(e.pointerId);
    host.style.cursor = '';
  });
  host.addEventListener('pointermove', (e) => {
    pointerIn = true; pointerDirty = true;
    setNdc(e);
    if (!drag) { requestRender(); return; }
    if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 5) return;
    drag.moved = true;
    host.classList.add('is-dragging');
    goal.az = THREE.MathUtils.clamp(drag.az - (e.clientX - drag.x) * 0.006, THREE.MathUtils.degToRad(8), THREE.MathUtils.degToRad(80));
    goal.el = THREE.MathUtils.clamp(drag.el + (e.clientY - drag.y) * 0.004, THREE.MathUtils.degToRad(18), THREE.MathUtils.degToRad(55));
    requestRender();
  });
  host.addEventListener('pointerup', (e) => {
    const wasClick = drag && !drag.moved && performance.now() - drag.t < 600;
    drag = null; host.classList.remove('is-dragging');
    if (wasClick) { setNdc(e); handleClick(); requestRender(); }
  });
  host.addEventListener('pointercancel', () => { drag = null; host.classList.remove('is-dragging'); });
  host.addEventListener('pointerleave', () => { pointerIn = false; host.style.cursor = ''; });

  // ---------- render loop (only while visible) ----------
  const clock = new THREE.Clock();
  const tmp = new THREE.Vector3();
  let visible = false, raf = 0, elapsed = 0;
  // rAF passes a timestamp as the first argument; wrap it so frame() never mistakes it for dt.
  const tick = () => frame();
  function requestRender() { if (!raf && visible) raf = requestAnimationFrame(tick); }

  function frame(fixedDt) {
    raf = 0;
    const dt = fixedDt || Math.min(clock.getDelta(), 0.05);   // fixedDt only from explicit calls
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
    dustMat.uniforms.uTime.value = elapsed;
    hot.material.opacity = 0.45 + 0.12 * Math.sin(elapsed * 7) * Math.sin(elapsed * 3.1);
    updateClock();
    if (bear.userData.squish > 0) {   // squishy bounce after a tap
      const q = (bear.userData.squish = Math.max(0, bear.userData.squish - dt * 1.6));
      const k = Math.sin((1 - q) * Math.PI * 4) * q * 0.14;
      bear.scale.set(1.5 * (1 + k * 0.6), 1.5 * (1 - k), 1.5 * (1 + k * 0.6));
    }
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

    // Play mode: follow paths, turn toward goals.
    for (const m of Object.values(movers)) {
      const o = m.obj;
      if (m.path) {
        const tgt = m.path[0];
        tmp.subVectors(tgt, o.position).setY(0);
        const dist = tmp.length();
        if (dist < 0.02) {
          m.path.shift();
          if (!m.path.length) { m.path = null; if (m === movers.robot) playClip('Idle'); }
        } else {
          o.position.addScaledVector(tmp.normalize(), Math.min(dist, m.speed * dt));
          o.rotation.y += wrap(Math.atan2(tmp.x, tmp.z) - o.rotation.y) * Math.min(1, dt * 9);
        }
      } else if (m.turn !== null) {
        const d = wrap(m.turn - o.rotation.y);
        o.rotation.y += d * Math.min(1, dt * 7);
        if (Math.abs(d) < 0.01) m.turn = null;
      }
    }

    // Where is the cursor? Characters glance toward it; hovering one shows a pointer.
    if (pointerIn) {
      ray.setFromCamera(ndc, camera);
      const p = ray.ray.intersectPlane(lookPlane, tmp2);
      if (p) {
        const local = danaModel.worldToLocal(p.clone()).sub(neckModel);
        const yaw = Math.atan2(local.x, local.z);
        anim.yaw = Math.abs(yaw) < 1.5 ? THREE.MathUtils.clamp(yaw, -0.65, 0.65) : 0;
        anim.pitch = THREE.MathUtils.clamp(Math.atan2(-local.y, Math.hypot(local.x, local.z)) * 0.6, -0.15, 0.3);
        const ry = wrap(yawTo(robot.position, p) - robot.rotation.y);
        robotYawGoal = Math.abs(ry) < 1.6 ? THREE.MathUtils.clamp(ry, -0.8, 0.8) : 0;
      }
      if (pointerDirty && !drag) { host.style.cursor = (pick() || ray.intersectObject(bear, true).length) ? 'pointer' : ''; pointerDirty = false; }
    } else { anim.yaw = 0; anim.pitch = 0; robotYawGoal = 0; }
    updateDana(dt, !!movers.dana.path);

    // Robot: procedural hover / reactions, head turned toward the cursor.
    robotYaw += (robotYawGoal - robotYaw) * Math.min(1, dt * 5);
    bot.setLook(robotYaw);
    bot.update(reduceMotion ? 0 : dt);

    // Selection ring, click pin, hearts.
    selRing.material.opacity += ((play ? 0.75 : 0) - selRing.material.opacity) * 0.15;
    selRing.visible = selRing.material.opacity > 0.01;
    selRing.position.set(selected.obj.position.x, 0.011, selected.obj.position.z);
    selRing.scale.setScalar((selected === movers.dana ? 1.05 : 1) * (1 + 0.04 * Math.sin(elapsed * 4)));
    pin.userData.age += dt;
    pin.visible = pin.userData.age < 0.9;
    pin.material.opacity = 0.9 * (1 - pin.userData.age / 0.9);
    pin.scale.setScalar(1 + pin.userData.age * 2);
    for (let i = hearts.length - 1; i >= 0; i--) {
      const h = hearts[i], u = h.userData;
      u.age += dt;
      if (u.age < 0) continue;
      h.position.y += dt * 0.42;
      h.position.x += dt * u.drift;
      h.scale.setScalar(0.24 * Math.min(1, u.age * 6));
      h.material.opacity = Math.max(0, 1 - u.age / 1.5);
      if (u.age > 1.5) { scene.remove(h); h.material.dispose(); hearts.splice(i, 1); }
    }

    if (composer) composer.render(dt); else renderer.render(scene, camera);

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

    if (visible) raf = requestAnimationFrame(tick);
  }

  new IntersectionObserver((entries) => {
    visible = entries[0].isIntersecting;
    if (visible) { clock.getDelta(); requestRender(); }
  }, { threshold: 0.01 }).observe(host);
  new ResizeObserver(() => { resize(); requestRender(); }).observe(host);

  // Reflections of the actual room (captured once from its centre, with the invisible
  // ceiling/front walls shown as soft white) instead of a generic studio environment.
  {
    const hide = [dana, robot, beam, dust, selRing, pin, ...steam, ...Object.values(layers)].filter((o) => o.visible);
    hide.forEach((o) => { o.visible = false; });
    const ghostState = { opacity: ghost.opacity, transparent: ghost.transparent, depthWrite: ghost.depthWrite };
    Object.assign(ghost, { opacity: 1, transparent: false, depthWrite: true }); ghost.color.set('#f3eee8'); ghost.needsUpdate = true;
    const studio = scene.environment;
    scene.environment = null;
    scene.position.set(-ROOM.w / 2, -1.3, -ROOM.d / 2);
    scene.updateMatrixWorld(true);
    const envRT = pmrem.fromScene(scene, 0.035, 0.05, 20);
    scene.position.set(0, 0, 0);
    scene.updateMatrixWorld(true);
    Object.assign(ghost, ghostState); ghost.needsUpdate = true;
    hide.forEach((o) => { o.visible = true; });
    scene.environment = envRT.texture;
    studio.dispose();
  }
  // Compile shaders in the background (KHR_parallel_shader_compile) while the illustration is still showing.
  try { await renderer.compileAsync(scene, camera); } catch (e) { /* older browsers: compiled on first frame */ }
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
