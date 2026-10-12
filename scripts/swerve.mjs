import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
 const page=await browser.newPage({viewport:{width:270,height:480},isMobile:true,hasTouch:true});
 await page.addInitScript(()=>{
   let id=0,time;const callbacks=new Map();
   window.requestAnimationFrame=fn=>{if(time===undefined)time=performance.now();callbacks.set(++id,fn);return id;};window.cancelAnimationFrame=id=>callbacks.delete(id);
   window.__frame=()=>{time+=1000/60;const pending=[...callbacks.values()];callbacks.clear();pending.forEach(fn=>fn(time));};
   document.addEventListener('pointerdown',e=>window.__pointerId=e.pointerId,true);
 });
 await page.goto(process.env.GAME_URL||'http://127.0.0.1:5173');await page.waitForFunction(()=>window.__game?.state().ready);
 await page.evaluate(()=>document.querySelector('#start').click());
 const cdp=await page.context().newCDPSession(page);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:135,y:360,id:1}]});
 const result=await page.evaluate(()=>{
   const surface=document.querySelector('#game');let nextZ,target=0;
   const move=goal=>surface.dispatchEvent(new PointerEvent('pointermove',{pointerId:window.__pointerId,clientX:135+goal/7.2*surface.clientWidth,clientY:360,bubbles:true}));
   for(let frame=0;frame<1200;frame++){
     const s=window.__game.state();if(s.mode!=='playing')throw Error('Trip ended before the swerve test');if(s.z < -75.2&&s.speed>18)break;
     const next=s.obstacles.filter(o=>o.z<s.z-1.3).sort((a,b)=>b.z-a.z)[0];
     if(next?.z!==nextZ){nextZ=next?.z;let predictedZ=s.z,v=s.speed,arrival=0;
       // Approximate future travel only to choose a safe driving line, never to alter game state.
       while(next&&predictedZ>next.z+1.7&&arrival<8){const p=Math.max(0,Math.min(1,(-predictedZ/240-.12)/.38));const targetV=10+16*p*p*(3-2*p);v+=Math.max(-10/60,Math.min(8/60,targetV-v));predictedZ-=v/60;arrival+=1/60;}
       const ox=next?.animal?Math.sin((s.elapsed+arrival)*.72+next.phase)*2.65:next?.x;target=next?(ox>=0?-1.65:1.65):0;
     }
     const desired=Math.max(-5.5,Math.min(5.5,(target-s.x)*4));const command=s.vx+Math.max(-.25,Math.min(.25,desired-s.vx));move(s.x+command/8);window.__frame();
   }
   const before=window.__game.state();
   // This quiet stretch is after the rock at 68m and before the dog at 84m.
   const direction=before.x>0?-1:1;move(before.x+direction*1.05);
   for(let i=0;i<20;i++)window.__frame();
   const after=window.__game.state();return {before:{z:before.z,speed:before.speed,cargo:before.cargo,hits:before.obstaclesHit,jolts:before.turnJolts},after:{z:after.z,cargo:after.cargo,hits:after.obstaclesHit,jolts:after.turnJolts}};
 });
 console.log('SWERVE',result);
 assert.ok(result.before.speed>18);assert.ok(result.after.jolts>result.before.jolts);assert.equal(result.after.hits,result.before.hits,'No obstacle hit during the swerve');assert.ok(result.after.cargo<result.before.cargo,'Fast steering alone spills fruit');
 console.log('PASS high-speed swerve causes real fruit loss without obstacle collision');
}finally{await browser.close();}
