/* Botanical Reverie — Operations App (Phase 1) */
const SUPABASE_URL = "https://rghwtmsfmtdhddamhwjf.supabase.co";
const SUPABASE_KEY = "sb_publishable_v4CyTvhZd0UqT0B43Enx5w_-Y8gd3po";
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const $ = (id) => document.getElementById(id);
const el = {
  auth: $("auth-view"), app: $("app-view"), nav: $("nav"),
  toast: $("toast"),
};
let signUpMode = false;
let CACHE = [];          // cached plants
let currentPlantId = null;

/* ---------- helpers ---------- */
function toast(msg){ el.toast.textContent = msg; el.toast.classList.add("show");
  setTimeout(()=>el.toast.classList.remove("show"), 2600); }
function pad(n){ return String(n).padStart(4,"0"); }
const ROMAN=["","I","II","III","IV","V","VI","VII","VIII","IX","X","XI","XII"];
function roman(n){ return ROMAN[n] || ("G"+n); }
function sibLetter(i){ if(!i) return ""; let s=""; i=i-1; do{ s=String.fromCharCode(97+(i%26))+s; i=Math.floor(i/26)-1;}while(i>=0); return s; }
function lineageCode(p){
  let base = "BR-"+pad(p.plant_no);
  if(p.generation && p.generation>1){ base += " · "+roman(p.generation)+sibLetter(p.sibling_index); }
  return base;
}
function money(n){ return (n==null||n==="")?"—":"$"+Number(n).toLocaleString(undefined,{minimumFractionDigits:0,maximumFractionDigits:2}); }

/* ---------- auth ---------- */
function showAuth(){ el.auth.classList.remove("hidden"); el.app.classList.add("hidden"); el.nav.classList.add("hidden"); var f=$("chat-fab"); if(f) f.classList.add("hidden"); }
function startView(){
  if(hasAddDraft()) return "add";
  try{ const s=JSON.parse(localStorage.getItem("br_view")||"null");
    if(s && s.v && (Date.now()-s.t) < 600000){            // returned within 10 minutes → resume
      if(s.v==="admin") return isAdmin()? "admin" : "today";
      if(["today","collection","add","supplies","quick","chat"].indexOf(s.v)>=0) return s.v;
    }
  }catch(e){}
  return "today";                                          // away 10+ min (or first load) → Today
}
function showApp(user){
  el.auth.classList.add("hidden"); el.app.classList.remove("hidden"); el.nav.classList.remove("hidden");
  const meta = user.user_metadata || {};
  window.ME = (meta.full_name && meta.full_name.trim())
    ? meta.full_name.trim()
    : (user.email||"").split("@")[0].replace(/^./,c=>c.toUpperCase());
  window.MY_EMAIL = user.email || "";
  $("who-name").textContent = window.ME;
  setupAdminNav();
  go(startView());   // resume the last view if returning within 10 min, else Today
}
$("au-switch").onclick = (e)=>{ e.preventDefault(); signUpMode=!signUpMode;
  $("au-submit").textContent = signUpMode? "Create account":"Sign in";
  $("au-switch-txt").textContent = signUpMode? "Already have an account?":"New here?";
  $("au-switch").textContent = signUpMode? "Sign in":"Create your account";
  $("au-msg").textContent=""; };
$("auth-form").onsubmit = async (e)=>{
  e.preventDefault();
  const email=$("au-email").value.trim(), pass=$("au-pass").value;
  $("au-msg").className="auth-msg muted"; $("au-msg").textContent="Working…";
  try{
    if(signUpMode){
      const {error} = await sb.auth.signUp({email,password:pass});
      if(error) throw error;
      $("au-msg").textContent="Account created. Check your email to confirm, then sign in.";
    }else{
      const {error} = await sb.auth.signInWithPassword({email,password:pass});
      if(error) throw error;
    }
  }catch(err){
    $("au-msg").className="auth-msg"; $("au-msg").style.color="var(--garnet-bright)";
    $("au-msg").textContent = err.message || "Something went wrong.";
  }
};
$("sign-out").onclick = async (e)=>{ e.preventDefault(); await sb.auth.signOut(); };

sb.auth.onAuthStateChange((_e, session)=>{ session? showApp(session.user) : showAuth(); });
sb.auth.getSession().then(({data})=>{ data.session? showApp(data.session.user) : showAuth(); });

/* ---------- navigation ---------- */
const views = ["today","collection","add","plant","supplies","admin","quick","chat"];
let LASTVIEW="today";
function saveView(){ try{ localStorage.setItem("br_view", JSON.stringify({v:LASTVIEW,t:Date.now()})); }catch(e){} }
function go(name){
  views.forEach(v=> $("v-"+v).classList.toggle("hidden", v!==name));
  document.querySelectorAll(".nav button").forEach(b=> b.classList.toggle("active", b.dataset.go===name));
  if(name==="today") loadToday();
  if(name==="collection") loadCollection();
  if(name==="add"){ setupAddForm(); }
  if(name==="supplies") loadSupplies();
  if(name==="admin") loadAdmin();
  if(name==="quick") loadQuick();
  if(name==="chat") loadChat();
  var _fab=$("chat-fab"); if(_fab) _fab.classList.toggle("hidden", name==="chat");
  if(el&&el.nav) el.nav.style.display = (name==="chat") ? "none" : "";
  LASTVIEW=name; saveView();
  window.scrollTo(0,0);
}
function setupAdminNav(){ const b=$("nav-admin"); if(b) b.style.display = isAdmin()? "" : "none"; }
document.querySelectorAll(".nav button").forEach(b=> b.onclick=()=>{ if(b.dataset.go==='collection') collFilter=null; go(b.dataset.go); });
document.addEventListener("visibilitychange", function(){ if(document.hidden) saveView(); });
window.addEventListener("pagehide", saveView);
$("go-add").onclick=()=>go("add");
$("add-cancel").onclick=()=>{ addDraftClear(); go("collection"); };
$("plant-back").onclick=()=>go("collection");

/* ---------- data ---------- */
async function fetchPlants(){
  const {data,error} = await sb.from("plant").select("*").order("plant_no",{ascending:true});
  if(error){ toast("Load error: "+error.message); return []; }
  CACHE = data||[]; return CACHE;
}

/* ---------- TODAY ---------- */
async function loadToday(){
  $("today-date").textContent = new Date().toLocaleDateString(undefined,{weekday:"long",month:"long",day:"numeric",year:"numeric"});
  const plants = await fetchPlants();
  // business numbers count Botanical Reverie only; care lists below cover every plant (home included)
  const isBR = p=>(p.collection||"Botanical Reverie")==="Botanical Reverie";
  const br = plants.filter(isBR);
  const homeCount = plants.filter(p=>p.collection==="Michi").length;
  const lauraCount = plants.filter(p=>p.collection==="Laura").length;
  const total = br.length;
  const value = br.reduce((s,p)=>s+(Number(p.current_value)||0),0);
  const quarantine = plants.filter(p=>p.status==="Quarantine").length;
  const ready = br.filter(p=>p.status==="Ready to Sell").length;
  const mothers = br.filter(p=>p.status==="Mother Plant").length;
  const recentRes = await sb.from("care_log").select("action,done_at,done_by_name,plant_id,plant(unique_name)").order("done_at",{ascending:false}).limit(12);
  const recent = recentRes.data || [];
  let review=[];
  try{ const rr=await sb.from("plant").select("id,unique_name,common_name,botanical_name").eq("needs_id_review",true).limit(20); review=rr.data||[]; }catch(e){}
  const wateredRes = await sb.from("care_log").select("plant_id,done_at").eq("action","Watered");
  const lastW = {};
  (wateredRes.data||[]).forEach(w=>{ const t=new Date(w.done_at).getTime(); if(!lastW[w.plant_id]||t>lastW[w.plant_id]) lastW[w.plant_id]=t; });
  const now=Date.now(), DAY=86400000;
  const active = plants.filter(p=>["In Collection","Mother Plant","Propagating","Quarantine","Ready to Sell","Listed","Reserved"].indexOf(p.status)>=0);
  const needs = active.map(p=>({p, days: lastW[p.id]? Math.floor((now-lastW[p.id])/DAY) : null}))
    .filter(x=> x.days===null || x.days>=7)
    .sort((a,b)=> (b.days===null?99999:b.days)-(a.days===null?99999:a.days));
  window.__todaySummary = `Collection ${total} plants; quarantine ${quarantine}; ready to sell ${ready}; mother plants ${mothers}. Needs check/water (${needs.length}): ` + (needs.slice(0,10).map(x=>`${x.p.unique_name||x.p.common_name||'Unnamed'} (${x.days===null?'no water logged':x.days+'d since water'})`).join('; ')||'none') + '.';
  $("today-body").innerHTML = `
    <div class="grid" style="grid-template-columns:repeat(2,minmax(0,1fr));">
      ${tile("In the collection", total, 'all', 'Botanical Reverie')}
      ${tile("Collection value", money(value), 'all', 'Botanical Reverie')}
      ${tile("In quarantine", quarantine, 'Quarantine', '')}
      ${tile("Ready to sell", ready, 'Ready to Sell', 'Botanical Reverie')}
      ${tile("Mother plants", mothers, 'Mother Plant', 'Botanical Reverie')}
    </div>
    ${(homeCount||lauraCount)?`<div class="muted" style="font-size:12px;margin-top:10px;letter-spacing:.03em;">＋ personal plants on the same care schedule, kept off the books:
      ${homeCount?`<a style="cursor:pointer;color:var(--gold);" onclick="selectCollection('all','Michi')">${homeCount} of yours</a>`:''}${(homeCount&&lauraCount)?' · ':''}${lauraCount?`<a style="cursor:pointer;color:var(--gold);" onclick="selectCollection('all','Laura')">${lauraCount} of Laura’s</a>`:''}</div>`:''}
    <div class="section-t"><div class="label flank" style="justify-content:flex-start;">LINNAEUS — TODAY</div>
      <div style="margin-top:10px;"><button type="button" class="btn btn-sm btn-gold" onclick="todayBrief()">✦ What needs attention</button></div>
      <div id="ai-today" class="roomnote" style="display:none;margin-top:10px;white-space:pre-wrap;"></div>
    </div>
    ${review.length?`<div class="section-t"><div class="label flank" style="justify-content:flex-start;">NEEDS ID — LINNAEUS FLAGGED (${review.length})</div>
      <div style="margin-top:10px;">${review.map(r=>`<div onclick="openPlant('${r.id}')" style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--line);padding:9px 0;font-size:14px;cursor:pointer;"><span><span class="dot"></span> ${r.unique_name||r.common_name||'Unnamed'}</span><span class="muted" style="font-size:11px;">${r.botanical_name||'no species'} · tap to fix</span></div>`).join('')}</div></div>`:''}
    <div class="section-t"><div class="label flank" style="justify-content:flex-start;">CHECK &amp; WATER</div>
      <div style="margin-top:10px;">${ needs.length ? needs.slice(0,12).map(x=>`
        <div onclick="openPlant('${x.p.id}')" style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--line);padding:9px 0;font-size:14px;cursor:pointer;">
          <span><span class="dot"></span> ${x.p.unique_name||x.p.common_name||"Unnamed"}</span>
          <span class="muted" style="font-size:11px;letter-spacing:.04em;">${ x.days===null ? "not yet logged" : x.days+" day"+(x.days===1?"":"s")+" since water" }</span>
        </div>`).join("") : `<div class="muted" style="font-size:13px;">Everything is watered. Beautifully kept.</div>` }
      </div>
    </div>
    <div class="section-t"><div class="label flank" style="justify-content:flex-start;">RECENTLY TENDED</div>
      <div style="margin-top:10px;">${ recent.length ? recent.map(r=>`
        <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--line);padding:8px 0;font-size:13px;">
          <span><span class="muted">${r.done_by_name||"Someone"}</span> ${r.action.toLowerCase()} <span style="font-family:'Cormorant Garamond',serif;font-style:italic;font-size:15px;color:var(--cream);">${r.plant?(r.plant.unique_name||"a plant"):"a plant"}</span></span>
          <span class="muted" style="font-size:11px;">${shortWhen(r.done_at)}</span>
        </div>`).join("") : `<div class="muted" style="font-size:13px;">No activity yet. Log your first care action on a plant.</div>` }
      </div>
    </div>`;
}
function shortWhen(iso){
  if(!iso) return "";
  var d=new Date(iso), diff=(Date.now()-d.getTime())/1000;
  if(diff<3600) return Math.max(1,Math.floor(diff/60))+"m ago";
  if(diff<86400) return Math.floor(diff/3600)+"h ago";
  return d.toLocaleDateString(undefined,{month:"short",day:"numeric"});
}
function tile(label,val,action,world){
  const click = action ? `onclick="selectCollection('${action}',${world!==undefined?`'${world}'`:'undefined'})" style="cursor:pointer;"` : `style="cursor:default;"`;
  return `<div class="card stat" ${click}><div class="body">
    <div class="label">${label}</div>
    <div style="font-family:'Cormorant Garamond',serif;font-size:34px;color:var(--cream);margin-top:6px;">${val}</div>
  </div></div>`;
}

