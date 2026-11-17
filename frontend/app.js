const $=s=>document.querySelector(s),esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const ss=sessionStorage; // session storage: login page appears every time the app is opened fresh
// Admin "view as user" (read-only): the admin page opens  /#view=<token>&roll=<roll>[&ds=<id>]
if(location.hash.startsWith("#view=")){const q=new URLSearchParams(location.hash.slice(1));
 ["pcs_token","pcs_roll","pcs_view","pcs_ds"].forEach(k=>ss.removeItem(k));ss.setItem("pcs_token",q.get("view"));ss.setItem("pcs_roll",q.get("roll")||"");ss.setItem("pcs_view","1");
 if(q.get("ds"))window.VGO=+q.get("ds");history.replaceState(null,"",location.pathname)}
const VIEW=ss.getItem("pcs_view")==="1"; // true = an admin is looking at a user's account: nothing can be trained, screened, uploaded, deleted or changed
if(VIEW)document.body.classList.add("view");
const S={token:ss.getItem("pcs_token"),roll:ss.getItem("pcs_roll"),ds:null,page:"dashboard",filter:"all",q:"",sel:null,model:"SVR",pmodel:"SVR"};
const ic=p=>`<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const ICON={dashboard:ic('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'),training:ic('<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>'),performance:ic('<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>'),results:ic('<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>'),export:ic('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>')};
ICON.predict=ic('<path d="M9 3h6"/><path d="M10 3v6.5L4.5 19a1.5 1.5 0 0 0 1.3 2.2h12.4a1.5 1.5 0 0 0 1.3-2.2L14 9.5V3"/><path d="M7.5 15h9"/>');
const fmt=(v,d=3)=>v==null?"—":(typeof v==="number"?(Math.abs(v)<1e-3&&v!==0||Math.abs(v)>1e5?v.toExponential(2):+v.toFixed(d)):esc(v));
const badge=v=>`<span class="badge ${String(v).replace(/ /g,"")}"${v==="NOT AVAILABLE"?' title="Could not be evaluated"':""}>${v==="NOT AVAILABLE"?"N/A":v==="INCOMPLETE"?"NOT EVALUABLE":v==="NOT REACHED"?"—":v}</span>`;
const lvl={CHEAP:"Cheap",MODERATE:"Moderate",EXPENSIVE:"Expensive"},costBadge=v=>v in lvl?`<span class="badge ${v}">${lvl[v]}</span>`:badge(v);
const usd=v=>v==null?"—":"$"+(v>=100?Math.round(v).toLocaleString():v>=10?v.toFixed(1):v.toFixed(2))+"/kg";
const toast=m=>{const t=$("#toast");t.textContent=m;t.style.display="block";setTimeout(()=>t.style.display="none",4000)};
async function api(p,o={}){o.headers={...(o.headers||{}),Authorization:"Bearer "+S.token};if(o.json){o.headers["Content-Type"]="application/json";o.body=JSON.stringify(o.json);o.method=o.method||"POST"}
 let r;try{r=await fetch("/api"+p,o)}catch(e){throw new Error("Cannot reach the server (API failure). Is the backend still running?")}
 if(r.status===401&&p!=="/login"&&p!=="/admin/login"){logout();throw new Error("Session expired – please log in again.")}
 if(!(r.headers.get("content-type")||"").includes("json"))return r;const j=await r.json();if(!r.ok)throw new Error(j.error||"Request failed");return j}
async function busy(msgs,fn){const b=$("#busy");b.classList.remove("hidden");let i=0;$("#busymsg").textContent=msgs[0];const t=setInterval(()=>$("#busymsg").textContent=msgs[Math.min(++i,msgs.length-1)],1800);
 try{return await fn()}finally{clearInterval(t);b.classList.add("hidden")}}

// ---------- Training flowchart: shows what the server is REALLY doing, top to bottom, as each step starts ----------
async function flow(title,fn){
 const rid=Date.now().toString(36)+Math.random().toString(36).slice(2,8);
 const el=document.createElement("div");el.id="flow";
 el.innerHTML=`<div class="fl-card"><div class="fl-head"><div class="fl-t">${esc(title)}</div><div class="fl-time" id="fl_time">0:00</div></div><div class="fl-body" id="fl_body"></div><div class="fl-foot">Training runs on the server – large datasets can take a few minutes.</div></div>`;
 document.body.appendChild(el);
 const body=el.querySelector("#fl_body"),t0=Date.now();let since=0,last=null,run=true;
 const clock=setInterval(()=>{const s=Math.floor((Date.now()-t0)/1000);$("#fl_time").textContent=Math.floor(s/60)+":"+String(s%60).padStart(2,"0")},500);
 const add=(m,d,fin)=>{if(last)last.classList.remove("act");
  if(last)body.insertAdjacentHTML("beforeend",'<div class="fl-arr"><svg viewBox="0 0 10 12" width="10" height="12"><path d="M5 0v9M1.5 6L5 10l3.5-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></div>');
  const n=document.createElement("div");n.className="fl-node"+(fin?" fin":" act");
  n.innerHTML=`<b>${esc(m)}</b>${d?`<small>${esc(d)}</small>`:""}${fin?"":'<span class="fl-dots"><i></i><i></i><i></i></span>'}`;
  body.appendChild(n);last=n;requestAnimationFrame(()=>{n.classList.add("show");body.scrollTo({top:body.scrollHeight,behavior:"smooth"})})};
 const poll=async()=>{try{const j=await api(`/datasets/${S.ds.id}/progress?rid=${rid}&since=${since}`);if(j&&j.events){since=j.n;j.events.forEach(e=>add(e.m,e.d))}}catch(e){}};
 const loop=(async()=>{while(run){await poll();await sleep(700)}})();
 try{const r=await fn(rid);run=false;await loop;await poll();last&&last.classList.remove("act");add("Training complete","models saved",true);await sleep(1100);return r}
 finally{run=false;clearInterval(clock);el.remove()}}

async function dl(path,name){await busy(["Preparing Excel..."],async()=>{const r=await api(path);if(r.blob){const u=URL.createObjectURL(await r.blob()),a=document.createElement("a");a.href=u;a.download=name;a.click()}})}
function logout(){if(VIEW){["pcs_token","pcs_roll","pcs_view","pcs_ds"].forEach(k=>ss.removeItem(k));window.close();setTimeout(()=>location.replace("/admin"),150);return}
 if(S.token)fetch("/api/logout",{method:"POST",headers:{Authorization:"Bearer "+S.token},keepalive:true}).catch(()=>{});ss.clear();S.token=null;S.ds=null;S.sel=null;show()}
$("#logout").onclick=logout;$("#mx").onclick=()=>closeModal();
let ROLE="user";
document.querySelectorAll("#rt button").forEach(b=>b.onclick=()=>{ROLE=b.dataset.r;$("#rt").dataset.role=ROLE;document.querySelectorAll("#rt button").forEach(x=>x.classList.toggle("on",x===b));
 const a=ROLE==="admin";$("#l1t").textContent=a?"Username":"Roll Number";$("#roll").placeholder=a?"Admin username":"e.g. 23CSE001";$("#roll").autocomplete="username";$("#roll").value="";$("#pw").value="";$("#lerr").textContent=""});
$("#lf").onsubmit=async e=>{e.preventDefault();$("#lerr").textContent="";try{
 if(ROLE==="admin"){const j=await api("/admin/login",{json:{username:$("#roll").value.trim(),password:$("#pw").value}});ss.clear();ss.setItem("pcs_admin_token",j.token);$("#pw").value="";location.href="/admin";return}
 const j=await api("/login",{json:{roll_number:$("#roll").value,password:$("#pw").value}});S.token=j.token;S.roll=j.roll_number;ss.setItem("pcs_token",j.token);ss.setItem("pcs_roll",j.roll_number);$("#pw").value="";show()}catch(x){$("#lerr").textContent=x.message}};
async function show(){const ok=!!S.token;$("#login").classList.toggle("hidden",ok);$("#app").classList.toggle("hidden",!ok);if(!ok)return;$("#who").textContent=(VIEW?"Admin view · ":"")+"Roll No: "+S.roll;if(VIEW){$("#logout").textContent="Close";if(!$("#vb")){const b=document.createElement("div");b.id="vb";b.textContent="Admin view · read-only";document.body.appendChild(b)}}
 if(window.VGO){const id=window.VGO;window.VGO=null;try{return await openDs(id)}catch(e){}}
 const id=ss.getItem("pcs_ds");if(id&&!S.ds){try{S.ds=await api("/datasets/"+id)}catch(e){ss.removeItem("pcs_ds")}}go(S.page||"dashboard")}
const backTo=()=>S.page==="performance"?(S.ds&&S.ds.summary?"results":"training"):"dashboard";
const allowed=p=>!S.ds||p==="dashboard"||p==="training"||(p==="performance"?!!S.ds.train:(S.ds.status==="screened"&&!!S.ds.summary));
function go(p){if(!allowed(p))p=S.ds.train?"performance":"training";S.page=p;
 $("#bar").innerHTML=p==="dashboard"?"":`<button class="btn sec sm" onclick="go(backTo())">← Back</button><span class="muted small bar-file" onclick="openFile(${S.ds.id})" title="Open this dataset in Excel">${esc(S.ds.filename)}</span>`;
 $("#main").innerHTML="";window.scrollTo(0,0);Promise.resolve(P[p]()).catch(e=>{$("#main").innerHTML=`<div class="note bad">${esc(e.message)}</div>`})}
async function openDs(id,page){S.ds=await api("/datasets/"+id);ss.setItem("pcs_ds",id);S.filter="all";S.q="";S.sel=null;go(page||(S.ds.status==="screened"?"results":"training"))}
const need=()=>S.ds?"":`<div class="card">No dataset open. Go to the <a href="#" onclick="go('dashboard');return false">Dashboard</a> and click OPEN on a dataset.</div>`;
const stat=(v,l,c="")=>`<div class="stat ${c}"><b>${v}</b><span>${l}</span></div>`;
const P={};
S.mode="upload";   // dashboard slider: "upload" = Upload Dataset (+ history), "predict" = Predict Single Cathode
P.dashboard=async()=>{const d=await api("/dashboard");S.dash=d;
 $("#main").innerHTML=`<h2>Welcome, ${esc(d.roll_number)}</h2>
 <div class="mt" id="mt" data-mode="${S.mode}" role="tablist"><span class="mt-pill"></span><button type="button" data-m="upload" role="tab" class="${S.mode==="upload"?"on":""}">UPLOAD DATASET</button><button type="button" data-m="predict" role="tab" class="${S.mode==="predict"?"on":""}">PREDICT SINGLE CATHODE</button></div>
 <div id="dmode"></div>`;
 document.querySelectorAll("#mt button").forEach(b=>b.onclick=()=>setMode(b.dataset.m));
 dashMode()};
window.setMode=m=>{S.mode=m;$("#mt").dataset.mode=m;document.querySelectorAll("#mt button").forEach(x=>x.classList.toggle("on",x.dataset.m===m));dashMode()};
function dashMode(){const d=S.dash,el=$("#dmode");if(!el)return;
 if(S.mode==="predict")return predictMode(d,el);
 const card=x=>`<div class="ds ${S.ds&&S.ds.id===x.id?"cur":""}"><div><b class="dsname" onclick="openDs(${x.id})">${esc(x.filename)}</b><br><span class="muted small">${x.row_count} cathodes · Uploaded: ${x.upload_date} ${x.model?"· Model: "+x.model:""}</span><br>${x.status==="screened"?`PASS: <b>${x.pass}</b> &nbsp; FAIL: <b>${x.fail}</b>`:`<span class="badge NA">${x.status}</span> not screened yet`}</div>
  <div><button class="btn sm" onclick="openDs(${x.id})">OPEN</button> <button class="btn sm sec" ${x.status!=="screened"?"disabled":""} onclick="openDs(${x.id},'results')">RESULTS</button> ${VIEW?"":`<button class="btn sm sec" onclick="delDs(${x.id})">Delete</button>`}</div></div>`;
 el.innerHTML=`${VIEW?"":`<div class="drop" id="dz" style="padding:22px"><b style="font-size:18px"><svg class="cloud" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 8.5a4.75 4.75 0 0 1-.5 9.5"/><path d="M12 12v8m0-8l-3 3m3-3l3 3"/></svg>Upload New Dataset</b><br><span class="muted">Drop a CSV / Excel file here or click to browse</span><input type="file" id="fi" accept=".csv,.xlsx,.xls" class="hidden"></div>`}
  <h3 style="margin-top:18px">${VIEW?"DATASET HISTORY":"MY DATASET HISTORY"}</h3>${d.datasets.map(card).join("")||'<p class="muted">No datasets uploaded yet.</p>'}`;
 const dz=$("#dz"),fi=$("#fi");if(dz){dz.onclick=()=>fi.click();dz.ondragover=e=>{e.preventDefault();dz.classList.add("over")};dz.ondragleave=()=>dz.classList.remove("over");dz.ondrop=e=>{e.preventDefault();dz.classList.remove("over");up(e.dataTransfer.files[0])};fi.onchange=()=>up(fi.files[0])}}
function predictMode(d,el){
 const ready=d.datasets.filter(x=>x.status==="trained"||x.status==="screened");
 (VIEW?Promise.resolve({available:false}):api("/shared").catch(()=>({available:false}))).then(sh=>{
  if(!ready.length&&!sh.available){el.innerHTML=`<div class="card">No trained models yet. Switch to <a href="#" onclick="setMode('upload');return false">Upload Dataset</a> and upload a dataset once &ndash; the SVR and ANN are trained and saved automatically, then you can predict single cathodes.</div>`;return}
  const opts=[...(sh.available?[{v:"shared",t:"Built-in trained models (SVR + ANN) – no upload needed"}]:[]),...ready.map(x=>({v:x.id,t:`${x.filename} · ${x.upload_date}`}))];
  const cur=String(S.ds&&S.ds.shared?"shared":S.ds&&S.ds.train&&ready.some(x=>x.id===S.ds.id)?S.ds.id:opts[0].v);
  el.innerHTML=`<div id="pmount"></div>`;
  const load=async v=>{try{if(v==="shared"){S.ds=sh}else{const id=+v;if(!S.ds||S.ds.shared||S.ds.id!==id||!S.ds.train){S.ds=await api("/datasets/"+id);ss.setItem("pcs_ds",id)}}await P.predict()}catch(e){toast(e.message)}};
  load(cur)})}
window.delDs=async id=>{if(confirm("Delete this dataset and all its results?")){await api("/datasets/"+id,{method:"DELETE"});if(S.ds&&S.ds.id===id){S.ds=null;ss.removeItem("pcs_ds")}go("dashboard")}};
async function up(f){if(!f)return;const fd=new FormData();fd.append("file",f);
 try{const j=await busy(["Uploading dataset...","Analyzing dataset..."],()=>api("/datasets",{method:"POST",body:fd}));
  if(j.duplicate){toast("This dataset is already in your history – opened the existing copy.");return await openDs(j.id)}
  await autoRun(j.id)}catch(e){toast(e.message)}}
// upload pipeline: train SVR + ANN, screen with both (both results saved), then open the Screening Results
async function autoRun(id){S.ds=await api("/datasets/"+id);ss.setItem("pcs_ds",id);
 try{await flow("Training SVR and ANN, then screening",async rid=>{
   await api(`/datasets/${id}/train`,{json:{mapping:{},rid}});
   try{await api(`/datasets/${id}/train_ann`,{json:{chain:true,rid}})}catch(e){toast("SVR trained, but the ANN could not be trained: "+e.message)}
   await api(`/datasets/${id}/screen`,{json:{model:"SVR",both:true}})});
  S.model="SVR";await openDs(id,"results")}
 catch(e){toast(e.message);await openDs(id,"training")}}   // e.g. formula / target column not detected -> choose them on the analysis screen
const selc=(id,cols,val)=>`<select id="${id}"><option value="">— choose column —</option>${cols.map(c=>`<option ${c===val?"selected":""}>${esc(c)}</option>`).join("")}</select>`;
const NA='<span class="na">Not available</span>';
const mstat=e=>e.usable?'<span class="ok">Available</span>':`<span class="na">Not available</span> <span class="small muted">${e.present?"("+esc(e.reason)+")":""}</span>`;
window.setMap=async(key,col)=>{try{const j=await api(`/datasets/${S.ds.id}/mapping`,{json:{descriptors:{[key]:col}}});S.ds.analysis.descriptors=j.descriptors;S.ds.analysis.mapping=j.mapping;const e=j.descriptors.find(x=>x.key===key);$("#ms_"+key).innerHTML=mstat(e);toast("Mapping updated")}catch(err){toast(err.message)}};
P.training=()=>{if(!S.ds)return $("#main").innerHTML=need();const a=S.ds.analysis,m=S.ds.train?.mapping||a.mapping,t=S.ds.train,miss=Object.entries(a.missing),inv=Object.entries(a.invalid_numeric),d=a.descriptors;
 const pick=(l,id)=>`<tr><td>${l}</td><td>${selc(id,a.columns,null)} <span class="na">Not detected – choose it</span></td></tr>`;
 const need_map=!m.formula||!m.target;
 $("#main").innerHTML=`<h2>Dataset Analysis</h2><div class="grid g4">${stat(esc(S.ds.filename).slice(0,22),"File")}${stat(a.rows,"Cathodes (rows)")}${stat(a.n_columns,"Columns")}</div>
 ${!m.ehull?'<div class="note bad">Ehull column is <b>not available</b> in this dataset.</div>':""}
 ${need_map&&!VIEW?`<div class="card"><h3>Select the missing columns</h3><table>${!m.formula?pick("Chemical formula","m_f"):""}${!m.target?pick("Target log10(k*)","m_t"):""}</table></div>`:""}
 <div class="card"><details id="mapdet"${S.mapOpen?" open":""} ontoggle="S.mapOpen=this.open"><summary><h3 style="display:inline">Mapping of features</h3></summary>
 <p class="muted small" style="margin:8px 0">If a descriptor is mapped to the wrong column, pick the correct one from your dataset's columns.</p>
 <div class="tw"><table><thead><tr><th>Paper descriptor</th><th>Group</th><th>Dataset column</th><th>Status</th></tr></thead><tbody>${d.map(e=>`<tr><td>${esc(e.label)}</td><td>${e.group}</td><td>${selc("",a.columns,e.column).replace('<select id="">',`<select ${VIEW?"disabled":""} onchange="setMap('${e.key}',this.value)">`).replace("— choose column —","— not mapped —")}</td><td id="ms_${e.key}">${mstat(e)}</td></tr>`).join("")}</tbody></table></div></details></div>
 ${miss.length?`<div class="card"><h3>Missing values</h3>${miss.map(([c,n])=>`${esc(c)}: ${n}`).join(" · ")}</div>`:""}
 ${inv.length?`<div class="card"><h3>Invalid numerical values</h3>${inv.map(([c,n])=>`${esc(c)}: ${n} non-numeric entries treated as missing`).join("<br>")}</div>`:""}
 ${VIEW?"":`<div class="card"><button class="btn train-big" onclick="runTrain()">Train dataset</button></div>`}`};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
window.openFile=async id=>{try{const j=VIEW?null:await api(`/datasets/${id}/open`,{method:"POST"});if(j&&j.opened){toast("Opening the dataset in Excel…");return}
  const r=await fetch(`/api/datasets/${id}/file`,{headers:{Authorization:"Bearer "+S.token}});if(!r.ok)throw new Error("Could not open the dataset file.");
  const b=await r.blob(),a=document.createElement("a");a.href=URL.createObjectURL(b);a.download=S.ds&&S.ds.id===id?S.ds.filename:"dataset";document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),4000);toast("Dataset downloaded – open it with Excel.")}
 catch(e){toast(e.message)}};
window.runTrain=async()=>{const v=id=>$("#"+id)?.value||null;const mp={formula:v("m_f"),target:v("m_t")};
 try{await flow("Training SVR and ANN, then screening",async rid=>{await api(`/datasets/${S.ds.id}/train`,{json:{mapping:mp,rid}});
   try{await api(`/datasets/${S.ds.id}/train_ann`,{json:{chain:true,rid}})}catch(e){toast("SVR trained, but the ANN could not be trained: "+e.message)}
   await api(`/datasets/${S.ds.id}/screen`,{json:{model:"SVR",both:true}})});S.model="SVR";await openDs(S.ds.id,"results")}
 catch(e){toast(e.message);go("training");$("#main").insertAdjacentHTML("afterbegin",`<div class="note bad">${esc(e.message)}</div>`)}};
window.runTrainAnn=async()=>{
 try{await flow("Training the neural network",rid=>api(`/datasets/${S.ds.id}/train_ann`,{json:{rid}}));S.model="ANN";await openDs(S.ds.id,"performance")}
 catch(e){toast(e.message)}};
window.setResModel=async m=>{const s=S.ds.summary;if(!s||m===s.model)return;
 if(m==="ANN"&&!S.ds.ann)return toast("The ANN is not trained for this dataset.");
 try{await api(`/datasets/${S.ds.id}/screen`,{json:{model:m}});S.ds=await api("/datasets/"+S.ds.id);S.model=m;S.filter="all";go("results")}catch(e){toast(e.message)}};
window.setModel=m=>{S.model=m;go("performance")};
window.runScreen=async(m)=>{m=m||"SVR";
 try{await busy(["Predicting cathodes...","Applying screening criteria...","Generating results..."],()=>api(`/datasets/${S.ds.id}/screen`,{json:{model:m}}));await openDs(S.ds.id,"results")}
 catch(e){toast(e.message)}};
function parity(p){
 const W=380,pad=40,all=p.y.concat(p.pred,p.y_train||[],p.pred_train||[]),lo=Math.min(...all),hi=Math.max(...all),sc=v=>pad+(v-lo)/(hi-lo)*(W-2*pad),tk=[0,1,2,3,4].map(i=>lo+(hi-lo)*i/4);
 const grid=tk.map(v=>`<line x1="${sc(v)}" x2="${sc(v)}" y1="${pad-10}" y2="${W-pad}" stroke="#eef2f6"/><line y1="${W-sc(v)}" y2="${W-sc(v)}" x1="${pad}" x2="${W-pad+10}" stroke="#eef2f6"/><text x="${sc(v)}" y="${W-pad+16}" text-anchor="middle" font-size="10" fill="#64748b">${v.toFixed(1)}</text><text x="${pad-6}" y="${W-sc(v)+3}" text-anchor="end" font-size="10" fill="#64748b">${v.toFixed(1)}</text>`).join("");
 const dots=(ys,ps,c,o,r)=>(ys||[]).map((y,i)=>`<circle cx="${sc(y)}" cy="${W-sc(ps[i])}" r="${r}" fill="${c}" opacity="${o}"/>`).join("");
 return `<svg viewBox="0 0 ${W} ${W}" style="width:100%;max-width:${W}px;background:#fff;border:1px solid var(--line);border-radius:10px">${grid}<line x1="${sc(lo)}" y1="${W-sc(lo)}" x2="${sc(hi)}" y2="${W-sc(hi)}" stroke="#c1121f" stroke-dasharray="5 4"/>${dots(p.y_train,p.pred_train,"#9db4c4",.55,3)}${dots(p.y,p.pred,"#0f8b8d",.9,4.5)}<text x="${W/2}" y="${W-6}" text-anchor="middle" font-size="11" fill="#0f2a43">experimental log10(k*)</text><text x="11" y="${W/2}" font-size="11" fill="#0f2a43" transform="rotate(-90 11 ${W/2})" text-anchor="middle">predicted log10(k*)</text></svg>
 <div class="lg"><span><i style="background:#0f8b8d"></i>Test set (40%, unseen)</span><span><i style="background:#9db4c4"></i>Training set (60%)</span></div>`}

// ---------- correlation & covariance ----------
const relWord=r=>{const a=Math.abs(r);return a>=.8?"very strong":a>=.6?"strong":a>=.4?"moderate":a>=.2?"weak":"very weak"};
const relDir=r=>Math.abs(r)<.2?"no clear link":r>0?"rise together":"one rises, the other falls";
const relNum=v=>v==null?"—":(Math.abs(v)>=100?v.toFixed(0):Math.abs(v)>=10?v.toFixed(1):v.toFixed(2));
function relMatrix(st,mode){
 const M=mode==="corr"?st.corr:st.cov,C=st.corr,nm=st.names,n=nm.length;
 // colour always shows direction + strength (from the correlation) so the two tabs read the same way; the printed number is the correlation or the covariance
 const cell=(v,i,j)=>{if(v==null)return '<td class="mx-n">—</td>';const r=C[i][j],a=r==null?0:Math.min(1,Math.abs(r)),
   bg=i===j?"rgba(100,116,139,.16)":(r>=0?`rgba(37,99,235,${(.08+.82*a).toFixed(2)})`:`rgba(220,38,38,${(.08+.82*a).toFixed(2)})`);
  const tip=i===j?`${nm[i]}: ${mode==="corr"?"compared with itself, always 1":"variance (spread) = "+v}`:`${nm[i]} and ${nm[j]}: ${mode==="corr"?"correlation "+v:"covariance "+v+" (correlation "+(r==null?"–":r.toFixed(2))+")"} – ${r==null?"":relWord(r)+", "+relDir(r)}`;
  return `<td style="background:${bg};color:${i!==j&&a>.55?"#fff":"#0f2a43"}" title="${esc(tip)}">${mode==="corr"?v.toFixed(2):relNum(v)}</td>`};
 return `<div class="mx-wrap"><table class="mx"><thead><tr><th></th>${nm.map((c,j)=>`<th class="${j===n-1?"mx-t":""}"><span>${esc(c)}</span></th>`).join("")}</tr></thead><tbody>${M.map((row,i)=>`<tr><th class="mx-r ${i===n-1?"mx-t":""}">${esc(nm[i])}</th>${row.map((v,j)=>cell(v,i,j)).join("")}</tr>`).join("")}</tbody></table></div>`}
