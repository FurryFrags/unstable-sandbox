import * as THREE from 'three';

const WORLD_SIZE = 84 * 9;
const MAX_HEIGHT = Math.round(16 * 1.3);
const OCEAN_LEVEL = 8;

const CHUNK_SIZE = 16;
const WORLD_CHUNKS = Math.ceil(WORLD_SIZE / CHUNK_SIZE);
const RENDER_DISTANCE = WORLD_CHUNKS;
const SHADOW_CAST_DISTANCE = 2;
const MAX_CHUNK_BUILDS_PER_FRAME = 1;
const FLY_SPEED_MULTIPLIER = 3;

const BLOCK_AIR = 0;
const BLOCK_STONE = 1;
const BLOCK_DIRT = 2;
const BLOCK_GRASS = 3;
const BLOCK_WOOD = 4;
const BLOCK_LEAF = 5;
const BLOCK_WATER = 6;
const BLOCK_SAND = 7;
const BLOCK_APPLE = 8;
const BLOCK_SNOW = 9;

const BIOME_PLAINS = 0;
const BIOME_DESERT = 1;
const BIOME_SNOW = 2;

const TREE_SPACING = 6;
const TREE_CANOPY_RADIUS = 1;
const TREE_DENSITY_THRESHOLD = 0.84;
const TREE_LEAF_CHANCE = 0.8;
const TREE_APPLE_CHANCE = 0.08;
const SAND_WATER_RADIUS = 3;
const MOUNTAIN_HEIGHT_THRESHOLD = MAX_HEIGHT - 4;
const CAVE_MIN_Y = 3;
const CAVE_SCALE = 0.16;
const CAVE_THRESHOLD = 0.78;

const WORLD_SAVE_KEY = 'voxel-sandbox-worlds-v1';
const WORLD_OPTION_KEY = 'voxel-sandbox-options-v1';

const canvas = document.getElementById('scene');
const statusEl = document.getElementById('status');
const homeMenuEl = document.getElementById('home-menu');
const worldHudEl = document.getElementById('world-hud');
const worldListEl = document.getElementById('world-list');
const newWorldNameInput = document.getElementById('new-world-name');
const createWorldBtn = document.getElementById('create-world-btn');
const optionStartFly = document.getElementById('option-start-fly');
const worldTitleEl = document.getElementById('world-title');
const backHomeBtn = document.getElementById('back-home-btn');
const timeSpeedButtons = [...document.querySelectorAll('[data-time-speed]')];
const miniMapEl = document.getElementById('mini-map');
const miniMapCanvas = document.getElementById('mini-map-canvas');
const miniMapCtx = miniMapCanvas.getContext('2d');
const fullMapOverlayEl = document.getElementById('full-map-overlay');
const fullMapCanvas = document.getElementById('full-map-canvas');
const fullMapCtx = fullMapCanvas.getContext('2d');
const closeMapBtn = document.getElementById('close-map-btn');
const mapContextMenuEl = document.getElementById('map-context-menu');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = false;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#87b9ff');

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, WORLD_SIZE * 3);
camera.position.set(12, 18, 12);

const hemiLight = new THREE.HemisphereLight('#dbefff', '#4e633f', 0.8);
scene.add(hemiLight);

const sun = new THREE.DirectionalLight('#fff7d2', 1.1);
sun.position.set(60, 90, 35);
scene.add(sun);

const sunVisual = new THREE.Mesh(new THREE.SphereGeometry(6, 20, 20), new THREE.MeshBasicMaterial({ color: '#ffe78a' }));
scene.add(sunVisual);

const moonVisual = new THREE.Mesh(new THREE.SphereGeometry(4.5, 18, 18), new THREE.MeshBasicMaterial({ color: '#d5e3ff' }));
scene.add(moonVisual);

const world = new THREE.Group();
scene.add(world);

