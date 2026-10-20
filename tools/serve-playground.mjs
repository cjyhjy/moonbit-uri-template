import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
const base = new URL('../dist/playground/', import.meta.url);
const assets = new Map(['index.html','style.css','main.mjs','worker.mjs','engine.mjs','diagnostics.mjs','compute.mjs','controller.mjs','json-source.mjs'].map(name=>[
  '/'+name,{body:readFileSync(new URL(name,base)),type:name.endsWith('.html')?'text/html; charset=utf-8':name.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8'}
]));
const server = createServer((req,res)=>{
  const path = new URL(req.url,'http://localhost').pathname;
  const asset = assets.get(path==='/'?'/index.html':path);
  if(req.method!=='GET' || !asset){res.writeHead(404);res.end('Not found');return;}
  res.writeHead(200,{'Content-Type':asset.type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
    'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; worker-src 'self'; connect-src 'none'; base-uri 'none'; frame-ancestors 'none'"});
  res.end(asset.body);
});
server.listen(Number(process.env.PORT??4173),'127.0.0.1',()=>console.log(`Playground: http://127.0.0.1:${server.address().port}`));