function relPairs(st,mode){
 const n=st.names.length,ti=n-1,pairs=[],tgt=[];
 for(let i=0;i<ti;i++){const r=st.corr[i][ti];if(r!=null)tgt.push({a:st.names[i],b:st.target,r,c:st.cov[i][ti]});for(let j=i+1;j<ti;j++){const r2=st.corr[i][j];if(r2!=null)pairs.push({a:st.names[i],b:st.names[j],r:r2,c:st.cov[i][j]})}}
 const top=(L,k)=>L.sort((x,y)=>Math.abs(y.r)-Math.abs(x.r)).slice(0,k);
 const row=p=>`<li><b>${esc(p.a)}</b> &amp; <b>${esc(p.b)}</b> <span class="rv2 ${p.r>=0?"pos":"neg"}">${mode==="corr"?(p.r>0?"+":"")+p.r.toFixed(2):relNum(p.c)}</span></li>`;
 return `<div class="relgrid"><div><h4>Descriptors that move most closely together</h4><ul class="rl">${top(pairs,6).map(row).join("")}</ul></div><div><h4>Descriptors most linked to ${esc(st.target)}</h4><ul class="rl">${top(tgt,6).map(row).join("")}</ul></div></div>`}
function relView(st,mode){

 return `  <div class="rlegend"><span><i style="background:rgba(37,99,235,.85)"></i>Positive</span><span><i style="background:rgba(220,38,38,.85)"></i>Negative</span></div>
  ${relPairs(st,mode)}<h4 style="margin:16px 0 4px">Full table</h4>${relMatrix(st,mode)}`}