const materials = {
  [BLOCK_STONE]: new THREE.MeshStandardMaterial({ color: '#7f858f', roughness: 0.9, side: THREE.DoubleSide }),
  [BLOCK_DIRT]: new THREE.MeshStandardMaterial({ color: '#805d3b', roughness: 1, side: THREE.DoubleSide }),
  [BLOCK_GRASS]: new THREE.MeshStandardMaterial({ color: '#58a83f', roughness: 0.95, side: THREE.DoubleSide }),
  [BLOCK_WOOD]: new THREE.MeshStandardMaterial({ color: '#7b5534', roughness: 0.95, side: THREE.DoubleSide }),
  [BLOCK_LEAF]: new THREE.MeshStandardMaterial({ color: '#3f8f3f', roughness: 0.9, side: THREE.DoubleSide }),
  [BLOCK_WATER]: new THREE.MeshStandardMaterial({ color: '#3e8fe3', roughness: 0.2, transparent: true, opacity: 0.65, depthWrite: false, side: THREE.DoubleSide }),
  [BLOCK_SAND]: new THREE.MeshStandardMaterial({ color: '#dfcb8d', roughness: 0.96, side: THREE.DoubleSide }),
  [BLOCK_APPLE]: new THREE.MeshStandardMaterial({ color: '#c42929', roughness: 0.72, side: THREE.DoubleSide }),
  [BLOCK_SNOW]: new THREE.MeshStandardMaterial({ color: '#f4f7ff', roughness: 0.88, side: THREE.DoubleSide }),
};

let worldSeed = 1;
let seedOffsetA = 0;
let seedOffsetB = 0;
let worldActive = false;
let currentWorld = null;
let timeSpeed = 1;
let dayPhase = 0.18;
let mapOpen = false;
let mapContextPoint = null;
let mapStaticLayerMini = null;
let mapStaticLayerFull = null;
let lastMiniMapDrawAt = 0;

const MINI_MAP_FPS = 18;

const PIN_CLICK_RADIUS_WORLD = 10;

const terrainHeightCache = new Int16Array(WORLD_SIZE * WORLD_SIZE).fill(-1);
const waterHeightCache = new Int16Array(WORLD_SIZE * WORLD_SIZE).fill(-1);
const sandRadiusCache = new Int8Array(WORLD_SIZE * WORLD_SIZE).fill(-1);
const biomeCache = new Int8Array(WORLD_SIZE * WORLD_SIZE).fill(-1);
const treeCenterCache = new Map();

