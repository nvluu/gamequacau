import '@fontsource/be-vietnam-pro/vietnamese-400.css';
import '@fontsource/be-vietnam-pro/vietnamese-600.css';
import '@fontsource/be-vietnam-pro/vietnamese-700.css';
import '@fontsource/be-vietnam-pro/vietnamese-800.css';
import '@fontsource/be-vietnam-pro/latin-400.css';
import '@fontsource/be-vietnam-pro/latin-600.css';
import '@fontsource/be-vietnam-pro/latin-700.css';
import '@fontsource/be-vietnam-pro/latin-800.css';
import './style.css';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;
const TOTAL = 24, FINISH = 240, STEP = 1 / 60;
type Mode = 'intro' | 'playing' | 'paused' | 'finished';
type Fruit = { mesh: THREE.Group; body: RAPIER.RigidBody; lost: boolean };
type Obstacle = { mesh: THREE.Group; x: number; z: number; radius: number; hit: boolean };
let mode: Mode = 'intro', world: RAPIER.World, truckBody: RAPIER.RigidBody;
let fruits: Fruit[] = [], obstacles: Obstacle[] = [];
let x = 0, z = 0, vx = 0, speed = 0, roll = 0, pitch = 0, shake = 0, hitCooldown = 0;
let retained = TOTAL, elapsed = 0, noticeTimer = 0, accumulator = 0, ready = false;
let soundEnabled = false, audio: AudioContext | undefined;
const input = { left: false, right: false, brake: false };
const pointerIds = new Map<string, number>();
const heldKeys = new Set<string>();
const scene = new THREE.Scene();
scene.background = new THREE.Color('#c5dfd7');
scene.fog = new THREE.Fog('#c5dfd7', 35, 145);
const camera = new THREE.PerspectiveCamera(48, 9 / 16, 0.1, 220);
let renderer: THREE.WebGLRenderer;
const truck = new THREE.Group(), wheelMeshes: THREE.Mesh[] = [];
const art = new THREE.Group();
const tempQ = new THREE.Quaternion(), tempEuler = new THREE.Euler();
const cameraTarget = new THREE.Vector3();