window.setRel=m=>{const st=S.relSt||S.ds.train.stats;$("#relbox").innerHTML=relView(st,m);["corr","cov"].forEach(k=>$("#rt_"+k).classList.toggle("on",k===m))};
function relCard(t){
 const st=t.stats;S.relSt=st;
 if(!st)return '<div class="card"><h3>Correlation &amp; covariance</h3><div class="note">Re-train to see the correlation and covariance matrices.</div></div>';
 const ti=st.names.length-1;
 return `<div class="card"><div class="card-h"><div><h3>Correlation &amp; covariance</h3></div><div class="rtabs"><button class="rtab on" id="rt_corr" onclick="setRel('corr')">Correlation</button><button class="rtab" id="rt_cov" onclick="setRel('cov')">Covariance</button></div></div>
  <div id="relbox">${relView(st,"corr")}</div></div>`}

const MODELS={SVR:["SVR","Support Vector Regression"],ANN:["ANN","Artificial Neural Network · PyTorch"]};
const modelPick=(cur,fn,annDone)=>`<div class="card mpick"><b>Model</b><div class="seg2" role="radiogroup" aria-label="Model">${["SVR","ANN"].map(k=>`<button type="button" role="radio" aria-checked="${cur===k}" class="${cur===k?"on":""}" onclick="${fn}('${k}')"><strong>${MODELS[k][0]}</strong><small>${MODELS[k][1]}${k==="ANN"&&!annDone?" · not trained yet":""}</small></button>`).join("")}</div></div>`;
const lossChart=loss=>{if(!loss||loss.length<2)return"";const W=380,H=380,p=40,lo=Math.min(...loss),hi=Math.max(...loss),x=i=>p+i/(loss.length-1)*(W-p-12),y=v=>H-p-(v-lo)/((hi-lo)||1)*(H-2*p+10);
 return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:${W}px;background:#fff;border:1px solid var(--line);border-radius:10px"><polyline fill="none" stroke="#0f8b8d" stroke-width="2" points="${loss.map((v,i)=>x(i).toFixed(1)+","+y(v).toFixed(1)).join(" ")}"/><text x="${W/2}" y="${H-8}" text-anchor="middle" font-size="11" fill="#0f2a43">epoch</text><text x="12" y="${H/2}" font-size="11" fill="#0f2a43" transform="rotate(-90 12 ${H/2})" text-anchor="middle">training loss (MSE, scaled)</text></svg>`};
// one view for both models. User side: 4 stat cards + graphs + "Screen using ..." button. Admin read-only view: also features, model table, correlation & covariance.
function modelView(m){
 const t=S.ds.train,a=S.ds.ann,isA=m==="ANN",pick=modelPick(m,"setModel",!!a);
 if(isA&&!a)return `<h2>Model Training</h2>${pick}<div class="card"><h3>ANN · Artificial Neural Network using PyTorch</h3>${VIEW?'<p class="muted">The ANN has not been trained for this dataset.</p>':'<button class="btn" onclick="runTrainAnn()">Train ANN</button>'}</div>`;
 const src=isA?a:t,mm=isA?a.comparison[0]:(t.comparison.find(x=>x.model==="SVR")||t.comparison[0]),feats=src.features,nm=m;
 const stats=`<div class="grid g4">${stat((src.n_train??t.n_train)+" / "+(src.n_test??t.n_test),"Train / test rows (60:40 by composition)")}${stat(feats.length,isA?"Features used (all of them)":"Features used (selected)")}${stat(fmt(mm.R2),"Test R²","p")}${stat(fmt(mm.MAE),"Test MAE (log units)")}</div>`;
 let extra="";
 if(VIEW){
  const ar=a&&a.architecture||{},fs=t.feature_selection,tot=!isA&&fs?fs.n_candidates:feats.length;
  const cmpRows=[...t.comparison.filter(x=>x.model==="SVR").map(x=>({...x,key:"SVR",name:"SVR"})),...(a?[{...a.comparison[0],key:"ANN",name:"ANN"}]:[])];
  extra=`<div class="card" style="margin-top:16px"><h3>${isA?"Features used by the ANN":"Selected features"} <span class="pill">${feats.length} of ${tot}</span></h3><div>${feats.map(c=>`<span class="pill">${esc(c)}</span>`).join("")}</div></div>
  <div class="card"><h3>Model comparison</h3><div class="tw"><table><thead><tr><th>Model</th><th>Test R²</th><th>Test R² (avg of repeated splits)</th><th>Test MAE (log units)</th><th>Train R²</th><th>Grouped-CV R² (train part)</th><th>Tuning</th><th>Best params</th></tr></thead><tbody>${cmpRows.map(r=>`<tr class="${r.key===m?"hl":""}"><td><b>${esc(r.name)}</b> ${r.key===m?'<span class="badge PASS">selected model</span>':""}</td><td><b>${fmt(r.R2)}</b></td><td>${r.R2_avg!=null?fmt(r.R2_avg)+" ± "+fmt(r.R2_avg_std,2)+' <span class="small">('+r.n_splits+" splits)</span>":"–"}</td><td>${fmt(r.MAE)}</td><td>${fmt(r.train_R2)}</td><td>${fmt(r.cv_R2)} ± ${fmt(r.cv_R2_std,2)}</td><td class="small">${esc(r.search)}</td><td class="small">${esc(JSON.stringify(r.params))}</td></tr>`).join("")}</tbody></table></div>
  ${isA?`<p class="small muted">ANN architecture: ${ar.input} inputs → ${(ar.hidden||[]).join(" → ")} → ${ar.output} output · ${esc(ar.activation||"")} · ${esc(ar.optimizer||"")} · ${ar.epochs} epochs · batch ${ar.batch_size} · weight decay ${ar.weight_decay}.</p>`:""}</div>
  ${relCard(src)}`}
 const lc=isA?lossChart(a.loss_curve):"";
 return `<h2>Model Training</h2>${pick}${stats}${extra}
  <div class="gr"><div class="card"><h3>${nm}: predicted vs experimental</h3>${parity(src.parity)}</div>${lc?`<div class="card"><h3>${nm}: training loss</h3>${lc}</div>`:""}${VIEW?"":`<div class="card gr-act"><button class="btn" onclick="runScreen('${m}')">Screen using ${nm}</button></div>`}</div>`}
P.performance=()=>{if(!S.ds)return $("#main").innerHTML=need();const t=S.ds.train;if(!t)return $("#main").innerHTML='<div class="note">Train the models first (Dataset Analysis page).</div>';
 if(t.n_test==null||t.n_groups==null)return $("#main").innerHTML='<div class="note">Re-train this dataset on the Dataset Analysis page.</div>';
 $("#main").innerHTML=modelView(S.model==="ANN"?"ANN":"SVR")};
// ---- Screening Results tab ----

// ---------- Cost filter helpers ----------
const funnelHtml=s=>{const f=s.funnel;if(!f||!f.length)return"";const top=Math.max(1,f[0].entered);
 return`<div class="card funnel">${f.map((x,i)=>{const w=x.passed?Math.max(1.5,100*x.passed/top):0,mid=i>0&&i<f.length-1;
  return`<div class="fn-row"><div class="fn-l"><b>${esc(x.label)}</b><small>${esc(x.rule||"")}</small></div><div class="fn-bar"><i style="width:${w.toFixed(1)}%"></i></div><div class="fn-n"><b>${x.passed}</b></div></div>`}).join("")}</div>`};
const costArgs=(res,idx,ci)=>{ci=ci||{};
 if(res==="NOT AVAILABLE")return["not available","",esc(ci.reason||ci.note||"No price available"),null];
 const mar=ci.rank?`rank ${ci.rank} of ${ci.n_priced}`:"";
 return[`≈ ${usd(idx)} · ${lvl[res]||res}`,"",mar,null]};
const costTable=ci=>{if(!ci||!ci.parts||!ci.parts.length)return ci&&ci.missing&&ci.missing.length?`<h3 style="margin-top:16px">Cost breakdown</h3><div class="note">No price for <b>${ci.missing.map(esc).join(", ")}</b>.</div>`:"";
 return`<h3 style="margin-top:16px">Cost breakdown</h3>
  <div class="tw"><table class="cbt"><thead><tr><th>Element</th><th>Stoich.</th><th>Precursor</th><th>Moles needed</th><th>Mass needed (g)</th><th>Price (USD/kg)</th><th>Cost (USD)</th><th>Share</th></tr></thead><tbody>${ci.parts.map(p=>`<tr><td><b>${esc(p.element)}</b></td><td>${fmt(p.n,3)}</td><td>${esc(p.precursor)}${p.excess_pct?` <small class="muted">(+${p.excess_pct} % excess)</small>`:""}${p.source==="admin"?' <small class="muted">(admin price)</small>':""}</td><td>${fmt(p.mol_precursor,4)}</td><td>${fmt(p.mass_g,4)}</td><td>${fmt(p.norm_price_kg,4)}</td><td>${fmt(p.cost,4)}</td><td>${fmt(p.share*100,1)} %</td></tr>`).join("")}</tbody><tfoot><tr><td colspan="6"><b>Total per mole of cathode</b></td><td colspan="2"><b>$${fmt(ci.cost_per_mol,4)}</b></td></tr><tr><td colspan="6"><b>Estimated cost per kg of cathode</b></td><td colspan="2"><b>${usd(ci.index)}</b></td></tr></tfoot></table></div>`};

// ---------- Best in category (among the PASS cathodes) ----------
const bestHtml=b=>{if(!b)return"";
 const ico={stable:"Ehull",cheapest:"Cost",active:"Activity",balanced:"Balance"};
 const cards=b.categories.map(c=>{
  if(!c.available)return`<div class="bc off"><div class="bc-t">${esc(c.title)}</div><div class="bc-f">—</div></div>`;
  const w=c.winner,tie=c.ties&&c.ties.length;
  const vals=[["Ehull",w.ehull==null?"—":fmt(w.ehull,2)+" meV/atom"],["Est. cost",w.cost==null?"—":usd(w.cost)],["log10(k*)",fmt(w.log_k,2)]];
  if(c.key==="balanced")vals.push(["Rank-sum",w.rank_sum+" ("+Object.entries(w.ranks).map(([k,v])=>k+" #"+v).join(", ")+")"]);
  return`<div class="bc click" onclick="detail(${w.id})"><div class="bc-t">${esc(c.title)}</div><div class="bc-f">${esc(w.formula)}${tie?` <span class="badge MODERATE" title="${esc(c.ties.join(", "))}">tie +${c.ties.length}</span>`:""}</div>
   <dl class="bc-v">${vals.map(v=>`<dt>${v[0]}</dt><dd>${v[1]}</dd>`).join("")}</dl></div>`}).join("");
 return`<div class="sec-t">Best in category <span class="muted" style="text-transform:none;letter-spacing:0;font-weight:400">· among the ${b.n_pass} PASS cathode${b.n_pass===1?"":"s"}</span></div>
  <div class="grid g4c">${cards}</div>`};

// ---------- Criteria card ----------
// ---------- Rankings list ----------


P.results=async()=>{
  S.filter="all";
  if(!S.ds)return $("#main").innerHTML=need();
  const s=S.ds.summary;
  if(!s)return $("#main").innerHTML='<div class="note">Not screened yet – open <a href="#" onclick="go(\'performance\');return false">Model Training</a>.</div>';
  $("#main").innerHTML=`<div class="ph"><div><h2>Screening Results</h2></div><button class="btn sec sm" onclick="S.model=S.ds.summary.model;go('performance')">Model details</button></div>
   ${modelPick(s.model==="ANN"?"ANN":"SVR","setResModel",!!S.ds.ann)}
   <div class="grid g4">${stat(s.total,"Total cathodes")}${stat(s.PASS,"PASS","p")}${stat(s.FAIL,"FAIL","f")}${s.INCOMPLETE?stat(s.INCOMPLETE,"Not evaluable","n"):""}${stat(s.pass_pct+"%","Pass rate")}</div>
   
   ${!s.ehull_available?'<div class="note bad">Ehull is <span class="na">not available</span> in this dataset.</div>':""}
   <div class="sec-t">Screening funnel</div>${funnelHtml(s)}
   <div id="best"></div>
   <div class="sec-t">Cathode ranking</div>
   <div class="card flush">
        <div class="tool"><input id="q" placeholder="Search formula…" value="${esc(S.q)}"><select id="rf" style="max-width:300px;margin:0"><option value="all">Results of all cathodes</option><option value="test">Results of test cathodes (40%)</option><option value="train">Results of training cathodes (60%)</option></select></div>
    <div class="tw"><table><thead><tr><th>Rank</th><th>Cathode / Formula</th><th>Predicted log10(k*)</th><th>Cost level</th><th>Final</th></tr></thead><tbody id="tb"></tbody></table></div>
    <p class="small muted" id="cnt" style="padding:10px 20px;margin:0"></p>
   </div>
`;
  $("#rf").onchange=e=>{S.filter=e.target.value;loadRes()};
  let tm;$("#q").oninput=e=>{S.q=e.target.value;clearTimeout(tm);tm=setTimeout(loadRes,250)};
  loadRes();loadBest();
  $("#main").insertAdjacentHTML("beforeend",exportCard());
};
async function loadBest(){try{const b=await api(`/datasets/${S.ds.id}/best`);const el=$("#best");if(el)el.innerHTML=bestHtml(b)}catch(e){}}
async function loadRes(){
  const r=await api(`/datasets/${S.ds.id}/results?filter=${S.filter}&q=${encodeURIComponent(S.q)}`);
  document.querySelectorAll(".chip").forEach(c=>c.classList.toggle("on",c.dataset.k===S.filter));
  $("#tb").innerHTML=r.map(x=>`<tr class="click t-${x.tier}${x.id===S.selId?" sel":""}" data-id="${x.id}" tabindex="0" onclick="detail(${x.id})" onkeydown="if(event.key==='Enter')detail(${x.id})"><td><b>#${x.rank}</b></td><td><a class="flink">${esc(x.formula)}</a></td><td>${fmt(x.predicted_log_kstar,2)}</td><td>${costBadge(x.cost_result)}</td><td>${badge(x.final_result)}</td></tr>`).join("");
  $("#cnt").textContent=r.length+" cathodes shown";
}

const dhtml=x=>{
 const d=x.detail,ci=d.cost||{},t=d.thresholds,f=x.final_result,p=x.orr_value,e=x.ehull,k=x.predicted_kstar,
  orrM=p-t.orr,ehM=e==null?null:t.ehull-e,adR=x.mahalanobis_distance/t.ad,dist=fmt(x.mahalanobis_distance,2),fails=[];
 if(x.ad_result==="FAIL")fails.push("Applicability domain");
 if(x.ehull_result==="FAIL")fails.push("Ehull");
 if(x.orr_result==="FAIL")fails.push("ORR activity");
 const expl=f==="FAIL"?`<div class="expl bad">Failed: ${fails.join(", ")}</div>`:f==="INCOMPLETE"&&d.not_available.length?`<div class="expl">${d.not_available.map(esc).join(" ")}</div>`:"";
 const chk=(ti,res,val,req,margin,pct)=>`<div class="chk ${String(res).replace(/ /g,"")}"><div class="t"><span>${ti}</span>${badge(res)}</div><div class="v">${val}</div>${req?`<div class="r">Requirement: ${req}</div>`:""}${margin?`<div class="r">${margin}</div>`:""}${pct!=null?`<div class="gauge"><i style="width:${Math.min(100,pct)}%;background:${res==="PASS"?"var(--pass)":"var(--fail)"}"></i></div>`:""}</div>`;
 return `<div class="dh"><div><h2>${esc(x.formula)}</h2><div class="sub">Screening result</div></div><div class="verdict ${f}">${f==="INCOMPLETE"?"NOT EVALUABLE":f}</div></div>
 ${expl}
 <h3>Screening values</h3><div class="checks">${chk("Applicability domain",x.ad_result,x.applicability_domain+" · distance "+dist,`distance ≤ ${fmt(t.ad,2)}`,"",Math.min(100,adR*100))}${chk("Ehull (stability)",x.ehull_result,e==null?"—":fmt(e,1)+" meV/atom",`≤ ${t.ehull} meV/atom`,e==null?"Not available in dataset":(ehM>=0?`${fmt(ehM,1)} below the limit`:`${fmt(-ehM,1)} above the limit`),e==null?null:e/t.ehull*100)}${chk("ORR activity",x.orr_result,"log10(k*) "+fmt(p,2),`≥ ${t.orr} (LSC benchmark)`,(orrM>=0?`${fmt(orrM,2)} above the benchmark`:`${fmt(-orrM,2)} below the benchmark`)+` · k* = ${fmt(k)} cm/s`,Math.max(0,Math.min(100,100+orrM*50)))}${chk("Estimated cost (precursors)",x.cost_result,...costArgs(x.cost_result,x.cost,ci))}</div>${costTable(ci)}`};
/* ================= 3D crystal-structure viewer (3Dmol.js) =================
   Click a cathode -> detail modal opens with a pseudo-cubic ABO3 cell built from the formula.
   3Dmol.js is loaded on first use: /3Dmol-min.js (put a local copy next to index.html to work offline), else the 3dmol.org / jsDelivr CDN. */
const V3={lib:null,el:null,viewer:null,tok:0,spin:true,cur:null};
const V3_SRC=["/3Dmol-min.js","https://3Dmol.org/build/3Dmol-min.js","https://cdn.jsdelivr.net/npm/3dmol/build/3Dmol-min.js"];
const V3_CLR={A:["#2f6bff","#6a4cf0","#00a6d6","#5b8def","#8a7bff"],B:["#0f9d94","#22b573","#0b7285","#6fd3a5","#3aa6a0"],O:"#e5484d"};
const V3_RAD={A:.62,B:.42,O:.34};
const V3_A_DEF=new Set("Li Na K Rb Cs Ca Sr Ba La Nd Pm Sm Eu Gd Dy Ho Er Tm Yb Lu Bi Pb".split(" "));   // always A-site
const V3_AMB=new Set("Y Sc Ce Pr Tb".split(" "));                                                       // A or B depending on position

function v3Load(){
 if(window.$3Dmol)return Promise.resolve();
 if(V3.lib)return V3.lib;
 V3.lib=(async()=>{
  for(const src of V3_SRC){
   try{await new Promise((ok,no)=>{const s=document.createElement("script");s.src=src;s.async=true;s.onload=ok;s.onerror=()=>{s.remove();no()};document.head.appendChild(s)});
       if(window.$3Dmol)return}catch(_){}
  }
  V3.lib=null;throw new Error("3Dmol.js could not be loaded");
 })();
 return V3.lib;
}

/* formula -> {A:[{el,f}],B:[{el,f}],ox}   (f = fraction of that site, each site sums to 1) */
function v3Parse(formula){
 const f=String(formula||"").replace(/[\u2080-\u2089]/g,c=>String(c.charCodeAt(0)-0x2080)).replace(/\s+/g,"").split(/[-±+δ]/)[0];
 if(!/^(?:[A-Z][a-z]?\d*\.?\d*)+$/.test(f))return null;
 const metals=[];let ox=0;
 for(const m of f.matchAll(/([A-Z][a-z]?)(\d*\.?\d*)/g)){
  const n=(m[2]===""||m[2]===".")?1:parseFloat(m[2]);
  if(m[1]==="O")ox+=n;else if(n>0){const e=metals.find(t=>t.el===m[1]);if(e)e.n+=n;else metals.push({el:m[1],n})}
 }
 if(metals.length<2)return null;
 let A=null,B=null;
 // 1) normal ABO3 formulas: the metals written first add up to 1 (A-site), the rest add up to 1 (B-site)
 let s=0;
 for(let i=0;i<metals.length-1;i++){
  s+=metals[i].n;
  if(Math.abs(s-1)<.02){
   const rest=metals.slice(i+1),sr=rest.reduce((a,t)=>a+t.n,0);
   if(Math.abs(sr-1)<.02&&!rest.some(t=>V3_A_DEF.has(t.el))){A=metals.slice(0,i+1);B=rest}
   break;
  }
  if(s>1.02)break;
 }
 // 2) anything else (double perovskites, non-unit totals): classify by element
 if(!A){
  A=[];B=[];let sumA=0,seenB=false;
  for(const t of metals){
   let toA=V3_A_DEF.has(t.el);
   if(!toA&&V3_AMB.has(t.el))toA=!seenB&&sumA+t.n<=1.0001;
   if(toA){A.push(t);sumA+=t.n}else{B.push(t);seenB=true}
  }
 }
 if(!A.length||!B.length)return null;
 const sa=A.reduce((a,t)=>a+t.n,0),sb=B.reduce((a,t)=>a+t.n,0);
 return{A:A.map(t=>({el:t.el,f:t.n/sa})),B:B.map(t=>({el:t.el,f:t.n/sb})),ox:ox?ox/sb:3};
}
/* largest-remainder allocation of N sites between the elements of one site (every element gets >=1 site) */
function v3Alloc(items,N){
 const raw=items.map(t=>t.f*N),cnt=raw.map(Math.floor);
 let left=N-cnt.reduce((a,b)=>a+b,0);
 items.map((_,i)=>i).sort((i,j)=>(raw[j]-cnt[j])-(raw[i]-cnt[i])).slice(0,left).forEach(i=>cnt[i]++);
 cnt.forEach((c,i)=>{if(c===0){const m=cnt.indexOf(Math.max(...cnt));cnt[m]--;cnt[i]=1}});
 const out=[];cnt.forEach((c,i)=>{for(let k=0;k<c;k++)out.push(items[i].el)});
 return{out,cnt};
}
function v3Hash(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return h>>>0}
function v3Rng(seed){let a=seed>>>0;return()=>{a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
function v3Shuffle(a,r){for(let i=a.length-1;i>0;i--){const j=Math.floor(r()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}
/* smallest cubic supercell (1,2,3 cells per edge) whose site counts reproduce the formula fractions within 3 % */
function v3PickN(p){
 let best=1,bestE=9;
 for(const n of [1,2,3]){
  const N=n*n*n,e=Math.max(...[p.A,p.B].map(it=>{const{cnt}=v3Alloc(it,N);return Math.max(...cnt.map((c,i)=>Math.abs(c/N-it[i].f)))}));
  if(e<=.03)return n;
  if(e<bestE){bestE=e;best=n}
 }
 return best;
}
/* pseudo-cubic perovskite supercell as an .xyz string: A at cell corners, B at cell centres, O at edge midpoints of the B sub-lattice (octahedra complete) */
function v3Build(p,formula){
 const a=3.9,n=v3PickN(p),N=n*n*n,r=v3Rng(v3Hash(formula));
 const aa=v3Alloc(p.A,N),bb=v3Alloc(p.B,N);
 const sA=v3Shuffle(aa.out.slice(),r),sB=v3Shuffle(bb.out.slice(),r);
 const idx=(i,j,k)=>((i%n)*n+(j%n))*n+(k%n),atoms=[];
 const put=(el,role,x,y,z)=>atoms.push({el,role,x:x*a,y:y*a,z:z*a});
 for(let i=0;i<=n;i++)for(let j=0;j<=n;j++)for(let k=0;k<=n;k++)put(sA[idx(i,j,k)],"A",i,j,k);          // boundary A atoms are periodic images, so octahedra/cube edges look complete
 for(let i=0;i<n;i++)for(let j=0;j<n;j++)for(let k=0;k<n;k++)put(sB[idx(i,j,k)],"B",i+.5,j+.5,k+.5);
 for(let i=0;i<n;i++)for(let j=0;j<n;j++)for(let k=0;k<=n;k++)put("O","O",i+.5,j+.5,k);
 for(let i=0;i<n;i++)for(let k=0;k<n;k++)for(let j=0;j<=n;j++)put("O","O",i+.5,j,k+.5);
 for(let j=0;j<n;j++)for(let k=0;k<n;k++)for(let i=0;i<=n;i++)put("O","O",i,j+.5,k+.5);
 const xyz=atoms.length+"\n"+formula+" - pseudo-cubic ABO3, "+n+"x"+n+"x"+n+" supercell, a = "+a+" A (schematic)\n"+atoms.map(t=>t.el+" "+t.x.toFixed(4)+" "+t.y.toFixed(4)+" "+t.z.toFixed(4)).join("\n");
 return{xyz,atoms,n,a,N,cntA:aa.cnt,cntB:bb.cnt};
}
function v3Colors(p){const c={};p.A.forEach((t,i)=>c[t.el]=V3_CLR.A[i%V3_CLR.A.length]);p.B.forEach((t,i)=>c[t.el]=V3_CLR.B[i%V3_CLR.B.length]);c.O=V3_CLR.O;return c}

/* left-hand panel: viewer slot, buttons, legend, key properties */
function v3Panel(x){
 const p=v3Parse(x.formula),o=(x.detail&&x.detail.original)||{};
 const pick=re=>{const k=Object.keys(o).find(k=>re.test(k.replace(/[^a-z]/gi,"")));const v=k==null?NaN:parseFloat(o[k]);return Number.isFinite(v)?v:null};
 const logk=x.orr_value!=null?x.orr_value:x.predicted_log_kstar;
 const rows=[["Rank","#"+(x.rank??"—")],["Predicted log10(k*)",fmt(logk,2)],["Predicted k*",fmt(x.predicted_kstar)+" cm/s"],["Ehull",x.ehull==null?"—":fmt(x.ehull,1)+" meV/atom"],["Est. precursor cost",usd(x.cost)+(lvl[x.cost_result]?" · "+lvl[x.cost_result]:"")]];
 [["TEC",/^tec$/i],["O p-band center",/^opband/i],["Band gap",/^(gap|bandgap)$/i],["Work function",/^workfunction$/i],["O-vacancy energy",/^(oxidevacancy|ovacancy)/i]].forEach(([n,re])=>{const v=pick(re);if(v!=null)rows.push([n,fmt(v,3)])});
 rows.push(["Final result",badge(x.final_result)]);
 let leg="",note="";
 if(p){
  const col=v3Colors(p),st=v3Build(p,x.formula);
  const li=(el,role,sub)=>`<div class="v3-li"><i style="background:${col[el]}"></i><b>${esc(el)}</b><span>${role}</span><em>${sub}</em></div>`;
  leg=p.A.map(t=>li(t.el,"A-site",Math.round(t.f*100)+"%")).join("")+p.B.map(t=>li(t.el,"B-site",Math.round(t.f*100)+"%")).join("")+li("O","Oxygen",(Math.abs(p.ox-3)<.05?"3":fmt(p.ox,2))+" per ABO₃");
  note=`${st.n}×${st.n}×${st.n} pseudo-cubic supercell (a = ${st.a} Å, ${st.N} A / ${st.N} B / ${3*st.N} O sites). Mixed sites are filled in proportion to the formula; the layout is illustrative, not a relaxed structure.`+(Math.abs(p.ox-3)>.05?` The formula has O${fmt(p.ox,2)} per ABO₃; the cell is drawn fully oxygenated.`:"");
 }else leg='<div class="v3-li"><span>Could not read the formula as ABO₃.</span></div>';
 return`<div class="v3"><div class="v3-h">Crystal structure<small>Pseudo-cubic ABO₃ unit cell · drag to rotate, scroll to zoom</small></div>
  <div class="v3-slot" id="v3slot"><div class="v3-msg">Loading 3D viewer…</div></div>
  <div class="v3-bar"><button class="btn sec sm" id="v3spin">Pause</button><button class="btn sec sm" id="v3reset">Reset view</button><button class="btn sec sm" id="v3dl">Download .xyz</button></div>
  <div class="v3-leg">${leg}</div>${note?`<p class="v3-note">${note}</p>`:""}
  <table class="v3-props">${rows.map(r=>`<tr><td>${r[0]}</td><td>${r[1]}</td></tr>`).join("")}</table></div>`;
}
async function v3Mount(x){
 const slot=document.getElementById("v3slot");if(!slot)return;
 const tok=++V3.tok,msg=t=>{if(tok===V3.tok&&document.getElementById("v3slot")===slot)slot.innerHTML=`<div class="v3-msg">${t}</div>`};
 const p=v3Parse(x.formula);
 if(!p)return msg("A 3D cell could not be built for this formula.");
 const st=v3Build(p,x.formula),col=v3Colors(p),role={};
 p.A.forEach(t=>role[t.el]="A-site");p.B.forEach(t=>role[t.el]="B-site");role.O="Oxygen";
 V3.cur={xyz:st.xyz,name:x.formula};
 const dl=document.getElementById("v3dl");
 if(dl)dl.onclick=()=>{const u=URL.createObjectURL(new Blob([st.xyz],{type:"chemical/x-xyz"})),a=document.createElement("a");a.href=u;a.download=x.formula.replace(/[^\w.-]/g,"_")+".xyz";document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),1000)};
 try{await v3Load()}catch(e){return msg("The 3D viewer library could not be loaded (needs internet once, or place <code>3Dmol-min.js</code> next to index.html). You can still download the .xyz file.")}
 if(tok!==V3.tok||document.getElementById("v3slot")!==slot)return;
 try{
  if(!V3.el){V3.el=document.createElement("div");V3.el.id="v3d"}
  slot.innerHTML="";slot.appendChild(V3.el);
  if(!V3.viewer)V3.viewer=$3Dmol.createViewer(V3.el,{backgroundColor:"#f3f8fe",antialias:true});
  const v=V3.viewer;
  v.spin(false);v.clear();v.resize();
  v.addModel(st.xyz,"xyz");
  Object.keys(col).forEach(el=>v.setStyle({elem:el},{sphere:{radius:V3_RAD[el==="O"?"O":role[el]==="A-site"?"A":"B"],color:col[el]}}));
  const L=st.n*st.a,bond=(s,e,r,c)=>v.addCylinder({start:{x:s[0],y:s[1],z:s[2]},end:{x:e[0],y:e[1],z:e[2]},radius:r,color:c,fromCap:true,toCap:true});
  const Bs=st.atoms.filter(t=>t.role==="B"),Os=st.atoms.filter(t=>t.role==="O");
  Bs.forEach(b=>Os.forEach(o=>{if(Math.hypot(b.x-o.x,b.y-o.y,b.z-o.z)<st.a/2+.1)bond([b.x,b.y,b.z],[o.x,o.y,o.z],.09,"#7f93aa")}));   // B-O octahedra
  [[0,0],[L,0],[0,L],[L,L]].forEach(([u,w])=>{bond([u,w,0],[u,w,L],.03,"#9db2c8");bond([u,0,w],[u,L,w],.03,"#9db2c8");bond([0,u,w],[L,u,w],.03,"#9db2c8")});   // cell edges
  try{v.setHoverable({},true,(at,vw)=>{if(!at.label)at.label=vw.addLabel(at.elem+" · "+(role[at.elem]||""),{position:at,backgroundColor:"#0f2a43",backgroundOpacity:.88,fontColor:"white",fontSize:12,borderThickness:0})},(at,vw)=>{if(at.label){vw.removeLabel(at.label);delete at.label}})}catch(_){}
  v.zoomTo();v.render();
  const reduce=window.matchMedia&&matchMedia("(prefers-reduced-motion: reduce)").matches;
  V3.spin=!reduce;const sp=document.getElementById("v3spin");
  if(V3.spin)v.spin("y",.6);if(sp)sp.textContent=V3.spin?"Pause":"Spin";
  if(sp)sp.onclick=()=>{V3.spin=!V3.spin;if(V3.spin)v.spin("y",.6);else v.spin(false);sp.textContent=V3.spin?"Pause":"Spin"};
  const rs=document.getElementById("v3reset");if(rs)rs.onclick=()=>{v.zoomTo();v.render()};
 }catch(e){console.error(e);msg("The 3D viewer could not draw this structure. You can still download the .xyz file.")}
}
function closeModal(){
 $("#modal").classList.add("hidden");$(".mbox").classList.remove("wide");
 try{if(V3.viewer)V3.viewer.spin(false)}catch(_){}
}
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!$("#modal").classList.contains("hidden"))closeModal()});
$("#modal").addEventListener("mousedown",e=>{if(e.target===$("#modal"))closeModal()});
function markSel(){document.querySelectorAll("#tb tr").forEach(r=>r.classList.toggle("sel",+r.dataset.id===S.selId))}
window.detail=async id=>{
 S.selId=id;markSel();                                              // 1) highlight the selected cathode row
 const x=await api(`/datasets/${S.ds.id}/results/${id}`);S.sel=x;
 $("#mbody").innerHTML=`<div class="dmod">${v3Panel(x)}<div class="dmain">${dhtml(x)}</div></div>`;   // 2) detail panel + viewer slot
 $(".mbox").classList.add("wide");$("#modal").classList.remove("hidden");
 v3Mount(x);                                                        // 3) build .xyz from the formula and render with 3Dmol.js
};
// ---------- Predict a single cathode (uses the saved model + saved training data) ----------
const checksHtml=o=>{
 const t=o.thresholds,p=o.pred_log,e=o.ehull,orrM=p-t.orr,ehM=e==null?null:t.ehull-e,adR=o.dist/t.ad;
 const chk=(ti,res,val,req,margin,pct)=>`<div class="chk ${String(res).replace(/ /g,"")}"><div class="t"><span>${ti}</span>${badge(res)}</div><div class="v">${val}</div>${req?`<div class="r">Requirement: ${req}</div>`:""}${margin?`<div class="r">${margin}</div>`:""}${pct!=null?`<div class="gauge"><i style="width:${Math.min(100,pct)}%;background:${res==="PASS"?"var(--pass)":"var(--fail)"}"></i></div>`:""}</div>`;
 return `<div class="checks one">${chk("Applicability domain",o.ad_result,(o.ad==="INSIDE"?"INSIDE":"OUTSIDE")+" · distance "+fmt(o.dist,2),`distance ≤ ${fmt(t.ad,2)}`,"",Math.min(100,adR*100))}${chk("Ehull (stability)",o.ehull_result,e==null?"not entered":fmt(e,1)+" meV/atom",`≤ ${t.ehull} meV/atom`,e==null?"":(ehM>=0?`${fmt(ehM,1)} below the limit`:`${fmt(-ehM,1)} above the limit`),e==null?null:e/t.ehull*100)}${chk("ORR activity",o.orr_result,"log10(k*) "+fmt(p,2),`≥ ${t.orr} (LSC benchmark)`,orrM>=0?`${fmt(orrM,2)} above the benchmark`:`${fmt(-orrM,2)} below the benchmark`,Math.max(0,Math.min(100,100+orrM*50)))}${chk("Estimated cost (precursors)",o.cost_result,...costArgs(o.cost_result,o.cost,o.cost_info))}</div>`};
