import * as THREE from '../node_modules/three/build/three.module.js';
import { ANIM_CONFIG, computeUVs } from './anim-state.js';

// --- Config ---
const WIN_SIZE = 200;               // initial window size (sub-agents resize via peon-config)
const HALF = WIN_SIZE / 2;
const SPRITE_SIZE = WIN_SIZE * 0.9; // sprite/bg fill most of the window

// --- Scene setup ---
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({
  canvas,
  alpha: true,
  antialias: false,
});
renderer.setSize(WIN_SIZE, WIN_SIZE);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setClearColor(0x000000, 0);

const scene = new THREE.Scene();

const camera = new THREE.OrthographicCamera(-HALF, HALF, HALF, -HALF, 0.1, 10);
camera.position.z = 1;

// --- Background ---
const bgTex = new THREE.TextureLoader().load('peon-asset://bg.png');
const bgMesh = new THREE.Mesh(
  new THREE.PlaneGeometry(SPRITE_SIZE, SPRITE_SIZE),
  new THREE.MeshBasicMaterial({ map: bgTex, color: 0x888888 })
);
bgMesh.position.z = -0.5;
scene.add(bgMesh);

// --- Sprite mesh ---
const loader = new THREE.TextureLoader();
const atlas = loader.load('peon-asset://sprite-atlas.png', () => {
  atlas.magFilter = THREE.NearestFilter;
  atlas.minFilter = THREE.NearestFilter;
  atlas.generateMipmaps = false;
  atlas.needsUpdate = true;
});

// Square sprite — fills most of the window
let geometry = new THREE.PlaneGeometry(SPRITE_SIZE, SPRITE_SIZE);
const material = new THREE.MeshBasicMaterial({
  map: atlas,
  transparent: true,
  alphaTest: 0.01,
});
const sprite = new THREE.Mesh(geometry, material);
scene.add(sprite);
sprite.position.y = 0;

// --- Flash overlay ---
async function loadShader(url) {
  const r = await fetch(url);
  return r.text();
}

let flashMesh = null;
let flashIntensity = 0;
const flashColor = new THREE.Color(1, 1, 0);
let flashDecay = 2.0;

async function setupFlash() {
  const vert = await loadShader('./shaders/flash.vert');
  const frag = await loadShader('./shaders/flash.frag');

  const flashMat = new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    uniforms: {
      flashColor: { value: flashColor },
      flashIntensity: { value: 0.0 },
    },
    transparent: true,
    depthTest: false,
  });

  const flashGeo = new THREE.PlaneGeometry(WIN_SIZE, WIN_SIZE);
  flashMesh = new THREE.Mesh(flashGeo, flashMat);
  flashMesh.position.z = 0.5;
  scene.add(flashMesh);
}

setupFlash();

// --- Border overlay ---
const borderTex = loader.load('peon-asset://borders.png', () => {
  borderTex.magFilter = THREE.NearestFilter;
  borderTex.minFilter = THREE.NearestFilter;
  borderTex.needsUpdate = true;
});
const borderMesh = new THREE.Mesh(
  new THREE.PlaneGeometry(WIN_SIZE, WIN_SIZE),
  new THREE.MeshBasicMaterial({ map: borderTex, transparent: true, depthTest: false })
);
borderMesh.position.z = 0.4;
scene.add(borderMesh);

// --- Session dots (glowing orbs) ---
const MAX_DOTS = 10;
const DOT_SIZE = 12;
const DOT_GAP  = 6;
const DOT_Y    = 88;

const DOT_HOT  = 0x44ff44; // actively working — bright green, pulsing
const DOT_WARM = 0x1a4d1a; // open but idle — dim green
const DOT_COLD = 0x333333; // cold — grey

