import * as THREE from 'three';

const WORLD_SIZE = 84 * 3;
const MAX_HEIGHT = 16;
const TREE_RATE = 0.07;

const canvas = document.getElementById('scene');
const statusEl = document.getElementById('status');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#87b9ff');
scene.fog = new THREE.Fog('#87b9ff', 30, 140);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 320);
camera.position.set(12, 18, 12);

const hemiLight = new THREE.HemisphereLight('#dbefff', '#4e633f', 0.8);
scene.add(hemiLight);

const sun = new THREE.DirectionalLight('#fff7d2', 1.1);
sun.position.set(60, 90, 35);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -120;
sun.shadow.camera.right = 120;
sun.shadow.camera.top = 120;
sun.shadow.camera.bottom = -120;
scene.add(sun);

const world = new THREE.Group();
scene.add(world);

function fract(v) {
  return v - Math.floor(v);
}

function hash2(x, z) {
  return fract(Math.sin(x * 127.1 + z * 311.7) * 43758.5453123);
}

function smoothNoise(x, z) {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const tx = x - x0;
  const tz = z - z0;
  const a = hash2(x0, z0);
  const b = hash2(x0 + 1, z0);
  const c = hash2(x0, z0 + 1);
  const d = hash2(x0 + 1, z0 + 1);
  const sx = tx * tx * (3 - 2 * tx);
  const sz = tz * tz * (3 - 2 * tz);
  const nx0 = a + (b - a) * sx;
  const nx1 = c + (d - c) * sx;
  return nx0 + (nx1 - nx0) * sz;
}

function terrainHeight(x, z) {
  const broad = smoothNoise(x * 0.05, z * 0.05) * 10;
  const rolling = smoothNoise(x * 0.12 + 42, z * 0.12 + 12) * 6;
  const detail = smoothNoise(x * 0.23 + 90, z * 0.23 + 37) * 2;
  return Math.max(2, Math.min(MAX_HEIGHT, Math.round(2 + broad + rolling + detail)));
}

