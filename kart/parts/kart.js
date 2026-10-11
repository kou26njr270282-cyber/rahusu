const VS = 8;  // Kenney vehicle scale
const TRUCKS = { 'vehicle-truck-red': '#e63946', 'vehicle-truck-yellow': '#ffd23f', 'vehicle-truck-green': '#3ddc97', 'vehicle-truck-purple': '#9b7bff' };
function truckFor(color) {
  const c = new THREE.Color(color), hsl = {}; c.getHSL(hsl);
  let best = 'vehicle-truck-red', bd = 1e9;
  for (const [name, col] of Object.entries(TRUCKS)) {
    const h2 = {}; new THREE.Color(col).getHSL(h2);
    let d = Math.abs(hsl.h - h2.h); d = Math.min(d, 1 - d);
    if (hsl.s < 0.2) d = name.endsWith('purple') ? 0 : 1;
    if (d < bd) { bd = d; best = name; }
  }
  return best;
}
function buildKart(c) {
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);
  const truck = MODELS[truckFor(c.kart)].clone(true);
  truck.scale.setScalar(VS);
  // per-kart material copy so star power can tint it
  const mat = MODELS[truckFor(c.kart)].userData.mat.clone();
  const wheels = [], fronts = [];
  truck.traverse(o => {
    if (o.isMesh) { o.material = mat; o.castShadow = true; o.receiveShadow = true; }
    if (o.name && o.name.startsWith('wheel-')) {
      o.rotation.order = 'YXZ';
      wheels.push({ spinner: o, r: 0.3 * VS });
      if (o.name.includes('front')) fronts.push(o);
    }
  });
  body.add(truck);
  // driver pops out of the sunroof
  const dmat = toonV();
  const drv = buildDriver(c, dmat);
  drv.group.scale.setScalar(0.78);
  drv.group.position.set(0, 4.2, -1.2);
  body.add(drv.group);
  // emblem on the hood
  const plate = new THREE.Mesh(new THREE.CircleGeometry(2.2, 24), new THREE.MeshBasicMaterial({ map: emblemTex(c) }));
  plate.position.set(0, 9.7, 6.4); plate.rotation.x = -Math.PI / 2 + 0.08; body.add(plate);
  const exhausts = [[-2.6, 3.2, -11.6], [2.6, 3.2, -11.6]].map(pos => {
    const fl = new THREE.Mesh(new THREE.ConeGeometry(1.1, 5, 10), new THREE.MeshBasicMaterial({ color: '#ffb02e', transparent: true, opacity: 0.9 }));
    fl.position.set(...pos); fl.rotation.x = -Math.PI / 2; fl.visible = false; body.add(fl); return fl;
  });
  const aura = new THREE.Mesh(new THREE.SphereGeometry(15, 20, 14), new THREE.MeshBasicMaterial({ color: '#fff27a', transparent: true, opacity: 0.2, depthWrite: false }));
  aura.position.y = 9; aura.visible = false; root.add(aura);
  const dizzy = new THREE.Group(); dizzy.position.set(0, 22, -1.2); dizzy.visible = false; body.add(dizzy);
  for (let i = 0; i < 3; i++) { const st = new THREE.Mesh(new THREE.OctahedronGeometry(0.9), new THREE.MeshBasicMaterial({ color: '#ffe14d' })); st.position.set(Math.cos(i / 3 * TAU) * 3.5, 0, Math.sin(i / 3 * TAU) * 3.5); dizzy.add(st); }
  const sw = new THREE.Object3D();
  root.userData = { body, mat, dmat, wheels, fronts, drv, exhausts, aura, sw, dizzy, kenney: true };
  return root;
}
