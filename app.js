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
function showAuth(){ el.auth.classList.remove("hidden"); el.app.classList.add("hidden"); el.nav.classList.add("hidden"); }
function showApp(user){
  el.auth.classList.add("hidden"); el.app.classList.remove("hidden"); el.nav.classList.remove("hidden");
  const nm = (user.email||"").split("@")[0];
  window.ME = nm.charAt(0).toUpperCase()+nm.slice(1); $("who-name").textContent = window.ME;
  go("today");
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
const views = ["today","collection","add","plant","supplies"];
function go(name){
  views.forEach(v=> $("v-"+v).classList.toggle("hidden", v!==name));
  document.querySelectorAll(".nav button").forEach(b=> b.classList.toggle("active", b.dataset.go===name));
  if(name==="today") loadToday();
  if(name==="collection") loadCollection();
  if(name==="add"){ setupAddForm(); }
  if(name==="supplies") loadSupplies();
}
document.querySelectorAll(".nav button").forEach(b=> b.onclick=()=>{ if(b.dataset.go==='collection') collFilter=null; go(b.dataset.go); });
$("go-add").onclick=()=>go("add");
$("add-cancel").onclick=()=>go("collection");
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
  const total = plants.length;
  const value = plants.reduce((s,p)=>s+(Number(p.current_value)||0),0);
  const quarantine = plants.filter(p=>p.status==="Quarantine").length;
  const ready = plants.filter(p=>p.status==="Ready to Sell").length;
  const mothers = plants.filter(p=>p.status==="Mother Plant").length;
  const recentRes = await sb.from("care_log").select("action,done_at,done_by_name,plant_id,plant(unique_name)").order("done_at",{ascending:false}).limit(12);
  const recent = recentRes.data || [];
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
    <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr));">
      ${tile("In the collection", total, 'all')}
      ${tile("Collection value", money(value), 'all')}
      ${tile("In quarantine", quarantine, 'Quarantine')}
      ${tile("Ready to sell", ready, 'Ready to Sell')}
      ${tile("Mother plants", mothers, 'Mother Plant')}
    </div>
    <div class="section-t"><div class="label flank" style="justify-content:flex-start;">LINNAEUS — TODAY</div>
      <div style="margin-top:10px;"><button type="button" class="btn btn-sm btn-gold" onclick="todayBrief()">✦ What needs attention</button></div>
      <div id="ai-today" class="roomnote" style="display:none;margin-top:10px;white-space:pre-wrap;"></div>
    </div>
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
function tile(label,val,action){
  const click = action ? `onclick="selectCollection('${action}')" style="cursor:pointer;"` : `style="cursor:default;"`;
  return `<div class="card stat" ${click}><div class="body">
    <div class="label">${label}</div>
    <div style="font-family:'Cormorant Garamond',serif;font-size:34px;color:var(--cream);margin-top:6px;">${val}</div>
  </div></div>`;
}

/* ---------- COLLECTION ---------- */
let collFilter = null;
window.selectCollection = function(f){ collFilter = (f && f!=='all') ? f : null; go('collection'); };
async function loadCollection(){
  const plants = await fetchPlants();
  const list = collFilter ? plants.filter(p=>p.status===collFilter) : plants;
  $("coll-count").textContent = list.length+" specimen"+(list.length===1?"":"s")+(collFilter?` · ${collFilter}`:"");
  renderColl(list);
}
$("coll-search").oninput = (e)=>{
  const q=e.target.value.toLowerCase();
  const base = collFilter ? CACHE.filter(p=>p.status===collFilter) : CACHE;
  renderColl(base.filter(p=>[p.unique_name,p.botanical_name,p.common_name,p.house,lineageCode(p)]
    .filter(Boolean).join(" ").toLowerCase().includes(q)));
};
function renderColl(plants){
  const g=$("coll-grid");
  if(!plants.length){ g.innerHTML=`<div class="empty" style="grid-column:1/-1;">
    <div class="big">No specimens yet.</div>
    <div>Tap “Add a Plant” to begin the collection.</div></div>`; return; }
  g.innerHTML = plants.map(p=>`
    <div class="card" onclick="openPlant('${p.id}')">
      <div class="thumb" style="${p.cover_photo_url?`background-image:url('${p.cover_photo_url}')`:''}">${p.cover_photo_url?'':'❦'}</div>
      <div class="body">
        <div class="nm">${p.unique_name||p.common_name||"Unnamed"}</div>
        <div class="code">${lineageCode(p)}</div>
        <div class="meta"><span class="dot"></span>${p.status||""}</div>
      </div>
    </div>`).join("");
}

