import * as THREE from 'three';

const WORLD_SIZE = 84 * 3;
const MAX_HEIGHT = 16;
const SEA_LEVEL = 4;

const CHUNK_SIZE = 16;
const WORLD_CHUNKS = Math.ceil(WORLD_SIZE / CHUNK_SIZE);
const RENDER_DISTANCE = 4;
const SHADOW_CAST_DISTANCE = 2;
const CHUNK_UNLOAD_PADDING = 1;

const BLOCK_AIR = 0;
const BLOCK_STONE = 1;
const BLOCK_DIRT = 2;
const BLOCK_GRASS = 3;

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
sun.shadow.mapSize.set(512, 512);
sun.shadow.camera.left = -70;
sun.shadow.camera.right = 70;
sun.shadow.camera.top = 70;
sun.shadow.camera.bottom = -70;
sun.shadow.camera.near = 10;
sun.shadow.camera.far = 220;
scene.add(sun);

const world = new THREE.Group();
scene.add(world);

const water = new THREE.Mesh(
  new THREE.PlaneGeometry(WORLD_SIZE + 30, WORLD_SIZE + 30),
  new THREE.MeshBasicMaterial({
    color: '#3e8fe3',
    transparent: true,
    opacity: 0.38,
    depthWrite: false,
  }),
);
water.rotation.x = -Math.PI * 0.5;
water.position.set((WORLD_SIZE - 1) * 0.5, SEA_LEVEL + 0.5, (WORLD_SIZE - 1) * 0.5);
water.frustumCulled = false;
scene.add(water);

const materials = {
  [BLOCK_STONE]: new THREE.MeshStandardMaterial({ color: '#7f858f', roughness: 0.9 }),
  [BLOCK_DIRT]: new THREE.MeshStandardMaterial({ color: '#805d3b', roughness: 1 }),
  [BLOCK_GRASS]: new THREE.MeshStandardMaterial({ color: '#58a83f', roughness: 0.95 }),
};

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

function getVoxelTypeAt(wx, y, wz) {
  if (wx < 0 || wz < 0 || wx >= WORLD_SIZE || wz >= WORLD_SIZE || y < 0 || y > MAX_HEIGHT) return BLOCK_AIR;
  const h = terrainHeight(wx, wz);
  if (y > h) return BLOCK_AIR;
  if (y === h) return h < SEA_LEVEL ? BLOCK_DIRT : BLOCK_GRASS;
  if (y >= h - 2) return BLOCK_DIRT;
  return BLOCK_STONE;
}

function buildChunkVoxelData(cx, cz) {
  const sizeY = MAX_HEIGHT + 1;
  const voxels = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * sizeY);
  const minX = cx * CHUNK_SIZE;
  const minZ = cz * CHUNK_SIZE;

  const voxelIndex = (lx, y, lz) => lx + lz * CHUNK_SIZE + y * CHUNK_SIZE * CHUNK_SIZE;

  for (let lz = 0; lz < CHUNK_SIZE; lz += 1) {
    for (let lx = 0; lx < CHUNK_SIZE; lx += 1) {
      const wx = minX + lx;
      const wz = minZ + lz;
      for (let y = 0; y <= MAX_HEIGHT; y += 1) {
        voxels[voxelIndex(lx, y, lz)] = getVoxelTypeAt(wx, y, wz);
      }
    }
  }
  return voxels;
}

