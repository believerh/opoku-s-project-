const CACHE='oa-shell-v4';
const SHELL=['/','/index.html','/app.js','/manifest.webmanifest','/icon-192.png','/icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(n=>n!==CACHE).map(n=>caches.delete(n)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
  const r=e.request,u=new URL(r.url);
  if(r.method!=='GET'||u.origin!==location.origin)return;
  // never cache staff/API data (except the public post list) or large media
  if(u.pathname.startsWith('/media/')||(u.pathname.startsWith('/api/')&&u.pathname!=='/api/posts'))return;
  e.respondWith(fetch(r).then(res=>{if(res.status===200){const c=res.clone();caches.open(CACHE).then(x=>x.put(r,c))}return res})
    .catch(()=>caches.match(r).then(m=>m||(r.mode==='navigate'?caches.match('/index.html'):Response.error()))));
});
// Push notifications
self.addEventListener('push',e=>{
  let d={};try{d=e.data.json()}catch(x){d={title:'Okomfo Anokye Updates',body:e.data?e.data.text():''}}
  e.waitUntil(self.registration.showNotification(d.title||'Okomfo Anokye Updates',{body:d.body||'',icon:'/icon-192.png',badge:'/icon-192.png',tag:d.tag,data:{url:d.url||'/'}}));
});
self.addEventListener('notificationclick',e=>{
  e.notification.close();
  const url=new URL((e.notification.data&&e.notification.data.url)||'/',self.location.origin).href;
  e.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(l=>{for(const c of l)if(c.url===url&&'focus'in c)return c.focus();return clients.openWindow(url)}));
});