/* ---------- COLLECTION ---------- */
let collFilter = null, collWorldOnce;
window.selectCollection = function(f, world){ collFilter = (f && f!=='all') ? f : null; collWorldOnce = world; go('collection'); };
async function loadCollection(){
  await fetchPlants();
  if(collFilter){ const f=$("coll-filter"); if(f) f.value=collFilter; collFilter=null; }
  const w=$("coll-world");
  if(w){
    if(collWorldOnce!==undefined){ w.value=collWorldOnce; collWorldOnce=undefined; }
    else { try{ w.value=localStorage.getItem("br_coll_world")||""; }catch(e){} }
  }
  applyColl();
}
function sortPlants(arr, mode){
  const a=arr.slice(), t=p=>p.date_entered?new Date(p.date_entered).getTime():0;
  if(mode==='old') a.sort((x,y)=>t(x)-t(y)||(x.plant_no||0)-(y.plant_no||0));
  else if(mode==='name') a.sort((x,y)=>(x.unique_name||x.common_name||'').localeCompare(y.unique_name||y.common_name||''));
  else if(mode==='status') a.sort((x,y)=>(x.status||'').localeCompare(y.status||''));
  else if(mode==='zone') a.sort((x,y)=>(x.location_zone||'').localeCompare(y.location_zone||''));
  else if(mode==='value') a.sort((x,y)=>(Number(y.current_value)||0)-(Number(x.current_value)||0));
  else a.sort((x,y)=>t(y)-t(x)||(y.plant_no||0)-(x.plant_no||0)); // newest
  return a;
}
function applyColl(){
  const q=($("coll-search").value||'').toLowerCase().trim();
  const f=$("coll-filter")?$("coll-filter").value:'';
  const w=$("coll-world")?$("coll-world").value:'';
  const sort=$("coll-sort")?$("coll-sort").value:'new';
  let list=CACHE.slice();
  if(w) list=list.filter(p=>(p.collection||'Botanical Reverie')===w);
  if(f==='__needsid') list=list.filter(p=>p.needs_id_review);
  else if(f) list=list.filter(p=>p.status===f);
  if(q) list=list.filter(p=>[p.unique_name,p.botanical_name,p.common_name,p.house,p.location_zone,lineageCode(p)].filter(Boolean).join(' ').toLowerCase().includes(q));
  list=sortPlants(list, sort);
  const label = f==='__needsid' ? ' · needs ID' : (f?` · ${f}`:'');
  $("coll-count").textContent = list.length+" specimen"+(list.length===1?'':'s')+label;
  renderColl(list);
}
$("coll-search").oninput = applyColl;
if($("coll-filter")) $("coll-filter").onchange = applyColl;
if($("coll-sort")) $("coll-sort").onchange = applyColl;
if($("coll-world")) $("coll-world").onchange = ()=>{ try{ localStorage.setItem("br_coll_world", $("coll-world").value); }catch(e){} applyColl(); };
function renderColl(plants){
  const g=$("coll-grid");
  if(!plants.length){ g.innerHTML=`<div class="empty"><div class="big">No specimens.</div><div>Adjust the filters, or tap “Add a Plant.”</div></div>`; return; }
  g.innerHTML = plants.map(function(p){
    const sub=[p.botanical_name||p.common_name, p.location_zone].filter(Boolean).join(' · ');
    const val=(isAdmin() && p.current_value!=null)? money(p.current_value):'';
    return '<div class="lrow" onclick="openPlant(\''+p.id+'\')">'
      +'<div class="lthumb" style="'+(p.cover_photo_url?("background-image:url('"+p.cover_photo_url+"')"):'')+'">'+(p.cover_photo_url?'':'❦')+'</div>'
      +'<div class="lmain"><div class="lnm">'+(p.unique_name||p.common_name||'Unnamed')+'</div>'
      +'<div class="lsub">'+lineageCode(p)+(sub?' · '+sub:'')+'</div></div>'
      +'<div class="lmeta"><div class="lstatus">'+(p.status||'')+'</div>'
      +(p.needs_id_review?'<div class="lflag">needs ID</div>':'')
      +(val?'<div class="lval">'+val+'</div>':'')
      +'</div></div>';
  }).join("");
}

/* ---------- ADD ---------- */
/* type → what the form asks for */
const ACQ = {
  "Founding plant":      {mother:false, vendor:true,  needMother:false, needVendor:false, founding:true},
  "Purchased":           {mother:false, vendor:true,  needMother:false, needVendor:true},
  "Trade / Gift":        {mother:false, vendor:true,  needMother:false, needVendor:true},
  "Tissue culture":      {mother:false, vendor:true,  needMother:false, needVendor:true},
  "Cutting":             {mother:true,  vendor:true,  needMother:false, needVendor:false, oneOf:true},
  "Division":            {mother:true,  vendor:false, needMother:true,  needVendor:false},
  "Our own propagation": {mother:true,  vendor:false, needMother:true,  needVendor:false},
};
const ZONES = ["Rack 1","Rack 2","Rack 3","Hoya Bench (south window)","Glass case (velvet aroids)","Quarantine","Outdoors (aloe)","Other"];
const SHELVES = ["Shelf 1 — top (low light / storage)","Shelf 2 (grow light)","Shelf 3 (grow light)","Shelf 4 (grow light)","Shelf 5 (grow light)"];
const POTS = ["Clear glass","Weathered terracotta","Matte black","Clear plastic (nursery)","Net pot (semi-hydro)","Other"];
const CONDS = ["Healthy","Minor stress","Rootbound","Dehydrated","Pest seen","Disease seen","Shipping damage","Other"];
const ADMIN_EMAILS = ["hello@botanicalreverie.com"];   // logins with admin access (pricing + Admin tab). Add emails here to grant.
function isAdmin(){ return ADMIN_EMAILS.indexOf((window.MY_EMAIL||"").toLowerCase())>=0; }
let condSel = new Set();
let VENDORS = [];
let addWired = false;
let addPhotoFile = null;
let verifyOK = false;

function fillCultivars(){
  const sel=$("f-cultivar"); if(!sel) return;
  const set=new Set();
  SPECIES.forEach(s=>{ if(s.cultivar) set.add(s.cultivar); });
  (CACHE||[]).forEach(p=>{ if(p.cultivar) set.add(p.cultivar); });
  const cur=sel.value, arr=[...set].sort((a,b)=>a.localeCompare(b));
  sel.innerHTML = `<option value="">— None —</option>` +
    arr.map(c=>`<option value="${escAttr(c)}">${c}</option>`).join("") +
    `<option value="__add__">＋ Add new cultivar…</option>`;
  if(cur && arr.indexOf(cur)>=0) sel.value=cur;
}
function ensureCultivar(name){
  if(!name) return; const sel=$("f-cultivar");
  if(![...sel.options].some(o=>o.value===name)) sel.add(new Option(name,name), sel.options[sel.options.length-1]);
  sel.value=name;
}
/* Photo policing — bounce dark / overexposed / blurry / low-res shots. Heuristic, dial in PHOTO_MIN_* if needed. */
const PHOTO_MIN_LONGEDGE=1200, PHOTO_DARK=42, PHOTO_BRIGHT=226, PHOTO_BLUR=45;
function checkPhotoQuality(file){
  return new Promise(resolve=>{
    const img=new Image();
    img.onload=()=>{
      const W=img.naturalWidth, H=img.naturalHeight, long=Math.max(W,H);
      const scale=Math.min(1, 256/long), cw=Math.max(2,Math.round(W*scale)), ch=Math.max(2,Math.round(H*scale));
      const c=document.createElement("canvas"); c.width=cw; c.height=ch;
      const ctx=c.getContext("2d"); ctx.drawImage(img,0,0,cw,ch);
      let d; try{ d=ctx.getImageData(0,0,cw,ch).data; }catch(e){ resolve({ok:true}); return; }
      const lum=new Float64Array(cw*ch); let sum=0;
      for(let i=0,p=0;i<d.length;i+=4,p++){ const y=0.299*d[i]+0.587*d[i+1]+0.114*d[i+2]; lum[p]=y; sum+=y; }
      const mean=sum/(cw*ch);
      let ls=0, lsq=0, n=0;
      for(let y=1;y<ch-1;y++) for(let x=1;x<cw-1;x++){ const p=y*cw+x;
        const lap=4*lum[p]-lum[p-1]-lum[p+1]-lum[p-cw]-lum[p+cw]; ls+=lap; lsq+=lap*lap; n++; }
      const lvar = n? (lsq/n)-Math.pow(ls/n,2) : 999;
      const issues=[];
      if(long<PHOTO_MIN_LONGEDGE) issues.push("too small / low-res (looks like a screenshot or thumbnail)");
      if(mean<PHOTO_DARK) issues.push("too dark — add light");
      else if(mean>PHOTO_BRIGHT) issues.push("overexposed — too bright");
      if(lvar<PHOTO_BLUR) issues.push("blurry or out of focus — hold steady");
      resolve({ok:issues.length===0, issues});
    };
    img.onerror=()=>resolve({ok:true});
    img.src=URL.createObjectURL(file);
  });
}

function fillSelect(id, arr, placeholder){
  const s=$(id); if(!s) return;
  s.innerHTML = (placeholder?`<option value="">${placeholder}</option>`:"") + arr.map(v=>`<option>${v}</option>`).join("");
}
function resetAddVis(){
  ["f-cond-other","f-cond-quar","f-zone-other","f-shelf-wrap","f-pot-other","f-addname","f-vdup","f-name-sug","f-inherit","f-recipe","f-cult-add","f-photo-note","f-verify-note","f-id-suggest","f-collection-note"].forEach(id=>{ const e=$(id); if(e) e.style.display="none"; });
  const vs=$("f-vsug"); if(vs){ vs.classList.remove("open"); vs.innerHTML=""; }
}

async function setupAddForm(){
  const f=$("add-form"); if(!f) return;
  f.reset();
  addPhotoFile=null; verifyOK=false; window.__lastIdentify=null; window.__newlyTypedName=null;
  const pimg=$("f-photo-preview"); if(pimg){ pimg.src=""; pimg.style.display="none"; }
  const ppr=$("f-photo-prompt"); if(ppr) ppr.style.display="block";
  const pz=$("f-photo-zone"); if(pz) pz.classList.remove("bad");
  $("f-date").value = new Date().toISOString().slice(0,10);
  fillSelect("f-zone", ZONES, "— Select a zone —");
  fillSelect("f-shelf", SHELVES, "— Select a shelf —");
  fillSelect("f-pot", POTS, "— Select a pot —");
  $("f-cond-chips").innerHTML = CONDS.map(c=>`<span class="chip pick" data-c="${c}">${c}</span>`).join("");
  condSel = new Set();
  await loadCatalog();
  const plants = CACHE.length? CACHE : await fetchPlants();
  $("f-mother").innerHTML = `<option value="">— Select the mother —</option>` +
    plants.map(p=>`<option value="${p.id}">${p.unique_name||p.common_name||"Unnamed"} (${lineageCode(p)})</option>`).join("");
  await loadVendors();
  fillCultivars();
  $("f-admin").style.display = isAdmin()? "block":"none";
  resetAddVis();
  applyAcq("");
  if(!addWired){ wireAddForm(); addWired=true; }
  addDraftRestore();   // bring back an interrupted add (text fields; photo re-added)
}

function applyAcq(t){
  const cfg = ACQ[t];
  $("f-mother-wrap").style.display = (cfg&&cfg.mother)?"block":"none";
  $("f-vendor-wrap").style.display = (cfg&&cfg.vendor)?"block":"none";
  if(cfg&&cfg.needMother) $("f-status").value="Propagating";
  if(!cfg||!cfg.mother){ $("f-mother").value=""; $("f-inherit").style.display="none"; }
}

async function loadVendors(){
  const {data} = await sb.from("plant").select("source_name,source_phone,source_website,source_address").not("source_name","is",null);
  const map={};
  (data||[]).forEach(r=>{ const n=(r.source_name||"").trim(); if(!n||map[n]) return;
    map[n]={name:n,phone:r.source_phone||"",website:r.source_website||"",address:r.source_address||""}; });
  [{name:"Laura — home collection"},{name:"Michi — home collection"}].forEach(s=>{ if(!map[s.name]) map[s.name]={name:s.name,phone:"",website:"",address:""}; });
  VENDORS = Object.values(map).sort((a,b)=>a.name.localeCompare(b.name));
}
function renderVsug(q){
  const vs=$("f-vsug"); const ql=(q||"").toLowerCase().trim();
  const list = VENDORS.filter(v=> !ql || v.name.toLowerCase().indexOf(ql)>=0).slice(0,8);
  if(!list.length){ vs.classList.remove("open"); vs.innerHTML=""; return; }
  vs.innerHTML = list.map(v=>`<div data-n="${escAttr(v.name)}">${v.name}${(v.phone||v.website)?` <span class="vmeta">· ${[v.phone,v.website].filter(Boolean).join(' · ')}</span>`:''}</div>`).join("");
  vs.classList.add("open");
}
function checkVendorDup(){
  const vd=$("f-vdup"); const name=($("f-srcname").value||"").trim();
  const v=VENDORS.find(x=>x.name.toLowerCase()===name.toLowerCase());
  if(!v||!name){ vd.style.display="none"; return; }
  const ph=($("f-srcphone").value||"").trim(), wb=($("f-srcweb").value||"").trim();
  const diffs=[];
  if(v.phone && ph && v.phone!==ph) diffs.push("phone");
  if(v.website && wb && v.website!==wb) diffs.push("website");
  if(diffs.length){ vd.style.display="block"; vd.innerHTML=`Heads up — “${v.name}” is on file with a different ${diffs.join(" & ")}. Same vendor?`; }
  else { vd.style.display="none"; if(!ph&&v.phone) $("f-srcphone").value=v.phone; if(!wb&&v.website) $("f-srcweb").value=v.website; if(!($("f-srcaddr").value||"").trim()&&v.address) $("f-srcaddr").value=v.address; }
}

