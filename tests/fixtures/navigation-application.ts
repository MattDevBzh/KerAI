import { createServer, type Server } from 'node:http';
export async function navigationFixture(): Promise<{
  origin: string;
  otherOrigin: string;
  close(): Promise<void>;
}> {
  const listen = (server: Server) =>
    new Promise<number>((resolve) =>
      server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port)),
    );
  const other = createServer((_request, response) =>
    response.end(
      '<html><body><input id="external-secret" value="EXTERNAL_PRIVATE_VALUE"><h1>External frame</h1></body></html>',
    ),
  );
  const otherPort = await listen(other);
  const otherOrigin = `http://127.0.0.1:${otherPort}`;
  const server = createServer((request, response) => {
    if (request.url?.startsWith('/api')) {
      response.setHeader('Content-Type', 'application/json');
      response.end('{"ok":true,"private":"NEVER_READ_RESPONSE_BODY"}');
      return;
    }
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(`<!doctype html><html><head><title>Fixture navigation</title><style>#result{color:rgb(20,60,90)}body{font:16px sans-serif}</style></head><body>
      <h1>Parcours local</h1><label for="city">Commune</label><input id="city" data-testid="city"><label for="password">Mot de passe</label><input type="password" id="password" value="TOP_SECRET_PASSWORD"><input autocomplete="username" id="username" value="PRIVATE_LOGIN"><input name="access_token" id="token" value="SECRET_TOKEN">
      <label for="choice">Choix</label><select id="choice"><option value="a">A</option><option value="b">B</option></select><input type="checkbox" id="check">
      <button id="go" data-testid="go">Afficher</button><button id="external">Frame externe</button><button id="local-frame">Frame locale</button><button id="popup">Nouvel onglet</button><button id="delayed">Attendre</button><div id="result" role="status">En attente</div><div data-private>PRIVATE_TEXT</div><div id="scroll-box" style="height:40px;width:100px;overflow:auto"><div style="height:500px;width:800px">Contenu défilant</div></div><span id="scroll-state">0,0</span><span id="window-scroll-state">0,0</span><div style="height:1800px"></div>
      <script>document.querySelector('#scroll-box').onscroll=event=>document.querySelector('#scroll-state').textContent=event.target.scrollLeft+','+event.target.scrollTop;window.onscroll=()=>document.querySelector('#window-scroll-state').textContent=scrollX+','+scrollY;document.querySelector('#go').onclick=()=>{document.querySelector('#result').textContent='Résultat '+document.querySelector('#city').value;fetch('/api?token=PRIVATE_QUERY')};
      document.querySelector('#external').onclick=()=>{const f=document.createElement('iframe');f.name='outside';f.src='${otherOrigin}';document.body.append(f)};
      document.querySelector('#local-frame').onclick=()=>{const f=document.createElement('iframe');f.name='inside';f.src='/inside';document.body.append(f)};
      document.querySelector('#delayed').onclick=()=>setTimeout(()=>{const element=document.createElement('div');element.id='delayed-result';element.textContent='Prêt';document.body.append(element)},200);
      document.querySelector('#popup').onclick=()=>window.open('/popup','fixture');</script></body></html>`);
  });
  const port = await listen(server);
  return {
    origin: `http://127.0.0.1:${port}`,
    otherOrigin,
    async close() {
      await Promise.all(
        [server, other].map(
          (server) =>
            new Promise<void>((resolve, reject) => {
              server.close((error) => (error ? reject(error) : resolve()));
              server.closeAllConnections();
            }),
        ),
      );
    },
  };
}
