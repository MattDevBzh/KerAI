// Self-contained review gallery, using the production PNG/GIF files unchanged.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
const { avatars } = JSON.parse(await readFile('src/shared/avatar-catalog.json', 'utf8'));
const assets = [];
for (const avatar of avatars) {
  const images = {};
  for (const [state, file] of Object.entries({
    idle: 'idle.png',
    working: 'working.gif',
    approved: 'approved.png',
  })) {
    const mime = file.endsWith('.gif') ? 'image/gif' : 'image/png';
    images[state] =
      `data:${mime};base64,${(await readFile(`webview/public/avatars/${avatar.id}/${file}`)).toString('base64')}`;
  }
  assets.push({ ...avatar, images });
}
const html = `<!doctype html>
<html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Feature Studio — 20 métiers</title>
<style>
*{box-sizing:border-box}body{margin:0;padding:32px;background:#f6f2e9;color:#302c38;font:15px system-ui,sans-serif}
body.dark{background:#1b202c;color:#e9edf3}header{max-width:1200px;margin:0 auto 28px}h1{font-size:28px;margin:0 0 8px}p{opacity:.75}
nav{display:flex;gap:8px;flex-wrap:wrap}button{font:inherit;border:1px solid #8e849c;border-radius:8px;padding:9px 16px;background:transparent;color:inherit;cursor:pointer}
button[aria-pressed=true]{background:#554086;color:white;border-color:#554086}button:focus-visible{outline:3px solid #d77b22;outline-offset:3px}
main{max-width:1200px;margin:auto;display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:24px 12px}
article{text-align:center;min-width:0}img{width:100%;max-width:200px;aspect-ratio:1;object-fit:contain;image-rendering:pixelated}h2{font-size:13px;margin:5px 0 0}
@media(max-width:850px){main{grid-template-columns:repeat(3,minmax(0,1fr))}}@media(max-width:480px){body{padding:18px}main{grid-template-columns:repeat(2,minmax(0,1fr))}}
</style><header><h1>20 métiers, une équipe.</h1><p>Pixel art de face · Fond transparent · Repos, travail animé et réussite</p>
<nav aria-label="État des personnages"><button data-state="idle" aria-pressed="true">Repos</button><button data-state="working" aria-pressed="false">Travail</button><button data-state="approved" aria-pressed="false">Réussite</button><button id="theme" aria-pressed="false">Fond sombre</button></nav><p id="motion" hidden>La réduction des animations est activée : le travail affiche la pose de repos.</p></header><main></main>
<script>
const assets=${JSON.stringify(assets).replace(/</g, '\\u003c')};
const motion=matchMedia('(prefers-reduced-motion: reduce)');let current='idle';
const main=document.querySelector('main');
for(const asset of assets){const card=document.createElement('article'),image=document.createElement('img'),title=document.createElement('h2');image.alt=asset.name;image.width=256;image.height=256;title.textContent=asset.name;card.append(image,title);main.append(card)}
function render(){const state=current==='working'&&motion.matches?'idle':current;main.querySelectorAll('img').forEach((image,index)=>image.src=assets[index].images[state]);document.querySelectorAll('[data-state]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.state===current)));document.querySelector('#motion').hidden=!(current==='working'&&motion.matches)}
document.querySelectorAll('[data-state]').forEach(button=>button.addEventListener('click',()=>{current=button.dataset.state;render()}));
document.querySelector('#theme').addEventListener('click',event=>{const dark=document.body.classList.toggle('dark');event.currentTarget.setAttribute('aria-pressed',String(dark));event.currentTarget.textContent=dark?'Fond clair':'Fond sombre'});
motion.addEventListener('change',render);render();
</script></html>`;
await mkdir('releases', { recursive: true });
await writeFile('releases/avatar-gallery.html', html);
console.log('releases/avatar-gallery.html');