function onMother(){
  const id=$("f-mother").value, note=$("f-inherit");
  if(!id){ note.style.display="none"; $("f-name-sug").style.display="none"; return; }
  const m=CACHE.find(x=>x.id===id); if(!m){ note.style.display="none"; return; }
  if(m.botanical_name){ ensureBotanical(m.botanical_name); $("f-botanical").value=m.botanical_name; onBotanical(); }
  if(m.common_name) $("f-common").value=m.common_name;
  if(m.cultivar) ensureCultivar(m.cultivar);
  if(/varieg|albo|aurea|mint|thai constellation|variegata/i.test([m.cultivar,m.botanical_name,m.unique_name].filter(Boolean).join(' '))) $("f-variegated").checked=true;
  const sug=suggestNextName(m), ns=$("f-name-sug");
  if(sug){ ns.style.display="block"; ns.innerHTML=`Suggested: <a id="use-name">${sug}</a> — of the ${m.house||'founding'} line`;
    const a=$("use-name"); if(a) a.onclick=()=>{ $("f-name").value=sug; }; }
  else ns.style.display="none";
  note.style.display="block";
  note.innerHTML = `Inherits from <b>${m.unique_name||m.botanical_name||'mother'}</b> — species & line${m.cultivar?', cultivar':''} carried over.`;
}
function ensureBotanical(name){
  const b=$("f-botanical");
  if(![...b.options].some(o=>o.value===name)){ b.add(new Option(name,name), b.options[b.options.length-1]); }
}
function suggestNextName(m){
  const nm=(m.unique_name||"").trim(); if(!nm) return null;
  const parts=nm.split(/\s+/), last=parts[parts.length-1].toUpperCase(), idx=ROMAN.indexOf(last);
  if(idx>0){ parts[parts.length-1]=ROMAN[idx+1]||("G"+(idx+1)); return parts.join(" "); }
  return nm+" II";
}

/* Type the first part of the name, tap a second half — on-brand epithets (Poetic-Names-Library) */
const NAME_SUFFIXES=["in Garnet","of the Oxblood Hour","Vespers","in Shadow","of Evenfall","in Gold",
  "of the Conservatory","in Velvet","of Dusk","the First","in Carmine","of the Gilded Hour","Noir",
  "in Bloom","of the Quiet Glow","the Elder","in Repose","of Nightfall","of House Garnet","Ember"];
let nameSuffixOffset=0;
function renderNameSuffixes(){
  const box=$("f-name-suffixes"); if(!box) return;
  const n=6, arr=[];
  for(let i=0;i<n;i++) arr.push(NAME_SUFFIXES[(nameSuffixOffset+i)%NAME_SUFFIXES.length]);
  box.innerHTML=arr.map(s=>`<span class="chip" data-suf="${escAttr(s)}" style="cursor:pointer;text-transform:none;letter-spacing:.03em;font-size:12px;">${s}</span>`).join("");
}
function appendNameSuffix(suf){
  const el=$("f-name"); if(!el) return;
  const base=(el.value||"").trim();
  if(base.toLowerCase().endsWith(suf.toLowerCase())){ el.focus(); return; }
  el.value = base ? base+" "+suf : suf;
  el.dispatchEvent(new Event("input",{bubbles:true}));   // fires the draft autosave
  el.focus();
}

async function saveNewName(){
  const bot=($("an-bot").value||"").trim(), com=($("an-common").value||"").trim(), med=$("an-medium").value, msg=$("an-msg");
  const warn=(t)=>{ msg.style.display="block"; msg.className="fnote warn"; msg.textContent=t; };
  if(!bot) return warn("Botanical name is required.");
  if(SPECIES.some(s=>(s.botanical_name||"").toLowerCase()===bot.toLowerCase())) return warn("That name is already in the catalog.");
  const {data,error}=await sb.from("species").insert({botanical_name:bot, common_name:com||null, recommended_medium:med||null}).select().single();
  if(error) return warn(error.message);
  SPECIES.push(data); SPECIES.sort((a,b)=>(a.botanical_name||"").localeCompare(b.botanical_name||""));
  renderBotanical(); $("f-botanical").value=bot; onBotanical();
  window.__newlyTypedName=bot;   // hand-typed → Linnaeus flags it for your review
  $("f-addname").style.display="none"; $("an-bot").value=""; $("an-common").value=""; $("an-medium").value=""; msg.style.display="none";
  toast(bot+" added — Linnaeus will flag it for your review.");
}

function wireAddForm(){
  const fc=$("f-collection");
  if(fc) fc.addEventListener("change", ()=>{ const n=$("f-collection-note"); if(n) n.style.display = (fc.value&&fc.value!=="Botanical Reverie")?"block":"none"; });
  $("f-acqtype").addEventListener("change", e=>applyAcq(e.target.value));
  $("f-botanical").addEventListener("change", onBotanical);
  $("f-medium").addEventListener("change", ()=>showRecipe($("f-medium").value));
  $("f-mother").addEventListener("change", onMother);
  $("f-cond-chips").addEventListener("click", e=>{
    const c=e.target.closest(".chip"); if(!c) return;
    const v=c.dataset.c; c.classList.toggle("on");
    if(condSel.has(v)) condSel.delete(v); else condSel.add(v);
    $("f-cond-other").style.display = condSel.has("Other")?"block":"none";
    const quar = condSel.has("Pest seen")||condSel.has("Disease seen");
    $("f-cond-quar").style.display = quar?"block":"none";
    if(quar) $("f-status").value="Quarantine";
    addDraftSave();
  });
  $("f-zone").addEventListener("change", ()=>{
    const z=$("f-zone").value;
    $("f-shelf-wrap").style.display = /^Rack/.test(z)?"block":"none";
    $("f-zone-other").style.display = z==="Other"?"block":"none";
  });
  $("f-pot").addEventListener("change", ()=>{ $("f-pot-other").style.display = $("f-pot").value==="Other"?"block":"none"; });
  const vn=$("f-srcname"), vs=$("f-vsug");
  vn.addEventListener("input", ()=>renderVsug(vn.value));
  vn.addEventListener("focus", ()=>renderVsug(vn.value));
  vn.addEventListener("blur", ()=>{ setTimeout(()=>vs.classList.remove("open"),150); checkVendorDup(); });
  vs.addEventListener("mousedown", e=>{
    const d=e.target.closest("div[data-n]"); if(!d) return;
    const v=VENDORS.find(x=>x.name===d.dataset.n); if(!v) return;
    vn.value=v.name; $("f-srcphone").value=v.phone||""; $("f-srcweb").value=v.website||""; $("f-srcaddr").value=v.address||"";
    vs.classList.remove("open"); $("f-vdup").style.display="none";
  });
  $("an-save").addEventListener("click", saveNewName);
  $("an-cancel").addEventListener("click", ()=>{ $("f-addname").style.display="none"; $("f-botanical").value=""; });
  // name second-half suggestions — type the first part, tap to finish it
  renderNameSuffixes();
  const dice=$("f-name-dice"); if(dice) dice.addEventListener("click", ()=>{ nameSuffixOffset=(nameSuffixOffset+6)%NAME_SUFFIXES.length; renderNameSuffixes(); });
  const sufBox=$("f-name-suffixes"); if(sufBox) sufBox.addEventListener("click", e=>{ const c=e.target.closest(".chip[data-suf]"); if(!c) return; appendNameSuffix(c.dataset.suf); });
  // photo capture
  $("f-photo-zone").addEventListener("click", ()=> $("f-photo-input").click());
  $("f-photo-input").addEventListener("change", async e=>{
    const file=e.target.files&&e.target.files[0]; if(!file) return;
    const note=$("f-photo-note"); note.style.display="none";
    const q=await checkPhotoQuality(file);
    if(!q.ok){
      addPhotoFile=null;
      $("f-photo-preview").style.display="none"; $("f-photo-prompt").style.display="block";
      $("f-photo-zone").classList.add("bad");
      note.style.display="block";
      note.innerHTML="Photo bounced — "+q.issues.join("; ")+". Please retake.";
      return;
    }
    addPhotoFile=file; verifyOK=false; window.__lastIdentify=null;
    idbPutPhoto(file);   // persist immediately so leaving the app to look something up can't lose it
    const vnote=$("f-verify-note"); if(vnote) vnote.style.display="none";
    const img=$("f-photo-preview"), pr=$("f-photo-prompt");
    img.src=URL.createObjectURL(file); img.style.display="block"; pr.style.display="none";
    $("f-photo-zone").classList.remove("bad");
    addDraftSave();
    runIdentify(file);   // auto-suggest species from the photo
  });
  // cultivar add-new
  $("f-cultivar").addEventListener("change", ()=>{
    if($("f-cultivar").value==="__add__"){ $("f-cult-add").style.display="block"; $("f-cultivar").value=""; $("f-cult-new").focus(); }
  });
  $("f-cult-save").addEventListener("click", ()=>{
    const v=($("f-cult-new").value||"").trim(); if(!v) return;
    ensureCultivar(v); $("f-cult-add").style.display="none"; $("f-cult-new").value="";
  });
  $("f-cult-cancel").addEventListener("click", ()=>{ $("f-cult-add").style.display="none"; $("f-cult-new").value=""; });
  $("f-id-suggest").addEventListener("click", e=>{ const c=e.target.closest(".chip"); if(!c) return; acceptCandidate(c.dataset.bot, c.dataset.com); });
  $("add-form").addEventListener("input", addDraftSave);
  $("add-form").addEventListener("change", addDraftSave);
  $("add-form").addEventListener("submit", submitAdd);
}

function clearBad(){ document.querySelectorAll("#add-form .bad").forEach(x=>x.classList.remove("bad")); }
function markBad(id){ const el=$(id); if(!el) return; el.classList.add("bad"); const lab=el.closest("label.field"); if(lab) lab.classList.add("bad"); }

async function submitAdd(e){
  e.preventDefault();
  const m=$("add-msg"); m.style.color=""; m.textContent=""; clearBad();
  const t=$("f-acqtype").value, cfg=ACQ[t], bad=[];
  if(!addPhotoFile) bad.push("f-photo-zone");
  if(!t) bad.push("f-acqtype");
  const bot=$("f-botanical").value; if(!bot||bot==="__add__") bad.push("f-botanical");
  if(!$("f-name").value.trim()) bad.push("f-name");
  if(!$("f-status").value) bad.push("f-status");
  const condOther=condSel.has("Other");
  if(condOther && !$("f-cond-other").value.trim()) bad.push("f-cond-other");
  const zone=$("f-zone").value; if(!zone) bad.push("f-zone");
  if(zone==="Other" && !$("f-zone-other").value.trim()) bad.push("f-zone-other");
  if(/^Rack/.test(zone) && !$("f-shelf").value) bad.push("f-shelf");
  const pot=$("f-pot").value; if(!pot) bad.push("f-pot");
  if(pot==="Other" && !$("f-pot-other").value.trim()) bad.push("f-pot-other");
  if(!$("f-medium").value) bad.push("f-medium");
  if(!$("f-date").value) bad.push("f-date");
  const motherId=$("f-mother").value, vendorName=$("f-srcname").value.trim();
  if(cfg){
    if(cfg.needMother && !motherId) bad.push("f-mother");
    if(cfg.needVendor && !vendorName) bad.push("f-srcname");
    if(cfg.oneOf && !motherId && !vendorName){ bad.push("f-mother"); bad.push("f-srcname"); }
  }
  if(bad.length || condSel.size===0){
    bad.forEach(markBad);
    m.style.color="var(--garnet-bright)";
    m.textContent = !addPhotoFile ? "A photo is required — tap the photo box, then fill any highlighted fields."
      : condSel.size===0 ? "Pick at least one condition, and fill the highlighted fields."
      : "Please fill the highlighted fields.";
    const first=$(bad[0]); if(first&&first.scrollIntoView) first.scrollIntoView({behavior:"smooth",block:"center"});
    return;
  }
  m.textContent="Adding…";
  let loc = zone==="Other" ? $("f-zone-other").value.trim() : zone;
  if(/^Rack/.test(zone)) loc = zone+" · "+$("f-shelf").value;
  const potv = pot==="Other" ? $("f-pot-other").value.trim() : pot;
  const conds=[...condSel].filter(c=>c!=="Other");
  if(condOther) conds.push($("f-cond-other").value.trim());
  let cultivar=$("f-cultivar").value.trim();
  if($("f-variegated").checked && !/varieg/i.test(cultivar)) cultivar = cultivar? cultivar+" (variegated)" : "Variegated";
  const rec={
    unique_name:$("f-name").value.trim(), status:$("f-status").value,
    collection:($("f-collection")&&$("f-collection").value)||"Botanical Reverie",
    botanical_name:bot, common_name:val("f-common"), cultivar:cultivar||null,
    mother_id:(cfg&&cfg.mother&&motherId)?motherId:null,
    date_entered:$("f-date").value||null, acquisition_type:t,
    condition_at_intake:conds.join(", ")||null,
    location_zone:loc, pot_type:potv, medium:val("f-medium"), notes:val("f-notes"),
  };
  if(cfg&&cfg.vendor&&vendorName){
    rec.source_name=vendorName; rec.source_phone=val("f-srcphone"); rec.source_website=val("f-srcweb"); rec.source_address=val("f-srcaddr");
  }
  if(isAdmin()){ rec.acquisition_cost=num("f-cost"); rec.target_price=num("f-target"); rec.current_value=num("f-value"); }
  const {data,error}=await sb.from("plant").insert(rec).select().single();
  if(error){ m.style.color="var(--garnet-bright)"; m.textContent=error.message; return; }
  // upload the required photo, set as cover
  if(addPhotoFile){
    try{
      const file=addPhotoFile;
      const ext=(file.name.split(".").pop()||"jpg").toLowerCase().replace(/[^a-z0-9]/g,"")||"jpg";
      const path=data.id+"/"+Date.now()+"."+ext;
      const up=await sb.storage.from("plant-photos").upload(path, file, {upsert:false, contentType:file.type||"image/jpeg"});
      if(up.error){ toast("Plant saved — photo upload failed: "+up.error.message); }
      else{
        const url=sb.storage.from("plant-photos").getPublicUrl(path).data.publicUrl;
        await sb.from("photo").insert({plant_id:data.id, image_url:url});
        await sb.from("plant").update({cover_photo_url:url}).eq("id",data.id);
      }
    }catch(err){ toast("Plant saved — photo failed: "+err.message); }
  }
  // ID review flag + Linnaeus's suggestion (uses migration columns; degrades gracefully until they exist)
  try{ await sb.from("plant").update({ needs_id_review: computeIdFlag(bot), ai_suggestion: window.__lastIdentify||null }).eq("id", data.id); }catch(e){}
  await fetchPlants(); await loadVendors();
  addDraftClear();
  $("add-form").reset(); condSel=new Set(); addPhotoFile=null; verifyOK=false; window.__lastIdentify=null; window.__newlyTypedName=null;
  $("f-photo-preview").style.display="none"; $("f-photo-prompt").style.display="block";
  resetAddVis(); applyAcq("");
  toast((rec.unique_name||"Plant")+" entered the collection.");
  openPlant(data.id);
}
function val(id){ const v=$(id).value; return v&&v.trim()? v.trim():null; }
function num(id){ const v=$(id).value; return v? Number(v):null; }

