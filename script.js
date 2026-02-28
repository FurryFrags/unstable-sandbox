const canvas = document.getElementById('world');
const ctx = canvas.getContext('2d');

const WORLD_SIZE = 56;
const DAY_LENGTH_SECONDS = 120;
const WATER_LEVEL = 1.6;
const MAX_HEIGHT = 7;

const clockEl = document.getElementById('clock');
const cycleLabelEl = document.getElementById('cycleLabel');
const foodCountEl = document.getElementById('foodCount');
const objectCountEl = document.getElementById('objectCount');
const toggleTimeBtn = document.getElementById('toggleTime');

const world = [];
let trees = [];
let foods = [];

let timeSpeed = 1;
let dayProgress = 0.25;
let timePaused = false;
let foodSpawnTimer = 0;
let lastTime = performance.now();

const camera = {
  x: WORLD_SIZE / 2,
  y: 9,
  z: -6,
  yaw: Math.PI / 4,
  pitch: -0.35,
  moveSpeed: 8,
  turnSpeed: 1.7,
};

const keys = new Set();
let mouseCaptured = false;

function fract(n) {
  return n - Math.floor(n);
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

function layeredHeight(x, z) {
  const n1 = smoothNoise(x * 0.09, z * 0.09) * 1.2;
  const n2 = smoothNoise(x * 0.22 + 18, z * 0.22 + 31) * 0.8;
  const n3 = smoothNoise(x * 0.45 + 80, z * 0.45 + 55) * 0.45;
  const radialFalloff = Math.hypot(x - WORLD_SIZE / 2, z - WORLD_SIZE / 2) * 0.035;
  return Math.max(0.4, Math.min(MAX_HEIGHT, n1 + n2 + n3 + 0.8 - radialFalloff));
}

function generateTerrain() {
  trees = [];
  world.length = 0;

  for (let z = 0; z < WORLD_SIZE; z += 1) {
    const row = [];
    for (let x = 0; x < WORLD_SIZE; x += 1) {
      const h = layeredHeight(x, z);
      const type = h <= WATER_LEVEL ? 'water' : h > 4.2 ? 'stone' : 'grass';
      row.push({ h, type });

      if (type === 'grass' && hash2(x * 2.7, z * 1.9) > 0.81) {
        trees.push({
          x: x + 0.5,
          z: z + 0.5,
          y: h,
          size: 0.8 + hash2(x + 8.1, z + 2.3) * 1.2,
        });
      }
    }
    world.push(row);
  }
}

function spawnFood(amount = 10) {
  let spawned = 0;
  let safety = 0;

  while (spawned < amount && safety < amount * 80) {
    safety += 1;
    const x = Math.floor(Math.random() * WORLD_SIZE);
    const z = Math.floor(Math.random() * WORLD_SIZE);
    const cell = world[z][x];

    if (!cell || cell.type === 'water') continue;
    if (foods.some((food) => Math.floor(food.x) === x && Math.floor(food.z) === z)) continue;

    foods.push({ x: x + 0.5, z: z + 0.5, y: cell.h + 0.12 });
    spawned += 1;
  }
}

function regenerateWorld() {
  generateTerrain();
  foods = [];
  spawnFood(28);
}

function getLightLevel() {
  const angle = dayProgress * Math.PI * 2;
  return 0.35 + ((Math.sin(angle - Math.PI / 2) + 1) / 2) * 0.7;
}

function getCycleLabel() {
  if (dayProgress >= 0.2 && dayProgress < 0.3) return 'Dawn';
  if (dayProgress >= 0.3 && dayProgress < 0.7) return 'Day';
  if (dayProgress >= 0.7 && dayProgress < 0.8) return 'Dusk';
  return 'Night';
}

function worldToCamera(point) {
  const dx = point.x - camera.x;
  const dy = point.y - camera.y;
  const dz = point.z - camera.z;

  const cy = Math.cos(-camera.yaw);
  const sy = Math.sin(-camera.yaw);
  const x1 = dx * cy - dz * sy;
  const z1 = dx * sy + dz * cy;

  const cp = Math.cos(-camera.pitch);
  const sp = Math.sin(-camera.pitch);
  const y2 = dy * cp - z1 * sp;
  const z2 = dy * sp + z1 * cp;

  return { x: x1, y: y2, z: z2 };
}

function project(point) {
  const cam = worldToCamera(point);
  if (cam.z <= 0.15) return null;
  const focal = 470;

  return {
    x: canvas.width / 2 + (cam.x / cam.z) * focal,
    y: canvas.height / 2 - (cam.y / cam.z) * focal,
    depth: cam.z,
  };
}

function drawPoly(points, fill, stroke) {
  if (points.some((p) => !p)) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}

function shade(hex, factor) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
  return `rgb(${clamp(r * factor)} ${clamp(g * factor)} ${clamp(b * factor)})`;
}