const whyHtml=o=>{
 const f=o.final,fails=[];
 if(o.ad_result==="FAIL")fails.push("Applicability domain");
 if(o.ehull_result==="FAIL")fails.push("Ehull");
 if(o.orr_result==="FAIL")fails.push("ORR activity");
 if(f==="FAIL")return `<div class="expl bad">Failed: ${fails.join(", ")}</div>`;
 if(f==="INCOMPLETE"&&(o.not_available||[]).length)return `<div class="expl">${o.not_available.map(esc).join(" ")}</div>`;
 return ""};
const cmpHtml=c=>{
 const out=c.ranges.filter(r=>!r.inside);
 return `<h3 style="margin-top:16px">Compared with the saved training data</h3>
  ${out.length?`<div class="note"><b>${out.length} of ${c.ranges.length} descriptors</b> outside the training data: ${out.map(r=>`${esc(r.feature)} (${fmt(r.value,3)})`).join(", ")}.</div>`:""}
  <div class="tw"><table><thead><tr><th>Most similar training cathodes</th><th>Distance</th><th>Experimental log10(k*)</th></tr></thead><tbody>${c.nearest.map(n=>`<tr><td><b>${esc(n.formula)}</b></td><td>${fmt(n.distance,2)}</td><td>${fmt(n.log_k,2)}</td></tr>`).join("")}</tbody></table></div>`};