function pushQuad(positions, normals, indices, corners, normal) {
  const base = positions.length / 3;
  for (const corner of corners) {
    positions.push(corner[0], corner[1], corner[2]);
    normals.push(normal[0], normal[1], normal[2]);
  }
  indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

function buildMaterialGreedyGeometry(voxels, materialType) {
  const dims = [CHUNK_SIZE, MAX_HEIGHT + 1, CHUNK_SIZE];
  const positions = [];
  const normals = [];
  const indices = [];

  const index = (x, y, z) => x + z * CHUNK_SIZE + y * CHUNK_SIZE * CHUNK_SIZE;
  const voxelAt = (x, y, z) => {
    if (x < 0 || y < 0 || z < 0 || x >= dims[0] || y >= dims[1] || z >= dims[2]) return BLOCK_AIR;
    return voxels[index(x, y, z)];
  };

  const mask = new Int8Array(Math.max(dims[0] * dims[1], dims[1] * dims[2], dims[0] * dims[2]));

  for (let d = 0; d < 3; d += 1) {
    const u = (d + 1) % 3;
    const v = (d + 2) % 3;
    const q = [0, 0, 0];
    q[d] = 1;
    const x = [0, 0, 0];
    const du = [0, 0, 0];
    const dv = [0, 0, 0];

    const width = dims[u];
    const height = dims[v];

    for (x[d] = -1; x[d] < dims[d]; x[d] += 1) {
      let n = 0;
      for (x[v] = 0; x[v] < dims[v]; x[v] += 1) {
        for (x[u] = 0; x[u] < dims[u]; x[u] += 1) {
          const a = x[d] >= 0 ? voxelAt(x[0], x[1], x[2]) : BLOCK_AIR;
          const b = x[d] < dims[d] - 1 ? voxelAt(x[0] + q[0], x[1] + q[1], x[2] + q[2]) : BLOCK_AIR;

          if (a === materialType && b === BLOCK_AIR) {
            mask[n] = 1;
          } else if (b === materialType && a === BLOCK_AIR) {
            mask[n] = -1;
          } else {
            mask[n] = 0;
          }
          n += 1;
        }
      }

      n = 0;
      for (let j = 0; j < height; j += 1) {
        for (let i = 0; i < width; ) {
          const c = mask[n];
          if (!c) {
            i += 1;
            n += 1;
            continue;
          }

          let w = 1;
          while (i + w < width && mask[n + w] === c) w += 1;

          let h = 1;
          outer: while (j + h < height) {
            for (let k = 0; k < w; k += 1) {
              if (mask[n + k + h * width] !== c) break outer;
            }
            h += 1;
          }

          x[u] = i;
          x[v] = j;
          du[0] = 0;
          du[1] = 0;
          du[2] = 0;
          dv[0] = 0;
          dv[1] = 0;
          dv[2] = 0;
          du[u] = w;
          dv[v] = h;

          const side = c > 0 ? 1 : -1;
          const normal = [0, 0, 0];
          normal[d] = side;

          const origin = [x[0], x[1], x[2]];
          if (c < 0) {
            origin[0] += q[0];
            origin[1] += q[1];
            origin[2] += q[2];
          }

          const p0 = [origin[0], origin[1], origin[2]];
          const p1 = [origin[0] + du[0], origin[1] + du[1], origin[2] + du[2]];
          const p2 = [origin[0] + du[0] + dv[0], origin[1] + du[1] + dv[1], origin[2] + du[2] + dv[2]];
          const p3 = [origin[0] + dv[0], origin[1] + dv[1], origin[2] + dv[2]];

          if (c > 0) {
            pushQuad(positions, normals, indices, [p0, p3, p2, p1], normal);
          } else {
            pushQuad(positions, normals, indices, [p0, p1, p2, p3], normal);
          }

          for (let l = 0; l < h; l += 1) {
            for (let k = 0; k < w; k += 1) {
              mask[n + k + l * width] = 0;
            }
          }

          i += w;
          n += w;
        }
      }
    }
  }

  if (!positions.length) return null;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return geometry;
}

class ChunkManager {
  constructor(root) {
    this.root = root;
    this.chunks = new Map();
    this.frustum = new THREE.Frustum();
    this.projectionView = new THREE.Matrix4();
  }

  key(cx, cz) {
    return `${cx},${cz}`;
  }

  inWorld(cx, cz) {
    return cx >= 0 && cz >= 0 && cx < WORLD_CHUNKS && cz < WORLD_CHUNKS;
  }

  buildChunk(cx, cz) {
    const key = this.key(cx, cz);
    if (this.chunks.has(key) || !this.inWorld(cx, cz)) return;

    const voxels = buildChunkVoxelData(cx, cz);
    const group = new THREE.Group();
    group.position.set(cx * CHUNK_SIZE, 0, cz * CHUNK_SIZE);

    const meshes = [];
    for (const type of [BLOCK_STONE, BLOCK_DIRT, BLOCK_GRASS]) {
      const geometry = buildMaterialGreedyGeometry(voxels, type);
      if (!geometry) continue;
      const mesh = new THREE.Mesh(geometry, materials[type]);
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      mesh.frustumCulled = true;
      group.add(mesh);
      meshes.push(mesh);
    }

    const bounds = new THREE.Box3(
      new THREE.Vector3(cx * CHUNK_SIZE, 0, cz * CHUNK_SIZE),
      new THREE.Vector3((cx + 1) * CHUNK_SIZE, MAX_HEIGHT + 1, (cz + 1) * CHUNK_SIZE),
    );

    this.chunks.set(key, { cx, cz, group, meshes, bounds });
    this.root.add(group);
  }

  unloadChunk(chunk) {
    this.root.remove(chunk.group);
    for (const mesh of chunk.meshes) {
      mesh.geometry.dispose();
    }
  }

  update(camera) {
    const camChunkX = Math.floor(camera.position.x / CHUNK_SIZE);
    const camChunkZ = Math.floor(camera.position.z / CHUNK_SIZE);

    for (let dz = -RENDER_DISTANCE; dz <= RENDER_DISTANCE; dz += 1) {
      for (let dx = -RENDER_DISTANCE; dx <= RENDER_DISTANCE; dx += 1) {
        this.buildChunk(camChunkX + dx, camChunkZ + dz);
      }
    }

    this.projectionView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projectionView);

    for (const [key, chunk] of this.chunks) {
      const dx = chunk.cx - camChunkX;
      const dz = chunk.cz - camChunkZ;
      const maxDistance = RENDER_DISTANCE + CHUNK_UNLOAD_PADDING;
      if (Math.abs(dx) > maxDistance || Math.abs(dz) > maxDistance) {
        this.unloadChunk(chunk);
        this.chunks.delete(key);
        continue;
      }

      const visible = this.frustum.intersectsBox(chunk.bounds);
      chunk.group.visible = visible;

      const castShadow = Math.max(Math.abs(dx), Math.abs(dz)) <= SHADOW_CAST_DISTANCE;
      for (const mesh of chunk.meshes) {
        mesh.castShadow = castShadow;
      }
    }

    statusEl.textContent = `Chunks: ${this.chunks.size} | Render radius: ${RENDER_DISTANCE} | Greedy meshing active.`;
  }
}

const chunkManager = new ChunkManager(world);

function makeWorld() {
  chunkManager.update(camera);
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
  activeKeys.add(event.code);

  const isInitialKeydown = !event.repeat;
  const shouldIgnoreTapLogic = (code) => code === 'Space' && !isInitialKeydown;

  if (shouldIgnoreTapLogic(event.code)) return;

  if (event.code === 'Space' && isInitialKeydown) {
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
  chunkManager.update(camera);
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
