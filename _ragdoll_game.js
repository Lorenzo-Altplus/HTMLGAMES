// Karisma Loading — Babylon 6.48.1 + Havok. Loaded after password gate.
// State machine: 'dance' (default), 'stand' (stop anim, T-pose), 'ragdoll' (physics).
(function(){
const canvas = document.getElementById('c');
const engine = new BABYLON.Engine(canvas, true, { alpha: true, preserveDrawingBuffer: true, stencil: true });
let scene, ragdoll, rootMesh, skeleton, danceAG, ground;
let state = null;           // 'dance' | 'stand' | 'ragdoll' — resta null finché setState non viene chiamato
let restMatrices = null;

const GLB_URL = 'karisma-assets/KarismaDance.glb';

async function start(){
  try {
    if (typeof HavokPhysics !== 'function') throw new Error('HavokPhysics non caricato.');
    if (!BABYLON.Ragdoll) throw new Error('BABYLON.Ragdoll mancante.');

    scene = new BABYLON.Scene(engine);
    scene.clearColor = new BABYLON.Color4(0, 0, 0, 0); // trasparente: si vede il bg dietro

    // Camera statica: target al centro, personaggio spostato a destra nella scena
    // così appare nella metà destra dello schermo come da mockup.
    const cam = new BABYLON.ArcRotateCamera('cam', -Math.PI/2, Math.PI/2.05, 3.5,
      new BABYLON.Vector3(0, 0.95, 0), scene);
    cam.attachControl(canvas, true);
    cam.wheelPrecision = 60;
    cam.lowerRadiusLimit = 2; cam.upperRadiusLimit = 7;
    cam.lowerBetaLimit = Math.PI/3; cam.upperBetaLimit = Math.PI/2 + 0.15;
    cam.minZ = 0.05;

    // luci morbide (background quasi bianco → meno contrasto necessario)
    new BABYLON.HemisphericLight('h', new BABYLON.Vector3(0.2, 1, 0.2), scene).intensity = 0.9;
    const d = new BABYLON.DirectionalLight('d', new BABYLON.Vector3(-0.4, -1, -0.6), scene);
    d.intensity = 0.8;

    // physics V2 Havok
    const havok = await HavokPhysics();
    scene.enablePhysics(new BABYLON.Vector3(0, -9.81, 0), new BABYLON.HavokPlugin(true, havok));

    // pavimento invisibile (collider per il ragdoll)
    ground = BABYLON.MeshBuilder.CreateGround('g', { width: 30, height: 30 }, scene);
    ground.visibility = 0;
    new BABYLON.PhysicsAggregate(ground, BABYLON.PhysicsShapeType.BOX,
      { mass: 0, friction: 0.8, restitution: 0.1 }, scene);

    // carica GLB direttamente dal file nel repo
    const res = await BABYLON.SceneLoader.ImportMeshAsync('', GLB_URL.substring(0, GLB_URL.lastIndexOf('/')+1), GLB_URL.substring(GLB_URL.lastIndexOf('/')+1), scene);
    rootMesh = res.meshes[0];
    skeleton = res.skeletons[0];
    if (!skeleton) throw new Error('Skeleton non trovato.');

    // scala a 1.5m e ruota 180° per far guardare verso la camera.
    // IMPORTANTE: glTF imposta rotationQuaternion che sovrascrive rotation.y,
    // quindi va azzerato prima per usare gli Euler.
    rootMesh.rotationQuaternion = null;
    rootMesh.computeWorldMatrix(true);
    const bb0 = rootMesh.getHierarchyBoundingVectors(true);
    const h0 = bb0.max.y - bb0.min.y;
    if (h0 > 0) rootMesh.scaling.scaleInPlace(1.5 / h0);
    rootMesh.rotation.y = Math.PI - 0.25;     // fronte → camera, con piccolo 3/4
    rootMesh.position.set(1.1, 0, 0);          // a destra della scena
    // ricalcola bb dopo scale+rotazione → piedi a y=0
    rootMesh.computeWorldMatrix(true);
    const bb1 = rootMesh.getHierarchyBoundingVectors(true);
    rootMesh.position.y -= bb1.min.y;          // alza di quanto serve per avere piedi a terra

    // config ragdoll (Mixamo) — tuned
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

    // salva rest pose (T-pose) prima che l'animazione parta
    restMatrices = skeleton.bones.map(b => b.getLocalMatrix().clone());

    ragdoll = new BABYLON.Ragdoll(skeleton, rootMesh, cfg);

    // animazione
    danceAG = scene.animationGroups[0] || null;
    if (danceAG) { danceAG.stop(); danceAG.loopAnimation = true; }

    // avvio in dance mode
    setState('dance');

    // click sul personaggio → ragdoll fisico + lancio
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

    // bottone ragdoll in HUD
    document.getElementById('btn-ragdoll').onclick = () => {
      if (state === 'dance') setState('stand');
      else if (state === 'stand') setState('dance');
      // se già ragdoll, reload (non c'è modo pulito di tornare indietro)
      else location.reload();
    };

    document.getElementById('loading-screen').classList.add('hidden');
    engine.runRenderLoop(() => scene.render());
    window.addEventListener('resize', () => engine.resize());
  } catch (e) {
    console.error(e);
    document.getElementById('err').textContent = 'Errore: ' + e.message;
  }
}

function setState(s) {
  if (s === state) return;
  const btn = document.getElementById('btn-ragdoll');
  const prev = state;
  state = s;

  if (s === 'dance') {
    btn.textContent = 'STOP';
    // dallo stato "stand" i bone sono in T-pose: l'animazione li riprende senza problemi
    if (danceAG) danceAG.start(true);
  }
  else if (s === 'stand') {
    btn.textContent = 'DANCE';
    if (danceAG) danceAG.stop();
    // ritorno alla T-pose (rest)
    if (restMatrices) {
      for (let i = 0; i < skeleton.bones.length; i++) {
        skeleton.bones[i].getLocalMatrix().copyFrom(restMatrices[i]);
        skeleton.bones[i].markAsDirty();
      }
      skeleton.computeAbsoluteMatrices(true);
    }
  }
  else if (s === 'ragdoll') {
    btn.textContent = 'RESTART';
    if (danceAG) danceAG.stop();
    if (restMatrices) {
      for (let i = 0; i < skeleton.bones.length; i++) {
        skeleton.bones[i].getLocalMatrix().copyFrom(restMatrices[i]);
        skeleton.bones[i].markAsDirty();
      }
      skeleton.computeAbsoluteMatrices(true);
    }
    scene.onBeforeRenderObservable.addOnce(() => ragdoll.ragdoll());
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
  const dir = new BABYLON.Vector3(
    (Math.random()-0.5)*2,
    Math.random()*1.3 + 0.4,
    (Math.random()-0.5)*2
  ).normalize();
  const impulse = dir.scale(12 + Math.random()*10);
  if (closest.physicsBody && closest.physicsBody.applyImpulse) closest.physicsBody.applyImpulse(impulse, pt);
  else if (closest.physicsImpostor) closest.physicsImpostor.applyImpulse(impulse, pt);
}

// Dance è lo stato iniziale — il bottone dice "STOP"
// (premo STOP → stato stand → bottone "DANCE" per riprendere)
// Click sul personaggio → 'ragdoll' fisico, bottone diventa "RESTART" (reload)

start();
})();