/* ---------- PLANT PAGE ---------- */
window.openPlant = async function(id){
  currentPlantId=id; go("plant");
  $("plant-body").innerHTML = `<div style="padding:60px;text-align:center;"><span class="spin"></span></div>`;
  let p = CACHE.find(x=>x.id===id);
  if(!p){ const {data}=await sb.from("plant").select("*").eq("id",id).single(); p=data; }
  const {data:kids} = await sb.from("plant").select("*").eq("mother_id",id).order("sibling_index");
  const {data:care} = await sb.from("care_log").select("*").eq("plant_id",id).order("done_at",{ascending:false}).limit(8);
  const {data:photos} = await sb.from("photo").select("*").eq("plant_id",id).order("created_at",{ascending:false});
  const {data:health} = await sb.from("health_log").select("*").eq("plant_id",id).order("created_at",{ascending:false});
  const mother = p.mother_id? CACHE.find(x=>x.id===p.mother_id) : null;
  renderPlant(p, mother, kids||[], care||[], photos||[], health||[]);
};
/* ---------- Grow-room brain (knowledge layer) ---------- */
function roomCareNote(p){
  var hay = [p.botanical_name,p.common_name,p.medium].filter(Boolean).join(' ').toLowerCase();
  if(/anthurium|warocqueanum|clarinervium|velvet/.test(hay))
    return "Thin-leaf velvet — keep it in the glass case (75–85% humidity, fan on). The open conservatory at 60%+ runs too dry for these.";
  if(/hoya|echeveria|sansevieria|succulent|cactus|string of/.test(hay))
    return "Likes it drier — water only when fully dry. The conservatory's steady airflow suits it well.";
  return "At home in the conservatory — 60%+ humidity under the grow lights. Check the top inch and water only if it's dry.";
}
function storyLine(p){
  var yr = p.date_entered ? new Date(p.date_entered).getFullYear() : null;
  if(p.mother_id) return "Of the "+(p.house||"founding")+" line — propagated and grown slowly in our Houston study, tended and photographed with care.";
  return "Founder of the "+(p.house||"")+" line"+(yr?", established "+yr:"")+" — grown slowly in our Houston study, tended with care.";
}
function tendedSummary(care){
  if(!care||!care.length) return '';
  const last=a=>{const c=care.find(x=>x.action===a);return c?shortWhen(c.done_at):null;};
  const out=[];
  const w=last('Watered'); if(w) out.push('Watered <span class="tg">'+w+'</span>');
  const f=last('Fed'); if(f) out.push('Fed <span class="tg">'+f+'</span>');
  const r=care[0]; if(r) out.push('Last tended <span class="tg">'+shortWhen(r.done_at)+'</span>');
  return out.join(' &nbsp;·&nbsp; ');
}
function renderPlant(p, mother, kids, care, photos, health){
  window.CURRENT_PLANT = p;
  const coverBg = p.cover_photo_url? `style="background-image:url('${p.cover_photo_url}');cursor:pointer;"` : "";
  const coll = p.collection||"Botanical Reverie";
  const isHome = coll!=="Botanical Reverie";   // personal (Home or Laura) — kept off the business books
  const personalLabel = coll==="Laura" ? "Laura’s collection — personal" : "Michi’s collection — personal";
  const personalChip = coll==="Laura" ? "Laura" : "Michi";
  const houseName = p.house || p.unique_name || "—";
  const varieg = /varieg|albo|aurea|mint|thai constellation|variegata/i.test([p.cultivar,p.botanical_name,p.unique_name].filter(Boolean).join(' '));
  const idbits=[];
  if(p.common_name) idbits.push(`<div class="id-common"><span class="id-lbl">Common</span><span class="id-cname">${p.common_name}</span></div>`);
  if(p.botanical_name) idbits.push(`<div class="id-species"><span class="id-lbl">Species</span><i class="id-sname">${p.botanical_name}</i></div>`);
  const specs=[
    ["Date entered", p.date_entered],
    ["Acquired as", p.acquisition_type],
    ["Source", p.source_name],
    (isAdmin()&&p.acquisition_cost!=null)?["Cost", money(p.acquisition_cost)]:null,
    ["Zone", p.location_zone],
    ["Pot", p.pot_type],
    ["Soil", p.medium],
    (isAdmin()&&p.current_value!=null)?["Value", money(p.current_value)]:null,
  ].filter(s=>s && s[1]);
  $("plant-body").innerHTML = `
    <div style="display:flex;gap:8px;align-items:center;margin:6px 0 16px;"><button class="btn btn-sm" onclick="go('collection')">‹ Back</button><button class="btn btn-sm" onclick="editPlant()">Edit</button><span style="flex:1;"></span><button class="btn btn-sm" onclick="askDelete()" style="border-color:var(--garnet);color:var(--garnet-bright);">Delete</button></div>
    ${p.needs_id_review?renderResolve(p):''}
    <div class="ghero" ${coverBg} ${p.cover_photo_url?`onclick="openZoom('${p.cover_photo_url}')"`:''}>
      <div class="greg">Reverie Registry № BR-${pad(p.plant_no)}</div>
      ${p.cover_photo_url?'':'<div class="gglyph">❦</div>'}
      <div class="gcap">
        <div class="gname">${p.unique_name||p.common_name||"Unnamed"}</div>
        <div class="ghouse">${isHome?personalLabel:`House of ${houseName} &nbsp;·&nbsp; Generation ${roman(p.generation||1)}`}</div>
      </div>
    </div>
    ${idbits.length?`<div class="idline-c">${idbits.join('')}</div>`:''}
    <div class="chips-c">
      ${isHome?`<span class="chip">${personalChip}</span>`:''}
      <span class="chip g">${p.status||""}</span>
      ${varieg?'<span class="chip">Variegated</span>':''}
      ${(p.cultivar&&!varieg)?`<span class="chip">${p.cultivar}</span>`:''}
      ${p.location_zone?`<span class="chip">${p.location_zone}</span>`:''}
    </div>
    <div class="pp-story" style="text-align:center;max-width:54ch;margin:14px auto 0;">${storyLine(p)}</div>

    ${tendedSummary(care)?`<div class="section-t"><div class="label flank">Tended</div><div class="tended" style="margin-top:10px;text-align:center;">${tendedSummary(care)}</div></div>`:""}

    <div class="section-t">
      <div class="label flank">The Conservatory</div>
      <div class="roomnote" style="margin-top:10px;">${roomCareNote(p)}</div>
    </div>

    ${specs.length?`<div class="section-t"><div class="label flank">Registry</div>
      <div class="specs">${specs.map(s=>`<div class="r"><span class="k">${s[0]}</span><span class="v">${s[1]}</span></div>`).join('')}</div></div>`:''}

    <div class="section-t">
      <div class="label flank">Ask Linnaeus</div>
      <div style="margin-top:10px;display:flex;gap:8px;max-width:560px;margin-left:auto;margin-right:auto;">
        <input id="ai-q" placeholder="What does this plant need right now?" style="flex:1;" />
        <button type="button" class="btn btn-sm btn-gold" onclick="askPlant()">✦ Ask</button>
      </div>
      <div id="ai-ans" class="roomnote" style="display:none;margin:10px auto 0;max-width:560px;white-space:pre-wrap;"></div>
    </div>

    <div class="section-t">
      <div class="label flank">Photographs</div>
      <div style="margin-top:10px;text-align:center;"><button type="button" class="btn btn-sm" onclick="addPhoto()">+ Add photo</button></div>
      <div style="margin-top:12px;">${renderPhotoGrid(photos)}</div>
    </div>

    <div class="section-t">
      <div class="label flank">Care &amp; Health</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;justify-content:center;">
        ${["Watered","Fed","Repotted","Pruned","Treated","Rotated","Moved"].map(a=>`<button type="button" class="btn btn-sm" onclick="logCare('${a}')">${a}</button>`).join("")}
      </div>
      <div id="care-list" style="margin-top:14px;">${renderCareItems(care)}</div>
      <div style="margin-top:18px;text-align:center;"><button type="button" class="btn btn-sm" onclick="toggleConcern()">+ Log a concern</button></div>
      <div id="concern-form" style="display:none;margin:12px auto 0;background:#15140f;border:1px solid var(--line);border-radius:3px;padding:14px;max-width:560px;">
        <div style="margin-bottom:10px;text-align:center;"><button type="button" class="btn btn-sm btn-gold" onclick="diagnoseConcern()">✦ Diagnose from photo</button></div>
        <label class="field">Symptom<textarea id="h-symptom" rows="2" placeholder="e.g. yellowing lower leaves, webbing on new growth"></textarea></label>
        <div class="row2">
          <label class="field">Suspected cause<input id="h-cause" placeholder="e.g. overwatering, spider mites" /></label>
          <label class="field">Treatment applied<input id="h-treat" placeholder="e.g. neem, repot, isolate" /></label>
        </div>
        <label class="field">Follow-up date<input type="date" id="h-follow" /></label>
        <button type="button" class="btn btn-primary btn-sm" onclick="saveConcern()">Save concern</button>
      </div>
      <div style="margin-top:14px;">${renderHealthItems(health)}</div>
    </div>

    ${p.notes?`<div class="section-t"><div class="label flank">Notes</div><p class="muted" style="margin:10px auto 0;text-align:center;max-width:54ch;">${p.notes}</p></div>`:""}

    ${isHome?'':`<div class="section-t">
      <div class="label flank">Lineage — House of ${houseName}</div>
      <div style="margin-top:12px;text-align:center;">
        ${mother?`<div class="muted" style="font-size:13px;">Mother: <a href="#" onclick="openPlant('${mother.id}');return false;">${mother.unique_name||"Unnamed"}</a> (${lineageCode(mother)})</div>`:`<div class="muted" style="font-size:13px;">Founder of this House.</div>`}
        ${kids.length? `<div style="margin-top:10px;" class="grid">${kids.map(k=>`
          <div class="card" onclick="openPlant('${k.id}')"><div class="body">
            <div class="nm" style="font-size:17px;">${k.unique_name||"Unnamed"}</div>
            <div class="code">${lineageCode(k)}</div>
            <div class="meta"><span class="dot"></span>${k.status||""}</div>
          </div></div>`).join("")}</div>` : `<div class="muted" style="font-size:13px;margin-top:8px;">No propagations yet.</div>`}
      </div>
    </div>`}`;
}
function kv(k,v){ return v? `<div class="k">${k}</div><div>${v}</div>` : ""; }


/* ---------- Linnaeus AI (in-app, via Netlify function) ---------- */
async function aiToken(){ try{ const {data}=await sb.auth.getSession(); return data&&data.session? data.session.access_token : null; }catch(e){ return null; } }
function fileToB64(file){ return new Promise(res=>{ const r=new FileReader();
  r.onload=()=>{ const s=String(r.result||""); const m=/^data:(image\/[a-z0-9.+-]+);base64,(.*)$/i.exec(s);
    res(m?{media:m[1],b64:m[2]}:{media:file.type||"image/jpeg",b64:s.split(",").pop()}); };
  r.onerror=()=>res(null); r.readAsDataURL(file); }); }