function loadWorldSaves() {
  try {
    return JSON.parse(localStorage.getItem(WORLD_SAVE_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveWorldSaves(worlds) {
  localStorage.setItem(WORLD_SAVE_KEY, JSON.stringify(worlds));
}

function ensureWorldPins(worldData) {
  if (!worldData.pins || !Array.isArray(worldData.pins)) worldData.pins = [];
  return worldData.pins;
}

function updateCurrentWorld(mutator) {
  if (!currentWorld) return;
  const worlds = loadWorldSaves();
  const idx = worlds.findIndex((w) => w.id === currentWorld.id);
  if (idx < 0) return;
  ensureWorldPins(worlds[idx]);
  mutator(worlds[idx]);
  saveWorldSaves(worlds);
  currentWorld = worlds[idx];
}

function deleteWorldById(worldId) {
  const worlds = loadWorldSaves().filter((w) => w.id !== worldId);
  saveWorldSaves(worlds);
}

function loadOptions() {
  try {
    return { startFlyMode: false, ...JSON.parse(localStorage.getItem(WORLD_OPTION_KEY) || '{}') };
  } catch {
    return { startFlyMode: false };
  }
}

function saveOptions(options) {
  localStorage.setItem(WORLD_OPTION_KEY, JSON.stringify(options));
}

const options = loadOptions();
optionStartFly.checked = !!options.startFlyMode;

function hashStringToSeed(value) {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) || 1;
}

function setWorldSeed(seed) {
  worldSeed = seed;
  seedOffsetA = (seed % 997) * 0.1337;
  seedOffsetB = (seed % 577) * 0.2811;
}

function resetWorldCaches() {
  terrainHeightCache.fill(-1);
  waterHeightCache.fill(-1);
  sandRadiusCache.fill(-1);
  biomeCache.fill(-1);
  treeCenterCache.clear();
}

function worldColumnIndex(x, z) {
  return x + z * WORLD_SIZE;
}

function fract(v) {
  return v - Math.floor(v);
}

function hash2(x, z) {
  return fract(Math.sin((x + seedOffsetA) * 127.1 + (z + seedOffsetB) * 311.7 + worldSeed * 0.013) * 43758.5453123);
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

function getTerrainHeightCached(x, z) {
  const clampedX = THREE.MathUtils.clamp(x, 0, WORLD_SIZE - 1);
  const clampedZ = THREE.MathUtils.clamp(z, 0, WORLD_SIZE - 1);
  const cacheIndex = worldColumnIndex(clampedX, clampedZ);
  const cached = terrainHeightCache[cacheIndex];
  if (cached >= 0) return cached;

  const broad = smoothNoise(clampedX * 0.05, clampedZ * 0.05) * 10;
  const rolling = smoothNoise(clampedX * 0.12 + 42, clampedZ * 0.12 + 12) * 6;
  const detail = smoothNoise(clampedX * 0.23 + 90, clampedZ * 0.23 + 37) * 2;
  const mountainMask = Math.max(0, smoothNoise(clampedX * 0.013 + 140, clampedZ * 0.013 + 70) - 0.56) / 0.44;
  const mountainRidge = smoothNoise(clampedX * 0.028 + 220, clampedZ * 0.028 + 160);
  const mountainHeight = mountainMask * (0.55 + mountainRidge) * 28;
  const height = Math.max(2, Math.min(MAX_HEIGHT, Math.round(2 + broad + rolling + detail + mountainHeight)));
  terrainHeightCache[cacheIndex] = height;
  return height;
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
  const craterSignal = smoothNoise(clampedX * 0.07 + 44, clampedZ * 0.07 + 59);

  const neighbors = [
    terrainHeight(Math.max(0, clampedX - 1), clampedZ),
    terrainHeight(Math.min(WORLD_SIZE - 1, clampedX + 1), clampedZ),
    terrainHeight(clampedX, Math.max(0, clampedZ - 1)),
    terrainHeight(clampedX, Math.min(WORLD_SIZE - 1, clampedZ + 1)),
  ];
  const avgNeighborHeight = neighbors.reduce((sum, value) => sum + value, 0) / neighbors.length;
  const basinDepth = avgNeighborHeight - h;

  let computedWaterHeight = -1;
  const oceanBlend = deepOceanSignal * 0.65 + continental * 0.35;
  if (oceanBlend < 0.44 && h <= OCEAN_LEVEL + 3) {
    computedWaterHeight = Math.max(h, OCEAN_LEVEL + Math.round((0.44 - oceanBlend) * 4));
  }

  const maxCraterWaterHeight = OCEAN_LEVEL + 4;
  if (h <= maxCraterWaterHeight && basinDepth > 0.9 && craterSignal < 0.3) {
    const craterDepth = Math.round((0.3 - craterSignal) * 8);
    computedWaterHeight = Math.max(computedWaterHeight, Math.max(h, Math.min(maxCraterWaterHeight, h + Math.min(3, Math.max(1, craterDepth)))));
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

function hasWaterInRadiusCached(x, z, radius) {
  const clampedX = THREE.MathUtils.clamp(x, 0, WORLD_SIZE - 1);
  const clampedZ = THREE.MathUtils.clamp(z, 0, WORLD_SIZE - 1);
  const cacheIndex = worldColumnIndex(clampedX, clampedZ);
  const cached = sandRadiusCache[cacheIndex];
  if (cached >= 0) return cached === 1;

  for (let dz = -radius; dz <= radius; dz += 1) {
    const nz = clampedZ + dz;
    if (nz < 0 || nz >= WORLD_SIZE) continue;
    for (let dx = -radius; dx <= radius; dx += 1) {
      const nx = clampedX + dx;
      if (nx < 0 || nx >= WORLD_SIZE) continue;
      if (Math.abs(dx) + Math.abs(dz) > radius) continue;
      if (hasWaterAt(nx, nz)) {
        sandRadiusCache[cacheIndex] = 1;
        return true;
      }
    }
  }

  sandRadiusCache[cacheIndex] = 0;
  return false;
}

function getBiomeCached(x, z) {
  const clampedX = THREE.MathUtils.clamp(x, 0, WORLD_SIZE - 1);
  const clampedZ = THREE.MathUtils.clamp(z, 0, WORLD_SIZE - 1);
  const cacheIndex = worldColumnIndex(clampedX, clampedZ);
  const cached = biomeCache[cacheIndex];
  if (cached >= 0) return cached;

  const temperature = smoothNoise(clampedX * 0.013 + 123, clampedZ * 0.013 + 48);
  const humidity = smoothNoise(clampedX * 0.017 + 11, clampedZ * 0.017 + 189);

  let biome = BIOME_PLAINS;
  if (temperature < 0.3) {
    biome = BIOME_SNOW;
  } else if (temperature > 0.64 && humidity < 0.42) {
    biome = BIOME_DESERT;
  }

  biomeCache[cacheIndex] = biome;
  return biome;
}

function biomeAt(x, z) {
  return getBiomeCached(x, z);
}


function isTreeCenter(wx, wz) {
  if (wx <= 2 || wz <= 2 || wx >= WORLD_SIZE - 3 || wz >= WORLD_SIZE - 3) return false;
  if (wx % TREE_SPACING !== 0 || wz % TREE_SPACING !== 0) return false;

  const cacheKey = `${wx},${wz}`;
  if (treeCenterCache.has(cacheKey)) return treeCenterCache.get(cacheKey);

  const centerHeight = terrainHeight(wx, wz);
  const biome = biomeAt(wx, wz);
  if (centerHeight <= OCEAN_LEVEL + 1 || hasWaterAt(wx, wz)) {
    treeCenterCache.set(cacheKey, false);
    return false;
  }
  if (biome === BIOME_DESERT) {
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

  const treeDensityThreshold = biome === BIOME_SNOW ? 0.9 : TREE_DENSITY_THRESHOLD;
  const result = hash2(wx * 0.73 + 5.7, wz * 0.73 + 17.1) > treeDensityThreshold;
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

      if (wx === tx && wz === tz && y >= trunkBaseY && y <= trunkTopY) return BLOCK_WOOD;
      if (wx === tx && wz === tz && y === trunkTopY + 1) return BLOCK_LEAF;

      const dx = Math.abs(wx - tx);
      const dz = Math.abs(wz - tz);
      const leafBottom = trunkTopY - 1;
      const leafTop = trunkTopY;
      const isInLeafLayer = y >= leafBottom && y <= leafTop;
      const isInCanopy = dx <= TREE_CANOPY_RADIUS && dz <= TREE_CANOPY_RADIUS && dx + dz <= TREE_CANOPY_RADIUS + 1;
      const isTrunkCore = dx === 0 && dz === 0 && y <= trunkTopY;
      const isApplePoint = y === leafBottom && (dx + dz === TREE_CANOPY_RADIUS + 1 || (dx === TREE_CANOPY_RADIUS && dz === TREE_CANOPY_RADIUS));
      if (isApplePoint) {
        const hasApple = hash2(wx * 0.69 + y * 0.21 + 13.5, wz * 0.94 + y * 0.53 + 44.1) < TREE_APPLE_CHANCE;
        if (hasApple) return BLOCK_APPLE;
      }

      const hasLeaf = hash2(wx * 1.91 + y * 0.47 + 31.7, wz * 1.37 + y * 0.73 + 19.3) < TREE_LEAF_CHANCE;
      if (isInLeafLayer && isInCanopy && !isTrunkCore && hasLeaf) return BLOCK_LEAF;
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

  if (y > CAVE_MIN_Y && y < h - 1) {
    const caveNoiseA = smoothNoise(wx * CAVE_SCALE + y * 0.12 + 300, wz * CAVE_SCALE + y * 0.09 + 500);
    const caveNoiseB = smoothNoise(wx * (CAVE_SCALE * 1.8) + y * 0.2 + 30, wz * (CAVE_SCALE * 1.8) + y * 0.16 + 90);
    const caveDensity = caveNoiseA * 0.7 + caveNoiseB * 0.3;
    if (caveDensity > CAVE_THRESHOLD) return BLOCK_AIR;
  }

  if (y <= 1) return BLOCK_STONE;

  if (y === h) {
    const biome = biomeAt(wx, wz);
    if (biome === BIOME_SNOW || h >= MOUNTAIN_HEIGHT_THRESHOLD) return BLOCK_SNOW;
    if (biome === BIOME_DESERT || hasWaterInRadiusCached(wx, wz, SAND_WATER_RADIUS)) return BLOCK_SAND;
    return BLOCK_GRASS;
  }
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

function buildMaterialGreedyGeometry(voxels, materialType, chunkOriginX, chunkOriginZ) {
  const positions = [];
  const normals = [];
  const indices = [];

  const index = (x, y, z) => x + z * CHUNK_SIZE + y * CHUNK_SIZE * CHUNK_SIZE;
  const voxelAt = (x, y, z) => {
    if (y < 0 || y > MAX_HEIGHT) return BLOCK_AIR;
    if (x < 0 || z < 0 || x >= CHUNK_SIZE || z >= CHUNK_SIZE) {
      const wx = chunkOriginX + x;
      const wz = chunkOriginZ + z;
      return getVoxelTypeAt(wx, y, wz);
    }
    return voxels[index(x, y, z)];
  };

  const isWaterAdjacent = (x, y, z) => {
    const adjacent = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    for (const [dx, dy, dz] of adjacent) {
      if (voxelAt(x + dx, y + dy, z + dz) === BLOCK_WATER) return true;
    }
    return false;
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
        const shouldForceAllFaces = materialType !== BLOCK_WATER && isWaterAdjacent(x, y, z);

        for (const face of faces) {
          const nx = x + face.neighbor[0];
          const ny = y + face.neighbor[1];
          const nz = z + face.neighbor[2];
          if (!shouldForceAllFaces && voxelAt(nx, ny, nz) !== BLOCK_AIR) continue;

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
    const chunkOriginX = cx * CHUNK_SIZE;
    const chunkOriginZ = cz * CHUNK_SIZE;
    group.position.set(chunkOriginX, 0, chunkOriginZ);

    const meshes = [];
    for (const type of [BLOCK_STONE, BLOCK_DIRT, BLOCK_GRASS, BLOCK_WOOD, BLOCK_LEAF, BLOCK_WATER, BLOCK_SAND, BLOCK_APPLE, BLOCK_SNOW]) {
      const geometry = buildMaterialGreedyGeometry(voxels, type, chunkOriginX, chunkOriginZ);
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
      if (mesh.geometry) mesh.geometry.dispose();
    }
  }

  clear() {
    for (const [, chunk] of this.chunks) this.unloadChunk(chunk);
    this.chunks.clear();
    this.pendingBuildQueue.length = 0;
    this.pendingBuildSet.clear();
  }

  update(cameraObj) {
    const camChunkX = Math.floor(cameraObj.position.x / CHUNK_SIZE);
    const camChunkZ = Math.floor(cameraObj.position.z / CHUNK_SIZE);

    for (let dz = -RENDER_DISTANCE; dz <= RENDER_DISTANCE; dz += 1) {
      for (let dx = -RENDER_DISTANCE; dx <= RENDER_DISTANCE; dx += 1) {
        this.enqueueChunkBuild(camChunkX + dx, camChunkZ + dz, camChunkX, camChunkZ);
      }
    }

    this.processChunkBuildQueue();

    this.projectionView.multiplyMatrices(cameraObj.projectionMatrix, cameraObj.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projectionView);

    for (const [, chunk] of this.chunks) {
      const dx = chunk.cx - camChunkX;
      const dz = chunk.cz - camChunkZ;
      chunk.group.visible = this.frustum.intersectsBox(chunk.bounds);
      const castShadow = Math.max(Math.abs(dx), Math.abs(dz)) <= SHADOW_CAST_DISTANCE;
      for (const mesh of chunk.meshes) mesh.castShadow = castShadow;
    }
  }
}

const chunkManager = new ChunkManager(world);

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

function closeMapContextMenu() {
  mapContextMenuEl.classList.add('hidden');
  mapContextMenuEl.innerHTML = '';
  mapContextPoint = null;
}

function createScratchCanvas(size) {
  const scratch = document.createElement('canvas');
  scratch.width = size;
  scratch.height = size;
  return scratch;
}

function sampleTerrainColorAtWorld(x, z) {
  const h = terrainHeight(x, z);
  const water = waterHeight(x, z);
  const biome = biomeAt(x, z);

  if (water >= h) return '#346fba';
  if (h > OCEAN_LEVEL + 9) return '#6f7b85';
  if (biome === BIOME_SNOW) return '#e6ecff';
  if (biome === BIOME_DESERT) return '#dcbf72';
  if (h > OCEAN_LEVEL + 4) return '#59984a';
  if (hasWaterInRadiusCached(x, z, SAND_WATER_RADIUS)) return '#d1bf88';
  return '#4f8f3e';
}

function buildStaticMapLayer(size) {
  const layerCanvas = createScratchCanvas(size);
  const layerCtx = layerCanvas.getContext('2d');
  if (!layerCtx) return null;

  const blockSize = 1;
  for (let pz = 0; pz < size; pz += blockSize) {
    for (let px = 0; px < size; px += blockSize) {
      const worldX = THREE.MathUtils.clamp(Math.floor((px / size) * WORLD_SIZE), 0, WORLD_SIZE - 1);
      const worldZ = THREE.MathUtils.clamp(Math.floor((pz / size) * WORLD_SIZE), 0, WORLD_SIZE - 1);
      layerCtx.fillStyle = sampleTerrainColorAtWorld(worldX, worldZ);
      layerCtx.fillRect(px, pz, blockSize, blockSize);
    }
  }

  return layerCanvas;
}

function rebuildMapStaticLayers() {
  mapStaticLayerMini = buildStaticMapLayer(miniMapCanvas.width);
  mapStaticLayerFull = buildStaticMapLayer(fullMapCanvas.width);
}

function worldToMapPixel(x, z, size) {
  const px = (THREE.MathUtils.clamp(x, 0, WORLD_SIZE) / WORLD_SIZE) * size;
  const pz = (THREE.MathUtils.clamp(z, 0, WORLD_SIZE) / WORLD_SIZE) * size;
  return { px, pz };
}

function mapPixelToWorld(event, targetCanvas) {
  const rect = targetCanvas.getBoundingClientRect();
  const nx = (event.clientX - rect.left) / rect.width;
  const nz = (event.clientY - rect.top) / rect.height;
  const x = THREE.MathUtils.clamp(nx * WORLD_SIZE, 0, WORLD_SIZE - 1);
  const z = THREE.MathUtils.clamp(nz * WORLD_SIZE, 0, WORLD_SIZE - 1);
  return { x, z };
}

function drawMapToCanvas(ctx, targetCanvas, scale = 1) {
  if (!ctx) return;
  const size = targetCanvas.width;
  const staticLayer = targetCanvas === fullMapCanvas ? mapStaticLayerFull : mapStaticLayerMini;

  ctx.clearRect(0, 0, size, size);
  if (staticLayer) ctx.drawImage(staticLayer, 0, 0, size, size);

  if (currentWorld) {
    for (const pin of ensureWorldPins(currentWorld)) {
      const pt = worldToMapPixel(pin.x, pin.z, size);
      ctx.fillStyle = '#ff4f4f';
      ctx.beginPath();
      ctx.arc(pt.px, pt.pz, Math.max(2, 3 * scale), 0, Math.PI * 2);
      ctx.fill();
      if (scale > 1.3) {
        ctx.fillStyle = '#fff';
        ctx.font = '12px Inter, sans-serif';
        ctx.fillText(pin.name, pt.px + 7, pt.pz - 6);
      }
    }
  }

  const playerPoint = worldToMapPixel(camera.position.x, camera.position.z, size);
  ctx.strokeStyle = '#d8ecff';
  ctx.lineWidth = Math.max(1.2, 1.3 * scale);
  ctx.beginPath();
  ctx.arc(playerPoint.px, playerPoint.pz, Math.max(3, 4.7 * scale), 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = '#2f84ff';
  ctx.beginPath();
  ctx.arc(playerPoint.px, playerPoint.pz, Math.max(2.2, 3.6 * scale), 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#0d47a1';
  ctx.lineWidth = Math.max(0.9, 0.9 * scale);
  ctx.beginPath();
  ctx.moveTo(playerPoint.px, playerPoint.pz - Math.max(4.4, 6.2 * scale));
  ctx.lineTo(playerPoint.px + Math.max(1.6, 2.2 * scale), playerPoint.pz - Math.max(1.2, 1.7 * scale));
  ctx.lineTo(playerPoint.px - Math.max(1.6, 2.2 * scale), playerPoint.pz - Math.max(1.2, 1.7 * scale));
  ctx.closePath();
  ctx.stroke();
}

function drawMaps() {
  if (!worldActive) return;
  const now = performance.now();
  if (now - lastMiniMapDrawAt >= 1000 / MINI_MAP_FPS) {
    drawMapToCanvas(miniMapCtx, miniMapCanvas, 0.7);
    lastMiniMapDrawAt = now;
  }
  if (mapOpen) drawMapToCanvas(fullMapCtx, fullMapCanvas, 1.8);
}

function setMapOpen(nextOpen) {
  mapOpen = nextOpen;
  fullMapOverlayEl.classList.toggle('hidden', !mapOpen);
  if (!mapOpen) closeMapContextMenu();
}

function tryGetPinAt(x, z) {
  if (!currentWorld) return null;
  let closest = null;
  let closestDist = Infinity;
  for (const pin of ensureWorldPins(currentWorld)) {
    const dist = Math.hypot(pin.x - x, pin.z - z);
    if (dist < PIN_CLICK_RADIUS_WORLD && dist < closestDist) {
      closest = pin;
      closestDist = dist;
    }
  }
  return closest;
}

function teleportToWorldPoint(x, z) {
  camera.position.x = x;
  camera.position.z = z;
  if (!flyMode) {
    camera.position.y = groundLevelAt(x, z);
    verticalVelocity = 0;
  }
}

function setModeStatus() {
  if (!worldActive) return;
  if (!pointerLocked) {
    statusEl.textContent = `World: ${currentWorld.name} | Click scene to lock pointer.`;
    return;
  }

  const travelMode = flyMode ? 'Fly ON' : 'Fly OFF';
  statusEl.textContent = `World: ${currentWorld.name} | ${travelMode} | Time ${timeSpeed}x | Press M for map`;
}

function setTimeSpeed(speed) {
  timeSpeed = speed;
  for (const button of timeSpeedButtons) {
    button.classList.toggle('active', Number(button.dataset.timeSpeed) === speed);
  }
  setModeStatus();
}

function updateDayNight(dt) {
  dayPhase = (dayPhase + dt * 0.03 * timeSpeed) % 1;
  const angle = dayPhase * Math.PI * 2;
  const orbitRadius = 150;
  const sx = Math.cos(angle) * orbitRadius;
  const sy = Math.sin(angle) * orbitRadius;

  sun.position.set(sx, sy, -70);
  sunVisual.position.copy(sun.position);
  moonVisual.position.set(-sx, -sy, 70);

  const daylight = THREE.MathUtils.clamp((sy + 25) / 140, 0.1, 1);
  sun.intensity = 0.25 + daylight * 1.0;
  hemiLight.intensity = 0.2 + daylight * 0.9;

  const dayColor = new THREE.Color('#87b9ff');
  const duskColor = new THREE.Color('#1d2747');
  scene.background = duskColor.clone().lerp(dayColor, daylight);
}

function moveCamera(dt) {
  if (!worldActive || mapOpen) return;

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

function saveCurrentWorldMeta() {
  if (!currentWorld) return;
  const worlds = loadWorldSaves();
  const idx = worlds.findIndex((w) => w.id === currentWorld.id);
  if (idx >= 0) {
    worlds[idx].lastPlayedAt = Date.now();
    saveWorldSaves(worlds);
  }
}

function enterHomeMenu() {
  worldActive = false;
  homeMenuEl.classList.remove('hidden');
  worldHudEl.classList.add('hidden');
  miniMapEl.classList.add('hidden');
  setMapOpen(false);
  if (document.pointerLockElement) document.exitPointerLock();
  setModeStatus();
}

function startWorld(worldData) {
  currentWorld = worldData;
  ensureWorldPins(currentWorld);
  worldTitleEl.textContent = `World: ${worldData.name}`;
  worldActive = true;
  homeMenuEl.classList.add('hidden');
  worldHudEl.classList.remove('hidden');
  miniMapEl.classList.remove('hidden');

  setWorldSeed(worldData.seed);
  resetWorldCaches();
  rebuildMapStaticLayers();
  lastMiniMapDrawAt = 0;
  chunkManager.clear();

  camera.position.set(12, 30, 12);
  yaw = Math.PI * 0.2;
  pitch = -0.2;
  flyMode = !!options.startFlyMode;
  verticalVelocity = 0;

  const worlds = loadWorldSaves();
  const idx = worlds.findIndex((w) => w.id === worldData.id);
  if (idx >= 0) {
    worlds[idx].lastPlayedAt = Date.now();
    saveWorldSaves(worlds);
  }

  setTimeSpeed(1);
  setModeStatus();
}

function createWorld(name) {
  const trimmed = name.trim() || `World ${new Date().toLocaleDateString()}`;
  const worlds = loadWorldSaves();
  const now = Date.now();
  const worldData = {
    id: `w-${now}-${Math.floor(Math.random() * 10000)}`,
    name: trimmed,
    seed: hashStringToSeed(`${trimmed}-${now}`),
    createdAt: now,
    lastPlayedAt: now,
    pins: [],
  };
  worlds.unshift(worldData);
  saveWorldSaves(worlds);
  renderWorldList();
  return worldData;
}

function renderWorldList() {
  const worlds = loadWorldSaves().sort((a, b) => (b.lastPlayedAt || 0) - (a.lastPlayedAt || 0));
  worldListEl.innerHTML = '';

  if (!worlds.length) {
    const empty = document.createElement('p');
    empty.textContent = 'No worlds yet — create one below.';
    worldListEl.append(empty);
    return;
  }

  for (const worldData of worlds) {
    const card = document.createElement('div');
    card.className = 'world-card';

    const meta = document.createElement('div');
    meta.innerHTML = `<strong>${worldData.name}</strong><br><small>Seed ${worldData.seed}</small>`;

    const worldActions = document.createElement('div');
    worldActions.className = 'world-actions';

    const playButton = document.createElement('button');
    playButton.type = 'button';
    playButton.textContent = 'Play';
    playButton.addEventListener('click', () => startWorld(worldData));

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'danger';
    deleteButton.textContent = 'Delete';
    deleteButton.addEventListener('click', () => {
      const ok = window.confirm(`Delete world "${worldData.name}"?`);
      if (!ok) return;
      deleteWorldById(worldData.id);
      renderWorldList();
    });

    worldActions.append(playButton, deleteButton);
    card.append(meta, worldActions);
    worldListEl.append(card);
  }
}

optionStartFly.addEventListener('change', () => {
  options.startFlyMode = optionStartFly.checked;
  saveOptions(options);
});

createWorldBtn.addEventListener('click', () => {
  const newWorld = createWorld(newWorldNameInput.value);
  newWorldNameInput.value = '';
  startWorld(newWorld);
});

newWorldNameInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') createWorldBtn.click();
});

backHomeBtn.addEventListener('click', () => {
  saveCurrentWorldMeta();
  enterHomeMenu();
  renderWorldList();
});

timeSpeedButtons.forEach((button) => {
  button.addEventListener('click', () => setTimeSpeed(Number(button.dataset.timeSpeed)));
});

closeMapBtn.addEventListener('click', () => setMapOpen(false));

fullMapOverlayEl.addEventListener('click', (event) => {
  if (event.target === fullMapOverlayEl) setMapOpen(false);
});

fullMapCanvas.addEventListener('click', (event) => {
  if (!worldActive) return;
  closeMapContextMenu();
  const { x, z } = mapPixelToWorld(event, fullMapCanvas);
  teleportToWorldPoint(x, z);
  drawMaps();
});

fullMapCanvas.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  if (!worldActive) return;

  const { x, z } = mapPixelToWorld(event, fullMapCanvas);
  mapContextPoint = { x, z };
  const clickedPin = tryGetPinAt(x, z);
  mapContextMenuEl.innerHTML = '';

  const addPinBtn = document.createElement('button');
  addPinBtn.type = 'button';
  addPinBtn.textContent = 'Pin this place';
  addPinBtn.addEventListener('click', () => {
    const defaultName = `Pin ${ensureWorldPins(currentWorld).length + 1}`;
    const pinName = window.prompt('Name this pin:', defaultName);
    if (!pinName || !pinName.trim()) return;
    updateCurrentWorld((worldData) => {
      ensureWorldPins(worldData).push({
        id: `p-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
        name: pinName.trim().slice(0, 32),
        x,
        z,
      });
    });
    closeMapContextMenu();
    drawMaps();
  });
  mapContextMenuEl.append(addPinBtn);

  if (clickedPin) {
    const removePinBtn = document.createElement('button');
    removePinBtn.type = 'button';
    removePinBtn.textContent = `Remove pin: ${clickedPin.name}`;
    removePinBtn.addEventListener('click', () => {
      updateCurrentWorld((worldData) => {
        worldData.pins = ensureWorldPins(worldData).filter((pin) => pin.id !== clickedPin.id);
      });
      closeMapContextMenu();
      drawMaps();
    });
    mapContextMenuEl.append(removePinBtn);
  }

  mapContextMenuEl.classList.remove('hidden');
  mapContextMenuEl.style.left = `${event.clientX}px`;
  mapContextMenuEl.style.top = `${event.clientY}px`;
});

window.addEventListener('click', (event) => {
  if (!mapContextMenuEl.contains(event.target) && event.target !== fullMapCanvas) {
    closeMapContextMenu();
  }
});

window.addEventListener('keydown', (event) => {
  if (!worldActive) return;

  if (event.code === 'KeyM' && !event.repeat) {
    setMapOpen(!mapOpen);
    drawMaps();
    return;
  }

  if (event.code === 'Escape' && mapOpen) {
    setMapOpen(false);
    return;
  }

  if (mapOpen) return;
  activeKeys.add(event.code);

  const isInitialKeydown = !event.repeat;
  if (event.code === 'Space' && !isInitialKeydown) return;

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

window.addEventListener('keyup', (event) => {
  activeKeys.delete(event.code);
});

canvas.addEventListener('click', async () => {
  if (!worldActive || mapOpen || document.pointerLockElement) return;
  await canvas.requestPointerLock({ unadjustedMovement: true }).catch(() => {});
});

document.addEventListener('pointerlockchange', () => {
  pointerLocked = document.pointerLockElement === canvas;
  setModeStatus();
});

document.addEventListener('mousemove', (event) => {
  if (!pointerLocked || !worldActive) return;
  yaw -= event.movementX * 0.0023;
  pitch -= event.movementY * 0.0023;
  pitch = THREE.MathUtils.clamp(pitch, -1.52, 1.52);
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

renderWorldList();
enterHomeMenu();

let lastTime = performance.now();
function tick(now) {
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;

  updateDayNight(dt);
  moveCamera(dt);
  if (worldActive) {
    chunkManager.update(camera);
    setModeStatus();
    drawMaps();
  }
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
