"use strict";

const ROLES = [
  "ÉTUDIANT EN 2E ANNÉE EXPERT — ESIEA",
  "APPRENTI DÉVELOPPEUR WEB FULL-STACK",
  "RESPONSABLE COMMUNICATION DU BUREAU DES JEUX",
];

const bgCanvas = document.getElementById("bg");
const renderer = new THREE.WebGLRenderer({ canvas: bgCanvas, antialias: true });
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 300);

renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

scene.fog = new THREE.FogExp2(0x000000, 0.018);
camera.position.set(0, 5, 0);
camera.lookAt(0, 0, -60);

const gridUniforms = {
  time: { value: 0.0 },
  speed: { value: 0.35 },
  brightness: { value: 0.65 },
  glowWidth: { value: 0.014 },
  color: { value: new THREE.Color(0x00ff88) },
};

const gridMat = new THREE.ShaderMaterial({
  uniforms: gridUniforms,
  transparent: true,
  side: THREE.DoubleSide,
  depthWrite: false,
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
  `,
  fragmentShader: `
    uniform float time, speed, brightness, glowWidth;
    uniform vec3 color;
    varying vec2 vUv;
    float gridLine(float c, float w) {
      return smoothstep(w+.001, w-.001, abs(fract(c-.5)-.5));
    }
    void main() {
      float scroll = fract(vUv.y * 22.0 - time * speed);
      float h = gridLine(scroll, glowWidth);
      float v = gridLine(vUv.x * 22.0, glowWidth);
      float g = max(h, v);
      float fH = smoothstep(0.0, .12, vUv.y);
      float fE = smoothstep(0.0, .06, vUv.x) * smoothstep(1.0, .94, vUv.x);
      g *= fH * fE * brightness;
      gl_FragColor = vec4(color * g, g);
    }
  `,
});

const gridMesh = new THREE.Mesh(new THREE.PlaneGeometry(120, 200, 1, 150), gridMat);
gridMesh.rotation.x = -Math.PI / 2;
gridMesh.position.set(0, 0, -60);
scene.add(gridMesh);

const starPos = new Float32Array(250 * 3);
for (let i = 0; i < 600; i++) {
  starPos[i * 3] = (Math.random() - 0.5) * 300;
  starPos[i * 3 + 1] = Math.random() * 60 + 2;
  starPos[i * 3 + 2] = (Math.random() - 0.5) * 150;
}
const starGeo = new THREE.BufferGeometry();
starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
scene.add(new THREE.Points(
  starGeo,
  new THREE.PointsMaterial({ color: 0x00ff88, size: 0.50, transparent: true, opacity: 0.68, sizeAttenuation: true })
));

const horizMesh = new THREE.Mesh(
  new THREE.PlaneGeometry(300, 20),
  new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.018, side: THREE.DoubleSide, depthWrite: false })
);
horizMesh.position.set(0, 8, -130);
scene.add(horizMesh);

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  resizeOscilloscope();
});

let audioCtx = null;
let analyser = null;
let gainNode = null;
let timeData = null;
let freqData = null;
let currentEl = null;
let audioSource = null;
let progressTimer = null;

function initAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    timeData = new Uint8Array(analyser.fftSize);
    freqData = new Uint8Array(analyser.frequencyBinCount);
    gainNode = audioCtx.createGain();
    gainNode.gain.value = document.getElementById("vol-slider")
      ? document.getElementById("vol-slider").value / 100
      : 0.8;
    analyser.connect(gainNode);
    gainNode.connect(audioCtx.destination);
  }
  if (audioCtx.state === "suspended") audioCtx.resume();
}

function loadURL(url, label) {
  setPlayerStatus("CONNEXION…");

  if (currentEl) {
    currentEl.pause();
    currentEl.remove();
  }
  if (audioSource) {
    audioSource.disconnect();
    audioSource = null;
  }
  clearInterval(progressTimer);

  initAudio();

  const el = new Audio();
  el.crossOrigin = "anonymous";
  el.src = url;
  el.style.cssText = "position:fixed;bottom:0;left:0;width:1px;height:1px;opacity:0;";
  document.body.appendChild(el);
  currentEl = el;

  audioSource = audioCtx.createMediaElementSource(el);
  audioSource.connect(analyser);

  el.addEventListener("ended", () => {
    setPlayerStatus("STANDBY");
    oscCanvas.classList.remove("visible");
    clearInterval(progressTimer);
    const playBtn = document.getElementById("play-btn");
    if (playBtn) playBtn.textContent = "▶";
    const fill = document.getElementById("progress-fill");
    if (fill) fill.style.width = "0%";
    const timeLabel = document.getElementById("time-label");
    if (timeLabel) timeLabel.textContent = "0:00 / 0:00";
  });

  el.addEventListener("canplay", () => {
    el.play().catch(() => {});
    setPlayerStatus(label ? "▶ " + label.slice(0, 18) : "▶ LIVE");
    oscCanvas.classList.add("visible");
    const playBtn = document.getElementById("play-btn");
    if (playBtn) playBtn.textContent = "⏸";
    startProgressUpdate();
  }, { once: true });

  el.addEventListener("error", () => setPlayerStatus("⚠ ERREUR URL"));
}

function setPlayerStatus(msg) {
  document.getElementById("status").textContent = msg;
}

function fmtTime(s) {
  if (!isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60).toString().padStart(2, "0");
  return m + ":" + sec;
}

function startProgressUpdate() {
  clearInterval(progressTimer);
  progressTimer = setInterval(() => {
    if (!currentEl || currentEl.paused) return;
    const ratio = currentEl.currentTime / (currentEl.duration || 1);
    const fill = document.getElementById("progress-fill");
    if (fill) fill.style.width = (ratio * 100) + "%";
    const timeLabel = document.getElementById("time-label");
    if (timeLabel) timeLabel.textContent = fmtTime(currentEl.currentTime) + " / " + fmtTime(currentEl.duration || 0);
  }, 500);
}

const oscCanvas = document.getElementById("oscilloscope");
const oscCtx = oscCanvas.getContext("2d");

function resizeOscilloscope() {
  oscCanvas.width = Math.min(1280, window.innerWidth * 0.9);
  oscCanvas.height = 200;
}
resizeOscilloscope();

function drawOscilloscope() {
  const W = oscCanvas.width;
  const H = oscCanvas.height;
  oscCtx.clearRect(0, 0, W, H);
  if (!analyser) return;

  analyser.getByteTimeDomainData(timeData);
  analyser.getByteFrequencyData(freqData);

  const sideW = W * 0.2;
  const centerW = W - sideW * 2;

  drawWaveZone(0, sideW, H, 0.55);
  drawFreqZone(sideW, centerW, H);
  drawWaveZone(sideW + centerW, sideW, H, 0.55);
}

function drawWaveZone(startX, zoneW, H, alpha) {
  if (!timeData) return;
  const cy = H / 2;
  const amp = H / 2 - 10;

  oscCtx.save();
  oscCtx.globalAlpha = alpha;
  oscCtx.strokeStyle = "#00ff88";
  oscCtx.lineWidth = 1.2;
  oscCtx.shadowColor = "#00ff88";
  oscCtx.shadowBlur = 5;

  oscCtx.beginPath();
  for (let i = 0; i < timeData.length; i++) {
    const x = startX + (i / timeData.length) * zoneW;
    const y = cy + (timeData[i] / 128 - 1) * amp;
    i === 0 ? oscCtx.moveTo(x, y) : oscCtx.lineTo(x, y);
  }
  oscCtx.stroke();

  oscCtx.beginPath();
  for (let i = 0; i < timeData.length; i++) {
    const x = startX + (i / timeData.length) * zoneW;
    const y = cy - (timeData[i] / 128 - 1) * amp;
    i === 0 ? oscCtx.moveTo(x, y) : oscCtx.lineTo(x, y);
  }
  oscCtx.stroke();

  oscCtx.globalAlpha = alpha * 0.2;
  oscCtx.lineWidth = 1;
  oscCtx.shadowBlur = 0;
  oscCtx.beginPath();
  oscCtx.moveTo(startX, cy);
  oscCtx.lineTo(startX + zoneW, cy);
  oscCtx.stroke();

  oscCtx.restore();
}

function drawFreqZone(startX, zoneW, H) {
  if (!freqData) return;

  const minBin = 1, maxBin = 80;
  const bins = maxBin - minBin;
  const halfW = zoneW / 2;
  const barW = halfW / bins;
  const cx = startX + zoneW / 2;
  const cy = H / 2;

  oscCtx.shadowColor = "#00ff88";
  oscCtx.shadowBlur = 5;

  for (let i = 0; i < bins; i++) {
    const val = freqData[minBin + i];
    const barH = (val / 255) * (H / 2 - 6);
    const alpha = 0.35 + (val / 255) * 0.65;

    oscCtx.fillStyle = `rgba(0,255,136,${alpha})`;

    const xR = cx + i * barW;
    const xL = cx - (i + 1) * barW;

    oscCtx.fillRect(xR, cy - barH, barW - 1, barH);
    oscCtx.fillRect(xR, cy, barW - 1, barH);
    oscCtx.fillRect(xL, cy - barH, barW - 1, barH);
    oscCtx.fillRect(xL, cy, barW - 1, barH);
  }

  oscCtx.shadowBlur = 0;
  oscCtx.strokeStyle = "rgba(0,255,136,.15)";
  oscCtx.lineWidth = 1;
  oscCtx.beginPath();
  oscCtx.moveTo(startX, cy);
  oscCtx.lineTo(startX + zoneW, cy);
  oscCtx.stroke();
}

const eqEl = document.getElementById("eq");
for (let i = 0; i < 22; i++) {
  const bar = document.createElement("div");
  bar.className = "eq-b";
  eqEl.appendChild(bar);
}
const eqBars = Array.from(document.querySelectorAll(".eq-b"));

let clock = 0;

function animate() {
  requestAnimationFrame(animate);
  clock += 0.01;

  if (analyser && freqData) analyser.getByteFrequencyData(freqData);

  gridUniforms.time.value = clock;
  camera.position.x = Math.sin(clock * 0.05) * 1.5;
  camera.lookAt(Math.sin(clock * 0.05) * 0.5, 0, -60);

  eqBars.forEach((bar, i) => {
    const idx = Math.floor((i / eqBars.length) * 70);
    const h = freqData ? Math.max(2, (freqData[idx] / 255) * 20) : 2;
    bar.style.height = h + "px";
  });

  drawOscilloscope();
  renderer.render(scene, camera);
}

animate();

let PROJECTS = [];

fetch("projects.json")
  .then(r => r.json())
  .then(data => {
    PROJECTS = data;
    renderProjects();
  });

function renderProjects() {
  const projectsGrid = document.getElementById("projects-grid");
  projectsGrid.innerHTML = "";
  PROJECTS.forEach((project, idx) => {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div class="card-type">${project.type}</div>
      <div class="card-name">${project.name}</div>
      <p   class="card-desc">${project.shortDesc}</p>
      <div class="pills">${project.tech.map(t => `<span class="pill">${t}</span>`).join("")}</div>
      <div class="card-view">VOIR LE PROJET →</div>
    `;
    card.addEventListener("click", () => openModal(idx));
    projectsGrid.appendChild(card);
  });
}