async function askLinnaeus(payload){
  const tok=await aiToken();
  if(!tok) return {error:"Sign in to use Linnaeus."};
  try{
    const r=await fetch("/api/linnaeus",{method:"POST",
      headers:{"content-type":"application/json","authorization":"Bearer "+tok},
      body:JSON.stringify(payload)});
    const j=await r.json().catch(()=>null);
    if(!r.ok) return {error:((j&&j.error)||("Linnaeus error ("+r.status+")")) + (j&&j.status?(" ["+j.status+"]"):"") + (j&&j.detail?(" — "+j.detail):"")};
    return j;
  }catch(e){ return {error:"Couldn't reach Linnaeus (is the app deployed?)."}; }
}
/* ----- Linnaeus chat (floating sparkle button → in-app conversation, with photos) ----- */
let CHAT=[]; let chatWired=false; let chatImg=null;
function chatEscape(t){ return String(t).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
function chatMd(t){ let s=chatEscape(t);
  s=s.replace(/\*\*([^*]+)\*\*/g,"<b>$1</b>");
  s=s.replace(/(^|[^*])\*([^*\n]+)\*/g,"$1<i>$2</i>");
  return s.replace(/\n/g,"<br>"); }
function chatScroll(){ const log=$("chat-log"); if(log) log.scrollTop=log.scrollHeight; }
function chatBubble(role,text){ const log=$("chat-log"); const d=document.createElement("div");
  d.className="cmsg "+(role==="user"?"user":"bot"); d.innerHTML=text?chatMd(text):""; log.appendChild(d); chatScroll(); return d; }
function chatGreeting(){ $("chat-log").innerHTML='<div class="cmsg bot">Hello, Michi. I’m Linnaeus — your botanist on call. Ask me about any specimen, the grow room, quarantine, the soil mixes, even brand voice. Tap the camera to show me a photo. What do you need?</div>'; }
function showAttachPreview(){ const p=$("chat-attach-preview"); if(!p) return;
  if(!chatImg){ p.classList.add("hidden"); p.innerHTML=""; return; }
  p.classList.remove("hidden"); p.innerHTML='<img src="'+chatImg.url+'" alt=""><span class="x" onclick="clearChatImg()">Remove photo &times;</span>'; }
window.clearChatImg=function(){ chatImg=null; showAttachPreview(); };
function loadChat(){
  if(!chatWired){ chatWired=true;
    $("chat-send").onclick=sendChat;
    $("chat-input").addEventListener("keydown",function(e){ if(e.key==="Enter"){ e.preventDefault(); sendChat(); } });
    var bindPick=function(inp){ if(!inp) return; inp.onchange=async function(){ const f=this.files&&this.files[0]; this.value=""; if(!f) return;
        const img=await fileToB64(f); if(!img){ return; }
        chatImg={b64:img.b64,media:img.media,url:"data:"+img.media+";base64,"+img.b64}; showAttachPreview(); }; };
    bindPick($("chat-file")); bindPick($("chat-camera"));
  }
  if(!CHAT.length) chatGreeting();
  setTimeout(function(){ var i=$("chat-input"); if(i) i.focus(); },60);
}
async function sendChat(){
  const input=$("chat-input"); const text=(input.value||"").trim();
  if(!text && !chatImg) return;
  input.value="";
  if(!CHAT.length) $("chat-log").innerHTML="";
  const sentImg=chatImg; chatImg=null; showAttachPreview();
  CHAT.push({role:"user",content:text||"(photo)"});
  const ub=chatBubble("user",text);
  if(sentImg){ const im=document.createElement("img"); im.className="shot"; im.src=sentImg.url; ub.insertBefore(im, ub.firstChild); chatScroll(); }
  const thinking=chatBubble("bot","Linnaeus is thinking…"); thinking.style.opacity=".6";
  $("chat-send").disabled=true;
  const api=CHAT.slice(-24).map(function(m){ return {role:m.role,content:m.content}; });
  if(sentImg && api.length){ const last=api[api.length-1];
    last.content=[{type:"text",text:text||"Here's the photo."},{type:"image",source:{type:"base64",media_type:sentImg.media,data:sentImg.b64}}]; }
  const res=await askLinnaeus({mode:"chat", messages:api});
  $("chat-send").disabled=false; if(thinking&&thinking.remove) thinking.remove();
  if(res && res.text){ CHAT.push({role:"assistant",content:res.text}); chatBubble("bot",res.text); }
  else { chatBubble("bot",(res&&res.error)?res.error:"Something went wrong — try again."); }
  var i2=$("chat-input"); if(i2) i2.focus();
}
window.sendChat=sendChat;

function plantCtx(p){ p=p||{}; return {unique_name:p.unique_name,botanical_name:p.botanical_name,common_name:p.common_name,cultivar:p.cultivar,location_zone:p.location_zone,status:p.status,condition_at_intake:p.condition_at_intake,date_entered:p.date_entered}; }
async function linnaeusVerify(botanical, common, file){
  if(!file) return null;
  const img=await fileToB64(file); if(!img) return null;
  return await askLinnaeus({mode:"verify", botanical_name:botanical, common_name:common, image_b64:img.b64, media_type:img.media});
}

/* ----- AI identify: suggest species candidates from the photo, no typing needed ----- */
window.__lastIdentify=null; window.__newlyTypedName=null;
async function runIdentify(file){
  const box=$("f-id-suggest"); if(!file){ if(box) box.style.display="none"; return; }
  if(box){ box.style.display="block"; box.innerHTML='<span class="muted" style="font-size:12px;">✦ Linnaeus is identifying…</span>'; }
  const img=await fileToB64(file); if(!img){ if(box) box.style.display="none"; return; }
  const v=await askLinnaeus({mode:"identify", image_b64:img.b64, media_type:img.media});
  if(!v || v.error || !v.result || !Array.isArray(v.result.candidates) || !v.result.candidates.length){
    window.__lastIdentify=null;
    if(box) box.innerHTML='<span class="muted" style="font-size:12px;">'+((v&&v.error)?("Linnaeus: "+v.error):"Linnaeus couldn’t ID this one — pick from the list or type the name.")+'</span>';
    return;
  }
  window.__lastIdentify=v.result;
  addDraftSave();   // keep the AI ID with the draft so it survives an app-switch too
  renderIdCandidates(v.result);
}
function idChip(c, onclickAttr){
  return `<span class="chip pick" ${onclickAttr} data-bot="${escAttr(c.botanical||'')}" data-com="${escAttr(c.common||'')}">${c.botanical||'?'}${c.common?` — ${c.common}`:''}${c.confidence?` · ${c.confidence}`:''}</span>`;
}
function renderIdCandidates(res){
  const box=$("f-id-suggest"); if(!box) return;
  box.style.display="block";
  box.innerHTML='<div class="label" style="margin-bottom:8px;">✦ Linnaeus sees — tap to use</div>'+
    '<div class="chips">'+res.candidates.map(c=>idChip(c,'')).join('')+'</div>'+
    (res.note?`<div class="fnote" style="margin-top:8px;">${res.note}</div>`:'');
}
async function acceptCandidate(bot, com){
  if(!bot) return;
  if(!SPECIES.some(s=>(s.botanical_name||'').toLowerCase()===bot.toLowerCase())){
    try{ const {data}=await sb.from("species").insert({botanical_name:bot, common_name:com||null}).select().single();
      if(data){ SPECIES.push(data); SPECIES.sort((a,b)=>(a.botanical_name||'').localeCompare(b.botanical_name||'')); renderBotanical(); } }catch(e){}
  }
  ensureBotanical(bot); $("f-botanical").value=bot; onBotanical();
  if(com) $("f-common").value=com;
  window.__newlyTypedName=null;          // accepted from Linnaeus, not hand-typed
  $("f-addname").style.display="none";
  addDraftSave();
}
function computeIdFlag(bot){
  const idf=window.__lastIdentify;
  if(!idf || !Array.isArray(idf.candidates) || !idf.candidates.length) return true;   // no AI read → review
  const names=idf.candidates.map(c=>(c.botanical||'').toLowerCase());
  if(names.indexOf((bot||'').toLowerCase())<0) return true;                            // chosen differs from Linnaeus → review
  if(window.__newlyTypedName && window.__newlyTypedName.toLowerCase()===(bot||'').toLowerCase()) return true; // hand-typed → review
  return false;
}

/* ----- Resolve a flagged plant (the "needs attention" fix flow) ----- */
function renderResolve(p){
  const cands=(p.ai_suggestion && Array.isArray(p.ai_suggestion.candidates))? p.ai_suggestion.candidates : [];
  return '<div class="section-t"><div class="roomnote" style="border-left-color:var(--garnet);">'
    +'<div class="label" style="color:var(--garnet-bright);margin-bottom:8px;">✦ Needs ID — Linnaeus flagged this</div>'
    +(cands.length? '<div style="font-size:12px;margin-bottom:6px;">Tap the right one:</div><div class="chips">'
        +cands.map(c=>idChip(c,`onclick="resolveId('${p.id}', this.getAttribute('data-bot'), this.getAttribute('data-com'))"`)).join('')+'</div>'
      : '<div class="fnote">No stored suggestion — re-identify from the photo.</div>')
    +'<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;">'
    +'<button type="button" class="btn btn-sm btn-gold" onclick="reIdentifyPlant(\''+p.id+'\')">✦ Re-identify from photo</button>'
    +'<button type="button" class="btn btn-sm" onclick="clearIdFlag(\''+p.id+'\')">Name is correct</button>'
    +'</div><div id="reid-out" style="margin-top:8px;"></div></div></div>';
}
window.resolveId=async function(id,bot,com){
  if(!bot) return;
  try{
    if(!SPECIES.length){ const {data}=await sb.from("species").select("id,botanical_name,common_name,recommended_medium,cultivar").order("botanical_name"); SPECIES=data||[]; }
    if(!SPECIES.some(s=>(s.botanical_name||'').toLowerCase()===bot.toLowerCase())){ try{ await sb.from("species").insert({botanical_name:bot, common_name:com||null}); }catch(e){} }
    await sb.from("plant").update({botanical_name:bot, common_name:com||null, needs_id_review:false}).eq("id",id);
    toast("Updated to "+bot+".");
    await fetchPlants(); openPlant(id);
  }catch(e){ toast("Couldn't update: "+e.message); }
};
window.clearIdFlag=async function(id){ try{ await sb.from("plant").update({needs_id_review:false}).eq("id",id); toast("Marked correct."); await fetchPlants(); openPlant(id); }catch(e){ toast("Couldn't update."); } };
window.reIdentifyPlant=async function(id){
  const out=$("reid-out"); if(out) out.innerHTML='<span class="muted" style="font-size:12px;">✦ Linnaeus is looking…</span>';
  const p=window.CURRENT_PLANT||{};
  const v=await askLinnaeus({mode:"identify", image_url:p.cover_photo_url});
  if(!v||v.error||!v.result||!(v.result.candidates||[]).length){ if(out) out.innerHTML='<span class="muted" style="font-size:12px;">'+((v&&v.error)?("Linnaeus: "+v.error):"Couldn’t ID — try a clearer photo.")+'</span>'; return; }
  if(out) out.innerHTML='<div class="chips">'+v.result.candidates.map(c=>idChip(c,`onclick="resolveId('${id}', this.getAttribute('data-bot'), this.getAttribute('data-com'))"`)).join('')+'</div>'+(v.result.note?`<div class="fnote" style="margin-top:6px;">${v.result.note}</div>`:'');
};

/* ----- Photo survives leaving the app: stash the File in IndexedDB so switching to another
        app to look something up can never wipe it (localStorage can't hold a File) ----- */
const IDB_NAME="br_add", IDB_STORE="photo", IDB_KEY="add-photo";
function idbOpen(){ return new Promise((res,rej)=>{ let r; try{ r=indexedDB.open(IDB_NAME,1); }catch(e){ return rej(e); }
  r.onupgradeneeded=()=>{ try{ r.result.createObjectStore(IDB_STORE); }catch(e){} };
  r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); }
async function idbPutPhoto(file){ try{ const db=await idbOpen(); return await new Promise((res,rej)=>{ const tx=db.transaction(IDB_STORE,"readwrite"); tx.objectStore(IDB_STORE).put(file,IDB_KEY); tx.oncomplete=()=>res(true); tx.onerror=()=>rej(tx.error); }); }catch(e){ return false; } }
async function idbGetPhoto(){ try{ const db=await idbOpen(); return await new Promise((res)=>{ const tx=db.transaction(IDB_STORE,"readonly"); const rq=tx.objectStore(IDB_STORE).get(IDB_KEY); rq.onsuccess=()=>res(rq.result||null); rq.onerror=()=>res(null); }); }catch(e){ return null; } }
async function idbDelPhoto(){ try{ const db=await idbOpen(); return await new Promise((res)=>{ const tx=db.transaction(IDB_STORE,"readwrite"); tx.objectStore(IDB_STORE).delete(IDB_KEY); tx.oncomplete=()=>res(true); tx.onerror=()=>res(false); }); }catch(e){ return false; } }

/* ----- Never lose an in-progress Add (autosave the draft) ----- */
function addDraftSave(){
  const f=$("add-form"); if(!f) return;
  const d={};
  f.querySelectorAll("input,select,textarea").forEach(el=>{ if(el.type==="file"||!el.id) return; d[el.id]=el.value; });
  d.__cond=[...condSel];
  d.__identify=window.__lastIdentify||null;
  d.__hasPhoto=!!addPhotoFile;
  if(d["f-acqtype"]||d["f-name"]||d["f-botanical"]||addPhotoFile){ try{ localStorage.setItem("br_add_draft", JSON.stringify(d)); }catch(e){} }
}
function addDraftClear(){ try{ localStorage.removeItem("br_add_draft"); }catch(e){} idbDelPhoto(); }
function hasAddDraft(){ try{ return !!localStorage.getItem("br_add_draft"); }catch(e){ return false; } }
async function addDraftRestore(){
  let d; try{ d=JSON.parse(localStorage.getItem("br_add_draft")||"null"); }catch(e){ d=null; }
  if(!d) return false;
  if(d["f-botanical"]) ensureBotanical(d["f-botanical"]);
  Object.keys(d).forEach(k=>{ if(k.indexOf("__")===0) return; const el=$(k); if(el) el.value=d[k]; });
  applyAcq(d["f-acqtype"]||"");
  if(/^Rack/.test(d["f-zone"]||"")) $("f-shelf-wrap").style.display="block";
  if(d["f-zone"]==="Other") $("f-zone-other").style.display="block";
  if(d["f-pot"]==="Other") $("f-pot-other").style.display="block";
  condSel=new Set(d.__cond||[]);
  [...$("f-cond-chips").children].forEach(c=>{ if(condSel.has(c.dataset.c)) c.classList.add("on"); });
  if(condSel.has("Other")) $("f-cond-other").style.display="block";
  if(d["f-botanical"]) onBotanical();
  { const fc=$("f-collection"), n=$("f-collection-note"); if(fc&&n) n.style.display = (fc.value&&fc.value!=="Botanical Reverie")?"block":"none"; }
  if(d.__identify) window.__lastIdentify=d.__identify;
  // bring the photo back from IndexedDB — this is what was getting lost on an app-switch
  let photoBack=false;
  if(d.__hasPhoto){
    try{
      const file=await idbGetPhoto();
      if(file){ addPhotoFile=file; photoBack=true;
        const img=$("f-photo-preview"), pr=$("f-photo-prompt");
        if(img){ img.src=URL.createObjectURL(file); img.style.display="block"; }
        if(pr) pr.style.display="none";
        const pz=$("f-photo-zone"); if(pz) pz.classList.remove("bad");
      }
    }catch(e){}
  }
  const note=$("add-msg");
  if(note){ note.style.color="var(--gold)";
    note.textContent = photoBack ? "Draft restored — your photo’s still here. Finish and save."
                                 : "Draft restored — re-add the photo to finish."; }
  return true;
}
window.askPlant=async function(){
  const q=($("ai-q").value||"").trim()||"What does this plant need right now?";
  const ans=$("ai-ans"); ans.style.display="block"; ans.textContent="Linnaeus is thinking…";
  const p=window.CURRENT_PLANT||{};
  const v=await askLinnaeus({mode:"advise", plant:plantCtx(p), question:q, image_url:p.cover_photo_url||undefined});
  ans.textContent=(v&&v.text)?v.text:(v&&v.error?("Linnaeus: "+v.error):"No answer.");
};
window.diagnoseConcern=function(){
  const inp=document.createElement("input"); inp.type="file"; inp.accept="image/*";
  inp.onchange=async e=>{ const f=e.target.files&&e.target.files[0]; if(!f) return;
    const q=await checkPhotoQuality(f); if(!q.ok){ toast("Photo bounced — "+q.issues.join("; ")); return; }
    toast("Linnaeus is looking…");
    const img=await fileToB64(f); if(!img){ toast("Couldn't read photo."); return; }
    const v=await askLinnaeus({mode:"diagnose", plant:plantCtx(window.CURRENT_PLANT), symptom:val("h-symptom"), image_b64:img.b64, media_type:img.media});
    if(!v||v.error||!v.result){ toast(v&&v.error?("Linnaeus: "+v.error):"Couldn't reach Linnaeus."); return; }
    const r=v.result;
    if(!val("h-symptom") && r.symptom) $("h-symptom").value=r.symptom;
    if(r.likely_cause) $("h-cause").value=r.likely_cause;
    if(r.treatment) $("h-treat").value=r.treatment;
    toast("Linnaeus: "+(r.severity||"reviewed")+" — review & save.");
  };
  inp.click();
};
window.todayBrief=async function(){
  const ans=$("ai-today"); ans.style.display="block"; ans.textContent="Linnaeus is reviewing…";
  const v=await askLinnaeus({mode:"today", summary: window.__todaySummary||"No data."});
  ans.textContent=(v&&v.text)?v.text:(v&&v.error?("Linnaeus: "+v.error):"No answer.");
};


/* ---------- ADMIN (people, access, daily report) ---------- */
async function loadAdmin(){
  const body=$("admin-body");
  if(!isAdmin()){ body.innerHTML='<div class="empty"><div class="big">Admins only.</div><div>Ask Michi for access.</div></div>'; return; }
  const today=new Date().toISOString().slice(0,10);
  body.innerHTML = `
    <div class="section-t"><div class="label flank" style="justify-content:flex-start;">You</div>
      <div class="row2" style="margin-top:10px;">
        <label class="field">Your display name<input id="ad-name" value="${escAttr(window.ME||'')}" placeholder="e.g. Michi" /></label>
        <label class="field">Login email<input value="${escAttr(window.MY_EMAIL||'')}" readonly /></label>
      </div>
      <button type="button" class="btn btn-primary btn-sm" onclick="saveMyName()">Save name</button>
      <span id="ad-name-msg" class="fnote" style="margin-left:10px;"></span>
    </div>
    <div class="section-t"><div class="label flank" style="justify-content:flex-start;">People &amp; access</div>
      <div class="fnote" style="margin-top:8px;">Send a secure reset link to any teammate's email. New teammate: have them tap "New here? Create your account" on the login (their email + a password), then they set their display name here once.</div>
      <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;">
        <input id="ad-reset-email" placeholder="teammate@email.com" style="flex:1;min-width:180px;" />
        <button type="button" class="btn btn-sm btn-gold" onclick="sendReset()">Send reset link</button>
      </div>
      <div id="ad-reset-msg" class="fnote" style="margin-top:8px;"></div>
    </div>
    <div class="section-t"><div class="label flank" style="justify-content:flex-start;">Daily report</div>
      <div style="margin-top:10px;"><input type="date" id="ad-day" value="${today}" onchange="renderReport(this.value)" style="width:auto;" /></div>
      <div id="ad-report" style="margin-top:12px;"><span class="muted">Loading…</span></div>
    </div>`;
  renderReport(today);
}
window.saveMyName=async function(){
  const name=($("ad-name").value||"").trim(), m=$("ad-name-msg");
  if(!name){ m.className="fnote warn"; m.textContent="Enter a name."; return; }
  const {error}=await sb.auth.updateUser({data:{full_name:name}});
  if(error){ m.className="fnote warn"; m.textContent=error.message; return; }
  window.ME=name; $("who-name").textContent=name; m.className="fnote"; m.textContent="Saved — you're “"+name+"” now.";
};
window.sendReset=async function(){
  const email=($("ad-reset-email").value||"").trim(), m=$("ad-reset-msg");
  if(!email){ m.className="fnote warn"; m.textContent="Enter an email."; return; }
  const {error}=await sb.auth.resetPasswordForEmail(email);
  if(error){ m.className="fnote warn"; m.textContent=error.message; return; }
  m.className="fnote"; m.textContent="Reset link sent to "+email+".";
};
window.renderReport=async function(day){
  const out=$("ad-report"); out.innerHTML='<span class="muted">Loading…</span>';
  const start=day+"T00:00:00", end=day+"T23:59:59.999";
  let added=[],care=[],health=[],needsId=[];
  try{ const r=await sb.from("plant").select("id,unique_name,common_name,botanical_name,source_name,acquisition_type").eq("date_entered",day); added=r.data||[]; }catch(e){}
  try{ const r=await sb.from("care_log").select("action,done_by_name,done_at,plant_id,plant(unique_name)").gte("done_at",start).lte("done_at",end).order("done_at",{ascending:false}); care=r.data||[]; }catch(e){}
  try{ const r=await sb.from("health_log").select("symptom,created_at,plant_id,plant(unique_name)").gte("created_at",start).lte("created_at",end); health=r.data||[]; }catch(e){}
  try{ const r=await sb.from("plant").select("id,unique_name,common_name,botanical_name").eq("needs_id_review",true).limit(50); needsId=r.data||[]; }catch(e){}
  const vendors=[...new Set(added.map(p=>p.source_name).filter(Boolean))];
  const row=(id,left,right)=>`<div ${id?`onclick="openPlant('${id}')"`:''} style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--line);padding:8px 0;font-size:13.5px;gap:10px;${id?'cursor:pointer;':''}"><span>${left}</span><span class="muted" style="font-size:11px;white-space:nowrap;">${right||''}</span></div>`;
  const sect=(t,items)=>`<div style="margin-top:16px;"><div class="label" style="color:var(--gold);">${t} (${items.length})</div>${items.length?items.join(''):'<div class="muted" style="font-size:13px;margin-top:4px;">—</div>'}</div>`;
  const nm=p=>p&&(p.unique_name||p.common_name)||'Unnamed';
  out.innerHTML =
    sect('Added', added.map(p=>row(p.id, nm(p), (p.botanical_name||'')+(p.acquisition_type?' · '+p.acquisition_type:''))))
   +sect('Care logged', care.map(c=>row(c.plant_id, `<span class="muted">${c.done_by_name||'Someone'}</span> ${String(c.action).toLowerCase()} <span style="font-family:'Cormorant Garamond',serif;font-style:italic;">${c.plant?c.plant.unique_name||'a plant':'a plant'}</span>`, shortWhen(c.done_at))))
   +sect('Concerns flagged', health.map(h=>row(h.plant_id, `⚠ ${h.symptom||'Concern'} — ${h.plant?h.plant.unique_name||'a plant':'a plant'}`, '')))
   +sect('New vendors', vendors.map(v=>row(null, v, 'new')))
   +sect('Needs ID (open)', needsId.map(p=>row(p.id, nm(p), (p.botanical_name||'no species')+' · fix')));
};

/* ---------- QUICK BENCH ADD (rapid: snap → name → save → next) ---------- */
const NAMES = ["Seraphine","Genevieve","Ophelia","Beatrix","Vivienne","Cordelia","Persephone","Delphine","Marguerite","Isadora","Hesper","Cleo","Augustine","Rosalind","Imogen","Celeste","Aurelia","Lucia","Sabine","Theodora","Wilhelmina","Eloise","Florence","Clementine","Honora","Lavinia","Octavia","Philippa","Rosamund","Tabitha","Winifred","Anneliese","Cosima","Maren","Verena","Sylvie","Colette","Josephine","Mireille","Ottoline",
"Hazel","Juniper","Ivy","Magnolia","Camellia","Dahlia","Briar","Laurel","Wren","Saffron","Sienna","Opal","Pearl","Maris","Fern","Linden","Rowan","Marigold","Iris","Flora",
"Lady in Garnet","Garnet Vespers","Carmine","Bordeaux","Cinder Rose","Velvet Garnet","Last Ember","Ember","The Oxblood Hour","The Red Hour",
"Evenfall","Vesper","Duskbloom","Gilded Hour","Emberglow","Hushed Gold","Lantern","Nightfall","Goldenhour","Twilight Vesper","The Quiet Glow",
"Chiaroscuro","Patina","Still Life","Verdigris","Old Master","Reverie","The Gilded Frame","Candle & Leaf","The Dutch Hour",
"Fenestra","Foliata","Velour","Seraph Wing","The Velvet Vein","The Cathedral Leaf"];
const QSTATUS = ["In Collection","Quarantine","Mother Plant","Propagating","Ready to Sell","Listed"];
let qPhoto=null, qIdentify=null, qCount=0, qWired=false;

function usedNames(){ const s=new Set(); (CACHE||[]).forEach(p=>{ if(p.unique_name) s.add(p.unique_name.toLowerCase()); }); return s; }
function suggestQuickName(){
  const used=usedNames();
  const pool=NAMES.filter(n=>!used.has(n.toLowerCase()));
  const src=pool.length?pool:NAMES;
  const pick=src[Math.floor(((qCount*7+ (src.length))%src.length))] || src[0];
  // rotate deterministically-ish without Math.random (blocked): walk by a shifting index
  let i=(qCount*13+ (Date.now? 0:0)) % src.length;  // qCount-based shuffle
  const inp=$("q-name"); if(inp) inp.value = src[i] || pick;
}
function fillSpeciesSelect(id){
  const s=$(id); if(!s) return;
  s.innerHTML = '<option value="">— Linnaeus will fill, or pick —</option>' + SPECIES.map(x=>`<option value="${escAttr(x.botanical_name)}">${x.botanical_name}</option>`).join('');
}
function qEnsureSpecies(bot){ const s=$("q-botanical"); if(!s||!bot) return; if(![...s.options].some(o=>o.value===bot)) s.add(new Option(bot,bot)); s.value=bot; }
async function loadQuick(){
  const b=$("quick-body"); if(!b) return;
  await loadCatalog();
  const plants = CACHE.length? CACHE : await fetchPlants();
  b.innerHTML = `
    <div id="q-photo-zone" style="border:1px dashed var(--line);border-radius:4px;min-height:150px;display:flex;align-items:center;justify-content:center;cursor:pointer;background:#0d0d0d;overflow:hidden;margin:6px 0 10px;text-align:center;">
      <div id="q-photo-prompt" style="color:var(--muted);font-size:13px;padding:30px;line-height:1.6;">＋ Tap to snap the plant<br><span style="font-size:11px;">Linnaeus names it for you</span></div>
      <img id="q-photo-preview" alt="" style="display:none;width:100%;max-height:300px;object-fit:cover;" />
    </div>
    <input type="file" id="q-photo-input" accept="image/*" style="display:none;" />
    <div id="q-id" class="fnote" style="display:none;margin-bottom:10px;"></div>
    <label class="field">Species<select id="q-botanical"></select></label>
    <div class="row2">
      <label class="field">Name<input id="q-name" placeholder="pet name" /></label>
      <label class="field">Status<select id="q-status">${QSTATUS.map(s=>`<option>${s}</option>`).join('')}</select></label>
    </div>
    <div style="margin:-6px 0 12px;"><a id="q-shuffle" class="fnote" style="cursor:pointer;color:var(--gold);border-bottom:1px solid var(--line);">🎲 another name</a></div>
    <div class="row2">
      <label class="field">Shelf / zone<select id="q-zone"></select></label>
      <label class="field" id="q-shelf-wrap" style="display:none;">Shelf<select id="q-shelf"></select></label>
    </div>
    <div style="display:flex;gap:12px;align-items:center;margin-top:6px;">
      <button type="button" class="btn btn-primary" onclick="saveQuick()">Save &amp; next ›</button>
      <span class="muted" id="q-count" style="font-size:13px;">Added this session: ${qCount}</span>
    </div>
    <div id="q-msg" class="auth-msg muted" style="margin-top:8px;"></div>
    <div style="margin-top:16px;"><a class="fnote" onclick="go('add')" style="cursor:pointer;">‹ Switch to the full Add form</a></div>`;
  fillSpeciesSelect("q-botanical");
  fillSelect("q-zone", ZONES, "— Select a zone —");
  fillSelect("q-shelf", SHELVES, "— Select a shelf —");
  qPhoto=null; qIdentify=null;
  suggestQuickName();
  if(!qWired){ wireQuick(); qWired=true; }
}
function wireQuick(){
  $("q-photo-zone").addEventListener("click", ()=> $("q-photo-input").click());
  $("q-photo-input").addEventListener("change", async e=>{
    const f=e.target.files&&e.target.files[0]; if(!f) return;
    const q=await checkPhotoQuality(f);
    if(!q.ok){ toast("Photo bounced — "+q.issues.join("; ")); return; }
    qPhoto=f; const img=$("q-photo-preview"), pr=$("q-photo-prompt");
    img.src=URL.createObjectURL(f); img.style.display="block"; pr.style.display="none";
    runQuickIdentify(f);
  });
  $("q-id").addEventListener("click", async e=>{
    const c=e.target.closest(".chip"); if(!c) return;
    await qAccept(c.dataset.bot, c.dataset.com);
  });
  $("q-shuffle").addEventListener("click", ()=>{ qCount++; suggestQuickName(); qCount--; });
  $("q-zone").addEventListener("change", ()=>{ $("q-shelf-wrap").style.display = /^Rack/.test($("q-zone").value)?"block":"none"; });
  $("q-status").addEventListener("change", ()=>{ if($("q-status").value==="Quarantine"){} });
}
async function runQuickIdentify(file){
  const box=$("q-id"); box.style.display="block"; box.className="fnote"; box.textContent="✦ Linnaeus is identifying…";
  const img=await fileToB64(file); if(!img){ box.style.display="none"; return; }
  const v=await askLinnaeus({mode:"identify", image_b64:img.b64, media_type:img.media});
  if(!v||v.error||!v.result||!Array.isArray(v.result.candidates)||!v.result.candidates.length){
    qIdentify=null; box.className="fnote"; box.innerHTML=(v&&v.error)?("Linnaeus: "+v.error):"Couldn’t ID — pick the species, or just Save (it'll land in Needs-ID).";
    return;
  }
  qIdentify=v.result;
  box.className="fnote";
  box.innerHTML='<div class="label" style="margin-bottom:6px;">✦ Tap the match</div><div class="chips">'+v.result.candidates.map(c=>`<span class="chip pick" data-bot="${escAttr(c.botanical||'')}" data-com="${escAttr(c.common||'')}">${c.botanical||'?'}${c.common?` — ${c.common}`:''}${c.confidence?` · ${c.confidence}`:''}</span>`).join('')+'</div>';
  // auto-select the top candidate so a quick Save just works
  const top=v.result.candidates[0]; if(top) await qAccept(top.botanical, top.common);
}
async function qAccept(bot, com){
  if(!bot) return;
  if(!SPECIES.some(s=>(s.botanical_name||'').toLowerCase()===bot.toLowerCase())){
    try{ const {data}=await sb.from("species").insert({botanical_name:bot, common_name:com||null}).select().single(); if(data) SPECIES.push(data); fillSpeciesSelect("q-botanical"); }catch(e){}
  }
  qEnsureSpecies(bot);
}
window.saveQuick=async function(){
  const m=$("q-msg"); m.style.color=""; m.textContent="";
  const name=($("q-name").value||"").trim();
  const bot=$("q-botanical").value;
  const zone=$("q-zone").value;
  if(!qPhoto){ m.style.color="var(--garnet-bright)"; m.textContent="Snap a photo first."; return; }
  if(!name){ m.style.color="var(--garnet-bright)"; m.textContent="Give it a name (tap 🎲 for one)."; return; }
  if(!zone){ m.style.color="var(--garnet-bright)"; m.textContent="Pick a shelf/zone."; return; }
  if(/^Rack/.test(zone) && !$("q-shelf").value){ m.style.color="var(--garnet-bright)"; m.textContent="Pick the shelf."; return; }
  m.textContent="Saving…";
  let loc = /^Rack/.test(zone) ? zone+" · "+$("q-shelf").value : zone;
  const sp = SPECIES.find(s=>s.botanical_name===bot);
  const rec={
    unique_name:name, status:$("q-status").value,
    botanical_name: bot||null, common_name: sp?sp.common_name:null,
    location_zone: loc, date_entered: new Date().toISOString().slice(0,10),
  };
  const {data,error}=await sb.from("plant").insert(rec).select().single();
  if(error){ m.style.color="var(--garnet-bright)"; m.textContent=error.message; return; }
  // upload photo + cover
  try{
    const ext=(qPhoto.name.split(".").pop()||"jpg").toLowerCase().replace(/[^a-z0-9]/g,"")||"jpg";
    const path=data.id+"/"+Date.now()+"."+ext;
    const up=await sb.storage.from("plant-photos").upload(path, qPhoto, {upsert:false, contentType:qPhoto.type||"image/jpeg"});
    if(!up.error){ const url=sb.storage.from("plant-photos").getPublicUrl(path).data.publicUrl;
      await sb.from("photo").insert({plant_id:data.id, image_url:url});
      await sb.from("plant").update({cover_photo_url:url}).eq("id",data.id); }
  }catch(e){}
  // needs-ID flag (no match / no AI → review)
  try{
    let flag=true;
    if(qIdentify && Array.isArray(qIdentify.candidates)){
      const names=qIdentify.candidates.map(c=>(c.botanical||'').toLowerCase());
      flag = names.indexOf((bot||'').toLowerCase())<0;
    }
    if(!bot) flag=true;
    await sb.from("plant").update({needs_id_review:flag, ai_suggestion:qIdentify||null}).eq("id",data.id);
  }catch(e){}
  await fetchPlants();
  qCount++; qIdentify=null; qPhoto=null;
  // reset photo + species + name; KEEP zone/shelf/status so you fly down a shelf
  $("q-photo-preview").style.display="none"; $("q-photo-prompt").style.display="block";
  $("q-id").style.display="none"; $("q-id").innerHTML="";
  $("q-botanical").value="";
  suggestQuickName();
  $("q-count").textContent="Added this session: "+qCount;
  m.style.color="var(--gold)"; m.textContent="Saved “"+name+"”. Snap the next.";
};

/* ---------- PWA service worker (registers on https) ---------- */
if ("serviceWorker" in navigator && location.protocol === "https:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch(()=>{});
  });
}


