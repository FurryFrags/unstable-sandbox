# Voxel Renderer Performance Notes (AI Handoff)

This note packages the rendering architecture so another AI can optimize safely **without breaking existing performance behavior**.

## Why this renderer is fast (with examples)

### 1) It renders chunks, not the whole world
- The world streams by `CHUNK=16` units inside a radius window.
- Only nearby chunks are meshed at once.
- Missing chunks are prioritized nearest-first.
- Chunk loads are capped per frame (`MAX_LOADS_PER_FRAME=1`) to smooth frame time.

**Example (pattern):**
```js
const CHUNK = 16;
const MAX_LOADS_PER_FRAME = 1;

function streamChunksAroundPlayer(playerChunkX, playerChunkZ, radius) {
  const queue = collectMissingChunksNearestFirst(playerChunkX, playerChunkZ, radius);
  for (let i = 0; i < Math.min(queue.length, MAX_LOADS_PER_FRAME); i += 1) {
    loadChunk(queue[i].cx, queue[i].cz);
  }
}
```

---

### 2) It uses cache + versioning for voxel data
- Chunk voxel buffers are cached in typed arrays.
- Cache is keyed by chunk coordinates.
- Rebuilds happen only when edit-version changes (`chunkEditVersion`, `chunkDataCache`).
- This avoids recomputing terrain every frame.

**Example (pattern):**
```js
const chunkDataCache = new Map();
const chunkEditVersion = new Map();

function getChunkData(cx, cz) {
  const key = `${cx},${cz}`;
  const version = chunkEditVersion.get(key) ?? 0;
  const cached = chunkDataCache.get(key);
  if (cached && cached.version === version) return cached.voxels;

  const voxels = buildChunkTypedArray(cx, cz);
  chunkDataCache.set(key, { version, voxels });
  return voxels;
}
```

---

### 3) It avoids scanning empty vertical space
- `estimateChunkYMax()` computes a practical top for meshing.
- Meshing loops run to `yMax`, not `WORLD_H`.
- In tall worlds (`WORLD_H=512`) this removes huge wasted CPU work.

**Example (pattern):**
```js
const WORLD_H = 512;

function buildChunkMesh(cx, cz) {
  const yMax = estimateChunkYMax(cx, cz);
  for (let y = 0; y <= yMax; y += 1) {
    // process solid/transparent faces
  }
}
```

---

### 4) It batches opaque blocks with `InstancedMesh`
- Opaque blocks are grouped by block type.
- Rendering uses instancing instead of one mesh per block.
- This cuts draw calls dramatically.

**Example (pattern):**
```js
const perTypeMatrices = groupVisibleOpaqueBlocksByType(voxels);
for (const [blockType, matrices] of perTypeMatrices) {
  const inst = new THREE.InstancedMesh(cubeGeo, materialFor(blockType), matrices.length);
  matrices.forEach((m, i) => inst.setMatrixAt(i, m));
  chunkGroup.add(inst);
}
```

---

### 5) Transparent blocks are face-only meshes
- Water/glass/lava use visible faces only, not full cubes.
- Neighbor checks skip internal/hidden faces.
- This lowers overdraw and avoids sorting artifacts.

**Example (pattern):**
```js
for (const face of FACES) {
  const nx = x + face.dx;
  const ny = y + face.dy;
  const nz = z + face.dz;
  const neighbor = getBlock(nx, ny, nz);

  if (isFaceVisibleForTransparent(block, neighbor, face)) {
    pushFaceToBuffer(positions, normals, uvs, indices, x, y, z, face);
  }
}
```

---

### 6) It uses voxel DDA raycast (not generic scene raycasting)
- Mining/highlight/picking grid-step through voxels using DDA.
- This is much cheaper than object-level `THREE.Raycaster` in block worlds.

**Example (pattern):**
```js
function raycastVoxelDDA(origin, dir, maxDist) {
  let { x, y, z, tMaxX, tMaxY, tMaxZ, tDeltaX, tDeltaY, tDeltaZ, stepX, stepY, stepZ } = initDDA(origin, dir);
  while (distanceFromOrigin(origin, x, y, z) <= maxDist) {
    if (isSolid(getBlock(x, y, z))) return { x, y, z };
    if (tMaxX < tMaxY && tMaxX < tMaxZ) { x += stepX; tMaxX += tDeltaX; }
    else if (tMaxY < tMaxZ) { y += stepY; tMaxY += tDeltaY; }
    else { z += stepZ; tMaxZ += tDeltaZ; }
  }
  return null;
}
```

---

### 7) It throttles non-critical UI updates
- HUD/chat/status refresh on cadence (about `0.15s`), not every frame.
- This reduces DOM/layout churn.

**Example (pattern):**
```js
let hudAccumulator = 0;

function tick(dt) {
  hudAccumulator += dt;
  if (hudAccumulator >= 0.15) {
    updateHud();
    hudAccumulator = 0;
  }
}
```

---

### 8) It keeps memory pressure bounded
- Chunk cache has explicit max size + eviction.
- Chunk unload/disposal releases geometry/material references.
- Prevents long-session degradation and GC spikes.

**Example (pattern):**
```js
const MAX_CHUNK_CACHE = 512;

function enforceChunkCacheLimit() {
  while (chunkDataCache.size > MAX_CHUNK_CACHE) {
    const oldestKey = lruPopOldest();
    disposeChunk(oldestKey);
    chunkDataCache.delete(oldestKey);
  }
}
```

## Performance Contract (pass this to any AI first)
1. World is procedural/infinite-style streaming; only a chunk window is loaded.
2. Mesh builds must stay local and bounded by `estimateChunkYMax`.
3. Opaque geometry stays instanced; transparent geometry stays face-only.
4. Picking/mining stays voxel DDA-based.
5. Chunk rebuilds are driven by edit-version invalidation only.

If a proposed change breaks any rule above, treat it as a performance regression until proven otherwise.

## Hotspot map + do-not-break list
Ask an AI to inspect these parts first, in this order:
1. Terrain generation + memoization.
2. Chunk data cache/versioning.
3. Chunk meshing split (opaque instancing vs transparent face mesh).
4. Streaming/load loop and per-frame caps.
5. DDA picking path.

Only after these should it touch UI/CSS.

## Prompt template for optimization-sensitive edits
Use this exact format when prompting another AI:

```md
## Goal
<what must change>

## Allowed files/functions
<strict scope>

## Performance invariants to preserve
- Chunked streaming only (no global rebuild)
- yMax-bounded meshing
- Opaque instancing
- Transparent face-only meshing
- DDA voxel picking
- Versioned invalidation only

## Validation checks
- Average FPS before/after
- Chunk rebuild count per minute
- Draw-call count before/after
- Peak memory / cache size behavior

## Output required
- Unified diff
- Brief performance impact explanation
- Any tradeoffs / risk notes
```

## Minimal architecture flow (for quick onboarding)
- `getBlock` -> `getChunkData` -> `buildChunkMeshes` -> `load/rebuild`.
- Edits increment chunk edit-version.
- Version mismatch invalidates cached chunk data/mesh.
- UI refresh is intentionally throttled.
- Typed arrays + instancing are intentional, not incidental.