const DOT_VERT = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const DOT_FRAG = `
  uniform vec3  dotColor;
  uniform float pulse;   // 0..1 animated for active, 0 for idle
  uniform float visible; // 0 or 1
  varying vec2 vUv;
  void main() {
    if (visible < 0.5) discard;
    vec2  c    = vUv - 0.5;
    float dist = length(c);
    // Soft core
    float core = 1.0 - smoothstep(0.20, 0.32, dist);
    // Outer glow ring — only for active
    float glow = (1.0 - smoothstep(0.32, 0.50, dist)) * pulse * 0.6;
    float alpha = core + glow;
    if (alpha < 0.01) discard;
    vec3 col = dotColor + dotColor * pulse * 0.5;
    gl_FragColor = vec4(col, alpha);
  }
`;

const dotMeshes = [];
const dotActive = [];  // hot dots pulse in the render loop

for (let i = 0; i < MAX_DOTS; i++) {
  const mat = new THREE.ShaderMaterial({
    vertexShader:   DOT_VERT,
    fragmentShader: DOT_FRAG,
    uniforms: {
      dotColor: { value: new THREE.Color(0x666666) },
      pulse:    { value: 0.0 },
      visible:  { value: 0.0 },
    },
    transparent: true,
    depthTest: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(DOT_SIZE, DOT_SIZE), mat);
  mesh.position.z = 0.6;
  scene.add(mesh);
  dotMeshes.push(mesh);
  dotActive.push(false);
}

// X of the first dot's center, for a row of `count` dots centered at x=0.
// Shared by updateDots (visuals) and hitTestDots (hover) so they can't disagree.
function dotStartX(count) {
  const totalWidth = count * DOT_SIZE + Math.max(0, count - 1) * DOT_GAP;
  return -totalWidth / 2 + DOT_SIZE / 2;
}

function updateDots(sessions) {
  const count = Math.min(sessions.length, MAX_DOTS);
  const startX = dotStartX(count);

  for (let i = 0; i < MAX_DOTS; i++) {
    const mesh = dotMeshes[i];
    const u    = mesh.material.uniforms;
    if (i < count) {
      const { hot, warm } = sessions[i];
      dotActive[i] = hot;
      mesh.position.x = startX + i * (DOT_SIZE + DOT_GAP);
      mesh.position.y = DOT_Y;
      u.dotColor.value.set(hot ? DOT_HOT : warm ? DOT_WARM : DOT_COLD);
      u.visible.value = 1.0;
    } else {
      dotActive[i] = false;
      u.visible.value = 0.0;
    }
  }
}

function triggerFlash(r, g, b, intensity = 0.6, decay = 3.0) {
  if (!flashMesh) return;
  flashColor.setRGB(r, g, b);
  flashMesh.material.uniforms.flashColor.value = flashColor;
  flashIntensity = intensity;
  flashDecay = decay;
}

// --- ANIM_FLASH map ---
const ANIM_FLASH = {
  waking:    () => triggerFlash(0.4, 0.8, 1.0, 0.3, 2.0),
  alarmed:   () => triggerFlash(1.0, 0.1, 0.1, 0.5, 2.5),
  celebrate: () => triggerFlash(1.0, 0.8, 0.0, 0.5, 2.0),
  annoyed:   () => triggerFlash(0.8, 0.4, 0.0, 0.3, 2.0),
};

// --- Animation state machine ---
let currentAnim = 'idle';
let currentFrame = 0;
let frameTimer = 0;
let pendingIdle = false;
let remainingLoops = 0;  // extra replays for non-sleeping anims
const REACTION_LOOPS = 3;  // play reaction animations 3x before sleeping
let idleTimer = null;
const IDLE_TIMEOUT_MS = 30000;

function resetIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (!isSubAgent && !anySessionActive) playAnim('sleeping');
  }, IDLE_TIMEOUT_MS);
}

function setFrame(animName, frame) {
  const { u0, u1, v0, v1 } = computeUVs(animName, frame);
  // PlaneGeometry vertex UV order: [0]=TL, [1]=TR, [2]=BL, [3]=BR
  const uv = geometry.attributes.uv;
  uv.setXY(0, u0, v1); // TL
  uv.setXY(1, u1, v1); // TR
  uv.setXY(2, u0, v0); // BL
  uv.setXY(3, u1, v0); // BR
  uv.needsUpdate = true;
}

