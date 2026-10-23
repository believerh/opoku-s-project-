(()=>{
const $=id=>document.getElementById(id);
const CK='oa_posts_v2',IMG_OK=['image/jpeg','image/png','image/webp','image/gif','image/avif'],VID_OK=['video/mp4','video/webm','video/quicktime'];
let pubPosts=[],staff=[],users=[],filter='All',user=null,emailOn=false,pushOn=false,subs=0,pushSubs=0,editing=null,kept=[],keptVideo=null,removed=[],removeVid=false,aStatus='all',aSearch='',tab='posts',tm;
const isAd=()=>!!user&&user.role==='admin';
async function api(path,o={}){const init={credentials:'same-origin',...o};if(o.json!==undefined){init.method=o.method||'POST';init.headers={'content-type':'application/json'};init.body=JSON.stringify(o.json);delete init.json}
const r=await fetch('/api'+path,init);let d=null;try{d=await r.json()}catch(e){}if(!r.ok){const er=new Error(d&&d.error||'Request failed');er.status=r.status;throw er}return d}
const byDate=(a,b)=>new Date(b.created_at)-new Date(a.created_at);
function msg(s){const el=$('status');el.textContent=s;el.classList.remove('hidden');clearTimeout(tm);tm=setTimeout(()=>el.classList.add('hidden'),5000)}
const esc=(s='')=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=v=>new Date(v).toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'});
const localDT=iso=>{const d=new Date(iso);d.setMinutes(d.getMinutes()-d.getTimezoneOffset());return d.toISOString().slice(0,16)};
const plural=(n,w)=>`${n} ${w}${n>1?'s':''}`;

/* ---------- public feed ---------- */
function mediaHtml(p){let a=(p.media_urls||[]).map(u=>`<img loading="lazy" src="${esc(u)}" alt="Post image">`).join('');if(p.video_url)a+=`<video controls preload="metadata" src="${esc(p.video_url)}"></video>`;return a?`<div class="media">${a}</div>`:''}
function countView(id){const k='oa_v_'+id,n=Date.now();try{if(n-(+localStorage.getItem(k)||0)<864e5)return;localStorage.setItem(k,n)}catch(e){}fetch('/api/posts/'+id+'/view',{method:'POST',keepalive:true}).catch(()=>{})}
const io='IntersectionObserver'in window?new IntersectionObserver(es=>es.forEach(e=>{const el=e.target;if(e.isIntersecting)el._t=setTimeout(()=>{io.unobserve(el);countView(el.dataset.id)},2000);else clearTimeout(el._t)}),{threshold:.15}):null;
function render(){const all=[...pubPosts].sort((a,b)=>(b.pinned-a.pinned)||byDate(a,b)),list=all.filter(p=>filter==='All'||p.category===filter);
$('stories').innerHTML=list.map(p=>`<article class="story" data-id="${p.id}"><div class="stripe ${p.priority==='Urgent'||p.pinned?'yellow':''}"></div><div class="storybody"><div class="tags">${p.pinned?'<span class="pin">📌 Pinned</span>':''}<span class="tag ${p.priority!=='Normal'?'urgent':''}">${esc(p.priority==='Normal'?p.category:p.priority+' • '+p.category)}</span></div><h3><a class="tl" href="/post/${p.id}">${esc(p.title)}</a></h3><p>${esc(p.body)}</p>${mediaHtml(p)}<div class="cardacts"><a class="more" href="/post/${p.id}">Open</a><button class="sharebtn" data-share="${p.id}" type="button">Share</button></div><div class="meta"><span>${esc(p.author||'Okomfo Anokye Updates')}</span><span>${date(p.created_at)}</span></div></div></article>`).join('');
$('empty').classList.toggle('hidden',list.length>0);$('stories').classList.toggle('hidden',!list.length);
$('tickerText').textContent=all[0]?all[0].title:'Your daily source for school announcements and trending stories.';
if(io)$('stories').querySelectorAll('.story').forEach(el=>io.observe(el))}
$('stories').addEventListener('click',async e=>{const b=e.target.closest('[data-share]');if(!b)return;const p=pubPosts.find(x=>x.id===b.dataset.share);if(!p)return;const url=location.origin+'/post/'+p.id;
try{if(navigator.share)await navigator.share({title:p.title,url});else{await navigator.clipboard.writeText(url);msg('Link copied.')}}catch(err){if(!err||err.name!=='AbortError')msg(url)}});
async function loadPosts(){try{pubPosts=await api('/posts');try{localStorage.setItem(CK,JSON.stringify(pubPosts))}catch(e){}}catch(e){try{pubPosts=JSON.parse(localStorage.getItem(CK)||'[]')}catch(x){pubPosts=[]}msg('Could not load the latest posts. Showing saved posts if available.')}render()}
$('filters').addEventListener('click',e=>{const b=e.target.closest('[data-filter]');if(!b)return;filter=b.dataset.filter;document.querySelectorAll('[data-filter]').forEach(x=>x.classList.toggle('active',x===b));$('feedTitle').textContent=filter==='All'?'Latest updates':filter;render()});
$('exploreBtn').onclick=()=>$('feed').scrollIntoView({behavior:'smooth'});

/* ---------- notifications (push + email) ---------- */
const b64=s=>{const r=atob((s+'='.repeat((4-s.length%4)%4)).replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from([...r].map(c=>c.charCodeAt(0)))};
const pushSupported=()=>'serviceWorker'in navigator&&'PushManager'in window&&'Notification'in window;
async function pushState(){if(!pushOn)return;if(!pushSupported()){$('pushBtn').classList.add('hidden');$('pushNote').textContent=/iphone|ipad/i.test(navigator.userAgent)?'On iPhone/iPad: tap Share, choose "Add to Home Screen", then open the app from your Home Screen to turn on notifications.':'This browser does not support notifications.';return}
try{const sub=await(await navigator.serviceWorker.ready).pushManager.getSubscription();$('pushBtn').textContent=sub?'🔕 Turn off notifications':'🔔 Get notifications on this device'}catch(e){}}
$('pushBtn').onclick=async()=>{let sub=null;try{const reg=await navigator.serviceWorker.ready;sub=await reg.pushManager.getSubscription();
if(sub){await api('/push/unsubscribe',{json:{endpoint:sub.endpoint}});await sub.unsubscribe();$('pushNote').textContent='Notifications are off for this device.'}
else{if(await Notification.requestPermission()!=='granted'){$('pushNote').textContent='Notifications are blocked. Allow them in your browser settings, then try again.';return}
const {key}=await api('/push/key');sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:b64(key)});
try{await api('/push/subscribe',{json:{subscription:sub.toJSON()}})}catch(e){await sub.unsubscribe();throw e}
$('pushNote').textContent='Done! You will get a notification when important updates are published.'}
pushState()}catch(e){$('pushNote').textContent='Could not change notifications: '+e.message}};
$('subForm').onsubmit=async e=>{e.preventDefault();if($('hp').value)return;const b=$('subBtn');b.disabled=true;try{const d=await api('/subscribe',{json:{email:$('subEmail').value.trim()}});$('subForm').reset();$('subNote').textContent=d.message}catch(err){$('subNote').textContent=err.message}finally{b.disabled=false}};

/* ---------- hidden staff area: yoursite.com/#admin, or tap the OA badge 5 times ---------- */
function applyRole(){document.querySelectorAll('.adm').forEach(el=>el.classList.toggle('roleHide',!isAd()));document.querySelectorAll('.tch').forEach(el=>el.classList.toggle('roleHide',isAd()));
$('whoami').textContent=user?`${user.name} · ${isAd()?'Administrator':'Teacher'}`:'';$('dashTitle').textContent=isAd()?'Admin dashboard':'Teacher dashboard'}
function route(){const a=location.hash==='#admin';['tickerWrap','heroSec','feed'].forEach(id=>$(id).classList.toggle('hidden',a));
$('subSec').classList.toggle('hidden',a||!(emailOn||pushOn));$('pushBox').classList.toggle('hidden',!pushOn);$('emailBox').classList.toggle('hidden',!emailOn);
$('adminView').classList.toggle('hidden',!a);$('loginPanel').classList.toggle('hidden',!(a&&!user));$('adminPanel').classList.toggle('hidden',!(a&&user));
if(user)applyRole();if(a)window.scrollTo(0,0)}
async function enterAdmin(){if(location.hash==='#admin'&&!user){try{user=(await api('/me')).user}catch(e){user=null}}route();if(user&&location.hash==='#admin')await loadStaff()}
let taps=0,tapT;$('crest').onclick=()=>{taps++;clearTimeout(tapT);tapT=setTimeout(()=>taps=0,3000);if(taps>=5){taps=0;location.hash='#admin'}};
window.addEventListener('hashchange',enterAdmin);
const leaveAdmin=()=>{location.hash='';history.replaceState(null,'',location.pathname);route();loadPosts()};
$('backBtn').onclick=leaveAdmin;
$('showPw').onchange=e=>$('password').type=e.target.checked?'text':'password';
$('loginForm').onsubmit=async e=>{e.preventDefault();try{user=(await api('/login',{json:{email:$('email').value.trim(),password:$('password').value}})).user;$('password').value='';route();setTab('posts');await loadStaff();msg('Signed in.')}catch(err){msg(err.message)}};
$('logoutBtn').onclick=async()=>{try{await api('/logout',{method:'POST'})}catch(e){}user=null;staff=[];resetForm();leaveAdmin()};
const gone=err=>{if(err.status===401){user=null;route()}msg(err.message)};

/* ---------- staff dashboard ---------- */
function setTab(t){tab=t;document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===t));['posts','review','team','activity','account'].forEach(x=>$('pane-'+x).classList.toggle('hidden',x!==t));
if(t==='review')renderReview();if(t==='team')loadTeam();if(t==='activity')loadActivity()}
$('tabs').addEventListener('click',e=>{const b=e.target.closest('[data-tab]');if(b)setTab(b.dataset.tab)});
async function loadStaff(){try{const d=await api('/staff/posts');staff=d.posts;user=d.me;emailOn=d.email;pushOn=d.push;subs=d.subscribers;pushSubs=d.pushSubscribers;$('pendBadge').textContent=d.pending||'';route();renderAdmin();if(tab==='review')renderReview();setMode()}catch(e){gone(e)}}
const BADGE={published:['pub','Published'],draft:['dr','Draft'],pending:['pend','Waiting for approval'],scheduled:['sch','Scheduled'],rejected:['rej','Rejected']};
function actions(p){const ad=isAd(),mine=p.createdById===user.id,b=[],B=(a,t,c='secondary')=>`<button class="${c}" data-act="${a}" data-id="${p.id}">${t}</button>`;
if(ad||(mine&&['draft','pending','rejected'].includes(p.status)))b.push(B('edit','Edit'));
if(ad){if(p.status==='pending')b.push(B('approve','Approve'),B('reject','Reject'));else if(p.status==='published')b.push(B('unpublish','Unpublish'));else if(p.status==='scheduled')b.push(B('publish','Publish now'),B('unpublish','Unschedule'));else b.push(B('publish','Publish'));b.push(B('delete','Delete','danger'))}
else if(mine){if(['draft','rejected'].includes(p.status))b.push(B('submit','Submit for approval'),B('delete','Delete','danger'));else if(p.status==='pending')b.push(B('withdraw','Withdraw'))}
if(p.status==='published')b.push(`<a class="secondary linkb" href="/post/${p.id}" target="_blank" rel="noopener">View</a>`);return `<div class="acts">${b.join('')}</div>`}
function item(p,full){const bd=BADGE[p.status]||['dr',p.status];
return `<div class="item"><div class="info"><b>${esc(p.title)}</b><small><span class="badge ${bd[0]}">${bd[1]}</span>${esc(p.category)} · ${date(p.created_at)}${p.status==='published'?` · 👁 ${p.views||0}`:''}${p.status==='scheduled'&&p.publishAt?` · goes live ${esc(new Date(p.publishAt).toLocaleString())}`:''}${p.pinned?' · 📌 pinned':''}${isAd()&&p.createdBy?` · by ${esc(p.createdBy)}`:''}${p.notified?' · notified':''}</small></div>${actions(p)}${p.status==='rejected'&&p.reviewNote?`<div class="note rejnote">Reason: ${esc(p.reviewNote)}</div>`:''}${full?`<div class="preview">${esc(p.body.length>300?p.body.slice(0,300)+'…':p.body)}${(p.media_urls||[]).length?`\n📷 ${plural(p.media_urls.length,'picture')}`:''}${p.video_url?'\n🎬 1 video':''}</div>`:''}</div>`}
function renderAdmin(){if(!user)return;const c=s=>staff.filter(p=>p.status===s).length,q=aSearch.toLowerCase();
const cells=[['Posts',staff.length],['Published',c('published')],['Drafts',c('draft')],['Waiting',c('pending')],['Views',staff.reduce((a,p)=>a+(p.views||0),0)]];if(isAd()){if(emailOn)cells.push(['Email subscribers',subs]);if(pushOn)cells.push(['Notification devices',pushSubs])}
$('stats').innerHTML=cells.map(x=>`<div class="stat"><b>${x[1]}</b><span>${x[0]}</span></div>`).join('');
const l=staff.filter(p=>(aStatus==='all'||p.status===aStatus)&&(!q||(p.title+' '+p.body).toLowerCase().includes(q)));
$('adminList').innerHTML=l.map(p=>item(p)).join('')||'<p class="note">No matching posts.</p>'}
function renderReview(){const l=staff.filter(p=>p.status==='pending');$('reviewList').innerHTML=l.map(p=>item(p,true)).join('')||'<p class="note">Nothing is waiting for approval.</p>'}
$('aSearch').oninput=e=>{aSearch=e.target.value;renderAdmin()};$('aStatus').onchange=e=>{aStatus=e.target.value;renderAdmin()};

