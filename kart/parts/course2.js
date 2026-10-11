// ---- Spline courses dressed with Kenney models (CC0, kenney.nl) ----
function cloneModel(name) {
  const m = MODELS[name].clone(true);
  m.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return m;
}

function splinePts(points, closedCircle) {
  if (closedCircle) {
    const { r, cx, cy } = closedCircle, n = Math.round(TAU * r / SP), out = [];
    for (let i = 0; i < n; i++) { const a = i / n * TAU; out.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r }); }
    return out;
  }
  const P = points.map(([x, y]) => ({ x, y }));
  const raw = [], np = P.length;
  for (let i = 0; i < np; i++) {
    const p0 = P[(i - 1 + np) % np], p1 = P[i], p2 = P[(i + 1) % np], p3 = P[(i + 2) % np];
    for (let s = 0; s < 80; s++) {
      const t = s / 80, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      raw.push({ x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) });
    }
  }
  const pts = [{ x: raw[0].x, y: raw[0].y }];
  let prev = raw[0], need = SP;
  for (let i = 1; i <= raw.length; i++) {
    const cur = raw[i % raw.length];
    let px = prev.x, py = prev.y, seg = Math.hypot(cur.x - px, cur.y - py);
    while (seg >= need) { const t = need / seg; px += (cur.x - px) * t; py += (cur.y - py) * t; pts.push({ x: px, y: py }); seg -= need; need = SP; }
    need -= seg; prev = cur;
  }
  if (Math.hypot(pts[pts.length - 1].x - pts[0].x, pts[pts.length - 1].y - pts[0].y) < SP * 0.6) pts.pop();
  return pts;
}

