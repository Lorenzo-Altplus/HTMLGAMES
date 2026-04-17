// Karisma Loading — versione semplice (niente fisica).
// KarismaBase.glb contiene le animazioni come action:
//   - "Idle"     → loop di idle (o posa statica se ha un solo keyframe)
//   - "Dance"    → loop di ballo
//   - "Ragdoll"  → animazione di caduta (opzionale: se manca, il bottone RAGDOLL è no-op)
// Stati: 'idle' (default) | 'dance' | 'ragdoll' (= plays Ragdoll anim, non physics)
(function(){
const canvas = document.getElementById('c');
const engine = new BABYLON.Engine(canvas, true, { alpha: true, preserveDrawingBuffer: true, stencil: true });
let scene, rootMesh, skeleton, idleAG, danceAG, ragdollAG;
let state = null;

const ASSET_DIR = 'karisma-assets/';

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

    // --- carica GLB ---
    const agsBefore = new Set(scene.animationGroups);
    const res = await BABYLON.SceneLoader.ImportMeshAsync('', ASSET_DIR, 'KarismaBase.glb', scene);
    rootMesh = res.meshes[0];
    skeleton = res.skeletons[0];
    if (!skeleton) throw new Error('Skeleton non trovato in KarismaBase.glb.');

    const newAGs = scene.animationGroups.filter(ag => !agsBefore.has(ag));
    const byName = n => newAGs.find(ag => ag.name.toLowerCase() === n.toLowerCase());
    idleAG    = byName('Idle');
    danceAG   = byName('Dance');
    ragdollAG = byName('Ragdoll') || byName('Fall') || byName('Falling');
    newAGs.forEach(ag => { if (ag !== idleAG && ag !== danceAG && ag !== ragdollAG) ag.dispose(); });

    console.log('[AG] idle =', idleAG?.name, `${(idleAG?.to - idleAG?.from)?.toFixed(2)}s`);
    console.log('[AG] dance =', danceAG?.name, `${(danceAG?.to - danceAG?.from)?.toFixed(2)}s`);
    console.log('[AG] ragdoll =', ragdollAG?.name, `${(ragdollAG?.to - ragdollAG?.from)?.toFixed(2)}s`);

    if (idleAG)    { idleAG.loopAnimation = true;    idleAG.stop(); }
    if (danceAG)   { danceAG.loopAnimation = true;   danceAG.stop(); }
    if (ragdollAG) { ragdollAG.loopAnimation = false; ragdollAG.stop(); }

    // --- posiziona e ruota il personaggio ---
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

    // click sul personaggio → ragdoll (se c'è l'animazione)
    scene.onPointerObservable.add((pi) => {
      if (pi.type !== BABYLON.PointerEventTypes.POINTERDOWN) return;
      if (pi.event.button !== 0) return;
      const pick = pi.pickInfo;
      if (!pick || !pick.hit) return;
      if (state === 'dance') { flashBtn('btn-dance'); return; }
      if (ragdollAG && state !== 'ragdoll') setState('ragdoll');
    });

    document.getElementById('btn-dance').onclick = () => {
      if (state === 'ragdoll') { location.reload(); return; }
      setState(state === 'dance' ? 'idle' : 'dance');
    };
    document.getElementById('btn-ragdoll').onclick = () => {
      if (state === 'ragdoll') { location.reload(); return; }
      if (state === 'dance')   { setState('idle'); flashBtn('btn-ragdoll'); return; }
      if (!ragdollAG)          { alert('Nessuna animazione "Ragdoll" trovata nel GLB.\nAggiungi un\'action chiamata "Ragdoll" (es. Mixamo "Falling Back Death").'); return; }
      setState('ragdoll');
    };
    // il bottone DEBUG non ha più senso senza fisica: lo nascondo
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
  if (idleAG)    idleAG.stop();
  if (danceAG)   danceAG.stop();
  if (ragdollAG) ragdollAG.stop();
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

  if (s === 'idle') {
    stopAllAnims();
    if (idleAG) {
      const dur = idleAG.to - idleAG.from;
      if (dur > 0.1) idleAG.start(true);
      else idleAG.start(false);
    }
    dBtn.style.display = '';
    dBtn.textContent = 'DANCE'; dBtn.classList.remove('active');
    rBtn.textContent = 'RAGDOLL'; rBtn.classList.remove('active');
  }
  else if (s === 'dance') {
    stopAllAnims();
    if (danceAG) danceAG.start(true);
    dBtn.style.display = '';
    dBtn.textContent = 'IDLE'; dBtn.classList.add('active');
    rBtn.textContent = 'RAGDOLL'; rBtn.classList.remove('active');
  }
  else if (s === 'ragdoll') {
    stopAllAnims();
    if (ragdollAG) ragdollAG.start(false);  // gioca una volta, resta sull'ultimo frame
    dBtn.style.display = 'none';
    rBtn.textContent = 'RESTART'; rBtn.classList.add('active');
  }
}

start();
})();
