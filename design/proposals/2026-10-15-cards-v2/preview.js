const themes=[
{id:'atelier',number:'01',name:'Atelier chaleureux',description:'Lin, terre cuite et bois sombre',light:'Lin & terre cuite',dark:'Noyer & ambre'},
{id:'orbite',number:'02',name:'Station Orbitale',description:'Lumière lunaire et bleu profond',light:'Blanc lunaire & cobalt',dark:'Bleu nuit & cyan'},
{id:'papier',number:'03',name:'Papier vivant',description:'Papier, encre et carnets de travail',light:'Papier crème & cobalt',dark:'Ardoise & pervenche'},
{id:'guilde',number:'04',name:'Guilde pixel',description:'Grille, détails rétro et couleurs franches',light:'Ivoire & menthe',dark:'Indigo & lavande'},
{id:'jardin',number:'05',name:'Jardin des idées',description:'Feuillages, sauge et lumière douce',light:'Porcelaine & feuillage',dark:'Pin & lumière dorée'}
];
const paths={
home:'M3 10 12 3l9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z',
team:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M16 3a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
route:'M5 3v12a4 4 0 0 0 4 4h10 M15 15l4 4-4 4 M5 3h14v6H5',
eye:'M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7 M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
book:'M4 3h14a2 2 0 0 1 2 2v16H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3 M3 17h17 M8 7h8 M8 11h5',
settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2',
arrow:'M5 12h14 M13 6l6 6-6 6',
check:'M5 12l4 4L19 6',
file:'M14 2H5v20h14V7Z M14 2v6h5 M8 12h8 M8 16h6',
code:'m8 6-6 6 6 6 M16 6l6 6-6 6 M14 3l-4 18',
pause:'M8 4v16 M16 4v16',
sun:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l1 1 M18 18l1 1 M5 19l1-1 M18 6l1-1',
moon:'M21 13a9 9 0 0 1-10-10A9 9 0 1 0 21 13Z',
spark:'m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3Z',
clock:'M12 7v5l3 2 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
folder:'M3 5h6l2 2h10v13H3Z',
branch:'M6 3v12a4 4 0 0 0 4 4h5 M6 9h8a4 4 0 0 0 4-4V3',
search:'M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0'
};
const icon=(name,extra='')=>'<svg class="icon '+extra+'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+paths[name]+'"/></svg>';
const agents=[
{name:'Merlin',role:'Architecte',image:'software-architect.png',state:'Plan validé',class:'done',deliverable:'Plan de réalisation',description:'Donne une structure à ton idée.'},
{name:'Pixel',role:'Développeur',image:'backend-developer.png',state:'À relire',class:'selected',deliverable:'2 fichiers modifiés',description:'Transforme le plan en code.'},
{name:'Sherlock',role:'Testeur',image:'qa-tester.png',state:'En attente',class:'waiting',deliverable:'Vérification à venir',description:'Vérifie ce qui doit fonctionner.'},
{name:'Nova',role:'Relectrice',image:'code-reviewer.png',state:'En attente',class:'waiting',deliverable:'Relecture à venir',description:'Apporte un regard indépendant.'}
];
function decor(theme){
 if(theme==='atelier')return '<div class="deco atelier-art"><i class="sun-disc"></i><i class="arch arch-one"></i><i class="arch arch-two"></i><div class="shelf"><i></i><i></i><i></i><i></i><i></i></div><span class="line-art">✳</span></div>';
 if(theme==='orbite')return '<div class="deco orbital-art"><i class="planet"></i><i class="orbit orbit-one"></i><i class="orbit orbit-two"></i><i class="star star-one">✦</i><i class="star star-two">✧</i><span class="orbital-coordinate">SECTEUR 03 / CONSTRUCTION</span></div>';
 if(theme==='papier')return '<div class="deco paper-art"><i class="paper-corner"></i><i class="paper-line"></i><span class="stamp">EN COURS<br>DE CRÉATION</span></div>';
 if(theme==='guilde')return '<div class="deco pixel-art"><i class="pixel-mountain one"></i><i class="pixel-mountain two"></i><div class="pixel-stars">✦<br>　✧　✦</div><span class="pixel-corner">▟</span></div>';
 return '<div class="deco garden-art"><svg viewBox="0 0 500 220" aria-hidden="true"><g fill="currentColor"><path d="M390 220C380 150 398 85 463 13C442 94 423 145 390 220Z"/><path d="M405 159C360 147 347 107 350 66C398 99 408 130 405 159Z"/><path d="M424 121C458 125 483 102 495 61C452 71 433 88 424 121Z"/><path d="M439 79C411 70 404 41 408 7C437 30 448 54 439 79Z"/><path d="M45 220C71 184 72 140 55 108C39 151 35 182 45 220Z"/><path d="M54 184C92 188 118 165 124 127C83 135 62 152 54 184Z"/></g></svg><i class="garden-sun"></i></div>';
}
function card(a){return '<article class="agent-card '+a.class+'"><div class="card-top"><span>'+a.role+'</span>'+icon(a.class==='done'?'check':a.class==='selected'?'eye':'clock')+'</div><div class="portrait"><img src="assets/'+a.image+'" width="128" height="128" alt="Portrait original de '+a.name+'"></div><h3>'+a.name+'</h3><p class="agent-description">'+a.description+'</p><span class="state '+a.class+'"><i></i>'+a.state+'</span><div class="card-foot">'+icon('file')+'<span>'+a.deliverable+'</span></div></article>';}
function screen(theme,mode){
 return '<section class="screen '+theme.id+' '+mode+'" aria-label="'+theme.name+' — mode '+(mode==='light'?'clair':'sombre')+'"><aside class="sidebar"><div class="brand"><img src="assets/logo.png" width="40" height="40" alt=""><span>Feature<br><b>Studio</b></span></div><div class="workspace-label">TON ESPACE</div><div class="project">'+icon('folder')+'<span>Mon mini-jeu<small>Projet découverte</small></span></div><nav class="app-nav" aria-label="Navigation de la maquette">'+[['home','Atelier'],['team','Équipe'],['route','Parcours'],['eye','Coulisses'],['book','Journal']].map(([i,l])=>'<span class="'+(l==='Atelier'?'active':'')+'">'+icon(i)+l+'</span>').join('')+'</nav><div class="sidebar-bottom"><div class="connection"><i></i>Copilot connecté</div><span>'+icon('settings')+'Réglages</span><div class="user"><span class="user-pic">M</span><div>Matt<small>Aux commandes</small></div></div></div></aside><div class="app-main"><header class="app-header"><div class="breadcrumb">Atelier <span>/</span> Session découverte</div><div class="header-controls"><span class="demo-tag">Aperçu</span>'+icon('search')+icon(mode==='light'?'sun':'moon')+'</div></header><div class="page-content"><div class="page-title"><div><div class="eyebrow">DE L’IDÉE AU PREMIER ESSAI</div><h2>Créer un mini-jeu</h2><p>Ton équipe avance. Tu gardes la main.</p></div><div class="session-status"><i></i>À toi de jouer</div></div><div class="content-grid"><div class="work-column"><div class="stage">'+decor(theme.id)+'<div class="stage-head"><div><span class="section-label">L’ÉQUIPE EN ACTION</span><h4>Chacun son rôle. Un projet commun.</h4></div><span class="stage-step">03 <span>/ 05</span></span></div><div class="agent-grid">'+agents.map(card).join('')+'</div><div class="handoff"><span>'+icon('check')+'Plan transmis</span><i></i><span class="current">'+icon('eye')+'Ton regard compte</span><i></i><span>'+icon('arrow')+'Prochain arrêt : les tests</span></div></div><section class="decision"><div class="decision-icon">'+icon('eye')+'</div><div class="decision-copy"><strong>Pixel a préparé ses modifications.</strong><p>Relis les 2 fichiers avant de passer le relais à Sherlock.</p></div><div class="decision-buttons"><button class="primary">'+icon('file')+'Relire</button><button class="quiet" aria-label="Mettre la session en pause">'+icon('pause')+'</button></div></section><div class="progress">'+['Brief','Plan','Code','Tests','Validation'].map((s,i)=>'<div class="'+(i<2?'complete':i===2?'current':'')+'"><span>'+(i<2?icon('check'):i+1)+'</span><b>'+s+'</b></div>').join('')+'</div></div><aside class="inspector"><div class="inspector-title"><span class="inspector-symbol">'+icon('eye')+'</span><div><h3>Dans les coulisses</h3><p>Comprendre le travail de Pixel</p></div></div><div class="inspector-agent"><img src="assets/backend-developer.png" width="32" height="32" alt=""><span>Pixel <small>Développeur</small></span><span class="small-state">À relire</span></div><section class="inspect-step"><div class="step-heading"><span>01</span><h4>Ce qu’il reçoit</h4></div><div class="chips"><span>'+icon('file')+'Plan validé</span><span>'+icon('folder')+'Fichiers utiles</span></div></section><section class="inspect-step"><div class="step-heading"><span>02</span><h4>Les outils utilisés</h4></div><div class="tool-line"><span>'+icon('book')+'Lire les fichiers</span><b>3</b></div><div class="tool-line"><span>'+icon('code')+'Modifier le code</span><b>2</b></div></section><section class="inspect-step"><div class="step-heading"><span>03</span><h4>Ce qu’il produit</h4></div><div class="output-file">'+icon('file')+'<span>game.ts</span><b>Modifié</b></div><div class="output-file">'+icon('file')+'<span>controls.ts</span><b>Modifié</b></div></section><section class="inspect-step last"><div class="step-heading"><span>04</span><h4>À qui il transmet</h4></div><div class="next-agent"><img src="assets/qa-tester.png" width="40" height="40" alt=""><div>Sherlock · Testeur<small>Après ta validation</small></div>'+icon('arrow')+'</div></section><div class="inspector-note">'+icon('spark')+'<span>Tu vois les actions et les résultats, étape par étape.</span></div></aside></div></div><div class="app-footer">'+icon('branch')+'<span>feature/mini-jeu</span><span class="footer-right">Tes agents proposent. Tu décides.</span></div></div></section>';
}
const board=document.querySelector('#board');
const params=new URLSearchParams(location.search);
let selected=themes.find(t=>t.id===params.get('theme'))||themes[0];
let view='both';
document.querySelector('.theme-picker').innerHTML=themes.map(t=>'<button data-theme="'+t.id+'" aria-pressed="false"><span class="theme-dot '+t.id+'"></span><span><b>'+t.number+' · '+t.name+'</b><small>'+t.description+'</small></span></button>').join('');
function render(){
 board.innerHTML=['light','dark'].map(mode=>'<div class="variant '+mode+'-variant"><div class="board-caption '+mode+'"><span>'+selected.number+' — '+selected.name+'</span><span>'+icon(mode==='light'?'sun':'moon')+' MODE '+(mode==='light'?'CLAIR':'SOMBRE')+' <i>· '+selected[mode]+'</i></span></div>'+screen(selected,mode)+'</div>').join('');
 document.querySelectorAll('[data-theme]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.theme===selected.id)));
 document.querySelector('#download').href=selected.number+'-'+selected.id+'-clair-sombre.png';
 board.dataset.view=view;
}
document.querySelector('.theme-picker').addEventListener('click',e=>{const b=e.target.closest('[data-theme]');if(!b)return;selected=themes.find(t=>t.id===b.dataset.theme);render();});
document.querySelector('.mode-buttons').addEventListener('click',e=>{const b=e.target.closest('[data-view]');if(!b)return;view=b.dataset.view;board.dataset.view=view;document.querySelectorAll('[data-view]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));});
if(params.has('capture')) document.body.classList.add('capture');
render();
function fitPreview(){
 if(!params.has('capture')) board.style.zoom=String(Math.min(1,(innerWidth-32)/1440));
}
addEventListener('resize',fitPreview);
fitPreview();