const predHtml=o=>`<div class="card pres"><div class="pv ${o.final}"><div><div class="pv-s">${esc(o.formula)}</div><div class="pv-n">${o.final==="INCOMPLETE"?"NOT EVALUABLE":o.final}</div></div><div class="pv-r"><div class="pv-k">${fmt(o.pred_log,2)}</div><div class="pv-s">predicted log10(k*)</div><div class="pv-s">k* = ${fmt(o.pred_k)} cm/s</div></div></div>
  ${whyHtml(o)}<h3>Screening values</h3>${checksHtml(o)}${costTable(o.cost_info)}
  ${cmpHtml(o.compare)}</div>`;
P.predictHistory=async()=>{const list=await api(`/datasets/${S.ds.id}/predictions`);window._ph=list;
 const kv=o=>`<div class="tw"><table><tbody>${Object.entries(o).map(([k,v])=>`<tr><td>${esc(k)}</td><td><b>${v==null?"—":typeof v==="number"?fmt(v):esc(v)}</b></td></tr>`).join("")}</tbody></table></div>`;
 window.phDetail=i=>{const p=window._ph[i],r=p.result;$("#mbody").innerHTML=`<h3>${esc(p.formula)} ${badge(r.final)}</h3><p class="muted small">${esc(p.model)} · ${esc(p.created)}</p><h4>Input values</h4>${kv(p.inputs)}<h4 style="margin-top:14px">Prediction results</h4>${kv({"Predicted log10(k*)":r.pred_log,"Predicted k* (cm/s)":r.pred_k,"Mahalanobis distance":r.dist,"Applicability domain":r.ad_result,"Ehull check":r.ehull_result,"ORR check":r.orr_result,"Est. cost":r.cost==null?null:usd(r.cost),"Cost level":r.cost_result,"Final":r.final})}`;$("#modal").classList.remove("hidden")};
 $("#pmount").innerHTML=`<div class="card flush"><div class="tw"><table><thead><tr><th>Cathode</th><th>Model</th><th>Predicted log10(k*)</th><th>Final</th><th>Date &amp; time</th></tr></thead><tbody>${list.map((p,i)=>`<tr style="cursor:pointer" onclick="phDetail(${i})"><td><b>${esc(p.formula)}</b></td><td>${esc(p.model)}</td><td>${fmt(p.result.pred_log,2)}</td><td>${badge(p.result.final)}</td><td class="muted small">${esc(p.created)}</td></tr>`).join("")||'<tr><td colspan="5" class="muted" style="padding:18px">This user has not made any single-cathode predictions on this dataset.</td></tr>'}</tbody></table></div></div>`};
