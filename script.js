import * as THREE from 'three';

const WORLD_SIZE = 84 * 9;
const MAX_HEIGHT = Math.round(16 * 1.3);
const OCEAN_LEVEL = 8;
const RIVER_LEVEL = 6;

const CHUNK_SIZE = 16;
const WORLD_CHUNKS = Math.ceil(WORLD_SIZE / CHUNK_SIZE);
const RENDER_DISTANCE = 6;
const SHADOW_CAST_DISTANCE = 2;
const CHUNK_UNLOAD_PADDING = 1;
const MAX_CHUNK_BUILDS_PER_FRAME = 1;
const FLY_SPEED_MULTIPLIER = 3;

const BLOCK_AIR = 0;
const BLOCK_STONE = 1;
const BLOCK_DIRT = 2;
const BLOCK_GRASS = 3;
const BLOCK_WOOD = 4;
const BLOCK_LEAF = 5;
const BLOCK_WATER = 6;

const TREE_SPACING = 6;
const TREE_CANOPY_RADIUS = 1;
const TREE_DENSITY_THRESHOLD = 0.84;
const TREE_LEAF_CHANCE = 0.2;

const canvas = document.getElementById('scene');
const statusEl = document.getElementById('status');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = false;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#87b9ff');

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

const sunVisual = new THREE.Mesh(
  new THREE.SphereGeometry(6, 20, 20),
  new THREE.MeshBasicMaterial({ color: '#ffe78a' }),
);
sunVisual.position.set(115, 105, -60);
scene.add(sunVisual);

const world = new THREE.Group();
scene.add(world);

const materials = {
  [BLOCK_STONE]: new THREE.MeshStandardMaterial({ color: '#7f858f', roughness: 0.9, side: THREE.DoubleSide }),
  [BLOCK_DIRT]: new THREE.MeshStandardMaterial({ color: '#805d3b', roughness: 1, side: THREE.DoubleSide }),
  [BLOCK_GRASS]: new THREE.MeshStandardMaterial({ color: '#58a83f', roughness: 0.95, side: THREE.DoubleSide }),
  [BLOCK_WOOD]: new THREE.MeshStandardMaterial({ color: '#7b5534', roughness: 0.95, side: THREE.DoubleSide }),
  [BLOCK_LEAF]: new THREE.MeshStandardMaterial({ color: '#3f8f3f', roughness: 0.9, side: THREE.DoubleSide }),
  [BLOCK_WATER]: new THREE.MeshStandardMaterial({
    color: '#3e8fe3',
    roughness: 0.2,
    transparent: true,
    opacity: 0.65,
    depthWrite: false,
    side: THREE.DoubleSide,
  }),
};

const terrainHeightCache = new Int16Array(WORLD_SIZE * WORLD_SIZE).fill(-1);
const waterHeightCache = new Int16Array(WORLD_SIZE * WORLD_SIZE).fill(-1);
const treeCenterCache = new Map();

function worldColumnIndex(x, z) {
  return x + z * WORLD_SIZE;
}

function getTerrainHeightCached(x, z) {
  const clampedX = THREE.MathUtils.clamp(x, 0, WORLD_SIZE - 1);
  const clampedZ = THREE.MathUtils.clamp(z, 0, WORLD_SIZE - 1);
  const cacheIndex = worldColumnIndex(clampedX, clampedZ);
  const cached = terrainHeightCache[cacheIndex];
  if (cached >= 0) return cached;

  const broad = smoothNoise(clampedX * 0.05, clampedZ * 0.05) * 10;
  const rolling = smoothNoise(clampedX * 0.12 + 42, clampedZ * 0.12 + 12) * 6;
  const detail = smoothNoise(clampedX * 0.23 + 90, clampedZ * 0.23 + 37) * 2;
  const height = Math.max(2, Math.min(MAX_HEIGHT, Math.round(2 + broad + rolling + detail)));
  terrainHeightCache[cacheIndex] = height;
  return height;
}


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
  return getTerrainHeightCached(x, z);
}