/* ---------- Show/Hide password toggle (accessibility) ---------- */
(function(){
  function addEye(){
    var p = document.getElementById("au-pass");
    if(!p || document.getElementById("au-eye")) return;
    p.style.marginTop = "0";
    p.style.paddingRight = "74px";
    var wrap = document.createElement("div");
    wrap.style.position = "relative";
    wrap.style.marginTop = "6px";
    p.parentNode.insertBefore(wrap, p);
    wrap.appendChild(p);
    var b = document.createElement("button");
    b.type = "button"; b.id = "au-eye"; b.textContent = "Show";
    b.setAttribute("aria-label", "Show password");
    b.style.cssText = "position:absolute;right:5px;top:5px;bottom:5px;background:rgba(184,151,90,.12);"
      + "border:1px solid var(--line);color:var(--gold);font-size:12px;letter-spacing:.12em;"
      + "text-transform:uppercase;padding:0 14px;cursor:pointer;border-radius:2px;";
    b.onclick = function(){
      var show = p.type === "password";
      p.type = show ? "text" : "password";
      b.textContent = show ? "Hide" : "Show";
      b.setAttribute("aria-label", show ? "Hide password" : "Show password");
    };
    wrap.appendChild(b);
  }
  document.addEventListener("DOMContentLoaded", addEye);
  addEye();
})();