P.predict=()=>{
 if(!S.ds||!$("#pmount"))return;if(VIEW)return P.predictHistory();const t=S.ds.train;
 if(!t)return $("#pmount").innerHTML='<div class="note">This dataset has not been trained yet.</div>';
 const cur=()=>S.pmodel==="ANN"&&S.ds.ann?S.ds.ann:t;
 const lab={};(cur().shap||[]).forEach(x=>lab[x.feature]=x.label);const st=cur().feature_stats||{};
 if(S.pmodel==="ANN"&&!S.ds.ann)S.pmodel="SVR";
 $("#pmount").innerHTML=`<div class="pred-grid solo" id="pgrid"><div class="card">
   <div class="mpick-in"><b>Prediction model</b><div class="seg2" role="radiogroup" aria-label="Prediction model"><button type="button" role="radio" aria-checked="${S.pmodel==="SVR"}" class="${S.pmodel==="SVR"?"on":""}" onclick="setPredModel('SVR')"><strong>SVR</strong><small>Support Vector Regression</small></button><button type="button" role="radio" aria-checked="${S.pmodel==="ANN"}" class="${S.pmodel==="ANN"?"on":""}" ${S.ds.ann?"":"disabled title='Train the ANN on the Model Training page first'"} onclick="setPredModel('ANN')"><strong>ANN</strong><small>Artificial Neural Network${S.ds.ann?"":" · not trained yet"}</small></button></div></div>
   
   <label>Cathode name / formula<input id="pf_name" placeholder="e.g. La0.6Sr0.4CoO3" maxlength="60"></label>
   <div class="fgrid" id="pf_grid">${cur().features.map(c=>{const s=st[c]||{};return `<label class="fld"><span class="fl-k">${esc(c)}</span><span class="fl-l">${esc(lab[c]||c)}</span><input type="number" step="any" data-f="${esc(c)}" placeholder="${s.median!=null?"e.g. "+fmt(s.median,3):"value"}"></label>`}).join("")}</div>
   <h3 style="margin-top:18px">Stability</h3>
   <label class="fld" style="max-width:340px"><span class="fl-k">Ehull</span><span class="fl-l">Energy above hull (meV/atom)</span><input type="number" step="any" id="pf_eh" placeholder="e.g. 30"><span class="fl-h">Limit: ≤ 57 meV/atom</span></label>
   <div style="margin-top:18px;display:flex;gap:10px;flex-wrap:wrap"><button class="btn" id="pbtn" onclick="runPredict()">Predict</button><button class="btn sec" onclick="fillPred()">Fill with typical values</button><button class="btn sec" onclick="clearPred()">Clear</button></div></div>
  <div id="predres" class="pred-res"></div></div>`;
 document.querySelectorAll("[data-f],#pf_eh,#pf_name").forEach(i=>i.addEventListener("keydown",e=>{if(e.key==="Enter")runPredict()}));
};
window.setPredModel=m=>{const keep={};document.querySelectorAll("[data-f]").forEach(i=>{if(i.value!=="")keep[i.dataset.f]=i.value});const eh=$("#pf_eh").value,nm=$("#pf_name").value;
 S.pmodel=m;P.predict();$("#pf_eh").value=eh;$("#pf_name").value=nm;document.querySelectorAll("[data-f]").forEach(i=>{if(keep[i.dataset.f]!==undefined)i.value=keep[i.dataset.f]})};