function playAnim(animName) {
  pendingIdle = false;
  if (!ANIM_CONFIG[animName]) return;
  currentAnim = animName;
  currentFrame = 0;
  frameTimer = 0;
  const loops = ANIM_CONFIG[animName].loops ?? REACTION_LOOPS;
  remainingLoops = (animName !== 'sleeping') ? loops - 1 : 0;
  setFrame(animName, 0);
  if (ANIM_FLASH[animName]) {
    ANIM_FLASH[animName]();
  }
  if (animName !== 'sleeping') {
    resetIdleTimer();
  }
}

playAnim('sleeping');

// --- Tooltip ---
const tooltip = document.getElementById('tooltip');
let currentSessions = [];

function hitTestDots(px, py) {
  const count = Math.min(currentSessions.length, MAX_DOTS);
  if (count === 0) return -1;
  const startThreeX = dotStartX(count);
  const dotCanvasY = HALF - DOT_Y;  // Three.js DOT_Y=88 → canvas pixel y=12
  const HIT_R = DOT_SIZE;           // slightly wider than visual for easier hover
  for (let i = 0; i < count; i++) {
    const dotCanvasX = startThreeX + i * (DOT_SIZE + DOT_GAP) + HALF;
    const dx = px - dotCanvasX;
    const dy = py - dotCanvasY;
    if (dx * dx + dy * dy < HIT_R * HIT_R) return i;
  }
  return -1;
}

// --- Drag handling ---
let dragging = false;

canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;  // left-click only
  dragging = true;
  tooltip.style.display = 'none';
  canvas.setPointerCapture(e.pointerId);
  window.peonBridge.startDrag();
});

canvas.addEventListener('pointerup', (e) => {
  if (e.button !== 0 || !dragging) return;
  dragging = false;
  window.peonBridge.stopDrag();
});

canvas.addEventListener('lostpointercapture', () => {
  if (!dragging) return;
  dragging = false;
  window.peonBridge.stopDrag();
});

canvas.addEventListener('pointercancel', () => {
  if (!dragging) return;
  dragging = false;
  window.peonBridge.stopDrag();
});

function handleMouseMove(e) {
  if (dragging) return;  // suppress tooltip during drag
  const px = e.offsetX;
  const py = e.offsetY;
  const idx = hitTestDots(px, py);
  let html;
  if (idx >= 0) {
    const s = currentSessions[idx];
    const status = s.hot ? '<span style="color:#44ff44">active</span>'
                         : s.warm ? '<span style="color:#1aaa1a">idle</span>'
                         : '<span style="color:#555">cold</span>';
    const label = s.name || ('\u2026' + s.id.slice(-8));
    html = `${label} &bull; ${status}`;
  } else {
    const active = currentSessions.filter(s => s.hot).length;
    const total  = currentSessions.length;
    if (total === 0) {
      html = 'Peon Pet';
    } else {
      const names = currentSessions.map(s => s.name).filter(Boolean);
      html = names.length ? names.join('<br>') : `${active}/${total} sessions`;
    }
  }
  tooltip.innerHTML = html;
  tooltip.style.display = 'block';
  // Position tooltip: prefer to the right/below cursor, clamped inside window
  const tw = tooltip.offsetWidth;
  const th = tooltip.offsetHeight;
  tooltip.style.left = Math.min(px + 6, WIN_SIZE - tw - 2) + 'px';
  tooltip.style.top  = Math.min(py + 6, WIN_SIZE - th - 2) + 'px';
}

function handleMouseLeave() {
  if (!dragging) tooltip.style.display = 'none';
}

canvas.addEventListener('mousemove', handleMouseMove);
canvas.addEventListener('mouseleave', handleMouseLeave);

// --- Sub-agent config ---
let isSubAgent = false;

