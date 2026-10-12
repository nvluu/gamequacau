import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ executablePath:process.env.CHROMIUM_PATH || undefined, args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true});
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
  const state=()=>page.evaluate(()=>window.__game.state());
  const waitState=(fn,timeout=60000)=>page.waitForFunction(fn,null,{timeout});
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5173');await waitState(()=>window.__game?.state().ready);
  const rect=await page.locator('#game').boundingBox();assert.ok(Math.abs(rect.width/rect.height-9/16)<.005);
  assert.equal(await page.locator('#brake,#left,#right,#sound').count(),0,'Old button controls removed');
  assert.equal((await state()).cargo,24);assert.equal((await state()).animals.length,6);
  await page.screenshot({path:'/tmp/gamequacau-intro.png'});
  await page.locator('#start').click();await waitState(()=>window.__game.state().z < -12);
  const gentle=await state();assert.equal(gentle.cargo,24);assert.ok(gentle.drawCalls<130,'Render calls stay bounded');
  assert.equal(gentle.audio.state,'running');assert.equal(gentle.audio.activeVoices,0);assert.ok(gentle.audio.rms<.001,'No background music / continuous audio');
  console.log('PASS gentle driving, bounded render cost and no background music',gentle.drawCalls);
  const animalBefore=gentle.animals[0].x;await page.waitForTimeout(350);assert.notEqual((await state()).animals[0].x,animalBefore);
  await waitState(()=>window.__game.state().obstaclesHit>0);await waitState(()=>window.__game.state().cargo<24);
  console.log('PASS animals move and collision spills fruit');
  await page.screenshot({path:'/tmp/gamequacau-playing.png'});
  await page.locator('#pause').click();const stopped=await state();await page.waitForTimeout(400);assert.equal((await state()).z,stopped.z);assert.equal((await state()).audio.musicNotes,stopped.audio.musicNotes);
  await page.locator('#resume').click();assert.equal((await state()).mode,'playing');
  await page.keyboard.down('d');const before=await state();await page.waitForTimeout(450);await page.keyboard.up('d');assert.ok((await state()).x>before.x);assert.equal((await state()).input.right,false);
  console.log('PASS pause/resume and keyboard');
  await page.locator('#pause').click();await page.locator('#restart-pause').click();assert.equal((await state()).cargo,24);
  const cdp=await page.context().newCDPSession(page);
  async function touch(type,x=190,id=1){await cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'||type==='touchCancel'?[]:[{x,y:610,id}]});}
  await touch('touchStart');await touch('touchMove',310);await waitState(()=>window.__game.state().x>1,5000);assert.equal((await state()).dragging,true);
  await touch('touchMove',85);await waitState(()=>window.__game.state().x < -1,5000);
  await touch('touchEnd');assert.equal((await state()).dragging,false);
  await touch('touchStart',290);const reanchor=await state();await page.waitForTimeout(160);assert.ok(Math.abs((await state()).x-reanchor.x)<.4,'A new touch does not teleport the car');
  await touch('touchCancel');assert.equal((await state()).dragging,false);
  await touch('touchStart');await page.keyboard.press('p');assert.equal((await state()).dragging,false);assert.equal((await state()).mode,'paused');await touch('touchEnd');
  console.log('PASS drag both directions, release, reanchor, cancellation and pause');
  await page.locator('#restart-pause').click();
  // Steer using actual keyboard input. Predict each animal's position when the truck reaches it.
  let held=null,target=0,nextZ=null,earlySpeed=null,laterSpeed=null,sampledFrames=[];const start=Date.now();
  while(Date.now()-start<105000){
    const s=await state();if(s.mode==='finished')break;
    if(s.z < -30 && earlySpeed===null)earlySpeed=s.speed;
    if(s.z < -150 && laterSpeed===null)laterSpeed=s.speed;
    sampledFrames.push(s.render);

    const next=s.obstacles.filter(o=>o.z<s.z-1.3).sort((a,b)=>b.z-a.z)[0];
    if(next?.z!==nextZ){nextZ=next?.z;const distance=Math.max(0,s.z-(next?.z??s.z)-1.7);const v=Math.max(s.speed,5);const arrival=(Math.sqrt(v*v+.72*distance)-v)/.36;const obstacleX=next?.animal?Math.sin((s.elapsed+arrival)*.72+next.phase)*2.65:next?.x;target=next?(obstacleX>=0?-1.9:1.9):0;}
    const key=s.x<target-.18?'d':s.x>target+.18?'a':null;
    if(key!==held){if(held)await page.keyboard.up(held);if(key)await page.keyboard.down(key);held=key;}
    await page.waitForTimeout(80);
  }
  if(held)await page.keyboard.up(held);
  assert.ok(laterSpeed>earlySpeed+2,'Speed increases during the trip');
  assert.ok(sampledFrames.every(f=>Math.abs(f.cameraZ-f.z-10.7)<1e-5),'Camera follows the same interpolated pose without Z lag');
  assert.ok(Math.max(...sampledFrames.map(f=>f.carScreenY))-Math.min(...sampledFrames.map(f=>f.carScreenY))<.015,'Car stays stable vertically in the camera');
  console.log('PASS progressive speed and stable camera',earlySpeed,laterSpeed);
  const final=await state();assert.equal(final.mode,'finished');assert.ok(final.z<=-240,'Full bridge crossed');assert.ok(final.cargo>0,'Some fruit reaches the finish');assert.ok(await page.locator('#end-screen').isVisible());
  console.log('PASS playable finish',final.cargo,'fruit,',final.obstaclesHit,'impacts');await page.screenshot({path:'/tmp/gamequacau-finish.png'});
  await page.locator('#again').click();assert.equal((await state()).cargo,24);assert.equal((await state()).mode,'playing');
  await page.setViewportSize({width:1280,height:900});await page.waitForTimeout(300);const desktop=await page.locator('#game').boundingBox();assert.ok(Math.abs(desktop.width/desktop.height-9/16)<.02);
  await page.screenshot({path:'/tmp/gamequacau-desktop.png'});assert.deepEqual(errors,[]);console.log('PASS restart, desktop portrait and no browser errors');
} finally {await browser.close();}