window.fillPred=()=>{const st=(S.pmodel==="ANN"&&S.ds.ann?S.ds.ann:S.ds.train).feature_stats||{};document.querySelectorAll("[data-f]").forEach(i=>{const s=st[i.dataset.f];if(s&&s.median!=null)i.value=+s.median.toPrecision(5)})};
window.clearPred=()=>{document.querySelectorAll("[data-f],#pf_eh,#pf_name").forEach(i=>i.value="");$("#predres").innerHTML="";$("#pgrid").classList.add("solo")};
window.runPredict=async()=>{
 const values={};document.querySelectorAll("[data-f]").forEach(i=>{if(i.value.trim()!=="")values[i.dataset.f]=i.value});
 if(!Object.keys(values).length)return toast("Enter at least one descriptor value.");
 const b=$("#pbtn");b.disabled=true;b.textContent="Predicting…";
 try{const o=await api(S.ds.shared?"/shared/predict":`/datasets/${S.ds.id}/predict`,{json:{values,ehull:$("#pf_eh").value,formula:$("#pf_name").value,model:S.pmodel}});$("#predres").innerHTML=predHtml(o);$("#pgrid").classList.remove("solo")}
 catch(e){toast(e.message);$("#predres").innerHTML=`<div class="note bad">${esc(e.message)}</div>`;$("#pgrid").classList.remove("solo")}
 finally{b.disabled=false;b.textContent="Predict"}};

