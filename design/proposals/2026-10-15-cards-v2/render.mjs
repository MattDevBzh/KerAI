import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { writeFile } from 'node:fs/promises';
const base=dirname(fileURLToPath(import.meta.url));
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1696},deviceScaleFactor:1.5});
const failures=[];
page.on('pageerror',e=>failures.push(e.message));
const themes=['atelier','orbite','papier','guilde','jardin'];
const measurements=[];
for (let i=0;i<themes.length;i++){
 const theme=themes[i];
 await page.goto('file://'+resolve(base,'index.html')+'?capture&theme='+theme);
 await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(img=>img.decode()));});
 const metrics=await page.evaluate(()=>({
  images:[...document.images].every(i=>i.complete&&i.naturalWidth>0),
  screens:[...document.querySelectorAll('.screen')].map(screen=>{
   const rect=screen.getBoundingClientRect();
   return {height:rect.height,bottom:rect.bottom,progressBottom:screen.querySelector('.progress').getBoundingClientRect().bottom,inspectorBottom:screen.querySelector('.inspector').getBoundingClientRect().bottom,footerTop:screen.querySelector('.app-footer').getBoundingClientRect().top,cardCount:screen.querySelectorAll('.agent-card').length};
  }),
  horizontalOverflow:document.querySelector('.board').scrollWidth>1440
 }));
 measurements.push({theme,...metrics});
 await page.locator('#board').screenshot({path:resolve(base,String(i+1).padStart(2,'0')+'-'+theme+'-clair-sombre.png')});
}
await page.goto('file://'+resolve(base,'index.html'));
await page.locator('[data-theme="jardin"]').click();
if(await page.locator('.screen.jardin').count()!==2)failures.push('Theme switch failed');
await page.locator('[data-view="dark"]').click();
if(await page.locator('.light-variant').isVisible())failures.push('Mode switch failed');
await writeFile(resolve(base,'render-verification.json'),JSON.stringify({failures,measurements},null,2)+'\n');
console.log(JSON.stringify({failures,measurements},null,2));
await browser.close();
if(failures.length)process.exit(1);
