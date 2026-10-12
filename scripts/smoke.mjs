import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ executablePath:process.env.CHROMIUM_PATH || undefined, args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true});
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!m.location().url.startsWith('https://i.ytimg.com/'))errors.push(m.text())});
  const state=()=>page.evaluate(()=>window.__game.state());
  const waitState=(fn,timeout=60000)=>page.waitForFunction(fn,null,{timeout});
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5173');await waitState(()=>window.__game?.state().ready);
  const rect=await page.locator('#game').boundingBox();assert.ok(Math.abs(rect.width/rect.height-9/16)<.005);
  assert.equal(await page.locator('#brake,#sound,#left,#right').count(),0,'Swipe controls replace buttons');
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
  await page.locator('#pause').click();const stopped=await state();await page.waitForTimeout(400);assert.equal((await state()).z,stopped.z);assert.equal((await state()).audio.running,false);
  await page.locator('#resume').click();assert.equal((await state()).mode,'playing');
  const before=await state();await page.mouse.move(180,450);await page.mouse.down();await page.mouse.move(260,450,{steps:8});await page.waitForTimeout(400);await page.mouse.up();assert.ok((await state()).x>before.x);
  console.log('PASS pause/resume and mouse drag');
  await page.locator('#pause').click();await page.locator('#restart-pause').click();assert.equal((await state()).cargo,24);
  const cdp=await page.context().newCDPSession(page);
  const touch=(type,x=195)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'||type==='touchCancel'?[]:[{x,y:500,id:1}]});
  await touch('touchStart');await touch('touchMove',280);await waitState(()=>window.__game.state().x>.8,5000);assert.equal((await state()).dragging,true);
  await touch('touchMove',105);await waitState(()=>window.__game.state().x<-.8,5000);
  await touch('touchEnd');assert.equal((await state()).dragging,false);
  await touch('touchStart');await touch('touchCancel');assert.equal((await state()).dragging,false);
  await touch('touchStart');await page.locator('#pause').click();assert.equal((await state()).dragging,false);assert.equal((await state()).mode,'paused');await touch('touchEnd');
  console.log('PASS drag both directions, release, cancel and pause');
  await page.locator('#restart-pause').click();
  // Actual gentle pointer steering; abrupt swerves are intentionally risky at high speed.
  let target=0,nextZ=null,earlySpeed=null,laterSpeed=null,sampledFrames=[];const start=Date.now();
  await touch('touchStart');
  while(Date.now()-start<105000){
    const s=await state();if(s.mode==='finished')break;
    if(s.z < -50&&earlySpeed===null)earlySpeed=s.speed;if(s.z < -130&&laterSpeed===null)laterSpeed=s.speed;sampledFrames.push(s.render);
    const next=s.obstacles.filter(o=>o.z<s.z-1.3).sort((a,b)=>b.z-a.z)[0];
    if(next?.z!==nextZ){nextZ=next?.z;const arrival=Math.max(0,s.z-(next?.z??s.z)-1.7)/Math.max(s.speed,10);const obstacleX=next?.animal?Math.sin((s.elapsed+arrival)*.72+next.phase)*2.65:next?.x;target=next?(obstacleX>=0?-1.8:1.8):0;}
    const limit=.42+Math.abs(s.vx??0)*.08;const goal=s.x+Math.max(-limit,Math.min(limit,target-s.x));
    await touch('touchMove',195+goal/7.2*390);await page.waitForTimeout(60);
  }
  await touch('touchEnd');
  assert.ok(earlySpeed>9,'Faster start');assert.ok(laterSpeed>24&&laterSpeed>earlySpeed*1.7,'Very fast by halfway');
  assert.ok(sampledFrames.every(f=>Math.abs(f.cameraZ-f.z-10.7)<1e-5),'Camera follows the same interpolated pose without Z lag');
  assert.ok(Math.max(...sampledFrames.map(f=>f.carScreenY))-Math.min(...sampledFrames.map(f=>f.carScreenY))<.02,'Car stays stable vertically in the camera');
  console.log('PASS faster start / fast halfway and stable camera',earlySpeed,laterSpeed);
  const final=await state();assert.equal(final.mode,'finished');assert.ok(final.z<=-240,'Full bridge crossed');assert.ok(final.cargo>0,'Some fruit reaches the finish');assert.ok(await page.locator('#end-screen').isVisible());
  console.log('PASS playable finish',final.cargo,'fruit,',final.obstaclesHit,'impacts');await page.screenshot({path:'/tmp/gamequacau-finish.png'});
  await page.locator('#again').click();assert.equal((await state()).cargo,24);assert.equal((await state()).mode,'playing');
  await page.setViewportSize({width:1280,height:900});await page.waitForTimeout(300);const desktop=await page.locator('#game').boundingBox();assert.ok(Math.abs(desktop.width/desktop.height-9/16)<.02);
  await page.screenshot({path:'/tmp/gamequacau-desktop.png'});assert.deepEqual(errors,[]);console.log('PASS restart, desktop portrait and no browser errors');
} finally {await browser.close();}