/* ---------- Smart intake: species dropdown + auto-fill + soil recipes ---------- */
const SOILS = {
  "House Mix":"3 parts orchid bark · 2 parts pumice/perlite · 1 part buffered coco coir · 1 part horticultural charcoal · 1 part worm castings.",
  "Velvet & Anthurium Mix":"House Mix made airier — more orchid bark + a handful of long-fiber sphagnum. Near pure bark & moss for thin-rooted velvets.",
  "Alocasia Mix":"House Mix + ½ part extra coco coir for steady moisture (never soggy). Keep airflow strong; mite-prone.",
  "Hoya / Epiphyte Mix":"Chunkier & faster-draining — more bark/perlite, less coir, skip the worm castings. They rot if kept damp.",
  "Semi-Hydro — LECA":"Inert clay pebbles in net pots; weak constant feed in the reservoir (~⅛–¼ tsp/gal), refreshed weekly.",
  "Semi-Hydro — Lechuza Pon":"Pumice/zeolite/lava blend, lightly pre-charged. Reservoir feeding; great for high-value specimens & imports."
};
let SPECIES = [];
async function loadCatalog(){
  const msel=$("f-medium"), anm=$("an-medium");
  if(msel && msel.options.length<=1){ Object.keys(SOILS).forEach(k=> msel.appendChild(new Option(k,k))); }
  if(anm && anm.options.length<=1){ Object.keys(SOILS).forEach(k=> anm.appendChild(new Option(k,k))); }
  if(!SPECIES.length){
    const {data} = await sb.from("species").select("id,botanical_name,common_name,recommended_medium,cultivar").order("botanical_name");
    SPECIES = data||[];
  }
  renderBotanical();
  fillCultivars();
}
function renderBotanical(){
  const b=$("f-botanical"); if(!b) return;
  b.innerHTML = `<option value="">— Select a botanical name —</option>` +
    SPECIES.map(s=>`<option value="${escAttr(s.botanical_name)}">${s.botanical_name}</option>`).join("") +
    `<option value="__add__">＋ Can't find it? Add a name…</option>`;
}
function showRecipe(k){
  const rec=$("f-recipe"); if(!rec) return;
  if(k && SOILS[k]){ rec.style.display="block";
    rec.innerHTML='<span style="color:var(--gold);font-size:10px;letter-spacing:.14em;text-transform:uppercase;display:block;margin-bottom:5px;">'+k+'</span>'+SOILS[k];
  } else rec.style.display="none";
}
function onBotanical(){
  const b=$("f-botanical");
  if(b.value==="__add__"){ $("f-addname").style.display="block"; $("f-common").value=""; return; }
  $("f-addname").style.display="none";
  const s=SPECIES.find(x=>x.botanical_name===b.value);
  if(!s){ $("f-common").value=""; return; }
  $("f-common").value=s.common_name||"";
  if(s.recommended_medium){ $("f-medium").value=s.recommended_medium; showRecipe(s.recommended_medium); }
}


/* ---------- Care logging (two-tap) ---------- */
function renderCareItems(care){
  if(!care || !care.length) return '<div class="muted" style="font-size:13px;">No care logged yet. Tap an action above.</div>';
  return care.map(function(c){
    var when = c.done_at ? new Date(c.done_at).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}) : '';
    return '<div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--line);padding:8px 0;font-size:13px;">'
      + '<span><span class="dot"></span> ' + c.action + (c.done_by_name? ' · <span class="muted">'+c.done_by_name+'</span>' : '') + '</span>'
      + '<span class="muted" style="font-size:11px;letter-spacing:.04em;">' + when + '</span></div>';
  }).join("");
}
window.logCare = async function(action){
  if(!currentPlantId) return;
  var rec = { plant_id: currentPlantId, action: action, done_by_name: (window.ME||null) };
  var res = await sb.from("care_log").insert(rec);
  if(res.error){ toast("Couldn't log: "+res.error.message); return; }
  toast(action + " logged.");
  openPlant(currentPlantId);
};


/* ---------- Photos (snap / upload → timeline) ---------- */
function renderPhotoGrid(photos){
  if(!photos || !photos.length) return '<div class="muted" style="font-size:13px;">No photos yet. Tap “Add photo”.</div>';
  return '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:8px;">' +
    photos.map(function(ph){
      return '<div onclick="openZoom(\''+ph.image_url+'\')" style="aspect-ratio:1;border:1px solid var(--line);border-radius:2px;cursor:pointer;background:#0d0d0d center/cover no-repeat;background-image:url(\''+ph.image_url+'\');"></div>';
    }).join("") + '</div>';
}
/* ----- Tap-to-zoom lightbox (pinch is disabled app-wide, so this gives magnification) ----- */
window.openZoom=function(url){
  if(!url) return;
  var box=$("zoombox"), img=$("zoom-img"); if(!box||!img) return;
  wireZoom();
  img.src=url; if(window.__zoomReset) window.__zoomReset();
  box.classList.remove("hidden");
};
window.closeZoom=function(){ var b=$("zoombox"); if(b) b.classList.add("hidden"); };
window.closeZoomBg=function(e){ if(e.target && e.target.id==="zoombox") window.closeZoom(); };
function wireZoom(){
  var box=$("zoombox"), img=$("zoom-img"); if(!box||box.__wired) return; box.__wired=true;
  var st={scale:1,tx:0,ty:0}, start=null, moved=0;
  function apply(){ img.style.transform="translate("+st.tx+"px,"+st.ty+"px) scale("+st.scale+")"; img.classList.toggle("zoomed", st.scale>1); }
  window.__zoomReset=function(){ st={scale:1,tx:0,ty:0}; apply(); };
  img.addEventListener("pointerdown",function(e){ start={x:e.clientX,y:e.clientY,tx:st.tx,ty:st.ty}; moved=0; try{img.setPointerCapture(e.pointerId);}catch(_){} });
  img.addEventListener("pointermove",function(e){ if(!start) return; var dx=e.clientX-start.x, dy=e.clientY-start.y; moved=Math.max(moved,Math.abs(dx)+Math.abs(dy)); if(st.scale>1){ st.tx=start.tx+dx; st.ty=start.ty+dy; apply(); } });
  function up(){ if(!start) return; var tap=moved<10; start=null; if(tap){ if(st.scale>1){ st.scale=1; st.tx=0; st.ty=0; } else { st.scale=2.5; } apply(); } }
  img.addEventListener("pointerup",up); img.addEventListener("pointercancel",function(){ start=null; });
}
window.addPhoto = function(){
  if(!currentPlantId) return;
  var inp = document.getElementById("photo-input");
  if(!inp){
    inp = document.createElement("input");
    inp.type = "file"; inp.accept = "image/*";
    inp.id = "photo-input"; inp.style.display = "none";
    document.body.appendChild(inp);
    inp.addEventListener("change", handlePhoto);
  }
  inp.value = "";
  inp.click();
};
async function handlePhoto(e){
  var file = e.target.files && e.target.files[0];
  if(!file) return;
  var q = await checkPhotoQuality(file);
  if(!q.ok){ toast("Photo bounced — "+q.issues.join("; ")+". Retake."); return; }
  toast("Uploading photo…");
  var ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g,"") || "jpg";
  var path = currentPlantId + "/" + Date.now() + "." + ext;
  var up = await sb.storage.from("plant-photos").upload(path, file, { upsert:false, contentType: file.type || "image/jpeg" });
  if(up.error){ toast("Upload failed: " + up.error.message); return; }
  var url = sb.storage.from("plant-photos").getPublicUrl(path).data.publicUrl;
  await sb.from("photo").insert({ plant_id: currentPlantId, image_url: url });
  var pl = CACHE.find(function(x){ return x.id === currentPlantId; });
  if(pl && !pl.cover_photo_url){ await sb.from("plant").update({ cover_photo_url: url }).eq("id", currentPlantId); }
  await fetchPlants();
  toast("Photo added.");
  openPlant(currentPlantId);
}