function drawTerrain3D() {
  const cells = [];
  for (let z = 0; z < WORLD_SIZE; z += 1) {
    for (let x = 0; x < WORLD_SIZE; x += 1) {
      const dx = x + 0.5 - camera.x;
      const dz = z + 0.5 - camera.z;
      cells.push({ x, z, depth: dx * dx + dz * dz });
    }
  }

  cells.sort((a, b) => b.depth - a.depth);

  const baseColors = {
    grass: '#4fb75e',
    stone: '#8f8f95',
    water: '#397db8',
  };

  const brightness = getLightLevel();

  cells.forEach(({ x, z }) => {
    const cell = world[z][x];
    const topY = cell.h;
    const baseColor = baseColors[cell.type];

    const p1 = project({ x, y: topY, z });
    const p2 = project({ x: x + 1, y: topY, z });
    const p3 = project({ x: x + 1, y: topY, z: z + 1 });
    const p4 = project({ x, y: topY, z: z + 1 });

    if (cell.type !== 'water') {
      const sideFront = [
        project({ x, y: 0, z: z + 1 }),
        project({ x: x + 1, y: 0, z: z + 1 }),
        p3,
        p4,
      ];
      drawPoly(sideFront, shade(baseColor, 0.5 * brightness + 0.2));

      const sideRight = [
        project({ x: x + 1, y: 0, z }),
        project({ x: x + 1, y: 0, z: z + 1 }),
        p3,
        p2,
      ];
      drawPoly(sideRight, shade(baseColor, 0.65 * brightness + 0.25));
    }

    const topColor =
      cell.type === 'water'
        ? `rgba(62, 149, 214, ${0.5 + (0.25 * brightness).toFixed(2)})`
        : shade(baseColor, brightness + 0.2);
    drawPoly([p1, p2, p3, p4], topColor, cell.type === 'water' ? 'rgba(180 225 255 / 0.2)' : null);
  });
}

function drawTree(tree) {
  const trunkBottom = project({ x: tree.x, y: tree.y, z: tree.z });
  const trunkTop = project({ x: tree.x, y: tree.y + tree.size, z: tree.z });
  const leftLeaf = project({ x: tree.x - 0.45 * tree.size, y: tree.y + tree.size, z: tree.z });
  const rightLeaf = project({ x: tree.x + 0.45 * tree.size, y: tree.y + tree.size, z: tree.z });
  const topLeaf = project({ x: tree.x, y: tree.y + tree.size * 1.65, z: tree.z });

  if (!trunkBottom || !trunkTop || !leftLeaf || !rightLeaf || !topLeaf) return;

  ctx.strokeStyle = '#5a3f27';
  ctx.lineWidth = Math.max(1, 4 / trunkBottom.depth);
  ctx.beginPath();
  ctx.moveTo(trunkBottom.x, trunkBottom.y);
  ctx.lineTo(trunkTop.x, trunkTop.y);
  ctx.stroke();

  drawPoly([leftLeaf, topLeaf, rightLeaf], '#2f8f3f', '#205f2c');
}

