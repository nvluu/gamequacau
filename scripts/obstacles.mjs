import assert from 'node:assert/strict';
import { createAnimalRoute, sampleAnimalRoute, OBSTACLE_LANES } from '../src/obstacle-motion.ts';
import { chromium } from 'playwright';
let seed=123456;
const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
let earlyTurns=0,edgeTurns=0;
for(let run=0;run<100;run++) {
  const route=createAnimalRoute(random);
  for(let i=1;i<route.length-1;i++) {
    const point=route[i];
    assert.ok(point.time>route[i-1].time);
    assert.ok(Math.abs(point.x)<=2.65+1e-9);
    const before=sampleAnimalRoute(route,point.time-1e-6),after=sampleAnimalRoute(route,point.time+1e-6);
    assert.ok(Math.abs(before.x-after.x)<.00001,'No teleport at a turn');
    assert.equal(before.direction,-after.direction,'Animal reverses direction');
    if(Math.abs(point.x)<2.64)earlyTurns++;else edgeTurns++;
  }
}
assert.ok(earlyTurns>0&&edgeTurns>0,'Both early turns and full crossings occur');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
  const page=await browser.newPage({viewport:{width:390,height:844}});
  await page.addInitScript(()=>{let seed=84512;Math.random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);});
  await page.goto(process.env.GAME_URL||'http://127.0.0.1:5173');await page.waitForFunction(()=>window.__game?.state().ready);
  const layouts=new Set(),lanes=new Set();
  for(let trip=0;trip<8;trip++) {
    if(trip===0)await page.locator('#start').click();
    else {await page.locator('#pause').click();await page.locator('#restart-pause').click();}
    const state=await page.evaluate(()=>window.__game.state());
    const fixed=state.obstacles.filter(o=>!o.animal);
    fixed.forEach(o=>{assert.ok(OBSTACLE_LANES.includes(o.x));lanes.add(o.x);});
    layouts.add(JSON.stringify(fixed.map(o=>o.x)));
    assert.equal(state.animals.length,6);
  }
  assert.equal(layouts.size,8,'Restart rerolls positions');assert.equal(lanes.size,3,'All three lanes appear');
  console.log('PASS random trip layouts, three lanes, bounded animal routes and continuous early reversals');
} finally {await browser.close();}