function buildCourse(ci) {
  if (courseGroup) { scene.remove(courseGroup); disposeGroup(courseGroup); }
  const def = ci === 'arena' ? ARENA : COURSES[ci], th = def.theme, night = th.kind === 'night', battle = !!def.battle;
  const group = new THREE.Group(); courseGroup = group; scene.add(group);
  ROADW = def.roadW || 120; CURB = def.curb ?? 12; WALL = def.wall || 98;

  // ---------- centerline, elevation and features ----------
  const pts = splinePts(def.points, def.circle);
  const n = pts.length, L = n * SP;
  const ang = pts.map((p, i) => { const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n]; return Math.atan2(b.y - a.y, b.x - a.x); });
  const curv = i => Math.abs(wrapAngle(ang[(i + 20) % n] - ang[(i - 20 + n) % n]));
  const straightIdx = (f, win = 70) => { const base = Math.floor(n * f); let best = base, bc = 1e9; for (let o = -win; o <= win; o += 2) { const i = (base + o + n) % n, c = curv(i) + curv((i + 15) % n) + curv((i - 15 + n) % n); if (c < bc) { bc = c; best = i; } } return best; };
  const ph1 = 0.4 + (def.seed || 0), ph2 = 1.1 + (def.seed || 0) * 1.3;
  let hgt = pts.map((_, i) => { const t = i / n * TAU; return (def.elev || 0) * (Math.sin(t * 2 + ph1) * 0.6 + Math.sin(t * 3 + ph2) * 0.4); });
  const h0 = hgt[0];
  hgt = hgt.map((h, i) => lerp(h0, h, smooth(60, 400, Math.min(i, n - i) * SP)));
  const minH = Math.min(...hgt);
  hgt = hgt.map(h => h - minH + 4);
  const gap = new Uint8Array(n), wallL = new Uint8Array(n).fill(1), wallR = new Uint8Array(n).fill(1);
  const ramps = [], pads = [], gaps = [];
  for (const g of def.gaps || []) {
    const s = straightIdx(g.f, 90), len = g.len;
    // ramp, then the hole
    const r0 = (s - 10 + n) % n;
    ramps.push({ i0: r0, len: 8, lat: 0, w: ROADW - 6, hmax: 13, big: true });
    pads.push({ idx: (r0 - 14 + n) % n, lat: -20 }, { idx: (r0 - 14 + n) % n, lat: 20 });
    for (let k = 0; k < len; k++) gap[(s + k) % n] = 1;
    gaps.push({ s, len });
  }
  const cutsResolved = [];
  for (const c of def.cuts || []) {
    let s = Math.floor(n * c.f), best = -1;
    for (let o = -60; o <= 60; o++) { const i = (Math.floor(n * c.f) + o + n) % n, cv = curv(i); if (cv > best) { best = cv; s = i; } }
    const side = c.side || Math.sign(wrapAngle(ang[(s + 20) % n] - ang[(s - 20 + n) % n])) || 1;
    for (let k = -c.len; k <= c.len; k++) (side > 0 ? wallR : wallL)[(s + k + n) % n] = 0;
    cutsResolved.push({ s, side });
  }
  for (const f of def.ramps || []) ramps.push({ i0: straightIdx(f), len: 7, lat: 0, w: 56, hmax: 7 });
  for (const [f, lat] of def.pads || []) pads.push({ idx: straightIdx(f, 40), lat });
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
  for (const p of pts) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  course = { def, th, pts, ang, hgt, n, L, bounds: { minX, minY, maxX, maxY }, cx, cy, boxes: [], pads: [], ramps, coins: [], obstacles: [], anim: [], gap, gaps, wallL, wallR, battle, cars: [] };
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

  // ---------- road ribbons (Kenney track look) ----------
  function strip(latA, yA, latB, yB, material, vScale, opts = {}) {
    const pos = [], uv = [], idx = [];
    const skip = opts.skip || (() => false);
    let vi = 0;
    for (let j = 0; j < n; j++) {
      const i = j, i2 = (j + 1) % n;
      if (skip(i) || skip(i2)) continue;
      for (const k of [i, i2]) {
        const h = hgt[k], la = typeof latA === 'function' ? latA(k) : latA, lb = typeof latB === 'function' ? latB(k) : latB;
        const [ax, az] = lp(k, la), [bx, bz] = lp(k, lb);
        pos.push(ax, h + yA, az, bx, h + yB, bz);
        const v = (k === i2 && i2 === 0 ? n : k) * SP / vScale; uv.push(0, v, 1, v);
      }
      idx.push(vi, vi + 1, vi + 2, vi + 1, vi + 3, vi + 2); vi += 4;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    if (!opts.vertical && g.attributes.normal.count && g.attributes.normal.array[1] < 0) { idx.reverse(); g.setIndex(idx); g.computeVertexNormals(); }
    const m = new THREE.Mesh(g, material); m.receiveShadow = true; if (opts.cast) m.castShadow = true; group.add(m);
    return m;
  }
  const isGap = i => gap[i] === 1;
  const roadTex = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = th.road || '#4b4e5a'; g.fillRect(0, 0, w, h); speckle(g, w, h, 1800, 0.05);
    if (!battle) { g.fillStyle = 'rgba(255,255,255,.85)'; g.fillRect(8, 0, 5, h); g.fillRect(w - 13, 0, 5, h); g.fillStyle = 'rgba(255,255,255,.35)'; for (let y = 0; y < h; y += 128) g.fillRect(w / 2 - 3, y, 6, 64); }
  });
  const curbTex = canvasTex(32, 64, (g, w, h) => { g.fillStyle = '#ef5a4c'; g.fillRect(0, 0, w, h / 2); g.fillStyle = '#f5f5f5'; g.fillRect(0, h / 2, w, h / 2); g.fillStyle = '#ffd23f'; g.fillRect(w - 7, 0, 7, h); });
  const shoulderTex = canvasTex(128, 128, (g, w, h) => { g.fillStyle = th.shoulder; g.fillRect(0, 0, w, h); speckle(g, w, h, 700, 0.06); });
  const lit = o => new THREE.MeshLambertMaterial(o);
  strip(-ROADW / 2, 0, ROADW / 2, 0, lit({ map: roadTex }), battle ? ROADW : ROADW, { skip: isGap });
  for (const s of [-1, 1]) {
    strip(s * ROADW / 2, 0.05, s * (ROADW / 2 + CURB), 0.6, lit({ map: curbTex }), 20, { skip: isGap });
    if (WALL > ROADW / 2 + CURB + 1) strip(s * (ROADW / 2 + CURB), 0.6, s * WALL, -0.4, lit({ map: shoulderTex }), 60, { skip: isGap });
    // underside of the road deck (visible across gaps and from below)
    strip(s * WALL, -0.4, s * WALL, -14, toon(th.deck || '#c9c3b8'), 50, { vertical: true, skip: isGap });
    // white tube barriers (one tube per continuous run of wall)
    const flags = s > 0 ? wallR : wallL, off = s * (WALL + 1.5);
    let run = [];
    const flush = () => {
      if (run.length > 3) {
        const curvePts = run.map(i => { const [x, z] = lp(i, off); return new THREE.Vector3(x, hgt[i] + 3.2, z); });
        const closed = run.length >= n - 1;
        const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(curvePts, closed), Math.max(8, run.length), 3.2, 8, closed), toon('#f4f4f4'));
        tube.castShadow = true; tube.receiveShadow = true; group.add(tube);
        const stripe = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(curvePts.map(v => v.clone().setY(v.y - 1.6)), closed), Math.max(8, run.length), 3.25, 8, closed), toon(s > 0 ? '#ef5a4c' : '#4c8bf5'));
        stripe.scale.set(1, 1, 1); group.add(stripe);
      }
      run = [];
    };
    for (let i = 0; i < n; i++) { if (flags[i] && !gap[i]) run.push(i); else flush(); }
    flush();
  }
  if (!battle) {
    const t = canvasTex(128, 16, (g) => { for (let x = 0; x < 16; x++) for (let y = 0; y < 2; y++) { g.fillStyle = (x + y) & 1 ? '#111' : '#fff'; g.fillRect(x * 8, y * 8, 8, 8); } }, false);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(ROADW, 14), lit({ map: t }));
    m.rotation.x = -Math.PI / 2; m.rotation.z = -ang[0] - Math.PI / 2; m.position.set(pts[0].x, hgt[0] + 0.08, pts[0].y); group.add(m);
    // Kenney finish arch
    const arch = cloneModel('track-finish'); arch.scale.setScalar(WALL / 4.6); arch.position.set(pts[0].x, hgt[0] - 0.2, pts[0].y); arch.rotation.y = Math.PI / 2 - ang[0];
    arch.traverse(o => { if (o.isMesh) o.castShadow = true; });
    // keep only the arch: hide the tile's own road by sinking it slightly under ours
    group.add(arch);
  }

  // ---------- jump ramps ----------
  for (const r of ramps) {
    const prof = new THREE.Shape(); prof.moveTo(0, 0); prof.lineTo(r.len * SP, r.hmax); prof.lineTo(r.len * SP, -12); prof.lineTo(0, -1); prof.lineTo(0, 0);
    const g = new THREE.ExtrudeGeometry(prof, { depth: r.w, bevelEnabled: false }); g.translate(0, 0, -r.w / 2);
    const rtex = canvasTex(64, 64, (gg, ww, hh) => { gg.fillStyle = '#f2f2f2'; gg.fillRect(0, 0, ww, hh); gg.fillStyle = r.big ? '#ff9f1c' : '#ef5a4c'; gg.fillRect(0, 0, ww, hh / 2); });
    rtex.repeat.set(0.06, 0.06);
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: rtex }));
    const [x, z] = lp(r.i0, r.lat);
    m.position.set(x, hgt[r.i0], z); m.rotation.y = -ang[r.i0]; m.castShadow = m.receiveShadow = true; group.add(m);
    const atex = canvasTex(64, 64, (gg) => { gg.fillStyle = '#ffd23f'; gg.beginPath(); gg.moveTo(32, 6); gg.lineTo(58, 34); gg.lineTo(42, 34); gg.lineTo(42, 58); gg.lineTo(22, 58); gg.lineTo(22, 34); gg.lineTo(6, 34); gg.closePath(); gg.fill(); }, false);
    const slope = Math.atan2(r.hmax, r.len * SP);
    for (const lo of r.big ? [-28, 0, 28] : [0]) {
      const dec = new THREE.Mesh(new THREE.PlaneGeometry(22, 22), new THREE.MeshBasicMaterial({ map: atex, transparent: true }));
      const mid = lp((r.i0 + Math.floor(r.len / 2)) % n, r.lat + lo);
      dec.position.set(mid[0], hgt[r.i0] + r.hmax * 0.5 + 0.3, mid[1]);
      dec.rotation.set(-Math.PI / 2 + slope, -Math.PI / 2 - ang[r.i0], 0, 'YXZ');
      group.add(dec);
    }
  }
  // ---------- boost pads ----------
  const padTex = canvasTex(64, 128, (g, w, h) => {
    g.fillStyle = '#ff7a00'; g.fillRect(0, 0, w, h); g.fillStyle = '#ffe14d';
    for (let y = 0; y < h; y += 32) { g.beginPath(); g.moveTo(8, y + 28); g.lineTo(32, y + 6); g.lineTo(56, y + 28); g.lineTo(48, y + 32); g.lineTo(32, y + 16); g.lineTo(16, y + 32); g.closePath(); g.fill(); }
  });
  padTex.repeat.set(1, 1.5);
  for (const pd of pads) {
    const i = pd.idx, [x, z] = lp(i, pd.lat);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(22, 34), new THREE.MeshBasicMaterial({ map: padTex }));
    m.rotation.set(-Math.PI / 2, -Math.PI / 2 - ang[i], 0, 'YXZ');
    m.position.set(x, hgt[i] + 0.15, z); group.add(m);
    course.pads.push({ idx: i, lat: pd.lat, tex: padTex });
  }
  // ---------- item boxes ----------
  const boxGeo = new THREE.BoxGeometry(10, 10, 10);
  const boxMat = new THREE.MeshPhongMaterial({ map: boxTex, transparent: true, opacity: 0.9, shininess: 120, emissive: 0x443355 });
  const addBox = (x, z, h) => { const m = new THREE.Mesh(boxGeo, boxMat); m.position.set(x, h + 8, z); m.castShadow = true; group.add(m); course.boxes.push({ x, y: z, h, t: 0, mesh: m, ph: Math.random() * TAU }); };
  if (battle) {
    for (let k = 0; k < 24; k++) { const i = Math.floor(k / 24 * n), lat = (k % 3 - 1) * ROADW * 0.3; const [x, z] = lp(i, lat); addBox(x, z, hgt[i]); }
  } else {
    for (const f of def.boxes || [0.18, 0.4, 0.62, 0.84]) {
      const i = straightIdx(f, 40);
      for (const lat of [-36, -12, 12, 36]) { const [x, z] = lp(i, lat); addBox(x, z, hgt[i]); }
    }
  }
  // ---------- coins (Kenney coin model) ----------
  if (!battle) {
    const list = [];
    [0.06, 0.22, 0.38, 0.55, 0.7, 0.92].forEach((f, r) => {
      const i0 = Math.floor(n * f), lat0 = [-30, 20, 0, -20, 30, 10][r];
      for (let k = 0; k < 5; k++) { const i = (i0 + k * 3) % n; if (gap[i]) continue; const lat = lat0 + Math.sin(k * 0.9) * 12; const [x, z] = lp(i, lat); list.push({ x, y: z, h: hgt[i], t: 0, ph: k * 0.5 }); }
    });
    // coin trail hints at shortcuts
    for (const c of cutsResolved) {
      for (let k = -2; k <= 2; k++) { const i = (c.s + k * 4 + n) % n; const [x, z] = lp(i, c.side * (WALL + 40)); list.push({ x, y: z, h: 0, t: 0, ph: k * 0.5, cut: true }); }
    }
    for (const c of list) { const m = cloneModel('coin'); m.scale.setScalar(16); m.position.set(c.x, c.h + 2, c.y); group.add(m); c.mesh = m; }
    course.coins = list;
  }
  // ---------- traffic (Kenney trucks driving along the course) ----------
  for (let k = 0; k < (def.traffic || 0); k++) {
    const name = ['vehicle-truck-yellow', 'vehicle-truck-green', 'vehicle-truck-purple', 'vehicle-truck-red'][k % 4];
    const m = cloneModel(name); m.scale.setScalar(VS * 1.45); group.add(m);
    course.cars.push({ mesh: m, idx: Math.floor((k + 0.5) / def.traffic * n), lat: k % 2 ? 26 : -26, sp: rand(95, 125), x: 0, y: 0, h: 0, a: 0 });
  }

  // ---------- terrain ----------
  const nearestFull = (x, z) => {
    let bi = 0, bd = 1e18;
    for (let i = 0; i < n; i += 5) { const d = (pts[i].x - x) ** 2 + (pts[i].y - z) ** 2; if (d < bd) { bd = d; bi = i; } }
    for (let o = -5; o <= 5; o++) { const i = (bi + o + n) % n, d = (pts[i].x - x) ** 2 + (pts[i].y - z) ** 2; if (d < bd) { bd = d; bi = i; } }
    return [bi, Math.sqrt(bd)];
  };
  const TSZ = 3400, GRID = 160;
  const terrainH = (x, z) => {
    const [bi, d] = nearestFull(x, z);
    if (battle) return d < WALL + 4 ? hgt[bi] - 3 : lerp(hgt[bi] - 3, 0, smooth(WALL, WALL + 200, d));
    const near = gap[bi] ? hgt[bi] - 150 : hgt[bi] - 3;
    return lerp(near, 0, smooth(gap[bi] ? WALL + 60 : WALL + 4, WALL + 280, d));
  };
  course.terrainH = terrainH;
  for (const c of course.coins) if (c.cut) c.h = terrainH(c.x, c.y);
  {
    const g = new THREE.PlaneGeometry(TSZ, TSZ, GRID, GRID); g.rotateX(-Math.PI / 2); g.translate(cx, 0, cy);
    const pos = g.attributes.position, col = new Float32Array(pos.count * 3);
    const c0 = new THREE.Color(th.ground), c1 = new THREE.Color(th.ground).multiplyScalar(0.88), cc = new THREE.Color(), water = new THREE.Color(th.water || '#3aa0ff'), dirt = new THREE.Color('#c48a52');
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), y = terrainH(x, z);
      pos.setY(i, y);
      cc.copy(c0).lerp(c1, (Math.sin(x * 0.013) * Math.sin(z * 0.011) + 1) / 2);
      if (y < -20) cc.copy(dirt).lerp(water, clamp((-y - 60) / 40, 0, 1));
      col.set([cc.r, cc.g, cc.b], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true })); m.receiveShadow = true; group.add(m);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(16000, 16000), new THREE.MeshLambertMaterial({ color: th.ground }));
    ground.rotation.x = -Math.PI / 2; ground.position.set(cx, -0.8, cy); group.add(ground);
    for (const gp of gaps) {
      const i = (gp.s + Math.floor(gp.len / 2)) % n;
      const w = new THREE.Mesh(new THREE.CircleGeometry(WALL + 70, 32), new THREE.MeshPhongMaterial({ color: th.water || '#3aa0ff', shininess: 90, transparent: true, opacity: 0.88 }));
      w.rotation.x = -Math.PI / 2; w.position.set(pts[i].x, hgt[i] - 120, pts[i].y); group.add(w);
    }
  }
  // ---------- decoration: Kenney forest/tent tiles far from the track, pines nearer ----------
  if (!battle) {
    const T = 160;
    for (let gx = Math.floor((cx - 1500) / T); gx <= Math.ceil((cx + 1500) / T); gx++) for (let gz = Math.floor((cy - 1500) / T); gz <= Math.ceil((cy + 1500) / T); gz++) {
      const x = gx * T, z = gz * T, [, d] = nearestFull(x, z);
      if (d < WALL + 330) continue;
      const rr = Math.abs((Math.sin(gx * 12.9898 + gz * 78.233 + ci * 3.1) * 43758.5453) % 1);
      if (rr > th.forest + 0.25) continue;
      const name = rr < 0.08 ? 'decoration-tents' : rr < th.forest ? 'decoration-forest' : 'decoration-empty';
      const m = cloneModel(name); m.scale.setScalar(T / 10); m.position.set(x, 0.2, z); m.rotation.y = Math.floor(rr * 97) % 4 * Math.PI / 2;
      m.traverse(o => { if (o.isMesh) o.castShadow = false; });
      group.add(m);
    }
    const spots = [];
    for (let tries = 0; tries < 2400 && spots.length < 220; tries++) {
      const x = rand(cx - 1300, cx + 1300), z = rand(cy - 1300, cy + 1300);
      const [bi, d] = nearestFull(x, z);
      if (d > WALL + 30 && d < WALL + 330 && !gap[bi]) spots.push({ x, z, y: terrainH(x, z), s: rand(0.9, 1.6), r: rand(0, TAU) });
    }
    const dummy = new THREE.Object3D();
    const inst = (geo, material, fn) => {
      const im = new THREE.InstancedMesh(geo, material, spots.length); im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false;
      spots.forEach((s, i) => { fn(dummy, s); dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix); });
      group.add(im);
    };
    const place = (yOff) => (d, s) => { d.position.set(s.x, s.y + yOff * s.s, s.z); d.scale.setScalar(s.s); d.rotation.set(0, s.r, 0); };
    inst(new THREE.CylinderGeometry(2, 2.6, 10, 6), toon('#c4733b'), place(5));
    inst(new THREE.ConeGeometry(13, 22, 6), toon(th.tree || '#2fae6c'), place(18));
    inst(new THREE.ConeGeometry(9.5, 17, 6), toon(th.tree2 || '#3cc47c'), place(30));
  }
  // ---------- distant hills + clouds ----------
  {
    const mm = new THREE.MeshLambertMaterial({ color: th.hill, flatShading: true });
    for (let i = 0; i < 30; i++) {
      const a = i / 30 * TAU + rand(-0.05, 0.05), r = rand(2900, 3500), hh = rand(260, 620), rr = rand(400, 700);
      const h = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 6, 0, TAU, 0, Math.PI / 2), mm);
      h.scale.set(rr, hh, rr); h.position.set(cx + Math.cos(a) * r, -10, cy + Math.sin(a) * r); group.add(h);
    }
    if (!night) {
      const cm = new THREE.MeshToonMaterial({ color: '#ffffff', emissive: '#8a8a8a', gradientMap: gradMap, fog: false });
      for (let i = 0; i < 18; i++) {
        const cl = new THREE.Group(), a = rand(0, TAU), r = rand(700, 2800);
        cl.position.set(cx + Math.cos(a) * r, rand(700, 1000), cy + Math.sin(a) * r);
        for (let k = 0; k < 6; k++) { const s2 = new THREE.Mesh(GEO.sph, cm); const sz = rand(45, 85); s2.scale.set(sz * 1.3, sz * 0.8, sz); s2.position.set(k * 55 - 140, rand(-12, 18), rand(-30, 30)); cl.add(s2); }
        cl.rotation.y = rand(0, TAU); group.add(cl);
        const sp = rand(3, 8); course.anim.push(() => { cl.position.x += sp * 0.016; });
      }
    }
  }
  // ---------- flags, balloons, lamps, grandstand ----------
  {
    for (let i = 30; i < n; i += 70) {
      if (gap[i]) continue;
      const side = (i / 70 | 0) % 2 ? 1 : -1, [x, z] = lp(i, side * (WALL + 14));
      const f = cloneModel('flag'); f.scale.setScalar(26); f.position.set(x, hgt[i], z); f.rotation.y = rand(0, TAU); group.add(f);
    }
    if (!battle) {
      const stand = cloneModel('decoration-tents'); stand.scale.setScalar(16); const [sx2, sz2] = lp(0, WALL + 95); stand.position.set(sx2, 0.2, sz2); stand.rotation.y = Math.PI / 2 - ang[0]; group.add(stand);
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
      for (let i = 0; i < n; i += 40) {
        if (gap[i]) continue;
        for (const side of [-1, 1]) {
          const [x, z] = lp(i, side * (WALL + 8));
          const p = new PB();
          p.add(GEO.cyl, '#3a3f5c', [0, 18, 0], 0, [0.8, 36, 0.8]);
          p.add(GEO.box, '#3a3f5c', [0, 36, 0], 0, [3, 2, 3]);
          const pole = p.mesh(toonV(), false); pole.position.set(x, hgt[i], z); group.add(pole);
          const lamp = new THREE.Sprite(new THREE.SpriteMaterial({ map: sparkTex, color: '#ffd98a', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
          lamp.scale.setScalar(26); lamp.position.set(x, hgt[i] + 35, z); group.add(lamp);
          const [px, pz] = lp(i, side * (WALL - 18));
          const pool = new THREE.Mesh(new THREE.CircleGeometry(30, 20), new THREE.MeshBasicMaterial({ map: sparkTex, color: '#ffcf7a', transparent: true, opacity: 0.32, depthWrite: false, blending: THREE.AdditiveBlending }));
          pool.rotation.x = -Math.PI / 2; pool.position.set(px, hgt[i] + 0.4, pz); group.add(pool);
        }
      }
    }
    if (battle) {
      const pillar = new PB();
      pillar.add(GEO.cyl, '#f4f4f4', [0, 25, 0], 0, [def.circle.r - WALL - 4, 50, def.circle.r - WALL - 4]);
      pillar.add(GEO.cyl, '#ef5a4c', [0, 52, 0], 0, [def.circle.r - WALL + 2, 6, def.circle.r - WALL + 2]);
      const pm = pillar.mesh(toonV()); pm.position.set(def.circle.cx, hgt[0], def.circle.cy); group.add(pm);
    }
  }
}
