import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
const page=await browser.newPage({viewport:{width:270,height:480}});
await page.addInitScript(()=>{
  let id=0,time;const callbacks=new Map();
  window.requestAnimationFrame=fn=>{if(time===undefined)time=performance.now();callbacks.set(++id,fn);return id;};
  window.cancelAnimationFrame=id=>callbacks.delete(id);
  window.__frame=delta=>{time+=delta;const pending=[...callbacks.values()];callbacks.clear();pending.forEach(fn=>fn(time));};
});
await page.goto(process.env.GAME_URL||'http://127.0.0.1:5173');await page.waitForFunction(()=>window.__game?.state().ready);
// Click in the DOM since rendering is deliberately driven by synthetic frame timestamps.
await page.evaluate(()=>document.querySelector('#start').click());
for(const schedule of [Array(100).fill(1000/120),[8,25,5,31,12,19,7,23,6,16,9,28]]) {
 const frames=await page.evaluate(schedule=>schedule.map(delta=>{window.__frame(delta);return window.__game.state();}),schedule);
 let movingWithoutPhysics=0;
 for(let i=1;i<frames.length;i++) {
  const prev=frames[i-1],curr=frames[i];
  assert.ok(curr.render.z<=prev.render.z+1e-7,'Rendered travel must never jump backwards');
  assert.ok(Math.abs(curr.render.cameraZ-curr.render.z-10.7)<1e-7,'Camera shares the interpolated timeline');
  assert.ok(Math.abs(curr.render.carScreenY-prev.render.carScreenY)<1e-5,'No camera bob from frame pacing');
  if(curr.simulationSteps===prev.simulationSteps&&curr.render.z<prev.render.z)movingWithoutPhysics++;
 }
 assert.ok(movingWithoutPhysics>0,'Rendering advances even between physics ticks');
 console.log('PASS',schedule.length===100?'120Hz':'irregular frames',movingWithoutPhysics,'interpolated frames between physics ticks');
}
} finally {await browser.close();}
