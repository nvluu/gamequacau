import { OBSTACLE_LANES, createAnimalRoute, sampleAnimalRoute, type AnimalWaypoint } from './obstacle-motion';
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
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GameAudio } from './audio';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;
const TOTAL = 24, FINISH = 240, STEP = 1 / 60;
type Mode = 'intro' | 'playing' | 'paused' | 'finished';
type Fruit = { mesh: THREE.Group; body: RAPIER.RigidBody; lost: boolean; previousPosition: THREE.Vector3; position: THREE.Vector3; previousRotation: THREE.Quaternion; rotation: THREE.Quaternion };
type Obstacle = { mesh: THREE.Group; x: number; z: number; radius: number; hit: boolean; animal?: 'dog' | 'chicken'; legs?: THREE.Object3D[]; warned?: boolean; phase?: number; route?: AnimalWaypoint[] };
let mode: Mode = 'intro', world: RAPIER.World, truckBody: RAPIER.RigidBody;
let fruits: Fruit[] = [], obstacles: Obstacle[] = [];
let x = 0, z = 0, vx = 0, speed = 0, roll = 0, pitch = 0, shake = 0, hitCooldown = 0;
let retained = TOTAL, elapsed = 0, noticeTimer = 0, accumulator = 0, ready = false;
const audio = new GameAudio();
const input = { left: false, right: false };
let drag: { id:number; startX:number; carX:number; targetX:number } | undefined;
let turnCooldown=0, turnJolts=0, suppressClick=false;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#c5dfd7');
scene.fog = new THREE.Fog('#c5dfd7', 35, 145);
const camera = new THREE.PerspectiveCamera(48, 9 / 16, 0.1, 220);
let renderer: THREE.WebGLRenderer;
const truck = new THREE.Group();
const art = new THREE.Group();
const tempQ = new THREE.Quaternion(), tempEuler = new THREE.Euler();
const previousTruck = new THREE.Object3D(), currentTruck = new THREE.Object3D();
let previousElapsed = 0, currentElapsed = 0, renderTime = 0, renderAlpha = 0, simulationSteps = 0;
const renderDiagnostics = { z: 0, cameraZ: 0, carScreenY: 0 };
const projectedTruck = new THREE.Vector3();
const fruitInstances: THREE.InstancedMesh[] = [];
let riverFlow: THREE.InstancedMesh;
const flowDummy = new THREE.Object3D();
let frameMs = 16.7, hudTick = 0, pixelRatio = Math.min(devicePixelRatio, 1), slowFrames = 0;
const groundShadow = new THREE.Mesh(new THREE.PlaneGeometry(2.25, 3.65), new THREE.MeshBasicMaterial({color:'#203c30',transparent:true,opacity:.2,depthWrite:false}));

