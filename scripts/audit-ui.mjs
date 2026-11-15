import { chromium } from 'playwright-core';
import { createServer } from 'vite';
const vite = await createServer({ server: { port: 5178, proxy: { '/api': 'http://127.0.0.1:43872' } } });
await vite.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1365, height: 900 } });
const page = await context.newPage();
page.setDefaultTimeout(60000);
await page.addInitScript(() => {
 window.audit = { frames: [], long: [], requests: [] };
 new PerformanceObserver(list => window.audit.long.push(...list.getEntries().map(e=>e.duration))).observe({ type:'longtask', buffered:true });
 let last=0; function frame(t) { if(last) window.audit.frames.push(t-last); last=t; requestAnimationFrame(frame); } requestAnimationFrame(frame);
});
let requests=[]; page.on('request', r => { if(r.url().includes('/api/')) requests.push(r.url().split('/api/')[1]); });
const results=[];
try {
for (const mode of ['cold','warm']) {
 const row={ mode }; const t=Date.now();
 await page.goto('http://localhost:5178/');
 await page.waitForSelector('.choice');
 row.gridDOM=Date.now()-t;
 await page.waitForFunction(() => [...document.querySelectorAll('.choice img')].filter(i=>i.getBoundingClientRect().top<innerHeight).every(i=>i.complete&&i.naturalWidth>0));
 row.gridVisible=Date.now()-t;
 row.firstPaint=await page.evaluate(()=>performance.getEntriesByName('first-contentful-paint')[0]?.startTime);
 for (let i=0;i<3;i++) await page.locator('.choice').nth(i).click();
 await page.getByPlaceholder('Your name').fill('UI Audit');
 let step=Date.now(); await page.getByRole('button',{name:'Open my gallery',exact:true}).click();
 await page.waitForSelector('.heart[aria-pressed="false"]'); row.enterGallery=Date.now()-step;
 step=Date.now(); await page.locator('.heart[aria-pressed="false"]').first().click();
 await page.waitForSelector('.heart[aria-pressed="true"]'); row.heartFeedback=Date.now()-step;
 await page.getByRole('button',{name:'Rehang the wall'}).click();
 await page.waitForSelector('.rehang',{state:'detached'}); row.heartToRecs=Date.now()-step;
 await page.getByRole('link',{name:'Blends',exact:true}).click();
 await page.locator('.code-input').fill('CANVAS');
 step=Date.now(); await page.getByRole('button',{name:'Blend',exact:true}).click();
 await page.waitForSelector('.reveal-match'); row.blendVisible=Date.now()-step;
 await page.waitForSelector('.painting canvas'); row.animationStart=Date.now()-step;
 await page.evaluate(()=>window.audit.frames=[]);
 await page.waitForSelector('.reveal.painted'); row.revealFinish=Date.now()-step;
 Object.assign(row,await page.evaluate(()=>{
 const f=window.audit.frames; const sorted=[...f].sort((a,b)=>a-b);
 return { fps:1000/(f.reduce((a,b)=>a+b,0)/f.length),frameP95:sorted[Math.floor(sorted.length*.95)],longTasks:window.audit.long.length,imageBytes:performance.getEntriesByType('resource').filter(e=>e.initiatorType==='img').reduce((s,e)=>s+e.transferSize,0) };
 }));
 row.onboardingRequests=requests.filter(p=>p==='onboarding').length; row.recsRequests=requests.filter(p=>p.startsWith('recs/')).length;
 results.push(row); console.log(JSON.stringify(row)); requests=[];
 await page.evaluate(()=>localStorage.clear());
}
} catch(e) { console.log(JSON.stringify({error:String(e),url:page.url(),results})); process.exitCode = 1; }
finally { await browser.close(); await vite.close(); }