/* ---------- Sick log (health concerns) ---------- */
function renderHealthItems(health){
  if(!health || !health.length) return '';
  return '<div class="label" style="margin-top:6px;">Health history</div>' + health.map(function(h){
    var when = h.created_at ? new Date(h.created_at).toLocaleDateString(undefined,{month:'short',day:'numeric'}) : '';
    var fu = h.follow_up_date ? ' · follow-up ' + new Date(h.follow_up_date).toLocaleDateString(undefined,{month:'short',day:'numeric'}) : '';
    return '<div style="border-bottom:1px solid var(--line);padding:9px 0;font-size:13px;">'
      + '<div style="display:flex;justify-content:space-between;align-items:flex-start;"><span style="color:var(--cream);">' + (h.symptom||'Concern') + '</span><span class="muted" style="font-size:11px;white-space:nowrap;margin-left:10px;">' + when + '</span></div>'
      + (h.suspected_cause ? '<div class="muted" style="font-size:12px;margin-top:3px;">Likely: ' + h.suspected_cause + '</div>' : '')
      + (h.treatment_applied ? '<div class="muted" style="font-size:12px;margin-top:2px;">Treated: ' + h.treatment_applied + fu + '</div>' : '')
      + '</div>';
  }).join("");
}
window.toggleConcern = function(){
  var f = document.getElementById("concern-form");
  if(f) f.style.display = (f.style.display === "none" || !f.style.display) ? "block" : "none";
};
window.saveConcern = async function(){
  if(!currentPlantId) return;
  var rec = {
    plant_id: currentPlantId,
    symptom: val("h-symptom"),
    suspected_cause: val("h-cause"),
    treatment_applied: val("h-treat"),
    follow_up_date: val("h-follow") || null
  };
  if(!rec.symptom){ toast("Add a symptom first."); return; }
  var res = await sb.from("health_log").insert(rec);
  if(res.error){ toast("Couldn't save: " + res.error.message); return; }
  toast("Concern logged.");
  openPlant(currentPlantId);
};


/* ---------- SUPPLIES / INVENTORY ---------- */
let SUPPLIES_CACHE = [];
async function loadSupplies(){
  // supply_status view gives uses_left + needs_reorder (created by pending-setup.sql)
  let res = await sb.from("supply_status").select("*").order("category").order("name");
  if(res.error){ res = await sb.from("supply").select("*").order("name"); } // fallback before view exists
  const list = res.data || [];
  SUPPLIES_CACHE = list;
  $("sup-count").textContent = list.length + " item" + (list.length===1?"":"s");
  renderSupplyReorder(list);
  renderSupplies(list);
}
function usesLeft(s){
  if(s.uses_left !== undefined && s.uses_left !== null) return s.uses_left;
  if(s.typical_use_qty && s.typical_use_qty>0) return Math.floor((Number(s.quantity_on_hand)||0)/s.typical_use_qty);
  return null;
}
function needsReorder(s){
  if(s.needs_reorder !== undefined && s.needs_reorder !== null) return s.needs_reorder;
  return (s.reorder_at!=null && (Number(s.quantity_on_hand)||0) <= s.reorder_at);
}
function renderSupplyReorder(list){
  const low = list.filter(needsReorder);
  const box = $("sup-reorder");
  if(!low.length){ box.innerHTML=""; return; }
  box.innerHTML = `<div style="background:rgba(145,36,28,.14);border:1px solid var(--garnet);border-radius:4px;padding:12px 14px;margin-bottom:10px;">
    <div style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--garnet-bright);margin-bottom:8px;">⚠ Reorder now &middot; ${low.length} item${low.length===1?"":"s"}</div>
    ${low.map(s=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;font-size:13px;">
      <span>${s.name||"Item"} <span style="color:var(--sage);font-size:10px;text-transform:uppercase;">&middot; ${s.category||""}</span></span>
      ${s.reorder_url?`<a href="${s.reorder_url}" target="_blank" rel="noopener" style="color:var(--gold);font-size:11px;letter-spacing:.1em;text-transform:uppercase;border:1px solid var(--line);padding:4px 10px;border-radius:2px;">Reorder</a>`:`<span class="muted" style="font-size:10px;">no link</span>`}
    </div>`).join("")}
  </div>`;
}
function renderSupplies(list){
  const box = $("sup-list");
  if(!list.length){ box.innerHTML = `<div class="empty"><div class="big">No supplies yet.</div><div>Tap &ldquo;Add supply&rdquo; to start your inventory.</div></div>`; return; }
  box.innerHTML = list.map(s=>{
    const ul = usesLeft(s);
    const low = needsReorder(s);
    return `<div style="background:#15140f;border:1px solid var(--line);border-radius:5px;padding:12px 14px;margin-bottom:9px;${low?'border-color:var(--garnet);':''}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">
        <div style="min-width:0;flex:1;">
          <div style="color:var(--cream);font-size:14.5px;line-height:1.25;">${s.name||"Item"}</div>
          <div style="font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:var(--sage);margin-top:3px;">${s.category||""}</div>
        </div>
        ${low?'<span style="flex:none;font-size:9px;letter-spacing:.08em;text-transform:uppercase;padding:3px 9px;border-radius:10px;border:1px solid var(--garnet);color:var(--garnet-bright);">Reorder</span>':''}
      </div>
      <div style="display:flex;gap:18px;margin-top:8px;font-size:12.5px;flex-wrap:wrap;">
        <span class="muted">On hand: <span style="color:var(--cream);">${s.quantity_on_hand!=null?s.quantity_on_hand:"—"} ${s.unit||""}</span></span>
        <span class="muted">Uses left: <span style="color:${low?'var(--garnet-bright)':'var(--fern)'};">${ul!=null?("≈ "+ul):"—"}</span></span>
      </div>
      <div style="display:flex;gap:8px;margin-top:11px;flex-wrap:wrap;">
        <button type="button" class="btn btn-sm" style="padding:6px 14px;font-size:10px;" onclick="logUse('${s.id}')">Use</button>
        <button type="button" class="btn btn-sm" style="padding:6px 14px;font-size:10px;" onclick="editSupply('${s.id}')">Edit</button>
        <button type="button" class="btn btn-sm" style="padding:6px 12px;font-size:10px;border-color:var(--garnet);color:var(--garnet-bright);" onclick="deleteSupply('${s.id}')">Delete</button>
      </div>
    </div>`;
  }).join("");
}
window.logUse = async function(id){
  const s = SUPPLIES_CACHE.find(x=>x.id===id);
  const def = (s && s.typical_use_qty) ? String(s.typical_use_qty) : "1";
  const qty = prompt("How much did you use" + (s&&s.unit?(" ("+s.unit+")"):"") + "?", def);
  if(qty===null) return;
  const n = Number(qty);
  if(!n || n<=0){ toast("Enter a number."); return; }
  const res = await sb.from("supply_usage").insert({ supply_id:id, qty_used:n, used_by_name:(window.ME||null) });
  if(res.error){ toast("Couldn't log: "+res.error.message); return; }
  toast("Logged. Inventory updated.");
  loadSupplies();
};
/* add-supply form wiring */
(function(){
  const ga=$("go-add-supply"), form=$("sup-form"), cancel=$("sup-cancel"), save=$("sup-save");
  if(ga) ga.onclick=()=>{ form.classList.toggle("hidden"); };
  if(cancel) cancel.onclick=()=>{ form.classList.add("hidden"); window.EDITING_SUPPLY=null; };
  if(save) save.onclick=async ()=>{
    const m=$("sup-msg"); m.style.color=""; m.textContent="Saving...";
    const rec = {
      name: val("s-name"), category: val("s-cat")||null, unit: val("s-unit"),
      quantity_on_hand: num("s-qty"), typical_use_qty: num("s-use"),
      reorder_at: num("s-reorder"), unit_cost: num("s-cost"),
      vendor: val("s-vendor"), reorder_url: val("s-url")
    };
    if(!rec.name){ m.style.color="var(--garnet-bright)"; m.textContent="Add an item name."; return; }
    var res; if(window.EDITING_SUPPLY){ res = await sb.from("supply").update(rec).eq("id", window.EDITING_SUPPLY); } else { res = await sb.from("supply").insert(rec); }
    if(res.error){ m.style.color="var(--garnet-bright)"; m.textContent=res.error.message; return; }
    m.textContent="";
    ["s-name","s-cat","s-unit","s-qty","s-use","s-reorder","s-cost","s-vendor","s-url"].forEach(id=>{ if($(id)) $(id).value=""; });
    form.classList.add("hidden");
    toast((rec.name)+(window.EDITING_SUPPLY?" updated.":" added to inventory.")); window.EDITING_SUPPLY=null;
    loadSupplies();
  };
})();


/* ---------- Edit / Delete plant ---------- */
function escAttr(v){ return (v==null?'':String(v)).replace(/"/g,'&quot;'); }
function escHtml(v){ return (v==null?'':String(v)).replace(/</g,'&lt;'); }
window.editPlant = function(){
  var p = window.CURRENT_PLANT; if(!p) return;
  var statuses = ["In Collection","Quarantine","Mother Plant","Propagating","Ready to Sell","Listed","Reserved","Sold","Gifted","Lost"];
  $("plant-body").innerHTML = `
    <div class="view-head"><h2 style="font-size:24px;">Edit plant</h2></div>
    <label class="field">Our name<input id="e-name" value="${escAttr(p.unique_name)}" /></label>
    <div class="row2">
      <label class="field">Status<select id="e-status">${statuses.map(s=>`<option ${s===p.status?'selected':''}>${s}</option>`).join("")}</select></label>
      <label class="field">Belongs to<select id="e-collection">
        ${["Botanical Reverie","Michi","Laura"].map(c=>`<option value="${c}" ${ (p.collection||"Botanical Reverie")===c?'selected':''}>${c==="Michi"?"Michi — mine":c==="Laura"?"Laura — hers":"Botanical Reverie"}</option>`).join("")}
      </select></label>
    </div>
    <label class="field">Zone<input id="e-zone" value="${escAttr(p.location_zone)}" /></label>
    <div class="row2">
      <label class="field">Botanical name<input id="e-botanical" value="${escAttr(p.botanical_name)}" /></label>
      <label class="field">Common name<input id="e-common" value="${escAttr(p.common_name)}" /></label>
    </div>
    <div class="row2">
      <label class="field">Pot type<input id="e-pot" value="${escAttr(p.pot_type)}" /></label>
      <label class="field">Current value<input id="e-value" type="number" step="0.01" value="${p.current_value!=null?p.current_value:''}" /></label>
    </div>
    <div class="row2">
      <label class="field">Target price<input id="e-target" type="number" step="0.01" value="${p.target_price!=null?p.target_price:''}" /></label>
      <label class="field">Asking price<input id="e-asking" type="number" step="0.01" value="${p.asking_price!=null?p.asking_price:''}" /></label>
    </div>
    <label class="field">Notes<textarea id="e-notes" rows="2">${escHtml(p.notes)}</textarea></label>
    <div style="display:flex;gap:10px;margin-top:6px;">
      <button class="btn btn-primary btn-sm" onclick="savePlantEdit()">Save changes</button>
      <button class="btn btn-sm" onclick="openPlant('${p.id}')">Cancel</button>
    </div>`;
};
window.savePlantEdit = async function(){
  if(!currentPlantId) return;
  var rec = {
    unique_name: val("e-name"), status: $("e-status").value,
    collection: ($("e-collection")&&$("e-collection").value)||"Botanical Reverie",
    location_zone: val("e-zone"), botanical_name: val("e-botanical"), common_name: val("e-common"),
    pot_type: val("e-pot"),
    current_value: num("e-value"), target_price: num("e-target"), asking_price: num("e-asking"),
    notes: val("e-notes")
  };
  var res = await sb.from("plant").update(rec).eq("id", currentPlantId);
  if(res.error){ toast("Save failed: "+res.error.message); return; }
  await fetchPlants();
  toast("Saved.");
  openPlant(currentPlantId);
};
window.askDelete = function(){
  var why = prompt("Delete this plant permanently? Type a short reason (logged) — e.g. duplicate, data error, died:");
  if(why===null) return;                                   // cancelled
  if(!why.trim()){ toast("A reason is required to delete."); return; }
  if(!confirm('Permanently delete this plant?\n\nReason: "'+why.trim()+'"\n\nThis cannot be undone.')) return;
  deletePlant(why.trim());
};
window.deletePlant = async function(reason){
  if(!currentPlantId) return;
  var p = window.CURRENT_PLANT;
  console.log("DELETE", p && (p.unique_name||p.id), "· reason:", reason);
  var res = await sb.from("plant").delete().eq("id", currentPlantId);
  if(res.error){ toast("Can't delete — does it have propagations? ("+res.error.message+")"); return; }
  await fetchPlants();
  toast("Deleted — "+(reason||"no reason"));
  go("collection");
};

/* ---------- Edit / Delete supply + search ---------- */
window.editSupply = function(id){
  var s = SUPPLIES_CACHE.find(function(x){ return x.id===id; }); if(!s) return;
  window.EDITING_SUPPLY = id;
  var setv = function(k,v){ if($(k)) $(k).value = (v==null?'':v); };
  setv("s-name",s.name); setv("s-cat",s.category); setv("s-unit",s.unit);
  setv("s-qty",s.quantity_on_hand); setv("s-use",s.typical_use_qty); setv("s-reorder",s.reorder_at);
  setv("s-cost",s.unit_cost); setv("s-vendor",s.vendor); setv("s-url",s.reorder_url);
  var form = $("sup-form"); form.classList.remove("hidden"); form.scrollIntoView({behavior:"smooth"});
};
window.deleteSupply = async function(id){
  var s = SUPPLIES_CACHE.find(function(x){ return x.id===id; });
  if(!confirm("Delete " + (s?s.name:"this supply") + "?")) return;
  var res = await sb.from("supply").delete().eq("id", id);
  if(res.error){ toast("Can't delete: "+res.error.message); return; }
  toast("Deleted.");
  loadSupplies();
};
(function(){
  var box = $("sup-search");
  if(box) box.oninput = function(e){
    var q = e.target.value.toLowerCase();
    renderSupplies(SUPPLIES_CACHE.filter(function(s){
      return [s.name,s.category,s.vendor].filter(Boolean).join(" ").toLowerCase().includes(q);
    }));
  };
})();
