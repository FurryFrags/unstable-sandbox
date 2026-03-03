# Performance Contract (Simulator)

This simulator is optimized around chunk-local work and bounded per-frame cost.

## Core invariants

1. **Only nearby chunks are live**
   - The world is chunked (`CHUNK_SIZE=16`).
   - A radius-based stream window controls what can be built each frame (`RENDER_DISTANCE`).
   - Chunk builds are nearest-first and capped (`MAX_CHUNK_BUILDS_PER_FRAME=1`).

2. **Chunk voxel data is cached and version-aware**
   - `ChunkManager.getChunkData(cx, cz)` memoizes typed voxel arrays by chunk key.
   - Cache entries track a version (`chunkEditVersion`) and LRU-ish usage (`lastUsed`).
   - Cache size is bounded (`MAX_CHUNK_DATA_CACHE`) with eviction.

3. **Mesh work is vertically bounded**
   - `estimateChunkYMax(cx, cz)` computes practical max build height using terrain + water + canopy headroom.
   - Chunk voxel fills and geometry passes iterate only to this local `yMax`.

4. **Non-critical UI is throttled**
   - HUD/status text updates are throttled (`STATUS_UPDATE_MS`) instead of every frame.

## Hotspot map

- Terrain sampling & memoization: `terrainHeight`, `waterHeight`, `biomeAt` (+ typed caches).
- Chunk voxel generation: `buildChunkVoxelData`.
- Chunk mesh generation: `buildMaterialGreedyGeometry`.
- Streaming loop: `ChunkManager.update` + queue processing.

## Data flow

`getVoxelTypeAt` -> `buildChunkVoxelData` -> `ChunkManager.getChunkData` -> `buildMaterialGreedyGeometry` -> `buildChunk` -> `ChunkManager.update`

## Don't-break list for future edits

- Do not increase chunk builds/frame without profiling.
- Preserve `yMax`-bounded loops when adding blocks/features.
- Keep chunk data cache bounded and version-invalidatable.
- Keep streaming nearest-first and unload far chunks.
- Keep HUD updates throttled.