const modal = document.getElementById("modal");
let carouselIdx = 0;
let currentImages = [];

function openModal(idx) {
  const project = PROJECTS[idx];
  carouselIdx = 0;
  currentImages = project.images;

  const imgsEl = document.getElementById("carousel-imgs");
  imgsEl.innerHTML = project.images.map(src => `<img src="${src}" alt="" />`).join("");

  const dotsEl = document.getElementById("carousel-dots");
  dotsEl.innerHTML = project.images
    .map((_, i) => `<div class="cdot${i === 0 ? " on" : ""}" data-i="${i}"></div>`)
    .join("");
  dotsEl.querySelectorAll(".cdot").forEach(dot =>
    dot.addEventListener("click", () => goCarousel(+dot.dataset.i))
  );

  document.getElementById("m-type").textContent = project.type;
  document.getElementById("m-title").textContent = project.name;
  document.getElementById("m-desc").textContent = project.longDesc;
  document.getElementById("m-pills").innerHTML =
    `<div class="pills">${project.tech.map(t => `<span class="pill">${t}</span>`).join("")}</div>`;

  document.getElementById("m-links").innerHTML = `
    <a class="modal-link${project.github ? "" : " disabled"}" href="${project.github || "#"}" target="_blank" rel="noopener">↗ GITHUB</a>
    <a class="modal-link live${project.live ? "" : " disabled"}" href="${project.live || "#"}" target="_blank" rel="noopener">↗ SITE LIVE</a>
  `;

  goCarousel(0);
  modal.classList.add("open");
  document.body.style.overflow = "hidden";
}