function makeWorld() {
  const grassMat = new THREE.MeshStandardMaterial({ color: '#58a83f', roughness: 0.95 });
  const dirtMat = new THREE.MeshStandardMaterial({ color: '#805d3b', roughness: 1 });
  const stoneMat = new THREE.MeshStandardMaterial({ color: '#7f858f', roughness: 0.9 });

  const cubeGeo = new THREE.BoxGeometry(1, 1, 1);
  const grassMesh = new THREE.InstancedMesh(cubeGeo, grassMat, WORLD_SIZE * WORLD_SIZE);
  const soilMesh = new THREE.InstancedMesh(cubeGeo, dirtMat, WORLD_SIZE * WORLD_SIZE * 2);
  const stoneMesh = new THREE.InstancedMesh(cubeGeo, stoneMat, WORLD_SIZE * WORLD_SIZE);

  grassMesh.castShadow = true;
  grassMesh.receiveShadow = true;
  soilMesh.castShadow = true;
  soilMesh.receiveShadow = true;
  stoneMesh.castShadow = true;
  stoneMesh.receiveShadow = true;

  const matrix = new THREE.Matrix4();
  let grassIdx = 0;
  let soilIdx = 0;
  let stoneIdx = 0;

  const treeSegments = [];
  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.22, 1.3, 6);
  const trunkMat = new THREE.MeshStandardMaterial({ color: '#6b4827', roughness: 1 });
  const leafGeo = new THREE.ConeGeometry(0.9, 1.9, 7);
  const leafMat = new THREE.MeshStandardMaterial({ color: '#2f8a42', roughness: 0.9 });
  const maxTrees = Math.ceil(WORLD_SIZE * WORLD_SIZE * TREE_RATE);
  const trunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, maxTrees);
  const leafMesh = new THREE.InstancedMesh(leafGeo, leafMat, maxTrees);
  trunkMesh.castShadow = true;
  trunkMesh.receiveShadow = true;
  leafMesh.castShadow = true;
  leafMesh.receiveShadow = true;
  let treeIdx = 0;

  for (let z = 0; z < WORLD_SIZE; z += 1) {
    for (let x = 0; x < WORLD_SIZE; x += 1) {
      const h = terrainHeight(x, z);

      matrix.makeTranslation(x, h, z);
      grassMesh.setMatrixAt(grassIdx, matrix);
      grassIdx += 1;

      for (let y = h - 1; y >= Math.max(1, h - 2); y -= 1) {
        matrix.makeTranslation(x, y, z);
        soilMesh.setMatrixAt(soilIdx, matrix);
        soilIdx += 1;
      }

      const bedrock = Math.max(0, h - 3);
      matrix.makeTranslation(x, bedrock, z);
      stoneMesh.setMatrixAt(stoneIdx, matrix);
      stoneIdx += 1;

      const seed = hash2(x * 0.7, z * 0.91);
      if (h > 5 && seed > 1 - TREE_RATE) {
        matrix.makeTranslation(x, h + 1.0, z);
        trunkMesh.setMatrixAt(treeIdx, matrix);

        matrix.makeTranslation(x, h + 2.3, z);
        leafMesh.setMatrixAt(treeIdx, matrix);

        treeSegments.push(
          x,
          h + 0.3,
          z,
          x,
          h + 3.1,
          z,
          x - 0.9,
          h + 2.2,
          z,
          x,
          h + 2.95,
          z,
          x + 0.9,
          h + 2.2,
          z,
          x,
          h + 2.95,
          z,
          x,
          h + 2.2,
          z - 0.9,
          x,
          h + 2.95,
          z,
          x,
          h + 2.2,
          z + 0.9,
          x,
          h + 2.95,
          z,
        );

        treeIdx += 1;
      }
    }
  }

  grassMesh.count = grassIdx;
  soilMesh.count = soilIdx;
  stoneMesh.count = stoneIdx;
  trunkMesh.count = treeIdx;
  leafMesh.count = treeIdx;

  grassMesh.instanceMatrix.needsUpdate = true;
  soilMesh.instanceMatrix.needsUpdate = true;
  stoneMesh.instanceMatrix.needsUpdate = true;
  trunkMesh.instanceMatrix.needsUpdate = true;
  leafMesh.instanceMatrix.needsUpdate = true;

  world.add(stoneMesh);
  world.add(soilMesh);
  world.add(grassMesh);
  world.add(trunkMesh);
  world.add(leafMesh);

  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD_SIZE + 30, WORLD_SIZE + 30),
    new THREE.MeshStandardMaterial({ color: '#3e8fe3', transparent: true, opacity: 0.42 }),
  );
  water.rotation.x = -Math.PI * 0.5;
  water.position.set((WORLD_SIZE - 1) * 0.5, 4.5, (WORLD_SIZE - 1) * 0.5);
  water.receiveShadow = true;
  scene.add(water);

  const vectorGeo = new THREE.BufferGeometry();
  vectorGeo.setAttribute('position', new THREE.Float32BufferAttribute(treeSegments, 3));
  const vectorTree = new THREE.LineSegments(
    vectorGeo,
    new THREE.LineBasicMaterial({ color: '#9df8ab', transparent: true, opacity: 0.5 }),
  );
  world.add(vectorTree);

  statusEl.textContent = `Generated ${WORLD_SIZE}x${WORLD_SIZE} world with smoother performance + continuous terrain.`;
}

const velocity = new THREE.Vector3();
const moveInput = new THREE.Vector3();
const forward = new THREE.Vector3();
const right = new THREE.Vector3();
const up = new THREE.Vector3(0, 1, 0);
const cameraEuler = new THREE.Euler(0, 0, 0, 'YXZ');
let yaw = Math.PI * 0.2;
let pitch = -0.2;
let pointerLocked = false;
let flyMode = false;
let verticalVelocity = 0;
let lastSpaceDown = -Infinity;
const activeKeys = new Set();

const PLAYER_HEIGHT = 1.7;
const JUMP_SPEED = 11;
const GRAVITY = 30;
const DOUBLE_TAP_MS = 260;