function getWaterHeightCached(x, z) {
  const clampedX = THREE.MathUtils.clamp(x, 0, WORLD_SIZE - 1);
  const clampedZ = THREE.MathUtils.clamp(z, 0, WORLD_SIZE - 1);
  const cacheIndex = worldColumnIndex(clampedX, clampedZ);
  const cached = waterHeightCache[cacheIndex];
  if (cached >= 0) return cached - 1;

  const h = terrainHeight(clampedX, clampedZ);
  const continental = smoothNoise(clampedX * 0.016 + 80, clampedZ * 0.016 + 11);
  const deepOceanSignal = smoothNoise(clampedX * 0.01 + 25, clampedZ * 0.01 + 91);
  const lakeSignal = smoothNoise(clampedX * 0.08 + 44, clampedZ * 0.08 + 59);
  const riverField = smoothNoise(clampedX * 0.05 + 132, clampedZ * 0.05 + 73);
  const riverFieldWarp = smoothNoise(clampedX * 0.11 + 211, clampedZ * 0.11 + 151);
  const riverDistance = Math.abs(riverField - riverFieldWarp);

  let computedWaterHeight = -1;

  const oceanBlend = deepOceanSignal * 0.65 + continental * 0.35;
  if (oceanBlend < 0.44 && h <= OCEAN_LEVEL + 3) {
    computedWaterHeight = Math.max(h, OCEAN_LEVEL + Math.round((0.44 - oceanBlend) * 4));
  }

  if (riverDistance < 0.06 && h <= MAX_HEIGHT - 2) {
    computedWaterHeight = Math.max(computedWaterHeight, Math.max(h, RIVER_LEVEL));
  }

  if (lakeSignal < 0.2 && h >= RIVER_LEVEL - 1 && h <= MAX_HEIGHT - 1) {
    const lakeDepth = Math.round((0.2 - lakeSignal) * 10);
    computedWaterHeight = Math.max(computedWaterHeight, h + Math.min(4, Math.max(1, lakeDepth)));
  }

  const encodedHeight = computedWaterHeight < 0 ? 0 : computedWaterHeight + 1;
  waterHeightCache[cacheIndex] = encodedHeight;
  return computedWaterHeight;
}

function waterHeight(x, z) {
  return getWaterHeightCached(x, z);
}

function hasWaterAt(x, z) {
  return waterHeight(x, z) >= terrainHeight(x, z);
}

function isTreeCenter(wx, wz) {
  if (wx <= 2 || wz <= 2 || wx >= WORLD_SIZE - 3 || wz >= WORLD_SIZE - 3) return false;
  if (wx % TREE_SPACING !== 0 || wz % TREE_SPACING !== 0) return false;

  const cacheKey = `${wx},${wz}`;
  if (treeCenterCache.has(cacheKey)) return treeCenterCache.get(cacheKey);

  const centerHeight = terrainHeight(wx, wz);
  if (centerHeight <= OCEAN_LEVEL + 1 || hasWaterAt(wx, wz)) {
    treeCenterCache.set(cacheKey, false);
    return false;
  }

  const north = terrainHeight(wx, wz - 1);
  const south = terrainHeight(wx, wz + 1);
  const east = terrainHeight(wx + 1, wz);
  const west = terrainHeight(wx - 1, wz);
  const isSteep = Math.max(
    Math.abs(centerHeight - north),
    Math.abs(centerHeight - south),
    Math.abs(centerHeight - east),
    Math.abs(centerHeight - west),
  ) > 2;
  if (isSteep) {
    treeCenterCache.set(cacheKey, false);
    return false;
  }

  const result = hash2(wx * 0.73 + 5.7, wz * 0.73 + 17.1) > TREE_DENSITY_THRESHOLD;
  treeCenterCache.set(cacheKey, result);
  return result;
}

