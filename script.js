const canvas = document.getElementById('world');
const ctx = canvas.getContext('2d');

const TILE_SIZE = 20;
const COLS = Math.floor(canvas.width / TILE_SIZE);
const ROWS = Math.floor(canvas.height / TILE_SIZE);
const DAY_LENGTH_SECONDS = 120;

const clockEl = document.getElementById('clock');
const cycleLabelEl = document.getElementById('cycleLabel');
const foodCountEl = document.getElementById('foodCount');
const objectCountEl = document.getElementById('objectCount');
const toggleTimeBtn = document.getElementById('toggleTime');

const terrain = [];
let objects = [];
let foods = [];

let timeSpeed = 1;
let dayProgress = 0.25; // 6:00 AM
let timePaused = false;
let foodSpawnTimer = 0;
let lastTime = performance.now();

function generateTerrain() {
  for (let y = 0; y < ROWS; y += 1) {
    terrain[y] = [];
    for (let x = 0; x < COLS; x += 1) {
      const edgeDistance = Math.min(x, y, COLS - x - 1, ROWS - y - 1);
      const noise = Math.random();

      let type = 'grass';
      if (noise + edgeDistance * 0.03 < 0.2) {
        type = 'water';
      } else if (noise > 0.78) {
        type = 'dirt';
      }

      terrain[y][x] = type;
    }
  }
}

function addObjects() {
  objects = [];

  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      if (terrain[y][x] === 'water') continue;

      const roll = Math.random();
      if (roll < 0.06) {
        objects.push({ x, y, type: 'tree' });
      } else if (roll < 0.09) {
        objects.push({ x, y, type: 'rock' });
      }
    }
  }
}

function spawnFood(amount = 8) {
  let spawned = 0;
  let safety = 0;
  while (spawned < amount && safety < amount * 30) {
    safety += 1;
    const x = Math.floor(Math.random() * COLS);
    const y = Math.floor(Math.random() * ROWS);

    if (terrain[y][x] === 'water') continue;
    if (objects.some((obj) => obj.x === x && obj.y === y && obj.type === 'tree')) continue;
    if (foods.some((food) => food.x === x && food.y === y)) continue;

    foods.push({ x, y, type: 'berry' });
    spawned += 1;
  }
}

function regenerateWorld() {
  generateTerrain();
  addObjects();
  foods = [];
  spawnFood(16);
}

function getLightLevel() {
  const angle = dayProgress * Math.PI * 2;
  return 0.4 + ((Math.sin(angle - Math.PI / 2) + 1) / 2) * 0.6;
}

function getCycleLabel() {
  if (dayProgress >= 0.2 && dayProgress < 0.3) return 'Dawn';
  if (dayProgress >= 0.3 && dayProgress < 0.7) return 'Day';
  if (dayProgress >= 0.7 && dayProgress < 0.8) return 'Dusk';
  return 'Night';
}

function drawTerrain() {
  const terrainColors = {
    grass: '#43a654',
    dirt: '#936b47',
    water: '#2e6ca4',
  };

  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      ctx.fillStyle = terrainColors[terrain[y][x]];
      ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    }
  }
}

function drawObjects() {
  objects.forEach((obj) => {
    const px = obj.x * TILE_SIZE;
    const py = obj.y * TILE_SIZE;

    if (obj.type === 'tree') {
      ctx.fillStyle = '#2f7f40';
      ctx.fillRect(px + 7, py + 9, 6, 10);
      ctx.beginPath();
      ctx.fillStyle = '#1f6f2f';
      ctx.arc(px + 10, py + 8, 7, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = '#9ba3aa';
      ctx.beginPath();
      ctx.arc(px + 10, py + 11, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  foods.forEach((food) => {
    ctx.fillStyle = '#e34b64';
    const px = food.x * TILE_SIZE + 7;
    const py = food.y * TILE_SIZE + 7;
    ctx.beginPath();
    ctx.arc(px, py, 3.4, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#67c76a';
    ctx.fillRect(px + 1, py - 4, 2, 3);
  });
}

function drawLighting() {
  const brightness = getLightLevel();
  const darknessAlpha = 1 - brightness;
  ctx.fillStyle = `rgba(10, 15, 30, ${darknessAlpha * 0.7})`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function updateUI() {
  const totalMinutes = Math.floor(dayProgress * 24 * 60) % (24 * 60);
  const hours = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
  const minutes = String(totalMinutes % 60).padStart(2, '0');

  clockEl.textContent = `${hours}:${minutes}`;
  cycleLabelEl.textContent = getCycleLabel();
  foodCountEl.textContent = foods.length;
  objectCountEl.textContent = objects.length;
}

function tick(now) {
  const dt = (now - lastTime) / 1000;
  lastTime = now;

  if (!timePaused) {
    dayProgress += (dt / DAY_LENGTH_SECONDS) * timeSpeed;
    dayProgress %= 1;

    foodSpawnTimer += dt * timeSpeed;
    if (foodSpawnTimer >= 6) {
      spawnFood(3);
      foodSpawnTimer = 0;
    }
  }

  drawTerrain();
  drawObjects();
  drawLighting();
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
  spawnFood(12);
});

document.getElementById('regenWorld').addEventListener('click', () => {
  regenerateWorld();
});

toggleTimeBtn.addEventListener('click', () => {
  timePaused = !timePaused;
  toggleTimeBtn.textContent = timePaused ? 'Resume Time' : 'Pause Time';
});

regenerateWorld();
requestAnimationFrame(tick);
