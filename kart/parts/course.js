// ---- Kenney tile-based course (CC0 models by Kenney, kenney.nl) ----
const TILE = 160;            // world size of one track tile
const KS = TILE / 10;        // Kenney tile models are 10 units wide
const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];  // N E S W

// Expand a list of corner cells (a rectilinear loop) into tiles.
function layoutTiles(V) {
  const sg = v => (v > 0) - (v < 0);
  const n = V.length, dirs = [];
  for (let i = 0; i < n; i++) {
    const a = V[i], b = V[(i + 1) % n];
    dirs.push(DIRS.findIndex(d => d[0] === sg(b[0] - a[0]) && d[1] === sg(b[1] - a[1])));
  }
  const tiles = [];
  for (let i = 0; i < n; i++) {
    const a = V[i], b = V[(i + 1) % n], len = Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]), h = dirs[i];
    for (let k = 1; k < len; k++) tiles.push({ x: a[0] + DIRS[h][0] * k, y: a[1] + DIRS[h][1] * k, hin: h, hout: h, type: 'F' });
    const hout = dirs[(i + 1) % n];
    tiles.push({ x: b[0], y: b[1], hin: h, hout, type: (h + 1) % 4 === hout ? 'R' : 'L' });
  }
  return tiles;   // tiles[0] is the first straight after V[0]: the finish tile
}

function cloneModel(name) {
  const m = MODELS[name].clone(true);
  m.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return m;
}