const mat = (color: string, roughness = .85) => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 });
const m = {
  road: mat('#acb5a8'), cream: mat('#f0e9cc'), dark: mat('#35594d'), rail: mat('#d8d4b6'),
  pink: mat('#df507f'), fruit: mat('#ec5b90'), leaf: mat('#69943e'),
  truck: mat('#eac252'), truckLight: mat('#ffdb74'), rubber: mat('#23352f'), glass: mat('#497d78', .35),
  red: mat('#dd7159'), rock: mat('#879889'), box: mat('#c2935e'), water: mat('#55aca6', .45),
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
// Batch static pieces by material: one draw per material instead of one per plank / leaf.
function batchStatic(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const inverse = root.matrixWorld.clone().invert();
  const groups = new Map<THREE.Material, THREE.BufferGeometry[]>();
  root.traverse(obj => {
    if (!(obj instanceof THREE.Mesh) || Array.isArray(obj.material)) return;
    const geometry = obj.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, obj.matrixWorld));
    const list = groups.get(obj.material) ?? []; list.push(geometry); groups.set(obj.material, list);
  });
  root.clear();
  for (const [material, geometries] of groups) {
    const merged = mergeGeometries(geometries); if (merged) root.add(new THREE.Mesh(merged, material));
    geometries.forEach(g => g.dispose());
  }
}
function makeFruitBatch() {
  // Oval magenta body and curved, wide green scales with pink bases, like a dragon fruit.
  const body = new THREE.SphereGeometry(.19, 10, 8); body.scale(1, 1.24, .93);
  const pinkParts: THREE.BufferGeometry[] = [body], greenParts: THREE.BufferGeometry[] = [];
  function blade(angle: number, height: number, length: number, width: number) {
    const shape = new THREE.Shape();
    shape.moveTo(-width / 2, 0); shape.quadraticCurveTo(-width * .58, length * .52, width * .06, length);
    shape.quadraticCurveTo(width * .55, length * .42, width / 2, 0); shape.closePath();
    const geometry = new THREE.ShapeGeometry(shape, 3);
    const positions = geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) { const t = positions.getY(i) / length; positions.setZ(i, .08 * t * t); }
    geometry.computeVertexNormals();
    const colors = new Float32Array(positions.count * 3);
    const skin = new THREE.Color('#ec5b90'), tip = new THREE.Color('#719d3f');
    for (let i=0;i<positions.count;i++) { const t=positions.getY(i)/length; const c=skin.clone().lerp(tip,THREE.MathUtils.smoothstep(t,.48,.85)); c.toArray(colors,i*3); }
    geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));
    const transform = new THREE.Matrix4().compose(new THREE.Vector3(Math.sin(angle) * .16, height, Math.cos(angle) * .15), new THREE.Quaternion().setFromEuler(new THREE.Euler(.5 * Math.cos(angle), angle, -.5 * Math.sin(angle))), new THREE.Vector3(1,1,1));
    greenParts.push(geometry.applyMatrix4(transform));
    const base = new THREE.ConeGeometry(width * .48, .09, 4); base.translate(0,.018,0); base.applyMatrix4(transform); pinkParts.push(base);
  }
  for (let ring = 0; ring < 2; ring++) for (let i = 0; i < 5; i++) blade(i * Math.PI * 2 / 5 + ring * .6, -.09 + ring * .14, .16 + ring * .035, .11);
  for (let i = 0; i < 4; i++) blade(i * Math.PI / 2, .14, .17, .09);
  const leafMaterial = m.leaf.clone(); leafMaterial.color.set('#ffffff'); leafMaterial.vertexColors=true; leafMaterial.side = THREE.DoubleSide;
  for (const [parts, material] of [[pinkParts, m.fruit], [greenParts, leafMaterial]] as [THREE.BufferGeometry[], THREE.Material][]) {
    const instances = new THREE.InstancedMesh(mergeGeometries(parts)!, material, TOTAL);
    instances.instanceMatrix.setUsage(THREE.DynamicDrawUsage); instances.frustumCulled = false;
    fruitInstances.push(instances); scene.add(instances); parts.forEach(g=>g.dispose());
  }
}
function updateFruitBatch() {
  fruits.forEach((f,i) => { f.mesh.scale.setScalar(f.mesh.visible ? 1 : 0); f.mesh.updateMatrix(); fruitInstances.forEach(batch=>batch.setMatrixAt(i,f.mesh.matrix)); });
  fruitInstances.forEach(batch=>batch.instanceMatrix.needsUpdate=true);
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
      tire.rotation.z = Math.PI / 2;
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
  scene.add(new THREE.HemisphereLight('#fff9e4', '#637f6f', 2.8));
  const sun = new THREE.DirectionalLight('#fff0cb', 3.3); sun.position.set(-15, 25, 10); scene.add(sun);
  // Green land with transverse streams rather than an endless sheet of water.
  box(art, [200, .3, 400], [0, -4.35, -130], mat('#8cba78'));
  const riverbed = mat('#c5c591');
  for (const riverZ of [-4,-76,-156,-232]) {
    box(art, [200,.08,24], [0,-4.16,riverZ], riverbed);
    box(art, [200,.07,17], [0,-4.08,riverZ], m.water);
    for (let i=0;i<12;i++) {
      const side=i%2?1:-1, px=side*(8+(i*5.7)%55);
      const rock=mesh(new THREE.IcosahedronGeometry(.8+(i%3)*.2,0),m.rock,art,[px,-3.8,riverZ+(i%2?10:-10)]);rock.scale.y=.6;
    }
  }
  riverFlow = new THREE.InstancedMesh(new THREE.BoxGeometry(2.4,.018,.07),new THREE.MeshBasicMaterial({color:'#d0f2de',transparent:true,opacity:.48}),64);
  riverFlow.instanceMatrix.setUsage(THREE.DynamicDrawUsage); riverFlow.frustumCulled=false; scene.add(riverFlow);
  const hillMats = [mat('#7cae91'), mat('#97bea2'), mat('#adcbb0')];
  for(let i = 0; i < 18; i++) {
    const side = i % 2 ? 1 : -1;
    const hill = mesh(new THREE.IcosahedronGeometry(1, 0), hillMats[i % 3], art, [side * (27 + i % 4 * 8), -2, -i * 17 + 20]);
    hill.scale.set(12 + i % 5 * 2, 7 + i % 6 * 2, 16);
  }
  for(let i = 0; i < 10; i++) {
    const g = new THREE.Group(); g.position.set(i % 2 ? 13 : -13, -3.8, -i * 25 + 12);
    box(g, [.22, 1.8, .22], [0, .6, 0], m.box);
    const crown = mesh(new THREE.IcosahedronGeometry(1.6, 0), m.leaf, g, [0, 2.5, 0]); crown.scale.y = 1.4; art.add(g);
  }
  scene.add(art);
  groundShadow.rotation.x=-Math.PI/2; groundShadow.position.y=-.029; scene.add(groundShadow);
}
function updateRiver(time: number) {
  for(let i=0;i<64;i++) {
    const riverZ=[-4,-76,-156,-232][Math.floor(i/16)];
    flowDummy.position.set(((i*13.37+time*2.8)%130)-65,-4.035,riverZ+Math.sin(i*12.6)*7);
    flowDummy.scale.set(.5+i%4*.4,1,1);flowDummy.updateMatrix();riverFlow.setMatrixAt(i,flowDummy.matrix);
  }
  riverFlow.instanceMatrix.needsUpdate=true;
}
function signTexture(text: string, background: string, color: string, label = false) {
  const canvas = document.createElement('canvas'); canvas.width = label ? 1024 : 2048; canvas.height = label ? 256 : 384;
  const ctx = canvas.getContext('2d')!; ctx.fillStyle = background; ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.strokeStyle=color;ctx.lineWidth=label?7:9;ctx.strokeRect(16,16,canvas.width-32,canvas.height-32);
  ctx.fillStyle=color;ctx.font=`800 ${label?96:142}px "Be Vietnam Pro", sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillText(text,canvas.width/2,canvas.height/2,canvas.width-90);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  texture.anisotropy=Math.min(renderer.capabilities.getMaxAnisotropy(),8);
  return texture;
}
function addTruckLettering() {
  const material=new THREE.MeshBasicMaterial({map:signTexture('Phương Tấu Hài','#eac252','#183f36',true),toneMapped:false,fog:false});
  const rear=new THREE.Mesh(new THREE.PlaneGeometry(1.6,.4),material);rear.position.set(0,1.15,1.516);truck.add(rear);
  const sideMaterial=new THREE.MeshBasicMaterial({map:signTexture('đời tài nó bạc','#eac252','#183f36',true),toneMapped:false,fog:false});
  for(const side of [-1,1]) {
    const label=new THREE.Mesh(new THREE.PlaneGeometry(1.84,.4),side===1?sideMaterial:material);
    label.position.set(side*.907,1.15,.43);label.rotation.y=side*Math.PI/2;truck.add(label);
  }
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
    const signMat=new THREE.MeshBasicMaterial({map:signTexture(pz===8?'CHUYẾN XE MÙA NGỌT':'VỀ NHÀ RỒI!','#183f36','#fff4c5'),toneMapped:false,fog:false});
    box(g,[7.9,1.5,.22],[0,4.25,0],m.dark);
    mesh(new THREE.PlaneGeometry(7.7,1.43),signMat,g,[0,4.25,.116]);
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
  batchStatic(g); scene.add(g); obstacles.push({mesh:g, x:px, z:pz, radius, hit:false});
}
function buildObstacles() {
  const layout: [number,number,'rock'|'crate'|'barrier'][] = [
    [0,-24,'rock'],[-2.1,-40,'crate'],[1.8,-53,'barrier'],[-.7,-68,'rock'],
    [2,-84,'crate'],[.3,-98,'barrier'],[-2.1,-112,'rock'],[1.8,-125,'rock'],
    [-.9,-139,'crate'],[1.8,-159,'barrier'],[-2,-163,'crate'],[.2,-188,'rock'],
    [2,-189,'crate'],[-1.9,-226,'barrier'],[.4,-219,'rock'],
  ];
  // Keep longitudinal spacing and leave room around moving animals.
  layout.filter((_,i)=>![2,4,6,8,10,12,14].includes(i)).forEach(o => makeObstacle(...o));
  makeAnimal(-52,'chicken',.2);makeAnimal(-84,'dog',1.4);makeAnimal(-113,'chicken',2.3);
  makeAnimal(-144,'dog',.5);makeAnimal(-174,'chicken',1.9);makeAnimal(-207,'dog',2.6);
}
function makeAnimal(pz: number, kind: 'dog' | 'chicken', phase: number) {
  const g=new THREE.Group(), body=new THREE.Group(), legs:THREE.Object3D[]=[];
  const fur=mat(kind==='dog'?'#b8814c':'#f5ead2'), accent=mat(kind==='dog'?'#70462f':'#e45d45');
  g.add(body);
  if(kind==='dog') {
    box(body,[.84,.4,.4],[0,.54,0],fur); box(body,[.36,.4,.37],[.46,.73,0],fur);
    box(body,[.24,.18,.27],[.68,.64,0],m.cream);box(body,[.07,.1,.17],[.8,.65,0],m.rubber);
    for(const side of [-1,1]) {
      const ear=box(body,[.16,.3,.1],[.43,.69,side*.22],accent);ear.rotation.z=.25;
      box(body,[.055,.055,.018],[.56,.8,side*.191],m.rubber);
    }
    const tail=box(body,[.33,.09,.09],[-.55,.7,0],fur);tail.rotation.z=-.55;
  } else {
    const belly=mesh(new THREE.SphereGeometry(.32,8,6),fur,body,[0,.48,0]);belly.scale.set(1.3,1,.85);
    mesh(new THREE.SphereGeometry(.19,8,6),fur,body,[.3,.78,0]);
    for(const side of [-1,1]) {
      const wing=box(body,[.3,.17,.04],[0,.5,side*.25],m.cream);wing.rotation.z=-.3;
      box(body,[.045,.045,.015],[.35,.82,side*.168],m.rubber);
      const tail=box(body,[.12,.32,.05],[-.35,.65,side*.09],m.dark);tail.rotation.z=-.6;
    }
    const beak=mesh(new THREE.ConeGeometry(.08,.2,4),m.truck,body,[.53,.77,0]);beak.rotation.z=-Math.PI/2;
    for(let i=0;i<3;i++)mesh(new THREE.SphereGeometry(.055,6,4),accent,body,[.21+i*.075,.96,0]);
    mesh(new THREE.SphereGeometry(.075,6,4),accent,body,[.41,.66,0]);
  }
  batchStatic(body);
  const legCount=kind==='dog'?4:2;
  for(let i=0;i<legCount;i++) {
    const leg=new THREE.Group();leg.position.set(kind==='dog'?(i<2?-.28:.29):0,.37,i%2?-.14:.14);
    box(leg,[.065,.3,.065],[0,-.15,0],kind==='dog'?accent:m.truck);
    box(leg,[.16,.055,.09],[.04,-.31,0],kind==='dog'?accent:m.truck);batchStatic(leg);g.add(leg);legs.push(leg);
  }
  g.position.z=pz;scene.add(g);obstacles.push({mesh:g,x:0,z:pz,radius:kind==='dog'?.65:.45,hit:false,animal:kind,legs,phase,route:createAnimalRoute(),warned:false});
}
function updateAnimals(time = elapsed, handleWarnings = true) {
  for(const o of obstacles) {
    o.mesh.visible=o.z>z-95&&o.z<z+16;
    if(!o.animal)continue;
    const {x:animalX,direction}=sampleAnimalRoute(o.route!,time);
    if(handleWarnings)o.x=animalX;o.mesh.position.x=animalX;o.mesh.rotation.y=direction>0?0:Math.PI;
    o.mesh.position.y=Math.abs(Math.sin(time*10))*.045;
    o.legs?.forEach((leg,i)=>leg.rotation.z=Math.sin(time*10+i*Math.PI)*.45);
    if(handleWarnings&&!o.warned&&mode==='playing'&&o.z>z-15&&o.z<z-2) {o.warned=true;audio.animal(o.animal);notice(o.animal==='dog'?'CÓ CHÓ QUA CẦU — KÉO ĐỂ NÉ NHÉ':'GÀ ĐANG QUA ĐƯỜNG!');}
  }
}
let introBounceTime=-1;
const introRaycaster=new THREE.Raycaster(),introPointer=new THREE.Vector2();
function bounceIntroTruck(event: MouseEvent) {
  if(!ready||mode!=='intro'||showingAbout||introBounceTime>=0||(event.target as HTMLElement).closest('button,a'))return;
  const rect=renderer.domElement.getBoundingClientRect();
  introPointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);
  scene.updateMatrixWorld(true);introRaycaster.setFromCamera(introPointer,camera);
  if(introRaycaster.intersectObjects([truck,...fruitInstances],true).length)introBounceTime=0;
}
function animateIntroBounce(dt: number) {
  if(introBounceTime<0)return;
  introBounceTime=Math.min(1,introBounceTime+dt);
  const t=introBounceTime,fade=(1-t)*(1-t);
  const lift=Math.sin(Math.PI*t)*.16;
  truck.position.y=lift;truck.rotation.z=Math.sin(t*Math.PI*4)*fade*.035;
  fruits.forEach((f,i)=> {
    f.mesh.position.copy(f.position);f.mesh.quaternion.copy(f.rotation);
    f.mesh.position.y+=lift+Math.sin(t*Math.PI*5+i*.7)*Math.sin(Math.PI*t)*fade*.065;
    f.mesh.position.x+=Math.sin(t*Math.PI*4+i)*Math.sin(Math.PI*t)*fade*.025;
    tempEuler.set(Math.sin(t*Math.PI*5+i)*fade*.07,0,truck.rotation.z);
    tempQ.setFromEuler(tempEuler);f.mesh.quaternion.premultiply(tempQ);
  });
  if(t===1){truck.position.y=0;truck.rotation.z=0;introBounceTime=-1;}
}
function resetPhysics() {
  introBounceTime=-1;
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
    const fruit = new THREE.Group(); fruit.position.set(px,py,pz);
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(px,py,pz).setLinearDamping(.55).setAngularDamping(.75).setCcdEnabled(true));
    world.createCollider(RAPIER.ColliderDesc.ball(.195).setDensity(1.1).setFriction(.6).setRestitution(.12),body);
    fruits.push({mesh:fruit,body,lost:false,previousPosition:fruit.position.clone(),position:fruit.position.clone(),previousRotation:new THREE.Quaternion(),rotation:new THREE.Quaternion()});
  }
  x = z = vx = speed = roll = pitch = shake = elapsed = hitCooldown = noticeTimer = accumulator = 0;
  retained = TOTAL;turnCooldown=turnJolts=0;
  obstacles.forEach(o=> {
    o.hit=false;o.warned=false;o.mesh.rotation.set(0,0,0);
    if(o.animal)o.route=createAnimalRoute();
    else {o.x=OBSTACLE_LANES[Math.floor(Math.random()*OBSTACLE_LANES.length)];o.mesh.position.x=o.x;}
  });
  truck.position.set(0,0,0); truck.rotation.set(0,0,0);
  previousTruck.position.copy(truck.position);currentTruck.position.copy(truck.position);
  previousTruck.quaternion.copy(truck.quaternion);currentTruck.quaternion.copy(truck.quaternion);
  previousElapsed=currentElapsed=renderTime=renderAlpha=simulationSteps=0;
  updateAnimals(); updateFruitBatch(); hudTick=0; resetInput(); updateHud(); $('impact').classList.remove('show'); $('drive-hint').style.opacity = '1';
}
function updateHud() {
  $('cargo').textContent = String(retained);
  const progress = Math.min(100,Math.floor(-z/FINISH*100));
  $('distance').textContent = `${progress}%`; $('progress').style.width = `${progress}%`;
}
function tone(freq: number, duration: number, volume = .12, type: OscillatorType = 'sine') { audio.effect(freq,duration,volume*2.5,type); }
function notice(text: string) { $('impact').textContent = text; $('impact').classList.add('show'); noticeTimer = 1.9; }
function collision(o: Obstacle) {
  o.hit = true; o.mesh.rotation.z = x < o.x ? -.18 : .18;
  const force = THREE.MathUtils.clamp(speed/8.5,.55,1.1);
  shake = force; speed *= .58; hitCooldown = .8;
  vx += (x >= o.x ? 1 : -1) * force * 2.5;
  fruits.forEach((f,i) => {
    if(f.lost) return;
    const side = i % 2 === 0 ? -1 : 1;
    const loadForce=force*(i < 12 ? .45 : .85);
    // An impact tosses the load upwards and sideways, allowing fruit to clear the bed walls.
    f.body.applyImpulse({x:side * (.085 + (i % 3) * .018) * loadForce,y:(.13 + (i % 4) * .019) * loadForce,z:-.09 * loadForce},true);
    f.body.applyTorqueImpulse({x:.014*side,y:.01,z:.014*side},true);
  });
  notice(o.animal?'PHANH GẤP! XE LẮC — HÀNG RƠI':'ỐI! XE LẮC — GIỮ CHẮC TAY LÁI'); tone(150,.32,.16,'sawtooth');
}
function step() {
  previousTruck.position.copy(currentTruck.position);previousTruck.quaternion.copy(currentTruck.quaternion);previousElapsed=currentElapsed;
  for(const f of fruits){f.previousPosition.copy(f.position);f.previousRotation.copy(f.rotation);}
  simulationSteps++;
  elapsed += STEP; hitCooldown = Math.max(0,hitCooldown-STEP);turnCooldown=Math.max(0,turnCooldown-STEP);
  if(noticeTimer>0) { noticeTimer-=STEP; if(noticeTimer<=0) $('impact').classList.remove('show'); }
  const steering = Number(input.right) - Number(input.left);
  const progress=THREE.MathUtils.clamp(-z/FINISH,0,1);
  const targetSpeed=10+16*THREE.MathUtils.smoothstep(progress,.12,.5);
  speed+=THREE.MathUtils.clamp(targetSpeed-speed,-10*STEP,8*STEP);
  const steeringSpeed=4.2+Math.max(0,speed-10)*.12;
  const targetVx=drag?THREE.MathUtils.clamp((drag.targetX-x)*8,-steeringSpeed,steeringSpeed):steering*steeringSpeed;
  const oldVx=vx;
  vx+=(targetVx-vx)*STEP*((drag||steering!==0)?8:18);
  const lateralAcceleration=(vx-oldVx)/STEP;
  if(speed>18&&Math.abs(lateralAcceleration)>35&&turnCooldown===0) {
    turnCooldown=.9;turnJolts++;shake=Math.max(shake,.28);
    const exposed=fruits.slice(12).filter(f=>!f.lost);
    for(let i=0;i<Math.min(3,exposed.length);i++) {
      const f=exposed[(i+turnJolts*3)%exposed.length];
      f.body.applyImpulse({x:-Math.sign(lateralAcceleration)*.11,y:.10,z:0},true);
      f.body.applyTorqueImpulse({x:0,y:0,z:Math.sign(lateralAcceleration)*.012},true);
    }
    notice('ĐÁNH LÁI GẤP! THANH LONG DỄ RƠI');
  }
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
  const targetRoll = THREE.MathUtils.clamp(-vx*.025,-.14,.14) + Math.sin(elapsed*29)*shake*.16;
  roll += (targetRoll-roll)*.15; pitch = Math.sin(elapsed*23)*shake*.06;
  truck.position.set(x,Math.sin(elapsed*25)*shake*.035, z);
  truck.rotation.set(pitch,THREE.MathUtils.clamp(-vx*.025,-.11,.11),roll);
  currentTruck.position.copy(truck.position);currentTruck.quaternion.copy(truck.quaternion);currentElapsed=elapsed;
  tempEuler.copy(truck.rotation); tempQ.setFromEuler(tempEuler);
  truckBody.setNextKinematicTranslation(truck.position); truckBody.setNextKinematicRotation(tempQ);
  updateAnimals();
  for(const o of obstacles) {
    if(!o.hit && hitCooldown<=0 && Math.abs((z-1.05)-o.z)<.9 && Math.abs(x-o.x)<.84+o.radius) collision(o);
  }
  // Model grip from the fruit crate: cargo follows gentle driving, but is free during a jolt.
  for(let i=0;i<fruits.length;i++) {
    const f=fruits[i];
    // Lower fruit is supported by the crate; the exposed top layer is vulnerable to swerves.
    if(f.lost||shake>=(i < 12 ? .4 : .045))continue;
    const p=f.body.translation();
    if(Math.abs(p.x-x)<.88 && Math.abs(p.z-z-.45)<1.03 && p.y<1.95) {
      const v=f.body.linvel();
      f.body.setLinvel({x:v.x*.5+vx*.5,y:v.y,z:v.z*.5-speed*.5},true);
    }
  }
  world.step();
  for(const f of fruits) {
    const p=f.body.translation(), q=f.body.rotation(); f.position.set(p.x,p.y,p.z); f.rotation.set(q.x,q.y,q.z,q.w);
    if(!f.lost && (p.y < .55 || Math.abs(p.x-x)>1.65 || Math.abs(p.z-z) > 2.9)) {
      f.lost = true; retained--; tone(360,.09,.025); notice(`RƠI MẤT ${TOTAL-retained} QUẢ RỒI!`);
    }
    if(f.lost && p.y < -4.05) { f.mesh.visible=false; f.body.setEnabled(false); }
  }
  if(elapsed > 6) $('drive-hint').style.opacity='0';
  if(++hudTick%6===0) updateHud();
  if(-z >= FINISH) finish(true);
  else if(retained <= 0) finish(false);
}
function resetInput() {
  input.left=input.right=false;suppressClick ||= !!drag;const pointer=drag?.id;drag=undefined;
  if(pointer!==undefined&&$('game').hasPointerCapture(pointer))$('game').releasePointerCapture(pointer);
}
let showingAbout=false;
function setAbout(open: boolean) {
  if(mode!=='intro')return;
  showingAbout=open;
  if(!open)stopIntroVideo();
  $('game').classList.toggle('showing-about',open);
  $('about-screen').classList.toggle('hidden',!open);
  ['intro','topbar','footer'].forEach(id=>$(id).classList.toggle('hidden',open));
  $(open?'about-back':'about-open').focus();
}
function leaveAbout() {
  stopIntroVideo();showingAbout=false;
  $('game').classList.remove('showing-about');
  $('about-screen').classList.add('hidden');
  $('topbar').classList.remove('hidden');
}
function stopIntroVideo() {
  $('video-card').querySelector('iframe')?.remove();$('video-play').classList.remove('hidden');
}
function playIntroVideo() {
  if(mode!=='intro'||!showingAbout||$('video-card').querySelector('iframe'))return;
  const frame=document.createElement('iframe');
  frame.src='https://www.youtube-nocookie.com/embed/m5MuKcskVaU?autoplay=1&playsinline=1&rel=0';
  frame.title='Video xe chở thanh long';frame.allow='autoplay; encrypted-media; picture-in-picture; fullscreen';
  frame.allowFullscreen=true;frame.referrerPolicy='strict-origin-when-cross-origin';
  $('video-play').classList.add('hidden');$('video-card').appendChild(frame);
}
function startGame() {
  if(!ready) return;
  leaveAbout();resetPhysics(); mode='playing';
  ['intro','about-open','end-screen','pause-screen','footer'].forEach(id=>$(id).classList.add('hidden'));
  ['hud','controls','pause'].forEach(id=>$(id).classList.remove('hidden'));
  camera.position.set(0,6.8,10.7); camera.lookAt(0,.7,-7);
  void audio.unlock().then(()=>audio.setRunning(mode==='playing'));
}
function pauseGame() {
  if(mode!=='playing') return; mode='paused'; resetInput(); audio.setRunning(false); $('pause-screen').classList.remove('hidden'); $('resume').focus();
}
function resumeGame() {
  if(mode!=='paused') return; mode='playing'; accumulator=0; void audio.unlock().then(()=>audio.setRunning(mode==='playing')); $('pause-screen').classList.add('hidden');
}
function bestScore(score: number) {
  try { const best=Math.max(score,Number(localStorage.getItem('qua-cau-best')) || 0); localStorage.setItem('qua-cau-best',String(best)); return best; }
  catch { return score; }
}
function finish(arrived: boolean) {
  if(mode!=='playing') return; mode='finished'; resetInput(); audio.setRunning(false); updateHud();
  ['controls','pause'].forEach(id=>$(id).classList.add('hidden'));
  $('end-screen').classList.remove('hidden');
  $('end-eyebrow').textContent=arrived?'CHUYẾN XE HOÀN THÀNH':'HÀNG RƠI HẾT RỒI';
  $('end-title').textContent=arrived?'Về nhà rồi!':'Thử lại một chuyến?';
  $('end-description').textContent=arrived?'Một chuyến đi nhỏ, mang theo cả mùa ngọt.':'Kéo nhẹ tay để né vật cản. Ở tốc độ cao, đánh lái gấp cũng làm rơi hàng nhé.';
  $('end-count').textContent=String(retained); $('best').textContent=`Kỷ lục của bạn: ${bestScore(arrived?retained:0)} / ${TOTAL} quả`;
  if(arrived) {tone(660,.25); setTimeout(()=>tone(880,.35),140);} else tone(150,.4);
  $('again').focus();
}
function showHome() {
  leaveAbout();resetPhysics(); mode='intro'; audio.setRunning(false); ['end-screen','pause-screen','hud','controls','pause'].forEach(id=>$(id).classList.add('hidden'));
  ['intro','about-open','footer'].forEach(id=>$(id).classList.remove('hidden')); $('start').focus();
}
function bindControls() {
  const surface=$('game');
  // Releasing a drag after a modal opens must not click the newly displayed button underneath.
  surface.addEventListener('pointerdown',()=>{suppressClick=false;},true);
  surface.addEventListener('click',e=>{if(suppressClick){e.preventDefault();e.stopImmediatePropagation();suppressClick=false;}},true);
  surface.addEventListener('pointerdown',e=>{
    if(mode!=='playing'||drag||(e.target as HTMLElement).closest('button,a'))return;
    e.preventDefault();surface.setPointerCapture(e.pointerId);drag={id:e.pointerId,startX:e.clientX,carX:x,targetX:x};$('drive-hint').style.opacity='0';
  });
  surface.addEventListener('pointermove',e=>{
    if(!drag||e.pointerId!==drag.id)return;e.preventDefault();
    drag.targetX=THREE.MathUtils.clamp(drag.carX+(e.clientX-drag.startX)/surface.clientWidth*7.2,-2.6,2.6);
  });
  const release=(e:PointerEvent)=>{if(drag?.id===e.pointerId)drag=undefined;};
  surface.addEventListener('pointerup',release);surface.addEventListener('pointercancel',release);surface.addEventListener('lostpointercapture',release);
  surface.addEventListener('click',bounceIntroTruck);
  surface.addEventListener('contextmenu',e=>e.preventDefault());
  window.addEventListener('blur',()=>{resetInput();pauseGame();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)pauseGame();});
  $('about-open').addEventListener('click',()=>setAbout(true));
  $('about-back').addEventListener('click',()=>setAbout(false));
  $('about-start').addEventListener('click',startGame);
  $('video-play').addEventListener('click',playIntroVideo);
  const posterImage=$('video-play').querySelector('img')!;
  posterImage.addEventListener('error',()=>posterImage.classList.add('hidden'));
  if(posterImage.complete&&posterImage.naturalWidth===0)posterImage.classList.add('hidden');
  $('start').addEventListener('click',startGame);$('again').addEventListener('click',startGame);
  $('restart-pause').addEventListener('click',startGame);$('pause').addEventListener('click',pauseGame);
  $('resume').addEventListener('click',resumeGame);$('home').addEventListener('click',showHome);

}
function resize() {
  const {width,height}=$('canvas').getBoundingClientRect(); camera.aspect=width/height; camera.updateProjectionMatrix(); renderer.setSize(width,height);if(ready&&mode==='intro')renderer.render(scene,camera);
}
function renderInterpolated(alpha: number) {
  // Simulation remains fixed-rate. Interpolate ALL moving visuals to the same render timestamp.
  truck.position.lerpVectors(previousTruck.position,currentTruck.position,alpha);
  truck.quaternion.slerpQuaternions(previousTruck.quaternion,currentTruck.quaternion,alpha);
  for(const f of fruits){f.mesh.position.lerpVectors(f.previousPosition,f.position,alpha);f.mesh.quaternion.slerpQuaternions(f.previousRotation,f.rotation,alpha);}
  renderTime=THREE.MathUtils.lerp(previousElapsed,currentElapsed,alpha);
  updateAnimals(renderTime,false);
  // Follow the interpolated car directly: no delayed Z tracking / changing look-at target.
  camera.position.set(truck.position.x*.5,6.8,truck.position.z+10.7);
  camera.lookAt(truck.position.x*.28,.7,truck.position.z-7);
}
function animate() {
  let lastTime=performance.now();
  renderer.setAnimationLoop((time: number)=> {
    const dt=Math.min(Math.max((time-lastTime)/1000,0),.1);lastTime=time;
    frameMs=frameMs*.95+dt*1000*.05;
    if(mode==='intro'&&elapsed>=1.3&&introBounceTime<0)return;
    if(mode==='playing'&&elapsed>2&&frameMs>32)slowFrames++;else slowFrames=Math.max(0,slowFrames-1);
    if(slowFrames>60&&pixelRatio>.85){pixelRatio=.85;renderer.setPixelRatio(pixelRatio);resize();slowFrames=0;}
    if(mode==='playing') {
      accumulator+=dt;
      while(accumulator>=STEP&&mode==='playing'){step();accumulator-=STEP;}
      renderAlpha=THREE.MathUtils.clamp(accumulator/STEP,0,1);
      renderInterpolated(renderAlpha);
    } else if(mode==='intro') {
      camera.position.set(5.8,5.8,9);camera.lookAt(0,.3,-1.2);
      if(elapsed<1.3){
        world.step();elapsed+=STEP;
        for(const f of fruits){const p=f.body.translation(),q=f.body.rotation();f.position.set(p.x,p.y,p.z);f.rotation.set(q.x,q.y,q.z,q.w);f.previousPosition.copy(f.position);f.previousRotation.copy(f.rotation);f.mesh.position.copy(f.position);f.mesh.quaternion.copy(f.rotation);}
      }
      animateIntroBounce(dt);renderTime=elapsed;
    }
    updateFruitBatch();updateRiver(renderTime);groundShadow.position.set(truck.position.x,-.029,truck.position.z);
    renderer.render(scene,camera);
    if(import.meta.env.DEV){projectedTruck.copy(truck.position).project(camera);renderDiagnostics.z=truck.position.z;renderDiagnostics.cameraZ=camera.position.z;renderDiagnostics.carScreenY=projectedTruck.y;}
  });
}
async function init() {
  try {
    renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
    renderer.setPixelRatio(pixelRatio); renderer.shadowMap.enabled=false;
    renderer.shadowMap.type=THREE.PCFSoftShadowMap; renderer.outputColorSpace=THREE.SRGBColorSpace;
    renderer.toneMapping=THREE.ACESFilmicToneMapping; renderer.toneMappingExposure=1.15;
    $('canvas').appendChild(renderer.domElement);
    renderer.domElement.addEventListener('webglcontextlost',e=> {e.preventDefault();pauseGame();$('error').textContent='Đồ họa tạm bị ngắt. Hãy tải lại trang để chơi tiếp.';$('error').classList.remove('hidden');});
    await document.fonts.load('800 48px "Be Vietnam Pro"');
    await RAPIER.init(); world=new RAPIER.World({x:0,y:-9.81,z:0}); world.timestep=STEP;
    makeBackdrop();makeBridge();batchStatic(art);makeTruck();addTruckLettering();batchStatic(truck);buildObstacles();makeFruitBatch();resetPhysics();bindControls();
    new ResizeObserver(resize).observe($('game')); resize();
    ready=true; $('about-start').removeAttribute('disabled'); $('start').removeAttribute('disabled'); $('start').innerHTML='<span>LÊN XE THÔI</span><span>→</span>';
    animate();
    // Read-only development diagnostics used by the browser smoke tests.
    if(import.meta.env.DEV) Object.defineProperty(window,'__game',{value:{state:()=>({introBounce:{time:introBounceTime,y:truck.position.y,fruitY:fruits[12]?.mesh.position.y},drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,frameMs,pixelRatio,renderAlpha,simulationSteps,turnJolts,dragging:!!drag,render:{...renderDiagnostics},audio:audio.status(),animals:obstacles.filter(o=>o.animal).map(o=>({kind:o.animal,phase:o.phase,z:o.z,hit:o.hit,...sampleAnimalRoute(o.route!,elapsed)})),obstacles:obstacles.map(o=>({x:o.x,z:o.z,hit:o.hit,animal:o.animal,phase:o.phase})),mode,x,z,vx,speed,cargo:retained,elapsed,fruitCount:fruits.length,obstaclesHit:obstacles.filter(o=>o.hit).length,ready,input:{...input}})}});
  } catch(error) {
    console.error(error); $('error').textContent='Chưa khởi động được đồ họa 3D. Hãy thử Chrome/Safari mới nhất, bật tăng tốc phần cứng rồi tải lại trang.';$('error').classList.remove('hidden');
    $('start').innerHTML='<span>KHÔNG THỂ KHỞI ĐỘNG</span>';
  }
}
void init();