function setMode(){const ed=!!editing,ad=isAd();$('formTitle').textContent=ed?'Edit post':'New post';
$('publishBtn').classList.toggle('hidden',ed);$('publishBtn').textContent=$('schedAt').value?'Schedule post':'Publish now';
$('draftBtn').textContent=ed?'Save changes':'Save as draft';
$('submitBtn').classList.toggle('hidden',ed&&!['draft','rejected'].includes(editing.status));
$('cancelEditBtn').classList.toggle('hidden',!ed);
$('notifyWrap').classList.toggle('hidden',ed||!(emailOn||pushOn));
$('schedWrap').classList.toggle('hidden',ed&&editing.status!=='scheduled')}
$('schedAt').oninput=setMode;
function renderExisting(){$('existing').innerHTML=kept.map((u,i)=>`<div class="thumb"><img src="${esc(u)}" alt=""><button type="button" data-rmimg="${i}" aria-label="Remove picture">✕</button></div>`).join('')+(keptVideo?`<div class="thumb"><video src="${esc(keptVideo)}" muted></video><button type="button" data-rmvid="1" aria-label="Remove video">✕</button></div>`:'');$('existingWrap').classList.toggle('hidden',!kept.length&&!keptVideo)}
function resetForm(){editing=null;kept=[];keptVideo=null;removed=[];removeVid=false;$('postForm').reset();renderExisting();setMode()}
$('clearBtn').onclick=resetForm;$('cancelEditBtn').onclick=resetForm;
$('existing').addEventListener('click',e=>{const i=e.target.closest('[data-rmimg]'),v=e.target.closest('[data-rmvid]');if(i)removed.push(kept.splice(+i.dataset.rmimg,1)[0]);else if(v){keptVideo=null;removeVid=true}else return;renderExisting()});
function startEdit(p){editing=p;kept=[...(p.media_urls||[])];keptVideo=p.video_url||null;removed=[];removeVid=false;['title','category','priority','body'].forEach(k=>$(k).value=p[k]);$('author').value=p.author||'';$('images').value='';$('video').value='';
$('pin').checked=!!p.pinSet;$('pinUntil').value=p.pinUntil?localDT(p.pinUntil).slice(0,10):'';$('schedAt').value=p.status==='scheduled'&&p.publishAt?localDT(p.publishAt):'';
setTab('posts');renderExisting();setMode();$('formTitle').scrollIntoView({behavior:'smooth'})}
$('postForm').onsubmit=async e=>{e.preventDefault();if(!user)return msg('Please sign in first.');
let action=e.submitter&&e.submitter.dataset.action||'draft';const sched=$('schedAt').value,images=[...$('images').files],video=$('video').files[0];
if(action==='publish'&&sched)action='schedule';
if(kept.length+images.length>8)return msg('A post can have at most 8 pictures.');
if(images.some(f=>!IMG_OK.includes(f.type)||f.size>15*1024*1024))return msg('Pictures must be JPG, PNG, WebP, GIF or AVIF, up to 15 MB each.');
if(video&&(!VID_OK.includes(video.type)||video.size>50*1024*1024))return msg('Video must be MP4, WebM or MOV, up to 50 MB.');
const fd=new FormData();['title','category','priority','author','body'].forEach(k=>fd.append(k,$(k).value));images.forEach(f=>fd.append('images',f));if(video)fd.append('video',video);fd.append('action',action);
if(isAd()){fd.append('notify',$('notify').checked?'1':'0');fd.append('pinned',$('pin').checked?'1':'0');if($('pin').checked&&$('pinUntil').value)fd.append('pinUntil',new Date($('pinUntil').value+'T23:59:59').toISOString());if(sched)fd.append('publishAt',new Date(sched).toISOString())}
if(editing){fd.append('removeMedia',JSON.stringify(removed));if(removeVid)fd.append('removeVideo','1')}
const btns=[$('publishBtn'),$('draftBtn'),$('submitBtn')];btns.forEach(b=>b.disabled=true);const old=e.submitter&&e.submitter.textContent;if(e.submitter)e.submitter.textContent='Saving…';
try{const d=await api(editing?'/staff/posts/'+editing.id:'/staff/posts',{method:editing?'PUT':'POST',body:fd}),st=d.post.status;
msg(action==='submit'?'Submitted. The administrator will review it.':editing?'Changes saved.':st==='published'?(d.queued?`Published. Notifying ${plural(d.queued,'subscriber')}.`:'Published for all visitors.'):st==='scheduled'?'Scheduled. It will go live automatically.':'Saved as a draft.');
resetForm();await loadStaff()}
catch(err){gone(err)}
finally{btns.forEach(b=>b.disabled=false);if(e.submitter&&old)e.submitter.textContent=old;setMode()}};
async function onAct(e){const bt=e.target.closest('[data-act]');if(!bt||!user)return;const p=staff.find(x=>x.id===bt.dataset.id);if(!p)return;const a=bt.dataset.act;
try{if(a==='edit')return startEdit(p);
if(a==='delete'){if(!confirm(`Delete "${p.title}" and its pictures/video? This cannot be undone.`))return;await api('/staff/posts/'+p.id,{method:'DELETE'});if(editing&&editing.id===p.id)resetForm();msg('Post deleted.');return loadStaff()}
const body={action:a};
if(a==='reject'){const n=prompt('Reason for rejecting (the teacher will see this):','');if(n===null)return;body.note=n}
if((a==='publish'||a==='approve')&&(subs+pushSubs)>0&&!p.notified)body.notify=confirm('Also notify subscribers (email and push) about this post?');
const d=await api('/staff/posts/'+p.id+'/status',{method:'PATCH',json:body});msg(d.queued?`Done. Notifying ${plural(d.queued,'subscriber')}.`:'Done.');await loadStaff()}
catch(err){gone(err)}}
$('adminList').addEventListener('click',onAct);$('reviewList').addEventListener('click',onAct);