window.peonBridge.onConfig(({ size, subAgent }) => {
  if (subAgent) isSubAgent = true;
  // Resize HTML body to match window
  document.documentElement.style.width = `${size}px`;
  document.documentElement.style.height = `${size}px`;
  document.body.style.width = `${size}px`;
  document.body.style.height = `${size}px`;

  // Resize renderer
  renderer.setSize(size, size);

  // Update camera bounds
  const half = size / 2;
  camera.left = -half;
  camera.right = half;
  camera.top = half;
  camera.bottom = -half;
  camera.updateProjectionMatrix();

  // Resize meshes to fit smaller window
  const inner = size * 0.9;
  bgMesh.geometry.dispose();
  bgMesh.geometry = new THREE.PlaneGeometry(inner, inner);
  geometry.dispose();
  geometry = new THREE.PlaneGeometry(inner, inner);
  sprite.geometry = geometry;
  borderMesh.geometry.dispose();
  borderMesh.geometry = new THREE.PlaneGeometry(size, size);

  // Re-apply current frame UVs to the new geometry
  setFrame(currentAnim, currentFrame);

  // Remove dots from scene and release WebGL resources
  for (const mesh of dotMeshes) {
    scene.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
  }

  // Disable tooltip
  tooltip.style.display = 'none';
  canvas.removeEventListener('mousemove', handleMouseMove);
  canvas.removeEventListener('mouseleave', handleMouseLeave);
});

// --- IPC events ---
let anySessionActive = false;

window.peonBridge.onEvent(({ anim }) => {
  // Sub-agents only respond to the initial waking event
  if (isSubAgent && anim !== 'waking') return;
  // Don't wake if already active — only wake from sleep
  if (anim === 'waking' && currentAnim !== 'sleeping') return;
  playAnim(anim);
});

window.peonBridge.onSessionUpdate(({ sessions }) => {
  currentSessions = sessions;
  updateDots(sessions);
  const wasActive = anySessionActive;
  anySessionActive = sessions.some(s => s.hot);
  // If a session just became hot and orc is sleeping, wake him to typing
  if (anySessionActive && !wasActive && currentAnim === 'sleeping') {
    playAnim('typing');
  }
});

// --- Render loop ---
let lastTime = 0;
function animate(time) {
  requestAnimationFrame(animate);
  const delta = Math.min((time - lastTime) / 1000, 0.1);
  lastTime = time;

  // Animate dot pulse
  for (let i = 0; i < MAX_DOTS; i++) {
    if (dotActive[i]) {
      dotMeshes[i].material.uniforms.pulse.value = (Math.sin(time * 0.003 + i) + 1) / 2;
    } else {
      dotMeshes[i].material.uniforms.pulse.value = 0.0;
    }
  }

  // Decay flash
  if (flashMesh && flashIntensity > 0) {
    flashIntensity = Math.max(0, flashIntensity - delta * flashDecay);
    flashMesh.material.uniforms.flashIntensity.value = flashIntensity;
  }

  // Advance animation frame
  const cfg = ANIM_CONFIG[currentAnim];
  frameTimer += delta;
  if (frameTimer >= 1 / cfg.fps) {
    frameTimer = 0;
    currentFrame++;
    if (currentFrame >= cfg.frames) {
      if (cfg.loop) {
        currentFrame = 0;
      } else {
        if (remainingLoops > 0) {
          remainingLoops--;
          currentFrame = 0;
        } else {
          currentFrame = cfg.frames - 1;
          if (!pendingIdle) {
            pendingIdle = true;
            setTimeout(() => {
              pendingIdle = false;
              // Sub-agents always stay typing while alive
              if (isSubAgent || anySessionActive) {
                playAnim('typing');
              } else {
                playAnim('sleeping');
              }
            }, 300);
          }
        }
      }
    }
    setFrame(currentAnim, currentFrame);
  }

  renderer.render(scene, camera);
}
requestAnimationFrame(animate);