function groundLevelAt(x, z) {
  const tx = THREE.MathUtils.clamp(Math.round(x), 0, WORLD_SIZE - 1);
  const tz = THREE.MathUtils.clamp(Math.round(z), 0, WORLD_SIZE - 1);
  return terrainHeight(tx, tz) + PLAYER_HEIGHT;
}

function setModeStatus() {
  if (pointerLocked) {
    statusEl.textContent = flyMode
      ? 'Fly mode ON. Move with WASD, Space up, Shift down. Double-tap Space to land mode.'
      : 'Fly mode OFF. Move with WASD, Space jump. Double-tap Space to fly.';
    return;
  }
  statusEl.textContent = 'Click the scene to re-enter spectator mode.';
}

function moveCamera(dt) {
  moveInput.set(0, 0, 0);
  if (activeKeys.has('KeyW')) moveInput.z += 1;
  if (activeKeys.has('KeyS')) moveInput.z -= 1;
  if (activeKeys.has('KeyA')) moveInput.x -= 1;
  if (activeKeys.has('KeyD')) moveInput.x += 1;
  if (flyMode && activeKeys.has('Space')) moveInput.y += 1;
  if (flyMode && (activeKeys.has('ShiftLeft') || activeKeys.has('ShiftRight'))) moveInput.y -= 1;

  if (moveInput.lengthSq() > 0) moveInput.normalize();

  const speed = activeKeys.has('ControlLeft') ? 34 : 18;
  velocity.copy(moveInput).multiplyScalar(speed * dt);

  forward.set(Math.sin(yaw), 0, Math.cos(yaw));
  right.crossVectors(forward, up).negate();

  camera.position.addScaledVector(forward, -velocity.z);
  camera.position.addScaledVector(right, velocity.x);

  if (flyMode) {
    camera.position.y += velocity.y;
    verticalVelocity = 0;
  } else {
    verticalVelocity -= GRAVITY * dt;
    camera.position.y += verticalVelocity * dt;
    const groundLevel = groundLevelAt(camera.position.x, camera.position.z);
    if (camera.position.y <= groundLevel) {
      camera.position.y = groundLevel;
      verticalVelocity = 0;
    }
  }

  camera.position.x = THREE.MathUtils.clamp(camera.position.x, -20, WORLD_SIZE + 20);
  camera.position.y = THREE.MathUtils.clamp(camera.position.y, 3, 200);
  camera.position.z = THREE.MathUtils.clamp(camera.position.z, -20, WORLD_SIZE + 20);

  cameraEuler.set(pitch, yaw, 0);
  camera.quaternion.setFromEuler(cameraEuler);
}

window.addEventListener('keydown', (event) => {
  if (event.code === 'Space') {
    const now = performance.now();
    const isDoubleTap = now - lastSpaceDown <= DOUBLE_TAP_MS;
    lastSpaceDown = now;

    if (isDoubleTap) {
      flyMode = !flyMode;
      if (!flyMode) {
        const groundLevel = groundLevelAt(camera.position.x, camera.position.z);
        camera.position.y = Math.max(camera.position.y, groundLevel);
      }
      verticalVelocity = 0;
      setModeStatus();
    } else if (!flyMode) {
      const groundLevel = groundLevelAt(camera.position.x, camera.position.z);
      const isGrounded = Math.abs(camera.position.y - groundLevel) < 0.05;
      if (isGrounded) verticalVelocity = JUMP_SPEED;
    }
  }

  activeKeys.add(event.code);
});
window.addEventListener('keyup', (event) => activeKeys.delete(event.code));

canvas.addEventListener('click', async () => {
  if (!document.pointerLockElement) {
    await canvas.requestPointerLock({ unadjustedMovement: true }).catch(() => {});
  }
});

document.addEventListener('pointerlockchange', () => {
  pointerLocked = document.pointerLockElement === canvas;
  setModeStatus();
});

document.addEventListener('mousemove', (event) => {
  if (!pointerLocked) return;
  yaw -= event.movementX * 0.0023;
  pitch -= event.movementY * 0.0023;
  pitch = THREE.MathUtils.clamp(pitch, -1.52, 1.52);
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

makeWorld();

let lastTime = performance.now();
function tick(now) {
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  moveCamera(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