function goCarousel(i) {
  carouselIdx = (i + currentImages.length) % currentImages.length;
  document.getElementById("carousel-imgs").style.transform = `translateX(-${carouselIdx * 100}%)`;
  document.querySelectorAll(".cdot").forEach((dot, j) => dot.classList.toggle("on", j === carouselIdx));
}

function closeModal() {
  modal.classList.remove("open");
  document.body.style.overflow = "";
}

document.getElementById("c-prev").addEventListener("click", () => goCarousel(carouselIdx - 1));
document.getElementById("c-next").addEventListener("click", () => goCarousel(carouselIdx + 1));
document.getElementById("modal-close").addEventListener("click", closeModal);
modal.addEventListener("click", e => { if (e.target === modal) closeModal(); });
document.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });

document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("on"));
    document.querySelectorAll(".pane").forEach(p => p.classList.remove("on"));
    tab.classList.add("on");
    document.getElementById("pane-" + tab.dataset.tab).classList.add("on");
  });
});

document.getElementById("load-url").addEventListener("click", () => {
  const url = document.getElementById("url-in").value.trim();
  if (url) loadURL(url, url.split("/").pop());
});
document.getElementById("url-in").addEventListener("keydown", e => {
  if (e.key === "Enter") document.getElementById("load-url").click();
});

