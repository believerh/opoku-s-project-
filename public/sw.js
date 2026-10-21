const CACHE='oa-shell-v3';
const SHELL=['/','/index.html','/app.js','/manifest.webmanifest','/icon-192.png','/icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(n=>n!==CACHE).map(n=>caches.delete(n)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
  const r=e.request,u=new URL(r.url);
  if(r.method!=='GET'||u.origin!==location.origin)return;
  // never cache admin/API data (except the public post list) or large media
  if(u.pathname.startsWith('/media/')||(u.pathname.startsWith('/api/')&&u.pathname!=='/api/posts'))return;
  e.respondWith(fetch(r).then(res=>{if(res.status===200){const c=res.clone();caches.open(CACHE).then(x=>x.put(r,c))}return res})
    .catch(()=>caches.match(r).then(m=>m||(r.mode==='navigate'?caches.match('/index.html'):Response.error()))));
});