window.exportCard=()=>{const n=S.ds.filename.replace(/\.[^.]+$/,"");
 return `<div class="sec-t">Export results</div><div class="card">
 <div class="exp-list" style="margin-top:0"><button class="btn exp-btn" onclick="dl('/datasets/${S.ds.id}/export/all','${n}_all.xlsx')"><svg class="ei" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></svg><span class="et"><b>Complete Results Excel</b></span><svg class="ed" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 11l5 5 5-5M5 20h14"/></svg></button><button class="btn exp-btn" onclick="dl('/datasets/${S.ds.id}/export/pass','${n}_PASS.xlsx')"><svg class="ei" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></svg><span class="et"><b>PASS Cathodes Excel</b></span><svg class="ed" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 11l5 5 5-5M5 20h14"/></svg></button><button class="btn exp-btn" onclick="dl('/datasets/${S.ds.id}/export/fail','${n}_FAIL.xlsx')"><svg class="ei" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></svg><span class="et"><b>FAIL Cathodes Excel</b></span><svg class="ed" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 11l5 5 5-5M5 20h14"/></svg></button><button class="btn exp-btn" onclick="dl('/datasets/${S.ds.id}/export/csv','${n}_results.csv')"><svg class="ei" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 12h6M9 15h6M9 18h3"/></svg><span class="et"><b>Results CSV</b></span><svg class="ed" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 11l5 5 5-5M5 20h14"/></svg></button></div></div>`};
show();
setInterval(()=>{if(S.token&&!VIEW&&!document.hidden)api("/ping").catch(()=>{})},30000); // heartbeat: keeps "active" status accurate for the admin dashboard

/* ---- scroll-reveal: cards / sections slide up 60px and fade in over 1.2s when they enter the viewport ---- */
(()=>{
 if(!("IntersectionObserver" in window)||(window.matchMedia&&matchMedia("(prefers-reduced-motion: reduce)").matches))return;
 const SEL=".ph,.card,.stat,.crit,.ds,.tile,.kpi,.note,.pres,.expl,details,#main>h2";
 const io=new IntersectionObserver(es=>{
  for(const e of es){
   if(!e.isIntersecting)continue;
   const el=e.target; io.unobserve(el);
   requestAnimationFrame(()=>el.classList.add("in"));
   // after the animation, drop the helper classes so normal hover/transition styles are untouched
   setTimeout(()=>{el.classList.remove("rv","in");el.style.transitionDelay=""},1200+(parseInt(el.style.transitionDelay)||0)+150);
  }
 },{threshold:.06,rootMargin:"0px 0px -5% 0px"});
 const prep=root=>{
  const seen=new Map();
  root.querySelectorAll(SEL).forEach(el=>{
   if(el.dataset.rv)return;
   const up=el.parentElement&&el.parentElement.closest(SEL);
   if(up&&root.contains(up))return;                       // nested inside another revealed block: skip
   el.dataset.rv="1";
   const n=seen.get(el.parentElement)||0; seen.set(el.parentElement,n+1);
   el.style.transitionDelay=Math.min(n*80,400)+"ms";       // gentle stagger for siblings
   el.classList.add("rv"); io.observe(el);
  });
 };
 const watch=id=>{const root=document.getElementById(id); if(!root)return;
  new MutationObserver(ms=>{if(ms.some(m=>m.addedNodes.length))prep(root)}).observe(root,{childList:true});
  if(root.children.length)prep(root);
 };
 watch("main"); watch("mbody");
})();
