(()=>{
const $=id=>document.getElementById(id);
const CK='oa_posts_v1',IMG_OK=['image/jpeg','image/png','image/webp','image/gif','image/avif'],VID_OK=['video/mp4','video/webm','video/quicktime'];
let posts=[],filter='All',admin=false,emailOn=false,subs=0,editing=null,kept=[],keptVideo=null,removed=[],removeVid=false,aStatus='all',aSearch='',tm;
async function api(path,o={}){const init={credentials:'same-origin',...o};if(o.json!==undefined){init.method=o.method||'POST';init.headers={'content-type':'application/json'};init.body=JSON.stringify(o.json);delete init.json}
const r=await fetch('/api'+path,init);let d=null;try{d=await r.json()}catch(e){}if(!r.ok){const er=new Error(d&&d.error||'Request failed');er.status=r.status;throw er}return d}
const byDate=(a,b)=>new Date(b.created_at)-new Date(a.created_at);
function msg(s){const el=$('status');el.textContent=s;el.classList.remove('hidden');clearTimeout(tm);tm=setTimeout(()=>el.classList.add('hidden'),4500)}
const esc=(s='')=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=v=>new Date(v).toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'});
const pub=()=>posts.filter(p=>p.published);
function mediaHtml(p){let a=(p.media_urls||[]).map(u=>`<img loading="lazy" src="${esc(u)}" alt="Post image">`).join('');if(p.video_url)a+=`<video controls preload="metadata" src="${esc(p.video_url)}"></video>`;return a?`<div class="media">${a}</div>`:''}
function render(){const all=pub().sort(byDate),list=all.filter(p=>filter==='All'||p.category===filter);
$('stories').innerHTML=list.map((p,i)=>`<article class="story"><div class="stripe ${p.priority==='Urgent'||i%3===1?'yellow':''}"></div><div class="storybody"><span class="tag ${p.priority!=='Normal'?'urgent':''}">${esc(p.priority==='Normal'?p.category:p.priority+' • '+p.category)}</span><h3>${esc(p.title)}</h3><p>${esc(p.body)}</p>${mediaHtml(p)}<div class="meta"><span>${esc(p.author||'Okomfo Anokye Updates')}</span><span>${date(p.created_at)}</span></div></div></article>`).join('');
$('empty').classList.toggle('hidden',list.length>0);$('stories').classList.toggle('hidden',!list.length);
$('tickerText').textContent=all[0]?all[0].title:'Your daily source for school announcements and trending stories.'}
function renderAdmin(){if(!admin)return;const pc=pub().length,q=aSearch.toLowerCase();
$('stats').innerHTML=`<div class="stat"><b>${posts.length}</b><span>Total posts</span></div><div class="stat"><b>${pc}</b><span>Published</span></div><div class="stat"><b>${posts.length-pc}</b><span>Drafts</span></div>`+(emailOn?`<div class="stat"><b>${subs}</b><span>Email subscribers</span></div>`:'');
const l=posts.filter(p=>(aStatus==='all'||(aStatus==='pub')===p.published)&&(!q||(p.title+' '+p.body).toLowerCase().includes(q))).sort(byDate);
$('adminList').innerHTML=l.map(p=>`<div class="item"><div class="info"><b>${esc(p.title)}</b><small><span class="badge ${p.published?'pub':'dr'}">${p.published?'Published':'Draft'}</span>${esc(p.category)} · ${date(p.created_at)}${p.notified?' · emailed':''}</small></div><button class="secondary" data-edit="${p.id}">Edit</button><button class="secondary" data-toggle="${p.id}">${p.published?'Unpublish':'Publish'}</button><button class="danger" data-delete="${p.id}">Delete</button></div>`).join('')||'<p class="note">No matching posts.</p>'}
async function loadPosts(){try{posts=await api('/posts');try{localStorage.setItem(CK,JSON.stringify(posts))}catch(e){}}catch(e){try{posts=JSON.parse(localStorage.getItem(CK)||'[]')}catch(x){posts=[]}msg('Could not load the latest posts. Showing saved posts if available.')}render();if(admin)await loadAdminPosts()}
async function loadAdminPosts(){try{const d=await api('/admin/posts');posts=d.posts;subs=d.subscribers;emailOn=d.email;render();renderAdmin();setMode()}catch(e){if(e.status===401){admin=false;route()}msg(e.message)}}
async function checkAdmin(){try{await api('/me');admin=true}catch(e){admin=false}}
/* hidden admin route: yoursite.com/#admin, or tap the OA badge 5 times */
function route(){const a=location.hash==='#admin';['tickerWrap','heroSec','feed','subSec'].forEach(id=>$(id).classList.toggle('hidden',a||(id==='subSec'&&!emailOn)));$('adminView').classList.toggle('hidden',!a);$('loginPanel').classList.toggle('hidden',!(a&&!admin));$('adminPanel').classList.toggle('hidden',!(a&&admin));if(a)window.scrollTo(0,0);else render()}
async function enterAdmin(){if(location.hash==='#admin'&&!admin)await checkAdmin();route();if(admin&&location.hash==='#admin')await loadAdminPosts()}
let taps=0,tapT;$('crest').onclick=()=>{taps++;clearTimeout(tapT);tapT=setTimeout(()=>taps=0,3000);if(taps>=5){taps=0;location.hash='#admin'}};
window.addEventListener('hashchange',enterAdmin);
const leaveAdmin=()=>{location.hash='';history.replaceState(null,'',location.pathname);route()};
$('backBtn').onclick=leaveAdmin;
$('exploreBtn').onclick=()=>$('feed').scrollIntoView({behavior:'smooth'});
$('filters').addEventListener('click',e=>{const b=e.target.closest('[data-filter]');if(!b)return;filter=b.dataset.filter;document.querySelectorAll('[data-filter]').forEach(x=>x.classList.toggle('active',x===b));$('feedTitle').textContent=filter==='All'?'Latest updates':filter;render()});
$('showPw').onchange=e=>$('password').type=e.target.checked?'text':'password';
$('loginForm').onsubmit=async e=>{e.preventDefault();try{await api('/login',{json:{email:$('email').value.trim(),password:$('password').value}});admin=true;$('password').value='';route();await loadAdminPosts();msg('Signed in.')}catch(err){msg(err.message)}};
$('logoutBtn').onclick=async()=>{try{await api('/logout',{method:'POST'})}catch(e){}admin=false;resetForm();leaveAdmin();loadPosts()};
function setMode(){const ed=!!editing;$('formTitle').textContent=ed?'Edit post':'New post';$('publishBtn').textContent=ed?'Save changes':'Publish now';$('draftBtn').classList.toggle('hidden',ed);$('cancelEditBtn').classList.toggle('hidden',!ed);$('notifyWrap').classList.toggle('hidden',ed||!emailOn)}
function renderExisting(){$('existing').innerHTML=kept.map((u,i)=>`<div class="thumb"><img src="${esc(u)}" alt=""><button type="button" data-rmimg="${i}" aria-label="Remove picture">✕</button></div>`).join('')+(keptVideo?`<div class="thumb"><video src="${esc(keptVideo)}" muted></video><button type="button" data-rmvid="1" aria-label="Remove video">✕</button></div>`:'');$('existingWrap').classList.toggle('hidden',!kept.length&&!keptVideo)}
function resetForm(){editing=null;kept=[];keptVideo=null;removed=[];removeVid=false;$('postForm').reset();renderExisting();setMode()}
$('clearBtn').onclick=resetForm;$('cancelEditBtn').onclick=resetForm;
$('existing').addEventListener('click',e=>{const i=e.target.closest('[data-rmimg]'),v=e.target.closest('[data-rmvid]');if(i)removed.push(kept.splice(+i.dataset.rmimg,1)[0]);else if(v){keptVideo=null;removeVid=true}else return;renderExisting()});
$('postForm').onsubmit=async e=>{e.preventDefault();if(!admin)return msg('Please sign in as admin first.');
const action=e.submitter&&e.submitter.dataset.action||'publish',images=[...$('images').files],video=$('video').files[0];
if(kept.length+images.length>8)return msg('A post can have at most 8 pictures.');
if(images.some(f=>!IMG_OK.includes(f.type)||f.size>5*1024*1024))return msg('Pictures must be JPG, PNG, WebP, GIF or AVIF, up to 5 MB each.');
if(video&&(!VID_OK.includes(video.type)||video.size>50*1024*1024))return msg('Video must be MP4, WebM or MOV, up to 50 MB.');
const fd=new FormData();['title','category','priority','author','body'].forEach(k=>fd.append(k,$(k).value));images.forEach(f=>fd.append('images',f));if(video)fd.append('video',video);
fd.append('action',action);fd.append('notify',$('notify').checked?'1':'0');if(editing){fd.append('removeMedia',JSON.stringify(removed));if(removeVid)fd.append('removeVideo','1')}
const btns=[$('publishBtn'),$('draftBtn')];btns.forEach(b=>b.disabled=true);$('publishBtn').textContent='Saving…';
try{const d=await api(editing?'/admin/posts/'+editing.id:'/admin/posts',{method:editing?'PUT':'POST',body:fd});
msg(editing?'Changes saved.':d.post.published?(d.queued?`Published. Emailing ${d.queued} subscriber${d.queued>1?'s':''}.`:'Published for all visitors.'):'Saved as a draft.');resetForm();await loadAdminPosts()}
catch(err){if(err.status===401){admin=false;route()}msg('Could not save: '+err.message)}
finally{btns.forEach(b=>b.disabled=false);setMode()}};
$('aSearch').oninput=e=>{aSearch=e.target.value;renderAdmin()};$('aStatus').onchange=e=>{aStatus=e.target.value;renderAdmin()};
$('adminList').addEventListener('click',async e=>{if(!admin)return;const ed=e.target.closest('[data-edit]'),tg=e.target.closest('[data-toggle]'),dl=e.target.closest('[data-delete]');
try{
if(ed){const p=posts.find(x=>x.id===ed.dataset.edit);if(!p)return;editing=p;kept=[...(p.media_urls||[])];keptVideo=p.video_url||null;removed=[];removeVid=false;$('title').value=p.title;$('category').value=p.category;$('priority').value=p.priority;$('author').value=p.author||'';$('body').value=p.body;$('images').value='';$('video').value='';renderExisting();setMode();$('formTitle').scrollIntoView({behavior:'smooth'});return}
if(tg){const p=posts.find(x=>x.id===tg.dataset.toggle);if(!p)return;const notify=!p.published&&emailOn&&!p.notified&&subs>0&&confirm('Also email your subscribers about this post?');const d=await api('/admin/posts/'+p.id+'/published',{method:'PATCH',json:{published:!p.published,notify}});msg(!p.published?(d.queued?`Published. Emailing ${d.queued} subscriber${d.queued>1?'s':''}.`:'Post is now published.'):'Post hidden from the website.');await loadAdminPosts();return}
if(dl){const p=posts.find(x=>x.id===dl.dataset.delete);if(!p||!confirm(`Delete "${p.title}" and its pictures/video? This cannot be undone.`))return;await api('/admin/posts/'+p.id,{method:'DELETE'});if(editing&&editing.id===p.id)resetForm();msg('Post deleted.');await loadAdminPosts()}
}catch(err){if(err.status===401){admin=false;route()}msg(err.message)}});
$('subForm').onsubmit=async e=>{e.preventDefault();if($('hp').value)return;const b=$('subBtn');b.disabled=true;try{const d=await api('/subscribe',{json:{email:$('subEmail').value.trim()}});$('subForm').reset();$('subNote').textContent=d.message}catch(err){$('subNote').textContent=err.message}finally{b.disabled=false}};
async function start(){api('/status').then(d=>{emailOn=d.email;route()}).catch(()=>{});await enterAdmin();await loadPosts()}
if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});
start();
})();
