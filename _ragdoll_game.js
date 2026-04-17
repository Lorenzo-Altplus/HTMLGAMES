// Karisma Loading — Babylon 6.48.1 + Havok. Loaded after password gate.
// Primary model: KarismaBase.glb (has the idle animation, ~26s).
// Dance animation comes from KarismaDance.glb and is retargeted to the main skeleton.
// States: 'idle' (default) | 'dance' | 'ragdoll'.
(function(){
const canvas = document.getElementById('c');
const engine = new BABYLON.Engine(canvas, true, { alpha: true, preserveDrawingBuffer: true, stencil: true });
let scene, ragdoll, rootMesh, skeleton, idleAG, danceAG, ground;
let state = null;
// In un glTF le bone sono guidate dai TransformNode linkati; per riportare
// il personaggio in T-pose dobbiamo ripristinare position/rotationQuaternion/scaling
// di ciascun _linkedTransformNode (scrivere su bone.getLocalMatrix() viene sovrascritto).
let restTransforms = null;   // [{ pos, rot, scale }]
let rootRest = null;         // rest transform del mesh root (per replicare dopo ragdoll)

const ASSET_DIR = 'karisma-assets/';

async function loadMainModel() {
  const agsBefore = new Set(scene.animationGroups);
  const res = await BABYLON.SceneLoader.ImportMeshAsync('', ASSET_DIR, 'KarismaBase.glb', scene);
  rootMesh = res.meshes[0];
  skeleton = res.skeletons[0];
  if (!skeleton) throw new Error('Skeleton non trovato in KarismaBase.glb.');

  // L'export di Blender genera 8 AG ma solo 1 è reale (durata ~26s). Tieni quello più lungo,
  // scarta il resto così non inquinano scene.animationGroups.
  const newAGs = scene.animationGroups.filter(ag => !agsBefore.has(ag));
  let best = null, bestLen = 0;
  newAGs.forEach(ag => {
    const len = ag.to - ag.from;
    if (len > bestLen) { bestLen = len; best = ag; }
  });
  newAGs.forEach(ag => { if (ag !== best) ag.dispose(); });
  if (best) {
    best.name = 'idle';
    best.loopAnimation = true;
    best.stop();
  }
  idleAG = best;
  console.log('Idle anim:', idleAG ? idleAG.name : '(nessuna)', 'dur:', bestLen.toFixed(2));
}

async function loadDanceFromOtherGLB() {
  // Mappa i TransformNode principali per nome bone: serviranno per retargettare.
  const mainTargets = new Map();
  skeleton.bones.forEach(b => {
    const tn = b._linkedTransformNode || b.getTransformNode && b.getTransformNode();
    if (tn && tn.name) mainTargets.set(tn.name, tn);
  });

  const agsBefore = new Set(scene.animationGroups);
  const meshesBefore = new Set(scene.meshes);
  const skelsBefore = new Set(scene.skeletons);
  const tnBefore = new Set(scene.transformNodes);

  const res = await BABYLON.SceneLoader.ImportMeshAsync('', ASSET_DIR, 'KarismaDance.glb', scene);
  const newAGs = scene.animationGroups.filter(ag => !agsBefore.has(ag));

  // la più lunga è il ballo
  let danceSrc = null, bestLen = 0;
  newAGs.forEach(ag => {
    const len = ag.to - ag.from;
    if (len > bestLen) { bestLen = len; danceSrc = ag; }
  });

  if (danceSrc) {
    danceAG = danceSrc.clone('dance', (target) => mainTargets.get(target.name) || target);
    danceAG.loopAnimation = true;
    danceAG.stop();
    console.log('Dance anim retargetted, dur:', bestLen.toFixed(2));
  } else {
    console.warn('Ballo non trovato in KarismaDance.glb');
  }

  // pulizia: dispose di mesh, skeleton, TransformNode e AG originali del second import
  newAGs.forEach(ag => ag.dispose());
  res.skeletons.forEach(s => s.dispose());
  // dispose meshes in reverse (figli prima dei padri) per evitare warning
  res.meshes.slice().reverse().forEach(m => m.dispose(false, false));
  // TransformNodes aggiunti dal secondo import
  scene.transformNodes.filter(tn => !tnBefore.has(tn)).forEach(tn => tn.dispose());
}

async function start(){
  try {
    if (typeof HavokPhysics !== 'function') throw new Error('HavokPhysics non caricato.');
    if (!BABYLON.Ragdoll) throw new Error('BABYLON.Ragdoll mancante.');

    scene = new BABYLON.Scene(engine);
    scene.clearColor = new BABYLON.Color4(0, 0, 0, 0);

    const cam = new BABYLON.ArcRotateCamera('cam', -Math.PI/2, Math.PI/2.05, 3.5,
      new BABYLON.Vector3(0, 0.95, 0), scene);
    cam.attachControl(canvas, true);
    cam.wheelPrecision = 60;
    cam.lowerRadiusLimit = 2; cam.upperRadiusLimit = 7;
    cam.lowerBetaLimit = Math.PI/3; cam.upperBetaLimit = Math.PI/2 + 0.15;
    cam.minZ = 0.05;

    new BABYLON.HemisphericLight('h', new BABYLON.Vector3(0.2,1,0.2), scene).intensity = 0.9;
    const d = new BABYLON.DirectionalLight('d', new BABYLON.Vector3(-0.4,-1,-0.6), scene);
    d.intensity = 0.8;

    const havok = await HavokPhysics();
    scene.enablePhysics(new BABYLON.Vector3(0,-9.81,0), new BABYLON.HavokPlugin(true, havok));

    ground = BABYLON.MeshBuilder.CreateGround('g', { width: 30, height: 30 }, scene);
    ground.visibility = 0;
    new BABYLON.PhysicsAggregate(ground, BABYLON.PhysicsShapeType.BOX,
      { mass: 0, friction: 0.8, restitution: 0.1 }, scene);

    await loadMainModel();
    await loadDanceFromOtherGLB();

    // orientamento + posizione
    rootMesh.rotationQuaternion = null;
    rootMesh.computeWorldMatrix(true);
    const bb0 = rootMesh.getHierarchyBoundingVectors(true);
    const h0 = bb0.max.y - bb0.min.y;
    if (h0 > 0) rootMesh.scaling.scaleInPlace(1.5 / h0);
    rootMesh.rotation.y = Math.PI - 0.25;
    rootMesh.position.set(1.1, 0, 0);
    rootMesh.computeWorldMatrix(true);
    const bb1 = rootMesh.getHierarchyBoundingVectors(true);
    rootMesh.position.y -= bb1.min.y;

    // rest pose (T-pose): salva TRS di ogni TransformNode collegato a una bone,
    // PRIMA che parta qualsiasi animazione. È lo stato a cui torneremo prima del ragdoll.
    restTransforms = skeleton.bones.map(b => {
      const tn = b._linkedTransformNode;
      if (!tn) return null;
      return {
        tn,
        pos:   tn.position.clone(),
        rot:   tn.rotationQuaternion ? tn.rotationQuaternion.clone() : null,
        scale: tn.scaling.clone(),
      };
    });

    // ragdoll config
    const B = 'mixamorig:';
    const cfgFull = [
      { bones: [B+'Head', B+'Neck'],      size: 0.18, boxOffset: -0.1,  min: -60,  max: 60,  mass: 2 },
      { bones: [B+'Spine2', B+'Spine1'],  size: 0.30, boxOffset: -0.15, min: -20,  max: 20,  mass: 5 },
      { bones: [B+'Spine', B+'Hips'],     size: 0.28, boxOffset: -0.1,  min: -30,  max: 30,  mass: 6, putBoxInBoneCenter: true },
      { bones: [B+'LeftArm'],             size: 0.11, boxOffset: -0.15, min: -120, max: 120, rotationAxis: BABYLON.Axis.Z, mass: 2 },
      { bones: [B+'LeftForeArm'],         size: 0.09, boxOffset: -0.12, min: 0,    max: 140, rotationAxis: BABYLON.Axis.Y, mass: 1.2 },
      { bones: [B+'RightArm'],            size: 0.11, boxOffset: -0.15, min: -120, max: 120, rotationAxis: BABYLON.Axis.Z, mass: 2 },
      { bones: [B+'RightForeArm'],        size: 0.09, boxOffset: -0.12, min: 0,    max: 140, rotationAxis: BABYLON.Axis.Y, mass: 1.2 },
      { bones: [B+'LeftUpLeg'],           size: 0.13, boxOffset: -0.22, min: -90,  max: 70,  rotationAxis: BABYLON.Axis.X, mass: 3 },
      { bones: [B+'LeftLeg'],             size: 0.11, boxOffset: -0.20, min: 0,    max: 130, rotationAxis: BABYLON.Axis.X, mass: 2.2 },
      { bones: [B+'RightUpLeg'],          size: 0.13, boxOffset: -0.22, min: -90,  max: 70,  rotationAxis: BABYLON.Axis.X, mass: 3 },
      { bones: [B+'RightLeg'],            size: 0.11, boxOffset: -0.20, min: 0,    max: 130, rotationAxis: BABYLON.Axis.X, mass: 2.2 },
    ];
    const existing = new Set(skeleton.bones.map(b => b.name));
    const cfg = cfgFull.filter(c => c.bones.every(bn => existing.has(bn)));
    ragdoll = new BABYLON.Ragdoll(skeleton, rootMesh, cfg);

    // stato iniziale: idle
    setState('idle');

    // click sul personaggio → ragdoll + impulso
    scene.onPointerObservable.add((pi) => {
      if (pi.type !== BABYLON.PointerEventTypes.POINTERDOWN) return;
      if (pi.event.button !== 0) return;
      const pick = pi.pickInfo;
      if (!pick || !pick.hit || pick.pickedMesh === ground) return;
      const pt = pick.pickedPoint.clone();
      const wasRagdoll = (state === 'ragdoll');
      if (!wasRagdoll) setState('ragdoll');
      if (wasRagdoll) applyImpulseAt(pt);
      else scene.onBeforeRenderObservable.addOnce(() => {
        scene.onBeforeRenderObservable.addOnce(() => applyImpulseAt(pt));
      });
    });

    // buttons
    document.getElementById('btn-dance').onclick = () => {
      if (state === 'ragdoll') { location.reload(); return; }
      setState(state === 'dance' ? 'idle' : 'dance');
    };
    document.getElementById('btn-ragdoll').onclick = () => {
      if (state === 'ragdoll') location.reload();
      else setState('ragdoll');
    };

    document.getElementById('loading-screen').classList.add('hidden');
    engine.runRenderLoop(() => scene.render());
    window.addEventListener('resize', () => engine.resize());
  } catch (e) {
    console.error(e);
    document.getElementById('err').textContent = 'Errore: ' + e.message;
  }
}

function stopAllAnims() {
  // stop() su TUTTI i gruppi, anche quelli che potrebbero essere stati lasciati vivi
  scene.animationGroups.forEach(ag => ag.stop());
}

function snapToRestPose() {
  if (!restTransforms) return;
  for (const r of restTransforms) {
    if (!r) continue;
    r.tn.position.copyFrom(r.pos);
    if (r.rot) {
      if (!r.tn.rotationQuaternion) r.tn.rotationQuaternion = r.rot.clone();
      else r.tn.rotationQuaternion.copyFrom(r.rot);
    }
    r.tn.scaling.copyFrom(r.scale);
  }
  // forza una compute delle matrici assolute del skeleton nel frame corrente
  skeleton.prepare();
}

function setState(s) {
  if (s === state) return;
  state = s;
  const dBtn = document.getElementById('btn-dance');
  const rBtn = document.getElementById('btn-ragdoll');

  if (s === 'idle') {
    stopAllAnims();
    if (idleAG) idleAG.start(true);
    dBtn.textContent = 'DANCE'; dBtn.classList.remove('active');
    rBtn.textContent = 'RAGDOLL'; rBtn.classList.remove('active');
  }
  else if (s === 'dance') {
    stopAllAnims();
    if (danceAG) danceAG.start(true);
    else if (idleAG) idleAG.start(true); // fallback se dance mancante
    dBtn.textContent = 'IDLE';  dBtn.classList.add('active');
    rBtn.textContent = 'RAGDOLL'; rBtn.classList.remove('active');
  }
  else if (s === 'ragdoll') {
    stopAllAnims();
    snapToRestPose();
    scene.onBeforeRenderObservable.addOnce(() => ragdoll.ragdoll());
    dBtn.textContent = 'RESTART';
    rBtn.textContent = 'RESTART'; rBtn.classList.add('active');
  }
}

function applyImpulseAt(pt){
  let closest = null, dist = Infinity;
  scene.meshes.forEach(mm => {
    if (mm === ground) return;
    if (!mm.physicsBody && !mm.physicsImpostor) return;
    const d = BABYLON.Vector3.Distance(mm.getAbsolutePosition(), pt);
    if (d < dist) { dist = d; closest = mm; }
  });
  if (!closest) return;
  const dir = new BABYLON.Vector3((Math.random()-0.5)*2, Math.random()*1.3+0.4, (Math.random()-0.5)*2).normalize();
  const impulse = dir.scale(12 + Math.random()*10);
  if (closest.physicsBody && closest.physicsBody.applyImpulse) closest.physicsBody.applyImpulse(impulse, pt);
  else if (closest.physicsImpostor) closest.physicsImpostor.applyImpulse(impulse, pt);
}

start();
})();
