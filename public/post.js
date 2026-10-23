(()=>{
const m=document.querySelector('main[data-id]');if(!m)return;
const id=m.dataset.id,url=m.dataset.url,title=m.dataset.title;
// count one view per browser per day (same rule as the home page)
try{const k='oa_v_'+id,n=Date.now();if(n-(+localStorage.getItem(k)||0)>=864e5){localStorage.setItem(k,n);fetch('/api/posts/'+id+'/view',{method:'POST',keepalive:true}).catch(()=>{})}}catch(e){}
const b=document.getElementById('shareBtn');
b.onclick=async()=>{try{if(navigator.share)await navigator.share({title,url});else{await navigator.clipboard.writeText(url);b.textContent='Link copied ✓'}}catch(e){}};
if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});
})();
