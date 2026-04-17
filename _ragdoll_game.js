// Karisma Ragdoll — game logic (loaded after password gate)
// Uses Babylon 6.48.1 + Havok (Physics V2).
(function(){
const canvas = document.getElementById('c');
const engine = new BABYLON.Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
let scene, ragdoll, rootMesh, skeleton, danceAG, currentMode, ground;

function b64ToBlobUrl(b64, mime){
  const bin = atob(b64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i=0;i<len;i++) bytes[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: mime }));
}

async function start(){
  try {
    if (!window.__KARISMA_B64) throw new Error('_karisma_b64.js non caricato.');
    if (typeof HavokPhysics !== 'function') throw new Error('HavokPhysics non caricato.');
    if (!BABYLON.Ragdoll) throw new Error('BABYLON.Ragdoll mancante (serve Babylon 6+).');

    const glbUrl = b64ToBlobUrl(window.__KARISMA_B64, 'model/gltf-binary');

    scene = new BABYLON.Scene(engine);
    scene.clearColor = new BABYLON.Color4(0.08, 0.08, 0.12, 1);

    // camera
    const cam = new BABYLON.ArcRotateCamera('cam', -Math.PI/2, Math.PI/2.15, 4.2, new BABYLON.Vector3(0, 1.0, 0), scene);
    cam.attachControl(canvas, true);
    cam.wheelPrecision = 40;
    cam.lowerRadiusLimit = 1.5; cam.upperRadiusLimit = 12;
    cam.minZ = 0.05;

    // luci
    new BABYLON.HemisphericLight('h', new BABYLON.Vector3(0.2,1,0.1), scene).intensity = 0.85;
    const d = new BABYLON.DirectionalLight('d', new BABYLON.Vector3(-0.4,-1,-0.6), scene);
    d.intensity = 1.2; d.position = new BABYLON.Vector3(3,5,3);

    // physics V2: Havok (richiesto dalla classe Ragdoll in Babylon 6+)
    const havok = await HavokPhysics();
    scene.enablePhysics(new BABYLON.Vector3(0, -9.81, 0), new BABYLON.HavokPlugin(true, havok));

    // pavimento
    ground = BABYLON.MeshBuilder.CreateGround('g', { width: 30, height: 30 }, scene);
    const gm = new BABYLON.StandardMaterial('gm', scene);
    gm.diffuseColor = new BABYLON.Color3(0.18, 0.2, 0.25);
    gm.specularColor = new BABYLON.Color3(0,0,0);
    ground.material = gm;
    // V2: PhysicsAggregate
    new BABYLON.PhysicsAggregate(ground, BABYLON.PhysicsShapeType.BOX, { mass: 0, friction: 0.8, restitution: 0.1 }, scene);

    // carica GLB
    const res = await BABYLON.SceneLoader.ImportMeshAsync('', '', glbUrl, scene, null, '.glb');
    rootMesh = res.meshes[0];
    skeleton = res.skeletons[0];
    URL.revokeObjectURL(glbUrl);

    if (!skeleton) throw new Error('Skeleton non trovato nel GLB.');

    // auto-scala a ~1.8m
    rootMesh.computeWorldMatrix(true);
    const bb = rootMesh.getHierarchyBoundingVectors(true);
    const h = bb.max.y - bb.min.y;
    if (h > 0) rootMesh.scaling.scaleInPlace(1.8 / h);
    rootMesh.position.y = 1.05;

    console.log('Bones:', skeleton.bones.map(b=>b.name));

    // --- RAGDOLL CONFIG (Mixamo) ---
    const B = 'mixamorig:';
    const cfgFull = [
      { bones: [B+'Head'],         size: 0.14, boxOffset: -0.08, min: -45, max: 45, mass: 1 },
      { bones: [B+'Neck'],         size: 0.08, min: -30, max: 30, mass: 0.5 },
      { bones: [B+'Spine2'],       size: 0.22, min: -10, max: 10, mass: 3.5 },
      { bones: [B+'Spine1'],       size: 0.20, min: -15, max: 15, mass: 2.5 },
      { bones: [B+'Spine', B+'Hips'], size: 0.22, min: -20, max: 20, mass: 4, putBoxInBoneCenter: true },
      { bones: [B+'LeftArm'],      size: 0.07, min: -90, max: 90, mass: 1.2, rotationAxis: BABYLON.Axis.Z },
      { bones: [B+'LeftForeArm'],  size: 0.06, min: 0,   max: 130, mass: 0.9, rotationAxis: BABYLON.Axis.Y },
      { bones: [B+'LeftHand'],     size: 0.05, min: -30, max: 30,  mass: 0.3 },
      { bones: [B+'RightArm'],     size: 0.07, min: -90, max: 90, mass: 1.2, rotationAxis: BABYLON.Axis.Z },
      { bones: [B+'RightForeArm'], size: 0.06, min: 0,   max: 130, mass: 0.9, rotationAxis: BABYLON.Axis.Y },
      { bones: [B+'RightHand'],    size: 0.05, min: -30, max: 30,  mass: 0.3 },
      { bones: [B+'LeftUpLeg'],    size: 0.09, min: -70, max: 50,  mass: 2.2, rotationAxis: BABYLON.Axis.X },
      { bones: [B+'LeftLeg'],      size: 0.07, min: 0,   max: 110, mass: 1.5, rotationAxis: BABYLON.Axis.X },
      { bones: [B+'LeftFoot'],     size: 0.07, min: -30, max: 30,  mass: 0.5 },
      { bones: [B+'RightUpLeg'],   size: 0.09, min: -70, max: 50,  mass: 2.2, rotationAxis: BABYLON.Axis.X },
      { bones: [B+'RightLeg'],     size: 0.07, min: 0,   max: 110, mass: 1.5, rotationAxis: BABYLON.Axis.X },
      { bones: [B+'RightFoot'],    size: 0.07, min: -30, max: 30,  mass: 0.5 },
    ];
    const existing = new Set(skeleton.bones.map(b=>b.name));
    const cfg = cfgFull.filter(c => c.bones.every(bn => existing.has(bn)));
    const missing = cfgFull.filter(c => !c.bones.every(bn => existing.has(bn)));
    if (missing.length) console.warn('Bone config mancanti:', missing.map(m=>m.bones));

    ragdoll = new BABYLON.Ragdoll(skeleton, rootMesh, cfg);
    ragdoll.init();

    // animazione
    danceAG = scene.animationGroups[0] || null;
    if (danceAG) { danceAG.stop(); danceAG.loopAnimation = true; }

    // modo iniziale
    const hash = (location.hash||'').toLowerCase();
    let mode;
    if (hash === '#dance')   mode = 'dance';
    else if (hash === '#ragdoll') mode = 'ragdoll';
    else mode = Math.random() < 0.5 ? 'dance' : 'ragdoll';
    setMode(mode);

    // click → afferra & lancia
    scene.onPointerObservable.add((pi) => {
      if (pi.type !== BABYLON.PointerEventTypes.POINTERDOWN) return;
      if (pi.event.button !== 0) return;
      const pick = pi.pickInfo;
      if (!pick || !pick.hit || pick.pickedMesh === ground) return;
      if (currentMode !== 'ragdoll') setMode('ragdoll');
      const pt = pick.pickedPoint;
      let closest = null, dist = Infinity;
      scene.meshes.forEach(mm => {
        if (mm === ground) return;
        const hasPhys = mm.physicsBody || mm.physicsImpostor;
        if (!hasPhys) return;
        const d = BABYLON.Vector3.Distance(mm.getAbsolutePosition(), pt);
        if (d < dist) { dist = d; closest = mm; }
      });
      if (!closest) return;
      const dir = new BABYLON.Vector3((Math.random()-0.5)*2, Math.random()*1.3+0.4, (Math.random()-0.5)*2).normalize();
      const impulse = dir.scale(10 + Math.random()*10);
      if (closest.physicsBody && closest.physicsBody.applyImpulse) {
        closest.physicsBody.applyImpulse(impulse, pt);
      } else if (closest.physicsImpostor) {
        closest.physicsImpostor.applyImpulse(impulse, pt);
      }
    });

    document.getElementById('loading').classList.add('hidden');
    engine.runRenderLoop(() => scene.render());
    window.addEventListener('resize', () => engine.resize());
  } catch (e) {
    console.error(e);
    document.getElementById('err').textContent = 'Errore: ' + e.message;
  }
}

function setMode(m){
  currentMode = m;
  document.getElementById('mode').textContent = m === 'dance' ? 'BALLA' : 'RAGDOLL';
  if (m === 'dance' && danceAG) danceAG.start(true);
  else if (m === 'ragdoll') {
    if (danceAG) danceAG.stop();
    if (ragdoll && !ragdoll.ragdollMode) ragdoll.ragdoll();
  }
}

document.getElementById('btn-dance').onclick   = () => { location.hash = '#dance'; location.reload(); };
document.getElementById('btn-ragdoll').onclick = () => { setMode('ragdoll'); };
document.getElementById('btn-random').onclick  = () => { location.hash = ''; location.reload(); };

start();
})();