function treeBlockAt(wx, y, wz) {
  const minTreeX = Math.floor((wx - TREE_CANOPY_RADIUS) / TREE_SPACING) * TREE_SPACING;
  const maxTreeX = Math.ceil((wx + TREE_CANOPY_RADIUS) / TREE_SPACING) * TREE_SPACING;
  const minTreeZ = Math.floor((wz - TREE_CANOPY_RADIUS) / TREE_SPACING) * TREE_SPACING;
  const maxTreeZ = Math.ceil((wz + TREE_CANOPY_RADIUS) / TREE_SPACING) * TREE_SPACING;

  for (let tx = minTreeX; tx <= maxTreeX; tx += TREE_SPACING) {
    for (let tz = minTreeZ; tz <= maxTreeZ; tz += TREE_SPACING) {
      if (!isTreeCenter(tx, tz)) continue;

      const trunkBaseY = terrainHeight(tx, tz) + 1;
      const trunkHeight = 4 + Math.floor(hash2(tx + 91.7, tz + 17.3) * 2);
      const trunkTopY = trunkBaseY + trunkHeight - 1;

      if (wx === tx && wz === tz && y >= trunkBaseY && y <= trunkTopY) {
        return BLOCK_WOOD;
      }

      if (wx === tx && wz === tz && y === trunkTopY + 1) {
        return BLOCK_LEAF;
      }

      const dx = Math.abs(wx - tx);
      const dz = Math.abs(wz - tz);
      const leafBottom = trunkTopY - 1;
      const leafTop = trunkTopY;
      const isInLeafLayer = y >= leafBottom && y <= leafTop;
      const isInCanopy = dx <= TREE_CANOPY_RADIUS && dz <= TREE_CANOPY_RADIUS && dx + dz <= TREE_CANOPY_RADIUS + 1;
      const isTrunkCore = dx === 0 && dz === 0 && y <= trunkTopY;
      const hasLeaf = hash2(wx * 1.91 + y * 0.47 + 31.7, wz * 1.37 + y * 0.73 + 19.3) < TREE_LEAF_CHANCE;
      if (isInLeafLayer && isInCanopy && !isTrunkCore && hasLeaf) {
        return BLOCK_LEAF;
      }
    }
  }

  return BLOCK_AIR;
}