function buildCourse(ci) {
  if (courseGroup) { scene.remove(courseGroup); disposeGroup(courseGroup); }
  const def = COURSES[ci], th = def.theme, night = th.kind === 'night';
  const group = new THREE.Group(); courseGroup = group; scene.add(group);
  const tiles = layoutTiles(def.loop);

  // ---------- centerline from tiles ----------
  const raw = [];
  for (const t of tiles) {
    const cx = t.x * TILE, cy = t.y * TILE, din = DIRS[t.hin], dout = DIRS[t.hout];
    const ex = cx - din[0] * TILE / 2, ey = cy - din[1] * TILE / 2;
    if (t.type === 'F') {
      for (let s = 0; s < 40; s++) raw.push({ x: ex + din[0] * TILE * s / 40, y: ey + din[1] * TILE * s / 40 });
    } else {
      const ax = ex + dout[0] * TILE / 2, ay = ey + dout[1] * TILE / 2, r = TILE / 2;
      const a0 = Math.atan2(ey - ay, ex - ax);
      const xx = cx + dout[0] * TILE / 2, yy = cy + dout[1] * TILE / 2;
      let da = wrapAngle(Math.atan2(yy - ay, xx - ax) - a0);
      for (let s = 0; s < 40; s++) { const a = a0 + da * s / 40; raw.push({ x: ax + Math.cos(a) * r, y: ay + Math.sin(a) * r }); }
    }
  }
  // resample to uniform spacing, starting at the middle of the finish tile
  const startOff = 20;
  const rot = raw.slice(startOff).concat(raw.slice(0, startOff));
  const pts = [{ x: rot[0].x, y: rot[0].y }];
  let prev = rot[0], need = SP;
  for (let i = 1; i <= rot.length; i++) {
    const cur = rot[i % rot.length];
    let px = prev.x, py = prev.y, seg = Math.hypot(cur.x - px, cur.y - py);
    while (seg >= need) { const t = need / seg; px += (cur.x - px) * t; py += (cur.y - py) * t; pts.push({ x: px, y: py }); seg -= need; need = SP; }
    need -= seg; prev = cur;
  }
  if (Math.hypot(pts[pts.length - 1].x - pts[0].x, pts[pts.length - 1].y - pts[0].y) < SP * 0.6) pts.pop();
  const n = pts.length, L = n * SP;
  const ang = pts.map((p, i) => { const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n]; return Math.atan2(b.y - a.y, b.x - a.x); });
  const ROAD_Y = 0.05 * KS;
  const hgt = pts.map(() => ROAD_Y);
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
  for (const p of pts) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const curv = i => Math.abs(wrapAngle(ang[(i + 20) % n] - ang[(i - 20 + n) % n]));
  const straightIdx = (f, win = 70) => { const base = Math.floor(n * f); let best = base, bc = 1e9; for (let o = -win; o <= win; o += 2) { const i = (base + o + n) % n, c = curv(i) + curv((i + 12) % n) + curv((i - 12 + n) % n); if (c < bc) { bc = c; best = i; } } return best; };
  course = { def, th, pts, ang, hgt, n, L, bounds: { minX, minY, maxX, maxY }, cx, cy, boxes: [], pads: [], ramps: [], coins: [], obstacles: [], anim: [], tiles };
  const lp = (i, lat) => { const p = pts[i], a = ang[i]; return [p.x - Math.sin(a) * lat, p.y + Math.cos(a) * lat]; };

  // ---------- sky, sun, fog ----------
  scene.fog = new THREE.Fog(th.fog, night ? 700 : 900, night ? 3200 : 3800);
  const skyMat = new THREE.ShaderMaterial({
    uniforms: { top: { value: new THREE.Color(th.skyTop) }, hor: { value: new THREE.Color(th.skyHor) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 hor; varying vec3 vP; void main(){ float t = clamp(abs(vP.y) * 1.6, 0.0, 1.0); gl_FragColor = vec4(mix(hor, top, pow(t, 0.7)), 1.0); }',
    side: THREE.BackSide, depthWrite: false, fog: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(5000, 32, 16), skyMat); sky.position.set(cx, 0, cy); sky.renderOrder = -1; group.add(sky);
  const sunDir = new THREE.Vector3(th.sunX ?? 0.5, th.sunY ?? 0.75, 0.25).normalize();
  {
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: sparkTex, color: th.sunGlow, transparent: true, opacity: 0.95, fog: false, depthWrite: false, blending: THREE.AdditiveBlending }));
    glow.scale.setScalar(night ? 500 : 1000); glow.position.set(cx + sunDir.x * 4200, sunDir.y * 4200, cy + sunDir.z * 4200); group.add(glow);
    const disc = new THREE.Sprite(new THREE.SpriteMaterial({ map: sparkTex, color: night ? '#fffbe6' : '#ffffff', fog: false, depthWrite: false }));
    disc.scale.setScalar(night ? 200 : 280); disc.position.copy(glow.position); group.add(disc);
  }
  hemi.color.set(th.hemiSky); hemi.groundColor.set(th.hemiGround); hemi.intensity = th.hemiI;
  sun.color.set(th.sun); sun.intensity = th.sunI;
  course.sunDir = sunDir;
  if (night) {
    const N = 1800, sp = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { const u = rand(0.05, 1), a = rand(0, TAU), r = 4400, s = Math.sqrt(1 - u * u); sp.set([cx + Math.cos(a) * s * r, u * r, cy + Math.sin(a) * s * r], i * 3); }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    group.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: '#ffffff', size: 14, sizeAttenuation: true, fog: false, map: sparkTex, transparent: true, depthWrite: false })));
  }

  // ---------- track tiles ----------
  const rotFor = (edges) => {
    // corner model connects its +z and -x edges; find the y-rotation mapping them onto `edges`
    const base = [[0, 1], [-1, 0]];
    for (let k = 0; k < 4; k++) {
      const th2 = k * Math.PI / 2, c = Math.round(Math.cos(th2)), s = Math.round(Math.sin(th2));
      const m = base.map(([x, z]) => [x * c + z * s, -x * s + z * c]);
      if (edges.every(e => m.some(q => q[0] === e[0] && q[1] === e[1]))) return th2;
    }
    return 0;
  };
  const occupied = new Set();
  tiles.forEach((t, i) => {
    occupied.add(t.x + ',' + t.y);
    const name = i === 0 ? 'track-finish' : t.type === 'F' ? 'track-straight' : 'track-corner';
    const m = cloneModel(name);
    m.scale.setScalar(KS);
    m.position.set(t.x * TILE, 0, t.y * TILE);
    if (t.type === 'F') m.rotation.y = (t.hin % 2) ? Math.PI / 2 : 0;
    else { const din = DIRS[t.hin], dout = DIRS[t.hout]; m.rotation.y = rotFor([[-din[0], -din[1]], [dout[0], dout[1]]]); }
    group.add(m);
  });
  // decoration tiles around the track
  let gx0 = 1e9, gy0 = 1e9, gx1 = -1e9, gy1 = -1e9;
  for (const t of tiles) { gx0 = Math.min(gx0, t.x); gy0 = Math.min(gy0, t.y); gx1 = Math.max(gx1, t.x); gy1 = Math.max(gy1, t.y); }
  const M = 2, start = tiles[0];
  for (let y = gy0 - M; y <= gy1 + M; y++) for (let x = gx0 - M; x <= gx1 + M; x++) {
    if (occupied.has(x + ',' + y)) continue;
    const nearStart = Math.abs(x - start.x) + Math.abs(y - start.y) <= 2;
    const r = (Math.sin(x * 12.9898 + y * 78.233 + ci * 3.1) * 43758.5453) % 1;
    const rr = Math.abs(r);
    const name = nearStart && rr < 0.6 ? 'decoration-tents' : rr < th.forest ? 'decoration-forest' : 'decoration-empty';
    const m = cloneModel(name);
    m.scale.setScalar(KS); m.position.set(x * TILE, 0, y * TILE); m.rotation.y = Math.floor(rr * 97) % 4 * Math.PI / 2;
    m.traverse(o => { if (o.isMesh) o.castShadow = false; });
    group.add(m);
  }
  // ground beyond the tiles
  {
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(16000, 16000), new THREE.MeshLambertMaterial({ color: th.ground }));
    ground.rotation.x = -Math.PI / 2; ground.position.set(cx, -0.5, cy); ground.receiveShadow = true; group.add(ground);
  }
  // distant hills + clouds
  {
    const mm = new THREE.MeshLambertMaterial({ color: th.hill, flatShading: true, fog: true });
    for (let i = 0; i < 30; i++) {
      const a = i / 30 * TAU + rand(-0.05, 0.05), r = rand(2900, 3500), hh = rand(260, 620), rr = rand(400, 700);
      const h = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 6, 0, TAU, 0, Math.PI / 2), mm);
      h.scale.set(rr, hh, rr); h.position.set(cx + Math.cos(a) * r, -10, cy + Math.sin(a) * r); group.add(h);
    }
    if (!night) for (let i = 0; i < 22; i++) {
      const c = cloneModel('cloud'); c.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
      const a = rand(0, TAU), r = rand(400, 2600), s = rand(60, 120);
      c.scale.set(s * 1.6, s * 0.7, s); c.position.set(cx + Math.cos(a) * r, rand(420, 700), cy + Math.sin(a) * r); c.rotation.y = rand(0, TAU); group.add(c);
      const sp = rand(3, 8); course.anim.push(() => { c.position.x += sp * 0.016; });
    }
  }

  // ---------- jump ramps ----------
  for (const f of def.ramps) {
    const i0 = straightIdx(f), len = 7, w = 56, hmax = 7, lat = 0;
    course.ramps.push({ i0, len, lat, w, hmax });
    const prof = new THREE.Shape(); prof.moveTo(0, 0); prof.lineTo(len * SP, hmax); prof.lineTo(len * SP, 0); prof.lineTo(0, 0);
    const g = new THREE.ExtrudeGeometry(prof, { depth: w, bevelEnabled: false }); g.translate(0, 0, -w / 2);
    const rtex = canvasTex(64, 64, (gg, ww, hh) => { gg.fillStyle = '#f2f2f2'; gg.fillRect(0, 0, ww, hh); gg.fillStyle = '#ef5a4c'; gg.fillRect(0, 0, ww, hh / 2); });
    rtex.repeat.set(0.06, 0.06);
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: rtex }));
    const [x, z] = lp(i0, lat);
    m.position.set(x, hgt[i0], z); m.rotation.y = -ang[i0]; m.castShadow = m.receiveShadow = true; group.add(m);
    const atex = canvasTex(64, 64, (gg) => { gg.fillStyle = '#ffd23f'; gg.beginPath(); gg.moveTo(32, 6); gg.lineTo(58, 34); gg.lineTo(42, 34); gg.lineTo(42, 58); gg.lineTo(22, 58); gg.lineTo(22, 34); gg.lineTo(6, 34); gg.closePath(); gg.fill(); }, false);
    const slope = Math.atan2(hmax, len * SP);
    const dec = new THREE.Mesh(new THREE.PlaneGeometry(24, 24), new THREE.MeshBasicMaterial({ map: atex, transparent: true }));
    const mid = lp((i0 + 3) % n, lat);
    dec.position.set(mid[0], hgt[i0] + hmax * 0.5 + 0.3, mid[1]);
    dec.rotation.set(-Math.PI / 2 + slope, -Math.PI / 2 - ang[i0], 0, 'YXZ');
    group.add(dec);
  }
  // ---------- boost pads ----------
  const padTex = canvasTex(64, 128, (g, w, h) => {
    g.fillStyle = '#ff7a00'; g.fillRect(0, 0, w, h); g.fillStyle = '#ffe14d';
    for (let y = 0; y < h; y += 32) { g.beginPath(); g.moveTo(8, y + 28); g.lineTo(32, y + 6); g.lineTo(56, y + 28); g.lineTo(48, y + 32); g.lineTo(32, y + 16); g.lineTo(16, y + 32); g.closePath(); g.fill(); }
  });
  padTex.repeat.set(1, 1.5);
  [[0.3, -22], [0.63, 22], [0.88, 0]].forEach(([f, lat]) => {
    const i = straightIdx(f, 40);
    const [x, z] = lp(i, lat);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(20, 32), new THREE.MeshBasicMaterial({ map: padTex }));
    m.rotation.set(-Math.PI / 2, -Math.PI / 2 - ang[i], 0, 'YXZ');
    m.position.set(x, hgt[i] + 0.15, z); group.add(m);
    course.pads.push({ idx: i, lat, tex: padTex });
  });
  // ---------- item boxes ----------
  const boxGeo = new THREE.BoxGeometry(10, 10, 10);
  const boxMat = new THREE.MeshPhongMaterial({ map: boxTex, transparent: true, opacity: 0.9, shininess: 120, emissive: 0x443355 });
  for (const f of [0.15, 0.47, 0.78]) {
    const i = straightIdx(f, 40);
    for (const lat of [-33, -11, 11, 33]) {
      const [x, z] = lp(i, lat);
      const m = new THREE.Mesh(boxGeo, boxMat); m.position.set(x, hgt[i] + 8, z); m.castShadow = true; group.add(m);
      course.boxes.push({ x, y: z, h: hgt[i], t: 0, mesh: m, ph: Math.random() * TAU });
    }
  }
  // ---------- coins (Kenney coin model) ----------
  {
    const list = [];
    [0.06, 0.22, 0.38, 0.55, 0.7, 0.92].forEach((f, r) => {
      const i0 = Math.floor(n * f), lat0 = [-26, 18, 0, -18, 26, 10][r];
      for (let k = 0; k < 5; k++) { const i = (i0 + k * 3) % n, lat = lat0 + Math.sin(k * 0.9) * 10; const [x, z] = lp(i, lat); list.push({ x, y: z, h: hgt[i], t: 0, ph: k * 0.5 }); }
    });
    for (const c of list) { const m = cloneModel('coin'); m.scale.setScalar(16); m.position.set(c.x, c.h + 2, c.y); group.add(m); c.mesh = m; }
    course.coins = list;
  }
  // ---------- flags and balloons ----------
  {
    for (let k = 0; k < tiles.length; k += 3) {
      const t = tiles[k]; if (t.type !== 'F' || k === 0) continue;
      const din = DIRS[t.hin], side = (k / 3) % 2 ? 1 : -1;
      const f = cloneModel('flag'); f.scale.setScalar(KS * 1.6);
      f.position.set(t.x * TILE + din[1] * side * TILE * 0.47, 0, t.y * TILE - din[0] * side * TILE * 0.47);
      f.rotation.y = rand(0, TAU); group.add(f);
    }
    if (!night) ['#ff5d73', '#ffd23f', '#4cc9ff', '#3ddc97', '#b388ff'].forEach((col, i) => {
      const b = new THREE.Group(), p = new PB();
      for (let k = 0; k < 8; k++) p.add(new THREE.SphereGeometry(18, 16, 12, k / 8 * TAU, TAU / 8), k % 2 ? col : '#ffffff', [0, 0, 0], 0, [1, 1.15, 1]);
      p.add(GEO.box, '#8a5a3b', [0, -30, 0], 0, [8, 6, 8]);
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) p.add(GEO.cyl, '#5b3a1a', [sx * 4, -22, sz * 4], 0, [0.3, 14, 0.3]);
      b.add(p.mesh(toonV()));
      const a = i / 5 * TAU + 0.4, r = rand(500, 1000); b.position.set(cx + Math.cos(a) * r, rand(180, 320), cy + Math.sin(a) * r); group.add(b);
      const y0 = b.position.y, ph = rand(0, TAU);
      course.anim.push(tt => { b.position.y = y0 + Math.sin(tt * 0.5 + ph) * 12; b.rotation.y = tt * 0.1; });
    });
    if (night) {
      // street lamps along the track
      for (let k = 1; k < tiles.length; k += 2) {
        const t = tiles[k], din = DIRS[t.hin];
        for (const side of [-1, 1]) {
          const x = t.x * TILE + din[1] * side * TILE * 0.49, z = t.y * TILE - din[0] * side * TILE * 0.49;
          const p = new PB();
          p.add(GEO.cyl, '#3a3f5c', [0, 18, 0], 0, [0.8, 36, 0.8]);
          p.add(GEO.box, '#3a3f5c', [0, 36, 0], 0, [3, 2, 3]);
          const pole = p.mesh(toonV(), false); pole.position.set(x, 0, z); group.add(pole);
          const lamp = new THREE.Sprite(new THREE.SpriteMaterial({ map: sparkTex, color: '#ffd98a', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
          lamp.scale.setScalar(26); lamp.position.set(x, 35, z); group.add(lamp);
          const pool = new THREE.Mesh(new THREE.CircleGeometry(30, 20), new THREE.MeshBasicMaterial({ map: sparkTex, color: '#ffcf7a', transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }));
          pool.rotation.x = -Math.PI / 2; pool.position.set(x - din[1] * side * 18, 1.2, z + din[0] * side * 18); group.add(pool);
        }
      }
    }
  }
}
