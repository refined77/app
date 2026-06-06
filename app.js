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
  if(name==="add"){ prepAdd(); setupSmartForm(); }
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
  $("today-body").innerHTML = `
    <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr));">
      ${tile("In the collection", total, 'all')}
      ${tile("Collection value", money(value), 'all')}
      ${tile("In quarantine", quarantine, 'Quarantine')}
      ${tile("Ready to sell", ready, 'Ready to Sell')}
      ${tile("Mother plants", mothers, 'Mother Plant')}
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
async function prepAdd(){
  $("f-date").value = new Date().toISOString().slice(0,10);
  const plants = CACHE.length? CACHE : await fetchPlants();
  const sel=$("f-mother");
  sel.innerHTML = `<option value="">— None (this is a founder) —</option>` +
    plants.map(p=>`<option value="${p.id}">${p.unique_name||p.common_name||"Unnamed"} (${lineageCode(p)})</option>`).join("");
}
$("add-form").onsubmit = async (e)=>{
  e.preventDefault();
  const m=$("add-msg"); m.style.color=""; m.textContent="Adding…";
  const rec = {
    unique_name: val("f-name"), status: val("f-status"),
    botanical_name: val("f-botanical"), common_name: val("f-common"),
    mother_id: val("f-mother")||null,
    date_entered: val("f-date")||null,
    acquisition_type: val("f-acqtype")||null,
    condition_at_intake: val("f-condition"),
    source_name: val("f-srcname"), source_website: val("f-srcweb"),
    source_phone: val("f-srcphone"), source_address: val("f-srcaddr"),
    acquisition_cost: num("f-cost"),
    location_zone: val("f-zone"), pot_type: val("f-pot")||null,
    medium: val("f-medium"),
    target_price: num("f-target"), current_value: num("f-value"),
    notes: val("f-notes"),
  };
  const {data,error} = await sb.from("plant").insert(rec).select().single();
  if(error){ m.style.color="var(--garnet-bright)"; m.textContent=error.message; return; }
  await fetchPlants();
  e.target.reset();
  toast((rec.unique_name||"Plant")+" entered the collection.");
  openPlant(data.id);
};
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
      <div class="label flank" style="justify-content:flex-start;">CARE &amp; HEALTH</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;">
        ${["Watered","Fed","Repotted","Pruned","Treated","Rotated","Moved"].map(a=>`<button type="button" class="btn btn-sm" onclick="logCare('${a}')">${a}</button>`).join("")}
      </div>
      <div id="care-list" style="margin-top:14px;">${renderCareItems(care)}</div>
      <div style="margin-top:18px;"><button type="button" class="btn btn-sm" onclick="toggleConcern()">+ Log a concern</button></div>
      <div id="concern-form" style="display:none;margin-top:12px;background:#15140f;border:1px solid var(--line);border-radius:3px;padding:14px;">
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
async function setupSmartForm(){
  const bsel=$("f-botanical"), msel=$("f-medium"), cn=$("f-common"), rec=$("f-recipe");
  if(!bsel || !msel) return;
  if(msel.options.length<=1){
    Object.keys(SOILS).forEach(k=>{ const o=document.createElement("option"); o.value=k; o.textContent=k; msel.appendChild(o); });
  }
  if(!SPECIES.length){
    const {data} = await sb.from("species").select("botanical_name,common_name,recommended_medium").order("botanical_name");
    SPECIES = data||[];
  }
  bsel.innerHTML = `<option value="">— Select a botanical name —</option>` +
    SPECIES.map(s=>`<option value="${s.botanical_name}">${s.botanical_name}</option>`).join("");
  function showRecipe(k){
    if(k && SOILS[k]){
      rec.style.display="block";
      rec.innerHTML='<span style="color:var(--gold);font-size:10px;letter-spacing:.14em;text-transform:uppercase;display:block;margin-bottom:5px;">'+k+'</span>'+SOILS[k];
    } else { rec.style.display="none"; }
  }
  bsel.onchange=()=>{
    const s=SPECIES.find(x=>x.botanical_name===bsel.value);
    if(!s){ cn.value=""; return; }
    cn.value=s.common_name||"";
    if(s.recommended_medium){ msel.value=s.recommended_medium; showRecipe(s.recommended_medium); }
  };
  msel.onchange=()=>showRecipe(msel.value);
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