function getVoxelTypeAt(wx, y, wz) {
  if (wx < 0 || wz < 0 || wx >= WORLD_SIZE || wz >= WORLD_SIZE || y < 0 || y > MAX_HEIGHT) return BLOCK_AIR;
  const h = terrainHeight(wx, wz);
  const waterSurface = waterHeight(wx, wz);

  if (y > h && y <= waterSurface) return BLOCK_WATER;

  const treeBlock = treeBlockAt(wx, y, wz);
  if (treeBlock !== BLOCK_AIR && y > h) return treeBlock;

  if (y > h) return BLOCK_AIR;
  if (y === h) return waterSurface >= h ? BLOCK_DIRT : BLOCK_GRASS;
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
  const positions = [];
  const normals = [];
  const indices = [];

  const index = (x, y, z) => x + z * CHUNK_SIZE + y * CHUNK_SIZE * CHUNK_SIZE;
  const voxelAt = (x, y, z) => {
    if (x < 0 || y < 0 || z < 0 || x >= CHUNK_SIZE || y > MAX_HEIGHT || z >= CHUNK_SIZE) return BLOCK_AIR;
    return voxels[index(x, y, z)];
  };

  const faces = [
    { normal: [1, 0, 0], corners: [[1, 0, 0], [1, 0, 1], [1, 1, 1], [1, 1, 0]], neighbor: [1, 0, 0] },
    { normal: [-1, 0, 0], corners: [[0, 0, 0], [0, 1, 0], [0, 1, 1], [0, 0, 1]], neighbor: [-1, 0, 0] },
    { normal: [0, 1, 0], corners: [[0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1]], neighbor: [0, 1, 0] },
    { normal: [0, -1, 0], corners: [[0, 0, 0], [0, 0, 1], [1, 0, 1], [1, 0, 0]], neighbor: [0, -1, 0] },
    { normal: [0, 0, 1], corners: [[0, 0, 1], [0, 1, 1], [1, 1, 1], [1, 0, 1]], neighbor: [0, 0, 1] },
    { normal: [0, 0, -1], corners: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]], neighbor: [0, 0, -1] },
  ];

  for (let y = 0; y <= MAX_HEIGHT; y += 1) {
    for (let z = 0; z < CHUNK_SIZE; z += 1) {
      for (let x = 0; x < CHUNK_SIZE; x += 1) {
        if (voxelAt(x, y, z) !== materialType) continue;

        for (const face of faces) {
          const nx = x + face.neighbor[0];
          const ny = y + face.neighbor[1];
          const nz = z + face.neighbor[2];
          if (voxelAt(nx, ny, nz) !== BLOCK_AIR) continue;

          const corners = face.corners.map(([cx, cy, cz]) => [x + cx, y + cy, z + cz]);
          pushQuad(positions, normals, indices, corners, face.normal);
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
    this.pendingBuildQueue = [];
    this.pendingBuildSet = new Set();
  }

  key(cx, cz) {
    return `${cx},${cz}`;
  }

  inWorld(cx, cz) {
    return cx >= 0 && cz >= 0 && cx < WORLD_CHUNKS && cz < WORLD_CHUNKS;
  }


  enqueueChunkBuild(cx, cz, camChunkX, camChunkZ) {
    const key = this.key(cx, cz);
    if (this.chunks.has(key) || this.pendingBuildSet.has(key) || !this.inWorld(cx, cz)) return;
    const distance = Math.max(Math.abs(cx - camChunkX), Math.abs(cz - camChunkZ));
    this.pendingBuildQueue.push({ cx, cz, key, distance });
    this.pendingBuildSet.add(key);
  }

  processChunkBuildQueue() {
    if (!this.pendingBuildQueue.length) return;
    this.pendingBuildQueue.sort((a, b) => a.distance - b.distance);

    let built = 0;
    while (built < MAX_CHUNK_BUILDS_PER_FRAME && this.pendingBuildQueue.length) {
      const next = this.pendingBuildQueue.shift();
      this.pendingBuildSet.delete(next.key);
      if (!this.chunks.has(next.key)) {
        this.buildChunk(next.cx, next.cz);
        built += 1;
      }
    }
  }

  buildChunk(cx, cz) {
    const key = this.key(cx, cz);
    if (this.chunks.has(key) || !this.inWorld(cx, cz)) return;

    const voxels = buildChunkVoxelData(cx, cz);
    const group = new THREE.Group();
    group.position.set(cx * CHUNK_SIZE, 0, cz * CHUNK_SIZE);

    const meshes = [];
    for (const type of [BLOCK_STONE, BLOCK_DIRT, BLOCK_GRASS, BLOCK_WOOD, BLOCK_LEAF, BLOCK_WATER]) {
      const geometry = buildMaterialGreedyGeometry(voxels, type);
      if (!geometry) continue;
      const mesh = new THREE.Mesh(geometry, materials[type]);
      mesh.receiveShadow = false;
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
        this.enqueueChunkBuild(camChunkX + dx, camChunkZ + dz, camChunkX, camChunkZ);
      }
    }

    this.processChunkBuildQueue();

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

    statusEl.textContent = `Chunks: ${this.chunks.size} | Render radius: ${RENDER_DISTANCE} | Full block-face meshing active.`;
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

  const baseSpeed = activeKeys.has('ControlLeft') ? 34 : 18;
  const speed = flyMode ? baseSpeed * FLY_SPEED_MULTIPLIER : baseSpeed;
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
