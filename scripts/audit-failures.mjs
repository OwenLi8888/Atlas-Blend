import { chromium } from 'playwright-core';
import { createServer } from 'vite';
const vite=await createServer({server:{port:5178,proxy:{'/api':'http://127.0.0.1:43872'}}});await vite.listen();
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1365,height:900}});
try {
 await page.goto('http://localhost:5178/');
 await page.waitForSelector('.choice');
 for(let i=0;i<3;i++) await page.locator('.choice').nth(i).click();
 await page.getByRole('button',{name:'Open my gallery',exact:true}).click();
 await page.waitForSelector('.heart[aria-pressed="false"]');
 const heart=page.locator('.heart[aria-pressed="false"]').first(); const label=await heart.getAttribute('aria-label');
 await page.route('**/api/heart',async route=>{await new Promise(r=>setTimeout(r,1000));await route.fulfill({status:502,json:{error:'Audit offline'}});});
 const t=Date.now();await heart.click();await page.waitForSelector('.heart[aria-pressed="true"]');
 console.log(JSON.stringify({optimisticWithSlowServerMs:Date.now()-t}));
 await page.getByRole('alert').filter({hasText:'Audit offline'}).waitFor();
 if(await page.getByRole('button',{name:label,exact:true}).getAttribute('aria-pressed')!=='false') throw Error('Heart did not roll back');
 console.log('PASS failed heart rolls back and shows an error');await page.unroute('**/api/heart');
 await page.route('**/api/blend',async route=>{const response=await route.fetch();const data=await response.json();data.commission={status:'pending',image_url:null,title:null,label_status:'pending',label:null};await route.fulfill({json:data});});
 await page.route('**/commission',route=>route.fulfill({json:{status:'pending',image_url:null,title:null,label_status:'pending',label:null}}));
 await page.getByRole('link',{name:'Blends',exact:true}).click();await page.locator('.code-input').fill('CANVAS');
 const begin=Date.now();await page.getByRole('button',{name:'Blend',exact:true}).click();await page.waitForSelector('.painting canvas');
 console.log(JSON.stringify({pendingAgentAnimationMs:Date.now()-begin}));
 await page.waitForSelector('.reveal.painted');
 console.log('PASS painting finishes while agent remains pending');
 await page.screenshot({path:'/tmp/gallery-after-reveal.png',fullPage:true});
 const measurements=await page.evaluate(async()=>{
 const {getPlan}=await import('/src/plan/planStore.ts');
 const response=await fetch('/api/onboarding').then(r=>r.json()); const id=response.works[0].id;
 const src='/api/image?id='+encodeURIComponent(id)+'&width=1280';await fetch(src);
 const times=[];for(const widthMm of [90,60,45]){const t=performance.now();const plan=await getPlan({id:'audit-'+widthMm,file:'',title:'',artist:'',year:'',credit:'',widthMm,src,uploaded:true});times.push({widthMm,ms:performance.now()-t,strokes:plan.strokes.length});}return times;
 });console.log(JSON.stringify({plans:measurements}));
}finally{await browser.close();await vite.close();}
