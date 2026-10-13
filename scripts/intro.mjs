import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  // Test our player integration independently of YouTube availability and embedding policy.
  await page.route('https://www.youtube-nocookie.com/embed/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Player integration fixture</title><p>External player fixture</p>'}));
  await page.route('https://i.ytimg.com/**',route=>route.abort());
  await page.goto(process.env.GAME_URL||'http://127.0.0.1:5173');await page.waitForFunction(()=>window.__game?.state().ready);
  assert.equal(await page.locator('#video-card').isVisible(),false,'Main screen has no video');
  await page.waitForTimeout(1500);
  await page.evaluate(()=>window.testCanvas=document.querySelector('#canvas canvas'));
  const introState=await page.evaluate(()=>window.__game.state());
  await page.screenshot({path:'/tmp/gamequacau-intro.png'});
  await page.locator('#about-open').click();
  assert.equal(await page.locator('#about-screen').isVisible(),true);
  assert.equal(await page.locator('#video-card iframe').count(),0,'Player loads only on interaction');
  assert.equal((await page.locator('.video-caption').innerText()).trim(),'Đã xem xe làm rớt thanh long? Giờ tới lượt bạn cầm lái!');
  assert.equal(await page.locator('.video-link').getAttribute('href'),'https://www.youtube.com/shorts/m5MuKcskVaU');
  for(const viewport of [{width:390,height:844},{width:360,height:640},{width:375,height:667},{width:320,height:568},{width:270,height:480},{width:1280,height:900}]) {
    await page.setViewportSize(viewport);await page.waitForTimeout(150);
    await page.locator('#about-screen').evaluate(el=>el.scrollTop=0);
    const card=await page.locator('#video-card').boundingBox(),caption=await page.locator('.video-caption').boundingBox(),button=await page.locator('#about-start').boundingBox();
    assert.ok(Math.abs(card.width/card.height-9/16)<.01,'Strict portrait player aspect ratio');
    assert.ok(card.y+card.height<=caption.y+1,'Caption follows the player');
    assert.ok(caption.y+caption.height<=button.y+1,'Play button follows caption');
    await page.locator('#about-start').scrollIntoViewIfNeeded();
    const stage=await page.locator('#game').boundingBox(),visibleButton=await page.locator('#about-start').boundingBox();
    assert.ok(visibleButton.y>=stage.y&&visibleButton.y+visibleButton.height<=stage.y+stage.height,'Play button reachable on short screens');
    await page.locator('#about-back').click();
    const mainButton=await page.locator('#start').boundingBox();
    assert.ok(mainButton.width<stage.width*.8,'Narrower home button');
    assert.ok(mainButton.y<stage.y+stage.height*.77,'Raised home button');
    await page.locator('#about-open').click();
  }
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(150);
  await page.locator('#about-screen').evaluate(el=>el.scrollTop=0);
  await page.screenshot({path:'/tmp/gamequacau-about.png'});
  assert.equal(await page.evaluate(()=>window.testCanvas===document.querySelector('#canvas canvas')),true,'Same 3D canvas across screens');
  assert.ok((await page.evaluate(()=>window.__game.state())).elapsed>=introState.elapsed,'UI navigation does not reset physics');
  await page.locator('#video-play').click();
  await page.locator('#about-back').click();
  assert.equal(await page.locator('#video-card iframe').count(),0,'Back stops video');
  await page.locator('#about-open').click();
  await page.locator('#video-play').click();const frame=page.locator('#video-card iframe');await frame.waitFor();
  const src=new URL(await frame.getAttribute('src'));assert.equal(src.hostname,'www.youtube-nocookie.com');assert.equal(src.pathname,'/embed/m5MuKcskVaU');assert.equal(src.searchParams.get('playsinline'),'1');
  assert.equal(await frame.getAttribute('referrerpolicy'),'strict-origin-when-cross-origin');
  await page.locator('#about-start').click();assert.equal(await frame.count(),0,'Remove player to stop audio/video during gameplay');
  assert.equal(await page.locator('#controls').isVisible(),true);
  const before=await page.evaluate(()=>window.__game.state());await page.keyboard.down('d');await page.waitForTimeout(200);await page.keyboard.up('d');assert.ok(Math.abs((await page.evaluate(()=>window.__game.state())).x-before.x)<.01,'Letter keys do not steer');
  await page.mouse.move(180,450);await page.mouse.down();await page.mouse.move(260,450,{steps:8});await page.waitForTimeout(350);await page.mouse.up();assert.ok((await page.evaluate(()=>window.__game.state())).x>.1,'Mouse steers');
  await page.locator('#pause').click();assert.equal(await page.locator('#pause-screen').isVisible(),true);
  assert.deepEqual(errors,[]);console.log('PASS responsive main/about screens, 9:16 video, unchanged canvas/physics, back/start player teardown and mouse steering. External YouTube player was mocked; streaming not verified.');
}finally{await browser.close();}
