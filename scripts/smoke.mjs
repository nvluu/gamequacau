import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || undefined,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true});
const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
const state=()=>page.evaluate(()=>window.__game.state());
const waitState=(fn,timeout=45000)=>page.waitForFunction(fn,null,{timeout});
await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5173');await waitState(()=>window.__game?.state().ready);
const rect=await page.locator('#game').boundingBox();assert.ok(Math.abs(rect.width/rect.height-9/16)<.005);
assert.equal((await state()).cargo,24);
await page.screenshot({path:'/tmp/gamequacau-intro.png'});
await page.locator('#start').click();await waitState(()=>window.__game.state().z < -12);
const gentle=await state();assert.equal(gentle.cargo,24,'Gentle straight driving must retain all fruit');
console.log('PASS gentle driving',gentle);
await waitState(()=>window.__game.state().obstaclesHit>0);
await waitState(()=>window.__game.state().cargo<24);
console.log('PASS collision spills fruit',await state());await page.screenshot({path:'/tmp/gamequacau-playing.png'});
await page.locator('#pause').click();const stopped=await state();await page.waitForTimeout(400);assert.equal((await state()).z,stopped.z);assert.equal((await state()).mode,'paused');
await page.locator('#resume').click();assert.equal((await state()).mode,'playing');
await page.keyboard.down('d');const before=await state();await page.waitForTimeout(600);await page.keyboard.up('d');assert.ok((await state()).x>before.x);assert.equal((await state()).input.right,false);
console.log('PASS keyboard and pause');
await page.locator('#pause').click();await page.locator('#restart-pause').click();const reset=await state();assert.equal(reset.cargo,24);assert.equal(reset.obstaclesHit,0);assert.ok(reset.z>-.5);
// Test actual touch events and release, including simultaneous brake and steering.
const cdp=await page.context().newCDPSession(page);
const left=await page.locator('#left').boundingBox(),brake=await page.locator('#brake').boundingBox();
await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:left.x+left.width/2,y:left.y+left.height/2,id:1},{x:brake.x+brake.width/2,y:brake.y+brake.height/2,id:2}]});
await page.waitForTimeout(350);assert.equal((await state()).input.left,true);assert.equal((await state()).input.brake,true);
await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(60);assert.equal((await state()).input.left,false);assert.equal((await state()).input.brake,false);
console.log('PASS multitouch');
await page.locator('#pause').click();await page.locator('#restart-pause').click();
// Real gameplay route: steer to avoid every upcoming obstacle, reaching the finish.
const layout=[{x:0,z:-24},{x:-2.1,z:-40},{x:1.8,z:-53},{x:-.7,z:-68},{x:2,z:-84},{x:.3,z:-98},{x:-2.1,z:-112},{x:1.8,z:-125},{x:-.9,z:-139},{x:1.8,z:-150},{x:-2,z:-163},{x:.2,z:-176},{x:2,z:-189},{x:-1.9,z:-203},{x:.4,z:-219}];
let held=null;const start=Date.now();
while(Date.now()-start<90000){
 const s=await state();if(s.mode==='finished')break;
 const next=layout.find(o=>o.z<s.z-1.5);
 const target=next?(next.x>=0?-2:2):0;
 const key=s.x<target-.2?'d':s.x>target+.2?'a':null;
 if(key!==held){if(held)await page.keyboard.up(held);if(key)await page.keyboard.down(key);held=key;}
 await page.waitForTimeout(100);
}
if(held)await page.keyboard.up(held);
const final=await state();assert.equal(final.mode,'finished');assert.ok(final.z<=-240,'Must finish the full bridge');assert.ok(final.cargo>0,'Some fruit must reach the finish');
assert.ok(await page.locator('#end-screen').isVisible());
console.log('PASS playable finish',final);await page.screenshot({path:'/tmp/gamequacau-finish.png'});
await page.locator('#again').click();assert.equal((await state()).cargo,24);assert.equal((await state()).mode,'playing');
await page.setViewportSize({width:1280,height:900});await page.waitForTimeout(300);const desktop=await page.locator('#game').boundingBox();assert.ok(Math.abs(desktop.width/desktop.height-9/16)<.02);
await page.screenshot({path:'/tmp/gamequacau-desktop.png'});
assert.deepEqual(errors,[]);console.log('PASS desktop portrait and no browser errors');} finally { await browser.close(); }