const mat = (color: string, roughness = .85) => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 });
const m = {
  road: mat('#acb5a8'), cream: mat('#f0e9cc'), dark: mat('#35594d'), rail: mat('#d8d4b6'),
  pink: mat('#df507f'), fruit: mat('#ec5b90'), leaf: mat('#69943e'),
  truck: mat('#eac252'), truckLight: mat('#ffdb74'), rubber: mat('#23352f'), glass: mat('#497d78', .35),
  red: mat('#dd7159'), rock: mat('#879889'), box: mat('#c2935e'), water: mat('#6eaaa0', .45),
};
function mesh(geometry: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Object3D, pos: [number, number, number]) {
  const obj = new THREE.Mesh(geometry, material); obj.position.set(...pos); obj.castShadow = true; obj.receiveShadow = true; parent.add(obj); return obj;
}
function box(parent: THREE.Object3D, size: [number, number, number], pos: [number, number, number], material: THREE.Material) {
  return mesh(new THREE.BoxGeometry(...size), material, parent, pos);
}
function fixedBox(size: [number, number, number], pos: [number, number, number], friction = .7) {
  world.createCollider(RAPIER.ColliderDesc.cuboid(...size).setTranslation(...pos).setFriction(friction));
}
function makeFruit() {
  const g = new THREE.Group();
  const body = mesh(new THREE.IcosahedronGeometry(.19, 1), m.fruit, g, [0, 0, 0]); body.scale.y = 1.15;
  for (let i = 0; i < 6; i++) {
    const angle = i * Math.PI / 3;
    const leaf = mesh(new THREE.ConeGeometry(.057, .17, 3), m.leaf, g, [Math.sin(angle) * .15, i % 2 ? .045 : -.045, Math.cos(angle) * .15]);
    leaf.rotation.set(Math.cos(angle) * .85, 0, -Math.sin(angle) * .85);
  }
  mesh(new THREE.ConeGeometry(.06, .12, 4), m.leaf, g, [0, .24, 0]);
  return g;
}
function makeTruck() {
  box(truck, [1.85, .24, 3.15], [0, .54, 0], m.dark);
  box(truck, [1.64, .19, 1.96], [0, .86, .45], m.truckLight);
  box(truck, [1.7, .85, .92], [0, 1.14, -1.12], m.truck);
  box(truck, [1.65, .17, 1.05], [0, 1.63, -1.12], m.truckLight);
  box(truck, [1.48, .39, .025], [0, 1.32, -1.595], m.glass);
  for (const side of [-1, 1]) {
    box(truck, [.025, .36, .65], [side * .86, 1.34, -1.12], m.glass);
    box(truck, [.11, .48, 2.02], [side * .845, 1.15, .43], m.truck);
    box(truck, [.07, .055, 2.04], [side * .845, 1.395, .43], m.cream);
    box(truck, [.21, .17, .14], [side * .94, 1.36, -1.44], m.dark);
    box(truck, [.28, .13, .045], [side * .54, .86, -1.606], m.cream);
    box(truck, [.23, .11, .055], [side * .61, .83, 1.5], m.red);
    for (const wheelZ of [-1.04, 1.05]) {
      const tire = mesh(new THREE.CylinderGeometry(.36, .36, .23, 12), m.rubber, truck, [side * .96, .39, wheelZ]);
      tire.rotation.z = Math.PI / 2; wheelMeshes.push(tire);
      const hub = mesh(new THREE.CylinderGeometry(.16, .16, .242, 10), m.cream, truck, [side * .96, .39, wheelZ]); hub.rotation.z = Math.PI / 2;
    }
  }
  box(truck, [1.69, .48, .12], [0, 1.15, 1.45], m.truck);
  box(truck, [1.85, .12, .15], [0, .62, -1.7], m.cream);
  box(truck, [.49, .12, .025], [0, .72, 1.515], m.cream);
  // Tiny green leaf painted on the cab roof.
  const emblem = mesh(new THREE.IcosahedronGeometry(.17, 0), m.leaf, truck, [0, 1.73, -1.12]); emblem.scale.set(1, .18, 1.7);
  scene.add(truck);
}
function makeBackdrop() {
  const light = new THREE.HemisphereLight('#fff9e4', '#637f6f', 2.8); scene.add(light);
  const sun = new THREE.DirectionalLight('#fff0cb', 3.3); sun.position.set(-15, 25, 10); sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024); sun.shadow.camera.left = -18; sun.shadow.camera.right = 18;
  sun.shadow.camera.top = 25; sun.shadow.camera.bottom = -25; sun.shadow.camera.near = .5; sun.shadow.camera.far = 90;
  sun.shadow.bias = -.0005; sun.shadow.normalBias = .035; scene.add(sun); scene.add(sun.target);
  box(art, [360, .3, 540], [0, -4.3, -170], m.water);
  const rippleMat = new THREE.MeshBasicMaterial({color:'#a1c9b4', transparent:true, opacity:.3});
  for(let i = 0; i < 100; i++) {
    const px = Math.sin(i * 19.3) * 48, pz = -((i * 11.79) % 310);
    box(art, [1.3 + (i % 5), .012, .08], [px, -4.13, pz], rippleMat);
  }
  const hillMats = [mat('#7cae91'), mat('#97bea2'), mat('#adcbb0')];
  for(let i = 0; i < 30; i++) {
    const side = i % 2 ? 1 : -1;
    const hill = mesh(new THREE.IcosahedronGeometry(1, 1), hillMats[i % 3], art, [side * (25 + i % 4 * 8), -2, -i * 12 + 20]);
    hill.scale.set(12 + i % 5 * 2, 7 + i % 6 * 2, 16); hill.castShadow = false;
  }
  for(let i = 0; i < 8; i++) {
    const g = new THREE.Group(); g.position.set(i % 2 ? 18 : -18, -3.8, -i * 33 + 12);
    box(g, [.22, 1.8, .22], [0, .6, 0], m.box);
    const crown = mesh(new THREE.IcosahedronGeometry(1.6, 0), m.leaf, g, [0, 2.5, 0]); crown.scale.y = 1.4;
    art.add(g);
  }
  scene.add(art);
  // Keep the shadow map around the moving truck rather than the whole bridge.
  scene.userData.sun = sun;
}
function signTexture(text: string, background: string, color: string) {
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 192;
  const ctx = canvas.getContext('2d')!; ctx.fillStyle = background; ctx.fillRect(0, 0, 512, 192);
  ctx.strokeStyle = color; ctx.lineWidth = 5; ctx.strokeRect(10, 10, 492, 172);
  ctx.fillStyle = color; ctx.font = 'bold 49px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 256, 98);
  return new THREE.CanvasTexture(canvas);
}
function makeBridge() {
  box(art, [7.2, .4, FINISH + 52], [0, -.25, -FINISH / 2 + 3], m.road);
  fixedBox([3.6, .2, (FINISH + 52) / 2], [0, -.25, -FINISH / 2 + 3]);
  for (const side of [-1, 1]) {
    box(art, [.28, .18, FINISH + 40], [side * 3.47, .01, -FINISH / 2], m.cream);
    box(art, [.1, .14, FINISH + 40], [side * 3.58, .9, -FINISH / 2], m.rail);
    box(art, [.1, .1, FINISH + 40], [side * 3.58, .48, -FINISH / 2], m.rail);
    for (let i = -1; i < 33; i++) {
      box(art, [.16, 1.1, .16], [side * 3.58, .45, -i * 8], m.cream);
      if (i % 3 === 0) {
        box(art, [.9, 4.4, 1], [side * 2.65, -2.45, -i * 8], m.rail);
        box(art, [7.3, .65, 1.4], [0, -.8, -i * 8], m.rail);
      }
    }
  }
  for(let i = -2; i < 68; i++) {
    box(art, [.075, .014, 1.5], [0, -.043, -i * 4], m.cream);
    for(const side of [-1,1]) box(art, [.07, .014, 2.3], [side * 2.95, -.043, -i * 4], m.cream);
  }
  for (const pz of [8, -FINISH]) {
    const g = new THREE.Group(); g.position.z = pz;
    for(const side of [-1,1]) box(g, [.35, 5, .4], [side * 3.8, 2.3, 0], m.dark);
    const signMat = new THREE.MeshStandardMaterial({ map:signTexture(pz === 8 ? 'CHUYẾN XE MÙA NGỌT' : 'VỀ NHÀ RỒI!', '#244b3d', '#f5dfaa'), roughness: .9 });
    box(g, [7.9, 1.05, .22], [0, 4.45, 0], signMat);
    art.add(g);
  }
  for(let i = 0; i < 14; i++) {
    box(art, [.5, .018, 1.2], [-3.25 + i * .5, -.031, -FINISH + 1.5], i % 2 ? m.cream : m.dark);
  }
}
function makeObstacle(px: number, pz: number, kind: 'rock' | 'crate' | 'barrier') {
  const g = new THREE.Group(); g.position.set(px, 0, pz);
  let radius = .5;
  if(kind === 'rock') {
    const rock = mesh(new THREE.IcosahedronGeometry(.67, 0), m.rock, g, [0, .4, 0]); rock.scale.set(1, .8, .9); rock.rotation.y = pz;
    mesh(new THREE.IcosahedronGeometry(.24, 0), m.rock, g, [.43, .12, .28]); radius = .6;
  } else if(kind === 'crate') {
    box(g, [.95, .9, .95], [0, .45, 0], m.box);
    for(const yy of [.1,.8]) box(g, [.99, .07, .99], [0, yy, 0], m.cream);
    for(const xx of [-.38,.38]) box(g, [.065, .92, .97], [xx, .46, 0], m.dark);
    const diag = box(g, [.09, 1.15, .02], [0, .45, .49], m.cream); diag.rotation.z = -.7;
  } else {
    radius = .67;
    box(g, [1.2, .47, .3], [0, .65, 0], m.red);
    for(const xx of [-.45,.45]) {
      box(g, [.09, .8, .09], [xx, .38, 0], m.dark); box(g, [.27, .08, .5], [xx, .04, 0], m.dark);
    }
    for(const xx of [-.4,0,.4]) { const stripe = box(g, [.13,.46,.315], [xx,.65,0], m.cream); stripe.rotation.z = -.35; }
  }
  scene.add(g); obstacles.push({mesh:g, x:px, z:pz, radius, hit:false});
}
function buildObstacles() {
  const layout: [number,number,'rock'|'crate'|'barrier'][] = [
    [0,-24,'rock'],[-2.1,-40,'crate'],[1.8,-53,'barrier'],[-.7,-68,'rock'],
    [2,-84,'crate'],[.3,-98,'barrier'],[-2.1,-112,'rock'],[1.8,-125,'rock'],
    [-.9,-139,'crate'],[1.8,-150,'barrier'],[-2,-163,'crate'],[.2,-176,'rock'],
    [2,-189,'crate'],[-1.9,-203,'barrier'],[.4,-219,'rock'],
  ];
  layout.forEach(o => makeObstacle(...o));
}
function resetPhysics() {
  fruits.forEach(f=> { scene.remove(f.mesh); world.removeRigidBody(f.body); }); fruits = [];
  if(truckBody) world.removeRigidBody(truckBody);
  truckBody = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 0, 0));
  const collider = (size: [number,number,number], pos: [number,number,number]) => {
    world.createCollider(RAPIER.ColliderDesc.cuboid(...size).setTranslation(...pos).setFriction(.6).setRestitution(.08),truckBody);
  };
  collider([.82,.095,.98],[0,.86,.45]);
  collider([.055,.24,1.01],[-.845,1.15,.43]); collider([.055,.24,1.01],[.845,1.15,.43]);
  collider([.845,.24,.06],[0,1.15,1.45]); collider([.84,.37,.11],[0,1.19,-.6]);
  for(let layer = 0; layer < 2; layer++) for(let row = 0; row < 4; row++) for(let col = 0; col < 3; col++) {
    const px = (col - 1) * .45 + (layer ? .035 : 0), pz = -.26 + row * .43;
    const py = 1.19 + layer * .43;
    const fruit = makeFruit(); fruit.position.set(px,py,pz); scene.add(fruit);
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(px,py,pz).setLinearDamping(.55).setAngularDamping(.75).setCcdEnabled(true));
    world.createCollider(RAPIER.ColliderDesc.ball(.195).setDensity(1.1).setFriction(.6).setRestitution(.12),body);
    fruits.push({mesh:fruit,body,lost:false});
  }
  x = z = vx = speed = roll = pitch = shake = elapsed = hitCooldown = noticeTimer = accumulator = 0;
  retained = TOTAL;
  obstacles.forEach(o=> {o.hit=false; o.mesh.rotation.set(0,0,0);});
  truck.position.set(0,0,0); truck.rotation.set(0,0,0);
  resetInput(); updateHud(); $('impact').classList.remove('show'); $('drive-hint').style.opacity = '1';
}
function updateHud() {
  $('cargo').textContent = String(retained);
  const progress = Math.min(100,Math.floor(-z/FINISH*100));
  $('distance').textContent = `${progress}%`; $('progress').style.width = `${progress}%`;
}
function tone(freq: number, duration: number, volume = .04, type: OscillatorType = 'sine') {
  if(!soundEnabled || !audio) return;
  const oscillator = audio.createOscillator(), gain = audio.createGain(); oscillator.type = type;
  oscillator.frequency.setValueAtTime(freq,audio.currentTime); oscillator.frequency.exponentialRampToValueAtTime(freq*.6,audio.currentTime+duration);
  gain.gain.setValueAtTime(volume,audio.currentTime); gain.gain.exponentialRampToValueAtTime(.001,audio.currentTime+duration);
  oscillator.connect(gain); gain.connect(audio.destination); oscillator.start(); oscillator.stop(audio.currentTime+duration);
}
function notice(text: string) { $('impact').textContent = text; $('impact').classList.add('show'); noticeTimer = 1.9; }
function collision(o: Obstacle) {
  o.hit = true; o.mesh.rotation.z = x < o.x ? -.18 : .18;
  const force = Math.max(.55,speed/8.5);
  shake = force; speed *= .58; hitCooldown = .8;
  vx += (x >= o.x ? 1 : -1) * force * 2.5;
  fruits.forEach((f,i) => {
    if(f.lost) return;
    const side = i % 2 === 0 ? -1 : 1;
    // An impact tosses the load upwards and sideways, allowing fruit to clear the bed walls.
    f.body.applyImpulse({x:side * (.085 + (i % 3) * .018) * force,y:(.13 + (i % 4) * .019) * force,z:-.09 * force},true);
    f.body.applyTorqueImpulse({x:.014*side,y:.01,z:.014*side},true);
  });
  notice('ỐI! XE LẮC — GIỮ CHẮC TAY LÁI'); tone(95,.23,.09,'triangle');
}
function step() {
  elapsed += STEP; hitCooldown = Math.max(0,hitCooldown-STEP);
  if(noticeTimer>0) { noticeTimer-=STEP; if(noticeTimer<=0) $('impact').classList.remove('show'); }
  const steering = Number(input.right) - Number(input.left);
  const targetSpeed = input.brake ? 3.1 : 8.6;
  speed += THREE.MathUtils.clamp(targetSpeed-speed,-5*STEP,1.4*STEP);
  const targetVx = steering * (input.brake ? 2.4 : 3.2);
  vx += (targetVx-vx) * STEP * 5;
  x += vx*STEP; z -= speed*STEP;
  if(Math.abs(x) > 2.63) {
    x = Math.sign(x)*2.63; vx *= -.2;
    if(hitCooldown<=0) {
      shake = .4; hitCooldown = 1.1; speed *= .85;
      fruits.forEach(f=> {if(!f.lost) f.body.applyImpulse({x:-Math.sign(x)*.035,y:.065,z:0},true);});
      notice('SÁT LAN CAN! LÁI VÀO GIỮA CẦU'); tone(120,.12,.04,'triangle');
    }
  }
  shake *= .95;
  const targetRoll = -vx*.035 + Math.sin(elapsed*29)*shake*.16;
  roll += (targetRoll-roll)*.15; pitch = Math.sin(elapsed*23)*shake*.06 + Math.sin(-z*2)*.004;
  truck.position.set(x,Math.sin(elapsed*25)*shake*.035, z);
  truck.rotation.set(pitch,-vx*.035,roll);
  tempEuler.copy(truck.rotation); tempQ.setFromEuler(tempEuler);
  truckBody.setNextKinematicTranslation(truck.position); truckBody.setNextKinematicRotation(tempQ);
  for(const o of obstacles) {
    if(!o.hit && hitCooldown<=0 && Math.abs((z-1.05)-o.z)<.9 && Math.abs(x-o.x)<.84+o.radius) collision(o);
  }
  // Model grip from the fruit crate: cargo follows gentle driving, but is free during a jolt.
  if(shake < .045) for(const f of fruits) {
    if(f.lost) continue;
    const p=f.body.translation();
    if(Math.abs(p.x-x)<.88 && Math.abs(p.z-z-.45)<1.03 && p.y<1.95) {
      const v=f.body.linvel();
      f.body.setLinvel({x:v.x*.85+vx*.15,y:v.y,z:v.z*.85-speed*.15},true);
    }
  }
  world.step();
  for(const f of fruits) {
    const p=f.body.translation(), q=f.body.rotation(); f.mesh.position.set(p.x,p.y,p.z); f.mesh.quaternion.set(q.x,q.y,q.z,q.w);
    if(!f.lost && (p.y < .55 || Math.abs(p.x-x)>1.65 || Math.abs(p.z-z) > 2.9)) {
      f.lost = true; retained--; tone(360,.09,.025); notice(`RƠI MẤT ${TOTAL-retained} QUẢ RỒI!`);
    }
    if(f.lost && p.y < -4.05) { f.mesh.visible=false; f.body.setEnabled(false); }
  }
  wheelMeshes.forEach(w=>w.rotation.x += speed*STEP/.36);
  if(elapsed > 6) $('drive-hint').style.opacity='0';
  updateHud();
  if(-z >= FINISH) finish(true);
  else if(retained <= 0) finish(false);
}
function resetInput() {
  input.left=input.right=input.brake=false; heldKeys.clear(); pointerIds.clear();
  ['left','right','brake'].forEach(id=>$(id).classList.remove('pressed'));
}
function syncInput() {
  input.left = pointerIds.has('left') || heldKeys.has('arrowleft') || heldKeys.has('a');
  input.right = pointerIds.has('right') || heldKeys.has('arrowright') || heldKeys.has('d');
  input.brake = pointerIds.has('brake') || heldKeys.has('arrowdown') || heldKeys.has('s') || heldKeys.has(' ');
  (['left','right','brake'] as const).forEach(k=>$(k).classList.toggle('pressed',input[k]));
}
function startGame() {
  if(!ready) return;
  resetPhysics(); mode='playing';
  ['intro','end-screen','pause-screen','footer'].forEach(id=>$(id).classList.add('hidden'));
  ['hud','controls','pause'].forEach(id=>$(id).classList.remove('hidden'));
  camera.position.set(0,6.8,10.7); camera.lookAt(0,.7,-7);
  if(soundEnabled) void audio?.resume();
}
function pauseGame() {
  if(mode!=='playing') return; mode='paused'; resetInput(); $('pause-screen').classList.remove('hidden'); $('resume').focus();
}
function resumeGame() {
  if(mode!=='paused') return; mode='playing'; accumulator=0; $('pause-screen').classList.add('hidden');
}
function bestScore(score: number) {
  try { const best=Math.max(score,Number(localStorage.getItem('qua-cau-best')) || 0); localStorage.setItem('qua-cau-best',String(best)); return best; }
  catch { return score; }
}
function finish(arrived: boolean) {
  if(mode!=='playing') return; mode='finished'; resetInput();
  ['controls','pause'].forEach(id=>$(id).classList.add('hidden'));
  $('end-screen').classList.remove('hidden');
  $('end-eyebrow').textContent=arrived?'CHUYẾN XE HOÀN THÀNH':'HÀNG RƠI HẾT RỒI';
  $('end-title').textContent=arrived?(retained>=18?'Mùa ngọt về nhà!':'Qua cầu rồi nhé!'):'Thử lại một chuyến?';
  $('end-description').textContent=arrived?'Một chuyến đi nhỏ, mang theo cả mùa ngọt.':'Đi chậm trước vật cản và giữ tay lái nhẹ hơn nhé.';
  $('end-count').textContent=String(retained); $('best').textContent=`Kỷ lục của bạn: ${bestScore(arrived?retained:0)} / ${TOTAL} quả`;
  if(arrived) {tone(660,.25); setTimeout(()=>tone(880,.35),140);} else tone(150,.4);
  $('again').focus();
}
function showHome() {
  resetPhysics(); mode='intro'; ['end-screen','pause-screen','hud','controls','pause'].forEach(id=>$(id).classList.add('hidden'));
  ['intro','footer'].forEach(id=>$(id).classList.remove('hidden')); $('start').focus();
}
function bindControls() {
  for(const id of ['left','right','brake']) {
    const button=$(id);
    button.addEventListener('pointerdown',e=> {if(mode!=='playing')return; e.preventDefault(); button.setPointerCapture(e.pointerId); pointerIds.set(id,e.pointerId); syncInput();});
    const release=(e:PointerEvent)=> {if(pointerIds.get(id)===e.pointerId) {pointerIds.delete(id); syncInput();}};
    button.addEventListener('pointerup',release); button.addEventListener('pointercancel',release); button.addEventListener('lostpointercapture',release);
    button.addEventListener('contextmenu',e=>e.preventDefault());
  }
  window.addEventListener('keydown',e=> {
    const key=e.key.toLowerCase();
    if(key==='escape' || key==='p') {if(e.repeat)return; if(mode==='playing')pauseGame(); else if(mode==='paused')resumeGame();return;}
    if(['arrowleft','arrowright','arrowdown','a','d','s',' '].includes(key) && mode==='playing') {e.preventDefault(); heldKeys.add(key);syncInput();}
  });
  window.addEventListener('keyup',e=> {heldKeys.delete(e.key.toLowerCase());syncInput();});
  window.addEventListener('blur',()=>{resetInput();pauseGame();});
  document.addEventListener('visibilitychange',()=> {if(document.hidden)pauseGame();});
  $('start').addEventListener('click',startGame); $('again').addEventListener('click',startGame);
  $('restart-pause').addEventListener('click',startGame); $('pause').addEventListener('click',pauseGame);
  $('resume').addEventListener('click',resumeGame); $('home').addEventListener('click',showHome);
  $('sound').addEventListener('click',()=> {
    soundEnabled=!soundEnabled;
    try {if(soundEnabled){audio ??= new AudioContext();void audio.resume();tone(540,.1);}}
    catch{soundEnabled=false;}
    $('sound').setAttribute('aria-label',soundEnabled?'Tắt âm thanh':'Bật âm thanh');
    document.querySelector('.sound-off')!.classList.toggle('hidden',soundEnabled);
  });
}
function resize() {
  const {width,height}=$('canvas').getBoundingClientRect(); camera.aspect=width/height; camera.updateProjectionMatrix(); renderer.setSize(width,height);
}
function animate() {
  const clock=new THREE.Clock();
  renderer.setAnimationLoop(()=> {
    const dt=Math.min(clock.getDelta(),.06);
    if(mode==='playing') {
      accumulator+=dt;
      while(accumulator>=STEP && mode==='playing') {step();accumulator-=STEP;}
      const strength=1-Math.exp(-dt*5);
      cameraTarget.set(x*.5,6.8,z+10.7); camera.position.lerp(cameraTarget,strength);
      camera.lookAt(x*.28,.7,z-7);
    } else if(mode==='intro') {
      const t=performance.now()/1000;
      camera.position.set(5.8+Math.sin(t*.2)*.15,5.8,9); camera.lookAt(0,.3,-1.2);
      // Settle the load before the first trip; no movement and no scoring in the menu.
      if(elapsed<1.3) { world.step(); elapsed+=STEP; fruits.forEach(f=>{const p=f.body.translation(),q=f.body.rotation();f.mesh.position.set(p.x,p.y,p.z);f.mesh.quaternion.set(q.x,q.y,q.z,q.w);}); }
    }
    const sun=scene.userData.sun as THREE.DirectionalLight;
    sun.position.set(x-12,25,z+12); sun.target.position.set(x,0,z-5);
    renderer.render(scene,camera);
  });
}
async function init() {
  try {
    renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
    renderer.setPixelRatio(Math.min(devicePixelRatio,1.75)); renderer.shadowMap.enabled=true;
    renderer.shadowMap.type=THREE.PCFSoftShadowMap; renderer.outputColorSpace=THREE.SRGBColorSpace;
    renderer.toneMapping=THREE.ACESFilmicToneMapping; renderer.toneMappingExposure=1.15;
    $('canvas').appendChild(renderer.domElement);
    renderer.domElement.addEventListener('webglcontextlost',e=> {e.preventDefault();pauseGame();$('error').textContent='Đồ họa tạm bị ngắt. Hãy tải lại trang để chơi tiếp.';$('error').classList.remove('hidden');});
    await RAPIER.init(); world=new RAPIER.World({x:0,y:-9.81,z:0}); world.timestep=STEP;
    makeBackdrop();makeBridge();makeTruck();buildObstacles();resetPhysics();bindControls();
    new ResizeObserver(resize).observe($('game')); resize();
    ready=true; $('start').removeAttribute('disabled'); $('start').innerHTML='<span>LÊN XE THÔI</span><span>→</span>';
    animate();
    // Read-only development diagnostics used by the browser smoke tests.
    if(import.meta.env.DEV) Object.defineProperty(window,'__game',{value:{state:()=>({mode,x,z,speed,cargo:retained,elapsed,fruitCount:fruits.length,obstaclesHit:obstacles.filter(o=>o.hit).length,ready,input:{...input}})}});
  } catch(error) {
    console.error(error); $('error').textContent='Chưa khởi động được đồ họa 3D. Hãy thử Chrome/Safari mới nhất, bật tăng tốc phần cứng rồi tải lại trang.';$('error').classList.remove('hidden');
    $('start').innerHTML='<span>KHÔNG THỂ KHỞI ĐỘNG</span>';
  }
}
void init();