/* team, activity, account */
async function loadTeam(){try{users=await api('/admin/users');$('teamList').innerHTML=users.map(u=>`<div class="item"><div class="info"><b>${esc(u.name)}</b><small><span class="badge ${u.active?'pub':'dr'}">${u.role==='admin'?'Administrator':u.active?'Teacher':'Deactivated'}</span>${esc(u.email)}${u.lastLoginAt?' · last sign-in '+date(u.lastLoginAt):''}</small></div>${u.role==='teacher'?`<div class="acts"><button class="secondary" data-uact="reset" data-id="${u.id}">Reset password</button><button class="${u.active?'danger':'secondary'}" data-uact="toggle" data-id="${u.id}">${u.active?'Deactivate':'Reactivate'}</button></div>`:''}</div>`).join('')}catch(e){gone(e)}}
$('userForm').onsubmit=async e=>{e.preventDefault();try{await api('/admin/users',{json:{name:$('uName').value,email:$('uEmail').value,password:$('uPass').value}});$('userForm').reset();msg('Teacher account created.');loadTeam()}catch(err){gone(err)}};
$('teamList').addEventListener('click',async e=>{const b=e.target.closest('[data-uact]');if(!b)return;try{
if(b.dataset.uact==='reset'){const pw=prompt('New temporary password (at least 10 characters):');if(!pw)return;await api('/admin/users/'+b.dataset.id,{method:'PATCH',json:{password:pw}});msg('Password reset. Share it with the teacher privately.')}
else{const u=users.find(x=>x.id===b.dataset.id);await api('/admin/users/'+b.dataset.id,{method:'PATCH',json:{active:!u.active}});msg(u.active?'Account deactivated.':'Account reactivated.')}
loadTeam()}catch(err){gone(err)}});
const ACT={'login':'signed in','login.failed':'had a failed sign-in attempt','post.create':'saved a draft','post.update':'edited','post.submit':'submitted for approval','post.withdraw':'withdrew','post.approve':'approved and published','post.reject':'rejected','post.publish':'published','post.schedule':'scheduled','post.unpublish':'unpublished','post.delete':'deleted','post.notify':'sent notifications for','user.create':'added a teacher','user.activate':'reactivated an account','user.deactivate':'deactivated an account','user.reset':'reset a password','password.change':'changed their password'};
async function loadActivity(){try{const l=await api('/admin/activity');$('activityList').innerHTML=l.map(a=>`<div class="item"><div class="info"><b>${esc(a.userName)} ${esc(ACT[a.action]||a.action)}${a.postTitle?' “'+esc(a.postTitle)+'”':''}</b><small>${esc(new Date(a.at).toLocaleString())}${a.detail?' · '+esc(a.detail):''}</small></div></div>`).join('')||'<p class="note">No activity yet.</p>'}catch(e){gone(e)}}
$('pwForm').onsubmit=async e=>{e.preventDefault();if($('newPw').value!==$('newPw2').value)return msg('The new passwords do not match.');try{await api('/me/password',{json:{current:$('curPw').value,password:$('newPw').value}});$('pwForm').reset();msg('Password changed.')}catch(err){gone(err)}};

async function start(){try{const d=await api('/status');emailOn=d.email;pushOn=d.push}catch(e){}
route();pushState();await enterAdmin();await loadPosts()}
if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});
start();
})();