function drawFoods() {
  foods.forEach((food) => {
    const p = project(food);
    if (!p) return;

    ctx.fillStyle = '#e05670';
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(1.2, 5 / p.depth), 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawSky() {
  const t = getLightLevel();
  const top = `rgb(${20 + Math.round(70 * t)} ${35 + Math.round(90 * t)} ${55 + Math.round(110 * t)})`;
  const bottom = `rgb(${8 + Math.round(20 * t)} ${16 + Math.round(35 * t)} ${24 + Math.round(50 * t)})`;

  const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  grad.addColorStop(0, top);
  grad.addColorStop(1, bottom);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function drawCrosshair() {
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  ctx.strokeStyle = 'rgba(255 255 255 / 0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - 7, cy);
  ctx.lineTo(cx + 7, cy);
  ctx.moveTo(cx, cy - 7);
  ctx.lineTo(cx, cy + 7);
  ctx.stroke();
}

function updateCamera(dt) {
  const speed = camera.moveSpeed * dt;
  const forwardX = Math.sin(camera.yaw);
  const forwardZ = Math.cos(camera.yaw);
  const rightX = Math.cos(camera.yaw);
  const rightZ = -Math.sin(camera.yaw);

  if (keys.has('KeyW')) {
    camera.x += forwardX * speed;
    camera.z += forwardZ * speed;
  }
  if (keys.has('KeyS')) {
    camera.x -= forwardX * speed;
    camera.z -= forwardZ * speed;
  }
  if (keys.has('KeyA')) {
    camera.x -= rightX * speed;
    camera.z -= rightZ * speed;
  }
  if (keys.has('KeyD')) {
    camera.x += rightX * speed;
    camera.z += rightZ * speed;
  }
  if (keys.has('Space')) camera.y += speed;
  if (keys.has('ShiftLeft') || keys.has('ShiftRight')) camera.y -= speed;

  if (keys.has('ArrowLeft')) camera.yaw -= camera.turnSpeed * dt;
  if (keys.has('ArrowRight')) camera.yaw += camera.turnSpeed * dt;
  if (keys.has('ArrowUp')) camera.pitch = Math.min(1.1, camera.pitch + camera.turnSpeed * 0.6 * dt);
  if (keys.has('ArrowDown')) camera.pitch = Math.max(-1.1, camera.pitch - camera.turnSpeed * 0.6 * dt);

  camera.x = Math.max(-5, Math.min(WORLD_SIZE + 5, camera.x));
  camera.z = Math.max(-10, Math.min(WORLD_SIZE + 10, camera.z));
  camera.y = Math.max(0.3, Math.min(24, camera.y));
}

function updateUI() {
  const totalMinutes = Math.floor(dayProgress * 24 * 60) % (24 * 60);
  const hours = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
  const minutes = String(totalMinutes % 60).padStart(2, '0');

  clockEl.textContent = `${hours}:${minutes}`;
  cycleLabelEl.textContent = getCycleLabel();
  foodCountEl.textContent = foods.length;
  objectCountEl.textContent = trees.length;
}

function tick(now) {
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;

  if (!timePaused) {
    dayProgress += (dt / DAY_LENGTH_SECONDS) * timeSpeed;
    dayProgress %= 1;

    foodSpawnTimer += dt * timeSpeed;
    if (foodSpawnTimer >= 5) {
      spawnFood(3);
      foodSpawnTimer = 0;
    }
  }

  updateCamera(dt);
  drawSky();
  drawTerrain3D();

  trees
    .slice()
    .sort(
      (a, b) =>
        (b.x - camera.x) * (b.x - camera.x) + (b.z - camera.z) * (b.z - camera.z) -
        ((a.x - camera.x) * (a.x - camera.x) + (a.z - camera.z) * (a.z - camera.z)),
    )
    .forEach(drawTree);

  drawFoods();
  drawCrosshair();
  updateUI();

  requestAnimationFrame(tick);
}

function selectSpeed(button) {
  document.querySelectorAll('.speed-btn').forEach((btn) => btn.classList.remove('active'));
  button.classList.add('active');
  timeSpeed = Number(button.dataset.speed);
}

document.querySelectorAll('.speed-btn').forEach((btn) => {
  btn.addEventListener('click', () => selectSpeed(btn));
});

document.getElementById('spawnFood').addEventListener('click', () => {
  spawnFood(14);
});

document.getElementById('regenWorld').addEventListener('click', () => {
  regenerateWorld();
});

toggleTimeBtn.addEventListener('click', () => {
  timePaused = !timePaused;
  toggleTimeBtn.textContent = timePaused ? 'Resume Time' : 'Pause Time';
});

window.addEventListener('keydown', (event) => {
  keys.add(event.code);
});

window.addEventListener('keyup', (event) => {
  keys.delete(event.code);
});

canvas.addEventListener('click', async () => {
  if (!document.pointerLockElement) {
    await canvas.requestPointerLock({ unadjustedMovement: true }).catch(() => {});
  }
});

document.addEventListener('pointerlockchange', () => {
  mouseCaptured = document.pointerLockElement === canvas;
});

document.addEventListener('mousemove', (event) => {
  if (!mouseCaptured) return;
  camera.yaw += event.movementX * 0.0023;
  camera.pitch = Math.max(-1.15, Math.min(1.15, camera.pitch - event.movementY * 0.0023));
});

regenerateWorld();
requestAnimationFrame(tick);