/* ---------- ADD ---------- */
/* type → what the form asks for */
const ACQ = {
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
const ADMINS = ["michi"];   // login name(s) allowed to see/enter pricing — add Laura etc. here later
function isAdmin(){ return ADMINS.indexOf((window.ME||"").toLowerCase())>=0; }
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
  ["f-cond-other","f-cond-quar","f-zone-other","f-shelf-wrap","f-pot-other","f-addname","f-vdup","f-name-sug","f-inherit","f-recipe","f-cult-add","f-photo-note","f-verify-note"].forEach(id=>{ const e=$(id); if(e) e.style.display="none"; });
  const vs=$("f-vsug"); if(vs){ vs.classList.remove("open"); vs.innerHTML=""; }
}

async function setupAddForm(){
  const f=$("add-form"); if(!f) return;
  f.reset();
  addPhotoFile=null; verifyOK=false;
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

async function saveNewName(){
  const bot=($("an-bot").value||"").trim(), com=($("an-common").value||"").trim(), med=$("an-medium").value, msg=$("an-msg");
  const warn=(t)=>{ msg.style.display="block"; msg.className="fnote warn"; msg.textContent=t; };
  if(!bot) return warn("Botanical name is required.");
  if(SPECIES.some(s=>(s.botanical_name||"").toLowerCase()===bot.toLowerCase())) return warn("That name is already in the catalog.");
  const {data,error}=await sb.from("species").insert({botanical_name:bot, common_name:com||null, recommended_medium:med||null}).select().single();
  if(error) return warn(error.message);
  SPECIES.push(data); SPECIES.sort((a,b)=>(a.botanical_name||"").localeCompare(b.botanical_name||""));
  renderBotanical(); $("f-botanical").value=bot; onBotanical();
  $("f-addname").style.display="none"; $("an-bot").value=""; $("an-common").value=""; $("an-medium").value=""; msg.style.display="none";
  toast(bot+" added to the catalog.");
}

function wireAddForm(){
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
    addPhotoFile=file; verifyOK=false;
    const vnote=$("f-verify-note"); if(vnote) vnote.style.display="none";
    const img=$("f-photo-preview"), pr=$("f-photo-prompt");
    img.src=URL.createObjectURL(file); img.style.display="block"; pr.style.display="none";
    $("f-photo-zone").classList.remove("bad");
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
  // Linnaeus photo verification — the stubbed ✓ / ⚠ check, live once the function is deployed.
  if(!verifyOK && addPhotoFile){
    const vn=$("f-verify-note");
    m.style.color=""; m.textContent="Linnaeus is checking the photo…";
    const v=await linnaeusVerify(bot, $("f-common").value, addPhotoFile);
    m.textContent="";
    if(v && v.result){
      const r=v.result;
      if(r.match===false && r.confidence!=="low"){
        vn.style.display="block"; vn.className="fnote warn";
        vn.innerHTML='⚠ Linnaeus thinks this looks like <b>'+(r.looks_like||'something else')+'</b>, not <b>'+bot+'</b>. '+(r.note||'')+' <a id="vconfirm">Confirm anyway</a> &nbsp;·&nbsp; <a id="vchange">Change name</a>';
        $("vconfirm").onclick=()=>{ verifyOK=true; vn.style.display="none"; submitAdd(e); };
        $("vchange").onclick=()=>{ vn.style.display="none"; markBad("f-botanical"); $("f-botanical").scrollIntoView({behavior:"smooth",block:"center"}); };
        return;
      }
      verifyOK=true;
      if(r.match===true){ vn.style.display="block"; vn.className="fnote"; vn.innerHTML="Linnaeus verified ✓ "+(r.note||""); }
    } else { verifyOK=true; } // AI unavailable (e.g. local preview) — don't block the save
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
  await fetchPlants(); await loadVendors();
  $("add-form").reset(); condSel=new Set(); addPhotoFile=null; verifyOK=false;
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
    return "Thin-leaf velvet — keep it in the glass case (75–85% humidity, fan on). The open room at 50–60% runs too dry for these.";
  if(/hoya|echeveria|sansevieria|succulent|cactus|string of/.test(hay))
    return "Likes it drier — water only when fully dry. The room's steady airflow suits it well.";
  return "At home in the room — 50–60% humidity under the grow lights. Check the top inch and water only if it's dry.";
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
  const cover = p.cover_photo_url? `style="background-image:url('${p.cover_photo_url}')"` : "";
  $("plant-body").innerHTML = `
    <div style="display:flex;gap:8px;align-items:center;margin:6px 0 16px;"><button class="btn btn-sm" onclick="go('collection')">‹ Back</button><button class="btn btn-sm" onclick="editPlant()">Edit</button><span style="flex:1;"></span><button class="btn btn-sm" onclick="askDelete()" style="border-color:var(--garnet);color:var(--garnet-bright);">Delete</button></div>
    <div class="pp-hero">
      <div class="pp-cover" ${cover}>${p.cover_photo_url?'':'❦'}</div>
      <div>
        <div class="pp-reg">Reverie Registry № BR-${pad(p.plant_no)}</div>
        <div class="pp-name italic">${p.unique_name||p.common_name||"Unnamed"}</div>
        <div class="pp-code">${p.house?p.house+' line':'Founding line'} &nbsp;·&nbsp; Gen ${roman(p.generation||1)}${p.cultivar?` &nbsp;·&nbsp; ${p.cultivar}`:''}</div>
        <div class="pp-story">${storyLine(p)}</div>
        <div class="chips">
          <span class="chip"><span class="dot"></span> ${p.status||""}</span>
          ${p.botanical_name?`<span class="chip italic" style="font-family:'Cormorant Garamond',serif;text-transform:none;letter-spacing:0;font-size:13px;">${p.botanical_name}</span>`:""}
          <span class="chip">Gen ${roman(p.generation||1)}</span>
        </div>
        <div class="kv">
          ${kv("Date entered", p.date_entered)}
          ${kv("Acquired as", p.acquisition_type)}
          ${kv("Source", p.source_name)}
          ${kv("Cost", p.acquisition_cost!=null?money(p.acquisition_cost):null)}
          ${kv("Zone", p.location_zone)}
          ${kv("Pot", p.pot_type)}
          ${kv("Current value", p.current_value!=null?money(p.current_value):null)}
        </div>
      </div>
    </div>
    ${tendedSummary(care)?`<div class="section-t"><div class="label flank" style="justify-content:flex-start;">TENDED</div><div class="tended" style="margin-top:10px;">${tendedSummary(care)}</div></div>`:""}
    <div class="section-t">
      <div class="label flank" style="justify-content:flex-start;">IN YOUR ROOM</div>
      <div class="roomnote" style="margin-top:10px;">${roomCareNote(p)}</div>
    </div>
    <div class="section-t">
      <div class="label flank" style="justify-content:flex-start;">PHOTOS</div>
      <div style="margin-top:10px;"><button type="button" class="btn btn-sm" onclick="addPhoto()">+ Add photo</button></div>
      <div style="margin-top:12px;">${renderPhotoGrid(photos)}</div>
    </div>
    ${p.notes?`<div class="section-t"><div class="label flank" style="justify-content:flex-start;">NOTES</div><p class="muted" style="margin-top:10px;">${p.notes}</p></div>`:""}
    <div class="section-t">
      <div class="label flank" style="justify-content:flex-start;">LINEAGE — ${p.house||""}</div>
      <div style="margin-top:12px;">
        ${mother?`<div class="muted" style="font-size:13px;">Mother: <a href="#" onclick="openPlant('${mother.id}');return false;">${mother.unique_name||"Unnamed"}</a> (${lineageCode(mother)})</div>`:`<div class="muted" style="font-size:13px;">Founder of this House.</div>`}
        ${kids.length? `<div style="margin-top:10px;" class="grid">${kids.map(k=>`
          <div class="card" onclick="openPlant('${k.id}')"><div class="body">
            <div class="nm" style="font-size:17px;">${k.unique_name||"Unnamed"}</div>
            <div class="code">${lineageCode(k)}</div>
            <div class="meta"><span class="dot"></span>${k.status||""}</div>
          </div></div>`).join("")}</div>` : `<div class="muted" style="font-size:13px;margin-top:8px;">No propagations yet.</div>`}
      </div>
    </div>
    <div class="section-t">
      <div class="label flank" style="justify-content:flex-start;">ASK LINNAEUS</div>
      <div style="margin-top:10px;display:flex;gap:8px;">
        <input id="ai-q" placeholder="What does this plant need right now?" style="flex:1;" />
        <button type="button" class="btn btn-sm btn-gold" onclick="askPlant()">✦ Ask</button>
      </div>
      <div id="ai-ans" class="roomnote" style="display:none;margin-top:10px;white-space:pre-wrap;"></div>
    </div>
    <div class="section-t">
      <div class="label flank" style="justify-content:flex-start;">CARE &amp; HEALTH</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;">
        ${["Watered","Fed","Repotted","Pruned","Treated","Rotated","Moved"].map(a=>`<button type="button" class="btn btn-sm" onclick="logCare('${a}')">${a}</button>`).join("")}
      </div>
      <div id="care-list" style="margin-top:14px;">${renderCareItems(care)}</div>
      <div style="margin-top:18px;"><button type="button" class="btn btn-sm" onclick="toggleConcern()">+ Log a concern</button></div>
      <div id="concern-form" style="display:none;margin-top:12px;background:#15140f;border:1px solid var(--line);border-radius:3px;padding:14px;">
        <div style="margin-bottom:10px;"><button type="button" class="btn btn-sm btn-gold" onclick="diagnoseConcern()">✦ Diagnose from photo</button></div>
        <label class="field">Symptom<textarea id="h-symptom" rows="2" placeholder="e.g. yellowing lower leaves, webbing on new growth"></textarea></label>
        <div class="row2">
          <label class="field">Suspected cause<input id="h-cause" placeholder="e.g. overwatering, spider mites" /></label>
          <label class="field">Treatment applied<input id="h-treat" placeholder="e.g. neem, repot, isolate" /></label>
        </div>
        <label class="field">Follow-up date<input type="date" id="h-follow" /></label>
        <button type="button" class="btn btn-primary btn-sm" onclick="saveConcern()">Save concern</button>
      </div>
      <div style="margin-top:14px;">${renderHealthItems(health)}</div>
    </div>`;
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
    const r=await fetch("/.netlify/functions/linnaeus",{method:"POST",
      headers:{"content-type":"application/json","authorization":"Bearer "+tok},
      body:JSON.stringify(payload)});
    const j=await r.json().catch(()=>null);
    if(!r.ok) return {error:((j&&j.error)||("Linnaeus error ("+r.status+")")) + (j&&j.detail?(" — "+j.detail):"")};
    return j;
  }catch(e){ return {error:"Couldn't reach Linnaeus (is the app deployed?)."}; }
}
function plantCtx(p){ p=p||{}; return {unique_name:p.unique_name,botanical_name:p.botanical_name,common_name:p.common_name,cultivar:p.cultivar,location_zone:p.location_zone,status:p.status,condition_at_intake:p.condition_at_intake,date_entered:p.date_entered}; }
async function linnaeusVerify(botanical, common, file){
  if(!file) return null;
  const img=await fileToB64(file); if(!img) return null;
  return await askLinnaeus({mode:"verify", botanical_name:botanical, common_name:common, image_b64:img.b64, media_type:img.media});
}
window.askPlant=async function(){
  const q=($("ai-q").value||"").trim()||"What does this plant need right now?";
  const ans=$("ai-ans"); ans.style.display="block"; ans.textContent="Linnaeus is thinking…";
  const v=await askLinnaeus({mode:"advise", plant:plantCtx(window.CURRENT_PLANT), question:q});
  ans.textContent=(v&&v.text)?v.text:(v&&v.error?("Linnaeus: "+v.error):"No answer.");
};
window.diagnoseConcern=function(){
  const inp=document.createElement("input"); inp.type="file"; inp.accept="image/*"; inp.setAttribute("capture","environment");
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
      return '<div style="aspect-ratio:1;border:1px solid var(--line);border-radius:2px;background:#0d0d0d center/cover no-repeat;background-image:url(\''+ph.image_url+'\');"></div>';
    }).join("") + '</div>';
}
window.addPhoto = function(){
  if(!currentPlantId) return;
  var inp = document.getElementById("photo-input");
  if(!inp){
    inp = document.createElement("input");
    inp.type = "file"; inp.accept = "image/*"; inp.setAttribute("capture","environment");
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
  box.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:4px;">
    <thead><tr>
      <th style="text-align:left;font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--gold);padding:6px 6px;border-bottom:1px solid var(--line);font-weight:400;">Item</th>
      <th style="text-align:left;font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--gold);padding:6px 6px;border-bottom:1px solid var(--line);font-weight:400;">On hand</th>
      <th style="text-align:left;font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--gold);padding:6px 6px;border-bottom:1px solid var(--line);font-weight:400;">Uses left</th>
      <th style="border-bottom:1px solid var(--line);"></th>
    </tr></thead><tbody>
    ${list.map(s=>{
      const ul = usesLeft(s);
      const low = needsReorder(s);
      return `<tr>
        <td style="padding:9px 6px;border-bottom:1px solid var(--line);"><span style="color:var(--cream);">${s.name||"Item"}</span><br><span style="font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:var(--sage);">${s.category||""}</span></td>
        <td style="padding:9px 6px;border-bottom:1px solid var(--line);">${s.quantity_on_hand!=null?s.quantity_on_hand:"—"} ${s.unit||""}</td>
        <td style="padding:9px 6px;border-bottom:1px solid var(--line);color:${low?'var(--garnet-bright)':'var(--fern)'};">${ul!=null?("≈ "+ul):"—"}</td>
        <td style="padding:9px 6px;border-bottom:1px solid var(--line);text-align:right;white-space:nowrap;">
          <button type="button" class="btn btn-sm" style="padding:5px 10px;font-size:10px;" onclick="logUse('${s.id}')">Use</button> <button type="button" class="btn btn-sm" style="padding:5px 10px;font-size:10px;" onclick="editSupply('${s.id}')">Edit</button> <button type="button" class="btn btn-sm" style="padding:5px 10px;font-size:10px;border-color:var(--garnet);color:var(--garnet-bright);" onclick="deleteSupply('${s.id}')">&times;</button>
          ${low?'<span style="display:inline-block;font-size:9px;letter-spacing:.08em;text-transform:uppercase;padding:2px 7px;border-radius:10px;border:1px solid var(--garnet);color:var(--garnet-bright);margin-left:6px;">Reorder</span>':''}
        </td>
      </tr>`;
    }).join("")}
    </tbody></table>`;
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
      <label class="field">Zone<input id="e-zone" value="${escAttr(p.location_zone)}" /></label>
    </div>
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
