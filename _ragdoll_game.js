// Karisma Loading — Babylon 6.48.1 + Havok.
// KarismaBase.glb contiene entrambe le animazioni: "Dance" (~26s) e "Idle" (~20s).
// Ragdoll si può attivare SOLO da idle (da dance il tasto riporta prima a idle).
// Bottone DEBUG mostra/nasconde le wireframe dei body physics.
(function(){
const canvas = document.getElementById('c');
const engine = new BABYLON.Engine(canvas, true, { alpha: true, preserveDrawingBuffer: true, stencil: true });
let scene, ragdoll, rootMesh, skeleton, kchar, idleAG, danceAG, ground;
let state = null;
let restTransforms = null;
let physicsViewer = null;

const ASSET_DIR = 'karisma-assets/';

async function loadMainModel() {
  const agsBefore = new Set(scene.animationGroups);
  const res = await BABYLON.SceneLoader.ImportMeshAsync('', ASSET_DIR, 'KarismaBase.glb', scene);
  rootMesh = res.meshes[0];
  skeleton = res.skeletons[0];
  if (!skeleton) throw new Error('Skeleton non trovato in KarismaBase.glb.');

  const newAGs = scene.animationGroups.filter(ag => !agsBefore.has(ag));

  // trova Dance e Idle per nome; fallback: Idle = AG più lungo oltre a Dance
  const byName = (n) => newAGs.find(ag => ag.name.toLowerCase() === n.toLowerCase());
  danceAG = byName('Dance');
  idleAG = byName('Idle');
  if (!idleAG || (idleAG.to - idleAG.from) < 0.1) {
    // Idle potrebbe avere durata 0 se il layer NLA non è stato pushato: usa il più lungo non-dance
    let best = null, bestLen = 0;
    newAGs.forEach(ag => {
      if (ag === danceAG) return;
      const len = ag.to - ag.from;
      if (len > bestLen && len > 1) { bestLen = len; best = ag; }
    });
    idleAG = best;
  }
  if (!danceAG) {
    let best = null, bestLen = 0;
    newAGs.forEach(ag => {
      if (ag === idleAG) return;
      const len = ag.to - ag.from;
      if (len > bestLen) { bestLen = len; best = ag; }
    });
    danceAG = best;
  }

  // dispose dei tracks extra (es. mixamo layer rimasto)
  newAGs.forEach(ag => {
    if (ag !== danceAG && ag !== idleAG) ag.dispose();
  });
  if (idleAG)  { idleAG.name = 'idle';   idleAG.loopAnimation = true;  idleAG.stop(); }
  if (danceAG) { danceAG.name = 'dance'; danceAG.loopAnimation = true; danceAG.stop(); }

  console.log('Loaded: idle =', idleAG ? `${(idleAG.to-idleAG.from).toFixed(1)}s` : 'n/a',
              'dance =', danceAG ? `${(danceAG.to-danceAG.from).toFixed(1)}s` : 'n/a');
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

    // wrapper per rotazione/scala/posizione senza toccare __root__ del glTF
    kchar = new BABYLON.TransformNode('kchar', scene);
    rootMesh.parent = kchar;
    kchar.computeWorldMatrix(true);
    const bb0 = rootMesh.getHierarchyBoundingVectors(true);
    const h0 = bb0.max.y - bb0.min.y;
    if (h0 > 0) kchar.scaling.setAll(1.5 / h0);
    kchar.rotation.y = Math.PI - 0.25;
    kchar.position.x = 1.1;
    kchar.computeWorldMatrix(true);
    const bb1 = rootMesh.getHierarchyBoundingVectors(true);
    kchar.position.y = -bb1.min.y;

    // rest pose: snapshot dei TransformNode collegati alle bone
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

    // ragdoll config (invariato)
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
    ragdoll = new BABYLON.Ragdoll(skeleton, kchar, cfg);

    setState('idle');

    // click sul personaggio → ragdoll + impulso, SOLO se siamo in idle
    scene.onPointerObservable.add((pi) => {
      if (pi.type !== BABYLON.PointerEventTypes.POINTERDOWN) return;
      if (pi.event.button !== 0) return;
      const pick = pi.pickInfo;
      if (!pick || !pick.hit || pick.pickedMesh === ground) return;
      const pt = pick.pickedPoint.clone();
      if (state === 'dance') {
        // blocca: ragdoll solo da idle
        flashBtn('btn-dance');
        return;
      }
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
      if (state === 'ragdoll') { location.reload(); return; }
      if (state === 'dance') {
        // ragdoll consentito solo da idle → torna a idle prima
        setState('idle');
        flashBtn('btn-ragdoll');
        return;
      }
      setState('ragdoll');
    };
    document.getElementById('btn-debug').onclick = toggleDebug;

    document.getElementById('loading-screen').classList.add('hidden');
    engine.runRenderLoop(() => scene.render());
    window.addEventListener('resize', () => engine.resize());
  } catch (e) {
    console.error(e);
    document.getElementById('err').textContent = 'Errore: ' + e.message;
  }
}

function flashBtn(id) {
  const b = document.getElementById(id);
  if (!b) return;
  b.style.background = '#ffb84d';
  setTimeout(() => { b.style.background = ''; }, 280);
}

function stopAllAnims() {
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
  skeleton.prepare();
}

function setState(s) {
  if (s === state) return;
  state = s;
  const dBtn = document.getElementById('btn-dance');
  const rBtn = document.getElementById('btn-ragdoll');

  if (s === 'idle') {
    stopAllAnims(); if (idleAG) idleAG.start(true);
    dBtn.textContent = 'DANCE'; dBtn.classList.remove('active');
    rBtn.textContent = 'RAGDOLL'; rBtn.classList.remove('active');
  }
  else if (s === 'dance') {
    stopAllAnims(); if (danceAG) danceAG.start(true); else if (idleAG) idleAG.start(true);
    dBtn.textContent = 'IDLE'; dBtn.classList.add('active');
    rBtn.textContent = 'RAGDOLL'; rBtn.classList.remove('active');
  }
  else if (s === 'ragdoll') {
    stopAllAnims(); snapToRestPose();
    scene.onBeforeRenderObservable.addOnce(() => {
      ragdoll.ragdoll();
      // se il debug era attivo, aggiorna anche la viewer (i body ora sono dinamici)
      if (physicsViewer) refreshPhysicsViewer();
    });
    dBtn.textContent = 'RESTART';
    rBtn.textContent = 'RESTART'; rBtn.classList.add('active');
  }
}

function toggleDebug() {
  const btn = document.getElementById('btn-debug');
  if (physicsViewer) {
    physicsViewer.dispose();
    physicsViewer = null;
    btn.classList.remove('active');
  } else {
    physicsViewer = new BABYLON.PhysicsViewer(scene);
    refreshPhysicsViewer();
    btn.classList.add('active');
  }
}

function refreshPhysicsViewer() {
  if (!physicsViewer) return;
  scene.meshes.forEach(m => {
    if (m === ground) return;
    if (m.physicsBody)    physicsViewer.showBody(m.physicsBody);
    if (m.physicsImpostor) physicsViewer.showImpostor(m.physicsImpostor);
  });
}

function applyImpulseAt(pt){
  let closest=null, dist=Infinity;
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
