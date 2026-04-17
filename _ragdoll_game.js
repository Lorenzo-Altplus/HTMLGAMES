// Karisma Loading — animation-based (niente fisica).
// Assets:
//   KarismaBase.glb  → personaggio + Idle (posa) + Dance (loop)
//   Ragdoll.glb      → animazione di caduta (one-shot)
//   Stand.glb        → animazione di rialzo (one-shot, uso la traccia più lunga)
// Flusso RAGDOLL: idle → ragdoll → lying 3s → stand → idle
(function(){
const canvas = document.getElementById('c');
const engine = new BABYLON.Engine(canvas, true, { alpha: true, preserveDrawingBuffer: true, stencil: true });
let scene, rootMesh, skeleton, idleAG, danceAG, ragdollAG, standAG;
let state = null;
let standTimer = null;

const ASSET_DIR = 'karisma-assets/';

// Carica un GLB "solo animazione": importa, prende il gruppo più lungo, lo CLONA
// retargettandolo sullo scheletro del modello principale, poi distrugge tutto il resto.
async function loadAndRetargetAnimation(filename, newName) {
  const mainTargets = new Map();
  skeleton.bones.forEach(b => {
    const tn = b._linkedTransformNode;
    if (tn && tn.name) mainTargets.set(tn.name, tn);
  });

  const agsBefore = new Set(scene.animationGroups);
  const tnBefore  = new Set(scene.transformNodes);
  const res = await BABYLON.SceneLoader.ImportMeshAsync('', ASSET_DIR, filename, scene);
  const newAGs = scene.animationGroups.filter(ag => !agsBefore.has(ag));

  // pick la traccia più lunga (nelle Stand.glb ce ne sono 2)
  let srcAG = null, bestLen = 0;
  newAGs.forEach(ag => { const len = ag.to - ag.from; if (len > bestLen) { bestLen = len; srcAG = ag; } });

  let retargeted = null;
  if (srcAG) {
    retargeted = srcAG.clone(newName, t => mainTargets.get(t.name) || t);
    retargeted.loopAnimation = false;
    retargeted.stop();
    console.log(`[AG] retargeted ${filename} → ${newName} (dur=${bestLen.toFixed(2)}s)`);
  } else {
    console.warn(`[AG] nessuna traccia trovata in ${filename}`);
  }

  // pulizia: tutto ciò che è stato importato va buttato
  newAGs.forEach(ag => ag.dispose());
  res.skeletons.forEach(s => s.dispose());
  res.meshes.slice().reverse().forEach(m => m.dispose(false, false));
  scene.transformNodes.filter(tn => !tnBefore.has(tn)).forEach(tn => tn.dispose());

  return retargeted;
}

async function start(){
  try {
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

    // --- carica GLB principale con idle e dance ---
    const agsBefore = new Set(scene.animationGroups);
    const res = await BABYLON.SceneLoader.ImportMeshAsync('', ASSET_DIR, 'KarismaBase.glb', scene);
    rootMesh = res.meshes[0]; skeleton = res.skeletons[0];
    if (!skeleton) throw new Error('Skeleton non trovato in KarismaBase.glb.');

    const mainAGs = scene.animationGroups.filter(ag => !agsBefore.has(ag));
    const byName = n => mainAGs.find(ag => ag.name.toLowerCase() === n.toLowerCase());
    idleAG  = byName('Idle');
    danceAG = byName('Dance');
    mainAGs.forEach(ag => { if (ag !== idleAG && ag !== danceAG) ag.dispose(); });

    if (idleAG)  { idleAG.loopAnimation = true;  idleAG.stop(); }
    if (danceAG) { danceAG.loopAnimation = true; danceAG.stop(); }

    // --- retargeta Ragdoll e Stand ---
    ragdollAG = await loadAndRetargetAnimation('Ragdoll.glb', 'ragdoll');
    standAG   = await loadAndRetargetAnimation('Stand.glb',   'stand');

    // --- rotazione/scala/posizione sul __root__ ---
    rootMesh.computeWorldMatrix(true);
    const bb0 = rootMesh.getHierarchyBoundingVectors(true);
    const h0 = bb0.max.y - bb0.min.y;
    if (h0 > 0) rootMesh.scaling.scaleInPlace(1.5 / h0);
    if (!rootMesh.rotationQuaternion) rootMesh.rotationQuaternion = BABYLON.Quaternion.Identity();
    const flip = BABYLON.Quaternion.FromEulerAngles(0, Math.PI - 0.25, 0);
    rootMesh.rotationQuaternion = flip.multiply(rootMesh.rotationQuaternion);
    rootMesh.position.x = 1.1;
    rootMesh.computeWorldMatrix(true);
    const bb1 = rootMesh.getHierarchyBoundingVectors(true);
    rootMesh.position.y = -bb1.min.y;

    setState('idle');

    // click sul personaggio = trigger ragdoll (se disponibile)
    scene.onPointerObservable.add((pi) => {
      if (pi.type !== BABYLON.PointerEventTypes.POINTERDOWN) return;
      if (pi.event.button !== 0) return;
      const pick = pi.pickInfo;
      if (!pick || !pick.hit) return;
      if (state === 'dance')   { flashBtn('btn-dance'); return; }
      if (state === 'ragdoll' || state === 'standing') return; // già in corso
      if (ragdollAG) setState('ragdoll');
    });

    document.getElementById('btn-dance').onclick = () => {
      if (state === 'ragdoll' || state === 'standing') return;
      setState(state === 'dance' ? 'idle' : 'dance');
    };
    document.getElementById('btn-ragdoll').onclick = () => {
      if (state === 'ragdoll' || state === 'standing') return;
      if (state === 'dance')   { setState('idle'); flashBtn('btn-ragdoll'); return; }
      if (!ragdollAG) { alert('Ragdoll.glb non trovata / animazione non caricata.'); return; }
      setState('ragdoll');
    };
    const debugBtn = document.getElementById('btn-debug');
    if (debugBtn) debugBtn.style.display = 'none';

    document.getElementById('loading-screen').classList.add('hidden');
    engine.runRenderLoop(() => scene.render());
    window.addEventListener('resize', () => engine.resize());
  } catch (e) {
    console.error(e);
    document.getElementById('err').textContent = 'Errore: ' + e.message;
  }
}

function stopAllAnims() {
  [idleAG, danceAG, ragdollAG, standAG].forEach(ag => { if (ag) ag.stop(); });
}

function flashBtn(id) {
  const b = document.getElementById(id);
  if (!b) return;
  b.style.background = '#ffb84d';
  setTimeout(() => { b.style.background = ''; }, 280);
}

function setState(s) {
  if (s === state) return;
  state = s;
  const dBtn = document.getElementById('btn-dance');
  const rBtn = document.getElementById('btn-ragdoll');
  if (standTimer) { clearTimeout(standTimer); standTimer = null; }

  if (s === 'idle') {
    stopAllAnims();
    if (idleAG) {
      const dur = idleAG.to - idleAG.from;
      if (dur > 0.1) idleAG.start(true);
      else idleAG.start(false);
    }
    dBtn.style.display = '';
    dBtn.textContent = 'DANCE'; dBtn.classList.remove('active');
    rBtn.style.display = '';
    rBtn.textContent = 'RAGDOLL'; rBtn.classList.remove('active');
  }
  else if (s === 'dance') {
    stopAllAnims();
    if (danceAG) danceAG.start(true);
    dBtn.style.display = '';
    dBtn.textContent = 'IDLE'; dBtn.classList.add('active');
    rBtn.style.display = '';
    rBtn.textContent = 'RAGDOLL'; rBtn.classList.remove('active');
  }
  else if (s === 'ragdoll') {
    stopAllAnims();
    if (ragdollAG) {
      ragdollAG.start(false);
      // quando l'animazione di caduta finisce, aspetta 3s a terra poi passa a stand
      ragdollAG.onAnimationGroupEndObservable.addOnce(() => {
        standTimer = setTimeout(() => {
          if (state === 'ragdoll') setState('standing');
        }, 3000);
      });
    }
    dBtn.style.display = 'none';
    rBtn.style.display = '';
    rBtn.textContent = '...'; rBtn.classList.add('active');
  }
  else if (s === 'standing') {
    stopAllAnims();
    if (standAG) {
      standAG.start(false);
      standAG.onAnimationGroupEndObservable.addOnce(() => {
        if (state === 'standing') setState('idle');
      });
    } else {
      // fallback se stand non c'è
      setState('idle');
    }
    dBtn.style.display = 'none';
    rBtn.style.display = '';
    rBtn.textContent = '...'; rBtn.classList.add('active');
  }
}

start();
})();