document.getElementById("file-in").addEventListener("change", e => {
  const f = e.target.files[0];
  if (f) loadURL(URL.createObjectURL(f), f.name);
});

const dropzone = document.getElementById("dropzone");
dropzone.addEventListener("dragover", e => { e.preventDefault(); dropzone.classList.add("over"); });
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("over"));
dropzone.addEventListener("drop", e => {
  e.preventDefault();
  dropzone.classList.remove("over");
  const f = e.dataTransfer.files[0];
  if (f) loadURL(URL.createObjectURL(f), f.name);
});

const controlsToggle = document.getElementById("controls-toggle");
const controlsPanel = document.getElementById("controls-panel");
const chevron = document.getElementById("chevron");

controlsToggle.addEventListener("click", () => {
  const open = controlsPanel.classList.toggle("open");
  chevron.classList.toggle("open", open);
});

document.getElementById("play-btn").addEventListener("click", () => {
  if (!currentEl) return;
  if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
  if (currentEl.paused) {
    currentEl.play();
    document.getElementById("play-btn").textContent = "⏸";
    setPlayerStatus("▶ LIVE");
    startProgressUpdate();
  } else {
    currentEl.pause();
    document.getElementById("play-btn").textContent = "▶";
    setPlayerStatus("⏸ PAUSE");
  }
});

document.getElementById("progress-bar").addEventListener("click", e => {
  if (!currentEl || !currentEl.duration) return;
  const rect = e.currentTarget.getBoundingClientRect();
  currentEl.currentTime = ((e.clientX - rect.left) / rect.width) * currentEl.duration;
});

document.getElementById("vol-slider").addEventListener("input", e => {
  const v = e.target.value / 100;
  if (gainNode) gainNode.gain.value = v;
  document.getElementById("vol-val").textContent = e.target.value + "%";
});

new IntersectionObserver(entries => {
  if (entries[0].isIntersecting) {
    document.querySelectorAll(".fill").forEach(el => {
      el.style.width = el.dataset.level + "%";
    });
  }
}, { threshold: 0.25 }).observe(document.getElementById("skills"));

const cursorDot = document.getElementById("cursor");
const cursorRing = document.getElementById("cursor-ring");
const isTouchDevice = window.matchMedia("(pointer: coarse)").matches;

if (!isTouchDevice) {
  let ringX = 0, ringY = 0;

  document.addEventListener("mousemove", e => {
    cursorDot.style.left = e.clientX + "px";
    cursorDot.style.top = e.clientY + "px";
    ringX += (e.clientX - ringX) * 0.12;
    ringY += (e.clientY - ringY) * 0.12;
    cursorRing.style.left = ringX + "px";
    cursorRing.style.top = ringY + "px";
  });

  document.querySelectorAll("a, button, .card, input").forEach(el => {
    el.addEventListener("mouseenter", () => {
      cursorDot.style.width = "14px";
      cursorDot.style.height = "14px";
      cursorRing.style.width = "40px";
      cursorRing.style.height = "40px";
    });
    el.addEventListener("mouseleave", () => {
      cursorDot.style.width = "7px";
      cursorDot.style.height = "7px";
      cursorRing.style.width = "26px";
      cursorRing.style.height = "26px";
    });
  });
} else {
  cursorDot.style.display = "none";
  cursorRing.style.display = "none";
}

const roleEl = document.getElementById("hero-role");
let roleIdx = 0;
let charIdx = 0;
let deleting = false;

function typeRole() {
  const current = ROLES[roleIdx];

  if (!deleting) {
    roleEl.textContent = current.slice(0, ++charIdx);
    if (charIdx === current.length) {
      deleting = true;
      setTimeout(typeRole, 2200);
      return;
    }
  } else {
    roleEl.textContent = current.slice(0, --charIdx);
    if (charIdx === 0) {
      deleting = false;
      roleIdx = (roleIdx + 1) % ROLES.length;
    }
  }

  setTimeout(typeRole, deleting ? 38 : 70);
}

typeRole();

const navToggle = document.getElementById("nav-toggle");
const navLinks = document.getElementById("nav-links");

navToggle.addEventListener("click", () => {
  const isOpen = navLinks.classList.toggle("open");
  navToggle.classList.toggle("open", isOpen);
  navToggle.setAttribute("aria-expanded", String(isOpen));
});

navLinks.querySelectorAll("a").forEach(link => {
  link.addEventListener("click", () => {
    navLinks.classList.remove("open");
    navToggle.classList.remove("open");
    navToggle.setAttribute("aria-expanded", "false");
  });
});