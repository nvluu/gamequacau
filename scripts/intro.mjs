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
  assert.equal(await page.locator('#intro h1,.trip-note,.intro-description').count(),0);
  assert.equal(await page.locator('#intro iframe').count(),0,'Player loads only on interaction');
  assert.equal((await page.locator('.video-caption').innerText()).trim(),'Đã xem xe làm rớt thanh long? Giờ tới lượt bạn cầm lái!');
  assert.ok(!(await page.locator('.input-hint').innerText()).includes('A / D'));
  for(const viewport of [{width:390,height:844},{width:360,height:640},{width:375,height:667},{width:320,height:568},{width:270,height:480},{width:1280,height:900}]) {
    await page.setViewportSize(viewport);await page.waitForTimeout(150);
    const stage=await page.locator('#game').boundingBox(),card=await page.locator('#video-card').boundingBox(),caption=await page.locator('.video-caption').boundingBox(),button=await page.locator('#start').boundingBox();
    assert.ok(card.width>=199&&card.height>=200,'Supported player viewport');if(viewport.height>600)assert.ok(Math.abs(card.width/card.height-9/16)<.02,'Portrait player aspect ratio');
    assert.ok(card.y>=stage.y&&card.y+card.height<=caption.y+1,'Caption follows the player');
    assert.ok(caption.y+caption.height<=button.y+1,'Caption and start button do not overlap');
    assert.ok(button.y+button.height<=stage.y+stage.height,'Start button stays inside portrait viewport');
  }
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(150);await page.screenshot({path:'/tmp/gamequacau-intro.png'});
  await page.locator('#video-play').click();const frame=page.locator('#video-card iframe');await frame.waitFor();
  const src=new URL(await frame.getAttribute('src'));assert.equal(src.hostname,'www.youtube-nocookie.com');assert.equal(src.pathname,'/embed/m5MuKcskVaU');assert.equal(src.searchParams.get('playsinline'),'1');
  assert.equal(await frame.getAttribute('referrerpolicy'),'strict-origin-when-cross-origin');
  await page.locator('#start').click();assert.equal(await frame.count(),0,'Remove player to stop audio/video during gameplay');
  assert.equal(await page.locator('#controls').isVisible(),true);
  const before=await page.evaluate(()=>window.__game.state());await page.keyboard.down('d');await page.waitForTimeout(200);await page.keyboard.up('d');assert.ok(Math.abs((await page.evaluate(()=>window.__game.state())).x-before.x)<.01,'Letter keys do not steer');
  await page.mouse.move(180,450);await page.mouse.down();await page.mouse.move(260,450,{steps:8});await page.waitForTimeout(350);await page.mouse.up();assert.ok((await page.evaluate(()=>window.__game.state())).x>.1,'Mouse steers');
  await page.locator('#pause').click();assert.equal(await page.locator('#pause-screen').isVisible(),true);
  assert.deepEqual(errors,[]);console.log('PASS responsive intro, exact caption, lazy iframe URL, player teardown and mouse-only steering. External YouTube player was mocked; streaming not verified.');
}finally{await browser.close();}
