/* Per-cathode .cif viewer and SCOPE report (PASS report = preparation + lab validation, FAIL report = why it failed + how to make it pass).
   Data comes from /api/datasets/<id>/results/<rid>/cif and /report (backend/report.py). Uses helpers of app.js ($, api, S, toast, v3Parse, v3Build, V3_RAD). */
(()=>{
const E=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const N=(v,d=2)=>v==null||!isFinite(v)?"—":(+v).toFixed(d);
const sf=f=>E(f).replace(/(\d+(?:\.\d+)?)/g,"<sub>$1</sub>");
const sci=(v,d=1)=>{if(v==null||!isFinite(v)||v<=0)return"—";const e=Math.floor(Math.log10(v)),m=v/Math.pow(10,e),sup=String(e).replace(/-/g,"⁻").replace(/\d/g,c=>"⁰¹²³⁴⁵⁶⁷⁸⁹"[c]);return`${m.toFixed(d)} ×10${sup}`};
const PA=["#a259f0","#3b6cf0","#00a6d6","#8a7bff","#5b8def"],PB=["#7ac70c","#f5a524","#14a39a","#e0559a","#6b7a90","#c9a227"],OXC="#e5484d";
const colors=R=>{const c={};R.A.forEach((s,i)=>c[s.el]=PA[i%PA.length]);R.B.forEach((s,i)=>c[s.el]=PB[i%PB.length]);c.O=OXC;return c};
const mix=(hex,k)=>{const n=parseInt(hex.slice(1),16),f=x=>Math.round(x+(255-x)*k);return`rgb(${f(n>>16&255)},${f(n>>8&255)},${f(n&255)})`};

/* ---------- static 3D view (isometric SVG of the same pseudo-cubic supercell the app shows) ---------- */
function cube3d(R,col){
 const p=typeof v3Parse==="function"?v3Parse(R.formula):null;if(!p)return'<div class="nocube">3D view not available for this formula.</div>';
 const st=v3Build(p,R.formula),L=st.n*st.a,c=L/2,W=420,H=420,ry=.62,rx=-.42,cy=Math.cos(ry),sy=Math.sin(ry),cx=Math.cos(rx),sx=Math.sin(rx),sc=W/(L*1.95);
 const pr=(x,y,z)=>{x-=c;y-=c;z-=c;const x1=x*cy+z*sy,z1=-x*sy+z*cy,y2=y*cx-z1*sx,z2=y*sx+z1*cx;return[W/2+x1*sc,H/2-y2*sc,z2]};
 const RAD={A:.34,B:.25,O:.16},items=[];
 const cs=[0,L],cor=[];cs.forEach(x=>cs.forEach(y=>cs.forEach(z=>cor.push([x,y,z]))));
 cor.forEach((a,i)=>cor.forEach((b,j)=>{if(i<j&&(a[0]!==b[0])+(a[1]!==b[1])+(a[2]!==b[2])===1){const u=pr(...a),v=pr(...b);items.push({z:-1e3,l:[u,v],w:1,c:"#9aa9bb"})}}));
 const Bs=st.atoms.filter(t=>t.role==="B"),Os=st.atoms.filter(t=>t.role==="O");
 Bs.forEach(b=>Os.forEach(o=>{if(Math.hypot(b.x-o.x,b.y-o.y,b.z-o.z)<st.a/2+.1){const u=pr(b.x,b.y,b.z),v=pr(o.x,o.y,o.z);items.push({z:(u[2]+v[2])/2-.01,l:[u,v],w:.9,c:"#7f93aa"})}}));
 st.atoms.forEach(t=>{const q=pr(t.x,t.y,t.z);items.push({z:q[2],q,r:RAD[t.role]*sc*(1+q[2]/(L*6)),el:t.el})});
 items.sort((a,b)=>a.z-b.z);
 const ids=Object.keys(col),defs=ids.map(el=>`<radialGradient id="g${el}" cx=".35" cy=".32" r=".75"><stop offset="0" stop-color="${mix(col[el],.55)}"/><stop offset=".6" stop-color="${col[el]}"/><stop offset="1" stop-color="${col[el]}"/></radialGradient>`).join("");
 const body=items.map(it=>it.l?`<line x1="${it.l[0][0].toFixed(1)}" y1="${it.l[0][1].toFixed(1)}" x2="${it.l[1][0].toFixed(1)}" y2="${it.l[1][1].toFixed(1)}" stroke="${it.c}" stroke-width="${it.w}"/>`:`<circle cx="${it.q[0].toFixed(1)}" cy="${it.q[1].toFixed(1)}" r="${Math.max(1.6,it.r).toFixed(1)}" fill="url(#g${it.el})"/>`).join("");
 return`<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg"><defs>${defs}</defs>${body}</svg>`;
}
const donut=(rows,col,label)=>{let a=0;const stops=rows.map(r=>{const s=a;a+=r.pct;return`${col[r.el]} ${s}% ${Math.min(100,a)}%`}).join(",");return`<div class="donut" style="background:conic-gradient(${stops})"><i>${label}</i></div>`};
const siteRows=(rows,col)=>rows.map(r=>`<div class="srow"><span class="dot" style="background:${col[r.el]}"></span><b>${E(r.el)}</b><small>${E(r.cls)}</small><em>${N(r.pct,0)} %</em><div class="sbar"><i style="width:${r.pct}%;background:${col[r.el]}"></i></div></div>`).join("");

/* ---------- pages ---------- */
const head=(R,sub)=>`<div class="ph"><img src="/logo.png" alt=""><div><div class="ph-t">SCOPE</div><div class="ph-s">${E(sub)}</div></div></div>`;
const bar=(R)=>`<div class="bar"><img src="/logo.png" alt=""><b>SCOPE</b><span>Cathode screening report</span><div class="bar-f">${sf(R.formula)}</div><div class="bar-id">${E(R.id)}</div></div>`;
const foot=(n,R)=>`<div class="foot"><span>SCOPE (NGIT) · machine-learning screening report · predictions are estimates, not measurements</span><b>Page ${n} / 5</b></div>`;
const ico=ok=>`<span class="ic ${ok?"ok":"no"}">${ok?"✓":"✕"}</span>`;
const sec=(num,t,sub)=>`<div class="sec"><i></i><div><h2>${num?num+" ":""}${E(t)}</h2>${sub?`<p>${E(sub)}</p>`:""}</div></div>`;
const fails=R=>R.metrics.filter(m=>!m.ok);

function page1(R){
 const pass=R.final==="PASS",col=colors(R),c=R.cell,F=fails(R);
 const cards=R.metrics.map(m=>{
  const lim=m.key==="orr"?N(m.limit,2).replace("-","−"):m.limit,thr=`Threshold: ${m.op} ${lim} ${m.unit}`,extra=pass?"":(m.ok?`Passes with ${N(m.diff,m.dec)} to spare`:`Over the limit by ${N(m.diff,m.dec)}`);
  const under=m.key==="orr"&&!m.ok?`Below the limit by ${N(m.diff,m.dec)}`:extra;
  return`<div class="mc ${m.ok?"":"bad"}">${ico(m.ok)}<div class="mn">${E(m.name)}</div><div class="mv">${N(m.value,m.dec)} <small>${E(m.unit)}</small></div><div class="mt ${m.ok?"g":"r"}">${E(thr)}${under?`<br>${E(under)}`:""}</div></div>`}).join("");
 let banner;
 if(!pass){const names=F.map(m=>m.name.split(" (")[0].replace("ORR activity, log₁₀","ORR activity")).join(", ");banner=`<div class="bn red">${ico(false)}<div><b>Not recommended for the lab.</b> ${F.length} of 3 screening filters failed (${E(names)}). Reasons are in Section 3 and ways to make it pass are in Section 4.</div></div>`}
 else if(R.close.length)banner=`<div class="bn amber"><span class="ic am">!</span><div><b>Heads-up:</b> the ${E(R.close.join(" and ").toLowerCase())} value${R.close.length>1?"s are":" is"} very close to its limit. Test it first in the lab (Section 4).</div></div>`;
 else banner=`<div class="bn green">${ico(true)}<div><b>Recommended for the lab.</b> All 3 screening filters passed. Preparation is in Section 3 and the laboratory validation protocol in Section 4.</div></div>`;
 const par=[["a",N(c.a,4),"Å"],["b",N(c.b,4),"Å"],["c",N(c.c,4),"Å"],["α","90.0","°"],["β","90.0","°"],["γ","90.0","°"],["volume",N(c.volume,2),"Å³"],["density",N(c.density,2),"g/cm³"],["Z","1","f.u."]];
 const leg=`<div class="leg"><div><b>A-site</b>${R.A.map(s=>`<span><i style="background:${col[s.el]}"></i>${E(s.el)}</span>`).join("")}</div><div><b>B-site</b>${R.B.map(s=>`<span><i style="background:${col[s.el]}"></i>${E(s.el)}</span>`).join("")}</div><div><b>Oxygen</b><span><i style="background:${OXC}"></i>O</span></div></div>`;
 return`<section class="page">
 <div class="top">${head(R,"Perovskite cathode screening · NGIT")}<div class="top-r"><b>CATHODE SCREENING REPORT</b><span>Issued ${E(R.issued)}</span><span class="id">Report ID&nbsp; ${E(R.id)}</span></div></div>
 <div class="body"><div class="title"><div><div class="fm">${sf(R.formula)}</div><div class="st ${pass?"g":"r"}"><i></i>${pass?"PASS":"FAIL"}</div></div><div class="tmp">${N(R.temp_c,0)} <small>°C</small></div></div>
 <div class="lab">KEY SCREENING METRICS</div><div class="mcs">${cards}</div>${banner}
 <div class="card"><div class="two"><div class="lab">3D VIEW</div><div class="lab rt">LATTICE PARAMETERS <span class="pill">Pm-3m (221)</span></div></div>
  <div class="viewrow"><div class="cube">${cube3d(R,col)}</div><div><div class="pg">${par.map(p=>`<div><small>${p[0]}</small><b>${p[1]} <em>${p[2]}</em></b></div>`).join("")}</div><div class="hr"></div>${leg}</div></div>
  <p class="fine">Estimated pseudo-cubic cell (a = 0.5·[2(r<sub>B</sub>+r<sub>O</sub>) + √2(r<sub>A</sub>+r<sub>O</sub>)]); mixed sites are filled in proportion to the formula. It is a schematic cell, not a relaxed structure.</p></div>
 <div class="card"><div class="lab">SITE COMPOSITION &amp; DOPING</div><div class="sites"><div><div class="lab t">A-SITE</div><div class="srow2">${donut(R.A,col,"A")}<div class="sl">${siteRows(R.A,col)}</div></div></div>
  <div><div class="lab t">B-SITE</div><div class="srow2">${donut(R.B,col,"B")}<div class="sl">${siteRows(R.B,col)}</div></div></div>
  <div><div class="lab t">OXYGEN</div><div class="srow2">${donut([{el:"O",pct:100}],col,"O")}</div></div></div></div></div>${foot(1,R)}</section>`;
}

function inputsCol(items){return items.map(r=>`<div class="kv"><span>${E(r.label)}</span><b>${N(r.value,3)} ${r.unit?`<small>${E(r.unit)}</small>`:""}</b></div>`).join("")}
function page2(R){
 const I=R.inputs,a=R.add||{},cf=R.conf,cs=R.cost,lv={CHEAP:["Cheap","g"],MODERATE:["Moderate","y"],EXPENSIVE:["Expensive","r"]}[cs.level];
 const fill=cf.ratio==null?0:Math.min(100,cf.ratio/1.25*100);
 return`<section class="page">${bar(R)}<div class="body">${sec("","Detailed analysis")}
 <div class="card"><div class="lab">MODEL INPUTS (23)</div><div class="cols3"><div><h4>A-SITE DESCRIPTORS</h4>${inputsCol(I.A)}<h4>WHOLE-STRUCTURE DESCRIPTORS</h4>${inputsCol(I.W)}</div>
  <div><h4>B-SITE DESCRIPTORS</h4>${inputsCol(I.B)}</div><div><h4>MATERIAL PROPERTIES</h4>${inputsCol(I.M)}<h4>PREDICTED OUTPUTS USED AS INPUTS</h4>${inputsCol(I.P)}</div></div></div>
 <div class="row2"><div class="card"><div class="lab">ADDITIONAL PREDICTED PROPERTIES</div><div class="tiles"><div><small>Ionic conductivity</small><b>${sci(a.ionic)} <em>S/cm</em></b></div><div><small>Electronic conductivity</small><b>${a.electronic==null?"—":N(a.electronic,1)} <em>S/cm</em></b></div><div><small>ASR</small><b>${a.asr==null?"—":N(a.asr,3)} <em>Ω·cm²</em></b></div></div></div>
  <div class="card"><div class="lab">MODEL CONFIDENCE</div>${cf.ratio==null?"<p class='fine'>Not available.</p>":`<div class="track"><i class="${cf.level}" style="width:${fill.toFixed(0)}%"></i><u style="left:80%"></u></div><div class="cfl ${cf.level}">${cf.level==="ok"?"✓":"!"} ${E(cf.label)}</div><p class="fine">Distance ${N(cf.dist,2)} (limit ${N(cf.limit,2)}).</p>`}</div></div>
 <div class="card"><div class="lab">ESTIMATED PRECURSOR COST</div>${cs.value==null?"<p class='fine'>Cost not available (a precursor price is missing).</p>":`<div class="cost"><div><div class="big">$${N(cs.value,1)}</div><small>per kg of cathode</small>${lv?`<div class="lv ${lv[1]}">${lv[0]}</div>`:""}</div><div class="cbars">${cs.parts.map(p=>`<div class="cb"><span>${E(p.precursor).replace(/(\d+)/g,"<sub>$1</sub>")}</span><div><i style="width:${p.share}%"></i></div><b>${N(p.share,1)} %</b></div>`).join("")}</div></div><p class="fine">Built-in approximate precursor prices (not live quotes), 95 % synthesis yield.</p>`}</div>
 ${R.notes.length?`<div class="note">${R.notes.map(E).join("<br>")}</div>`:""}</div>${foot(2,R)}</section>`;
}

/* ---------- PASS report: preparation + lab protocol ---------- */
function prepSteps(R){
 const P=R.prep,T=R.thr;if(!P)return"";
 const steps=[["Dry the powders",["Heat each powder as listed in the table to remove water, then cool in a desiccator."].concat(P.has_hygro?["Weigh the rare-earth oxide straight after drying; it absorbs moisture and CO₂ quickly."]:[])],
  ["Weigh",[`Weigh each powder as in the table (for ${P.grams} g of cathode) on a balance accurate to 0.1 mg.`,"Adjust for the purity printed on the bottle."].concat(P.excess.length?[`The table already includes the extra precursor for volatile elements (${P.excess.join(", ")}).`]:[])],
  ["Mix and mill",["Put the powders in a ball-mill jar with zirconia balls and just enough ethanol to cover them.","Mill at 300 rpm for 6 h."]],
  ["Dry and sieve",["Dry at 80 °C overnight, then sieve to remove lumps and milling balls."]],
  ["First heating (calcination)",["Place in a lidded alumina crucible and heat in air: 3 °C/min up to 1000 °C, hold 10 h, then cool slowly."]],
  ["Check the powder",["Grind it and run XRD. Only the perovskite pattern should appear.","If extra peaks remain, heat again at 1050–1100 °C for 10 h."]],
  ["Shape the samples",["Mix with 2–3 wt % binder (PVB) and press into bars and discs.","Press again at 250 MPa in a cold isostatic press for an even density."]],
  ["Sinter",["Heat at 1 °C/min to 500 °C and hold 2 h to burn out the binder, then 3 °C/min to 1200 °C, hold 5 h, and cool slowly.","Check the density is at least 95 %. If not, raise the temperature in 25 °C steps (maximum 1250 °C)."]],
  ["Make the electrode paste",["Mill some powder to a fine size (0.5–1 µm) and mix it with terpineol and ethyl cellulose into a paste."]],
  ["Make the test cell",["Print the paste on both sides of a dense GDC disc, dry at 120 °C, then fire at 900–1000 °C for 2 h."]]];
 return steps.map((s,i)=>`<div class="stp"><span class="n">${i+1}</span><div><h3>${E(s[0])}</h3><ul>${s[1].map(b=>`<li>${E(b)}</li>`).join("")}</ul></div></div>`);
}
function page3pass(R){
 const P=R.prep;if(!P)return`<section class="page">${bar(R)}<div class="body">${sec("3","How to prepare the cathode")}<div class="note">The precursor recipe could not be calculated for this formula.</div></div>${foot(3,R)}</section>`;
 const st=prepSteps(R),route=["Dry","Weigh","Ball-mill","Calcine","XRD","Press","Sinter","Test"];
 return`<section class="page">${bar(R)}<div class="body">${sec("3","How to prepare the cathode",`Solid-state route for a ${P.grams} g batch (typical starting conditions - optimise by XRD).`)}
 <div class="card"><div class="lab">ROUTE: SOLID-STATE REACTION</div><div class="route">${route.map(r=>`<span>${r}</span>`).join("")}</div></div>
 <div class="card"><div class="lab">PRECURSORS FOR A ${N(P.grams,3)} G BATCH</div><table class="tb"><thead><tr><th>METAL</th><th>PRECURSOR</th><th>MOL / MOL CAT.</th><th>MASS (G)</th><th>WT %</th><th>PRE-TREATMENT</th></tr></thead><tbody>
  ${P.rows.map(r=>`<tr><td><b>${E(r.metal)}</b></td><td>${E(r.precursor).replace(/(\d+)/g,"<sub>$1</sub>")}</td><td class="mono">${N(r.mol,3)}</td><td class="mono"><b>${N(r.mass,4)}</b></td><td class="mono">${N(r.wt,1)}</td><td>${E(r.pre)}</td></tr>`).join("")}</tbody></table>
  <p class="fine">Total ${N(P.total_powder,3)} g of powder gives ${N(P.grams,3)} g of cathode; about ${N(P.gas_loss_pct,1)} % of the weight is lost as gas during heating.</p></div>
 <div class="card steps">${st.slice(0,6).join("")}</div></div>${foot(3,R)}</section>`;
}
function page4pass(R){
 const P=R.prep,L=R.lab,T=R.thr,st=prepSteps(R);
 const safety=["Fine powders are harmful to breathe: wear a dust mask (P2 / N95), gloves and safety glasses, and work in a ventilated area.","Use heat-resistant gloves at furnaces and never open one below 200 °C."].concat(P?P.safety:[]).concat(["Put all waste powders and ethanol in labelled heavy-metal waste containers."]);
 return`<section class="page">${bar(R)}<div class="body">${sec("3","How to prepare the cathode","Steps 7–10 and safety")}
 <div class="card steps">${st.slice(6).join("")}</div>
 <div class="card safety"><div class="lab">SAFETY</div><ul>${safety.map(s=>`<li>${E(s)}</li>`).join("")}</ul></div>
 ${sec("4","Laboratory validation protocol")}
 <div class="bn blue"><div>${sf(R.formula)} passed all three screening filters at ${N(R.temp_c,0)} °C. These results are computer predictions, so the next step is to check them in the lab. Do the test marked <b>Run first</b> before the others.</div></div>
 <div class="card"><div class="lab">ACCEPTANCE CRITERIA</div><table class="tb"><thead><tr><th>PROPERTY</th><th>MODEL PREDICTION</th><th>LAB ACCEPTANCE CRITERION</th><th>METHOD</th></tr></thead><tbody>
  <tr><td><b>Thermal expansion (TEC)</b></td><td class="mono">${N(R.metrics[1].value,2)} ×10⁻⁶ K⁻¹</td><td>Average of ${T.tec} ×10⁻⁶ K⁻¹ or lower</td><td>Dilatometer</td></tr>
  <tr><td><b>Stability (Ehull)</b></td><td class="mono">${N(R.metrics[0].value,1)} meV/atom</td><td>No new phases after 100 h in air at the working temperature, and no reaction with the electrolyte (GDC)</td><td>XRD before and after heating</td></tr>
  <tr><td><b>Activity, log₁₀(k*)</b></td><td class="mono">${N(R.metrics[2].value,2)} log₁₀(cm/s)</td><td>log₁₀(k*) of ${N(T.orr,2)} or higher at ${N(R.temp_c,0)} °C</td><td>ECR (EIS as cross-check)</td></tr></tbody></table></div></div>${foot(4,R)}</section>`;
}
function page5pass(R){
 const L=R.lab,T=R.thr,A=R.add||{};
 const t=[["T1","Check the crystal structure (XRD)",["Scan a little of the powder with an X-ray diffractometer (XRD).","You should see one perovskite pattern only. Extra peaks mean impurities; less than 3 % is acceptable.",`The cell size should be close to ${N(L.cell_lo,2)}–${N(L.cell_hi,2)} Å.`],""],
  ["T2","Check the composition and density",[`Confirm with EDS or ICP that the metals match the formula (A-site: ${L.a_sites}; B-site: ${L.b_sites}), within ± 2 %.`,`Measure the density of a sintered bar. It should be at least 95 % of the ideal value (about ${N(L.density,2)} g/cm³); porous samples give wrong results.`],""],
  ["T3","Measure thermal expansion (TEC)",["Cut a bar about 4 × 4 × 15 mm and put it in a dilatometer, which measures how much a sample grows when heated.","Heat to 800 °C in air and cool back, twice. Use the second heating to get the average expansion between 30 and 800 °C. Test 3 bars.",`Pass: average of ${T.tec} ×10⁻⁶ K⁻¹ or lower.`,
    (L.tec_close?"The predicted value is very close to the limit"+(L.co_rich?", and cobalt-rich materials often expand more than predicted":"")+". ":L.co_rich?"Cobalt-rich materials often expand more than predicted. ":"")+"This is the quickest yes / no test, so do it first."],"RUN FIRST"],
  ["T4","Check stability",[`Keep some powder in air at ${N(R.temp_c,0)} °C for 100 h, then run XRD again. No new peaks means it is stable.`,"Mix the powder 1 : 1 with GDC electrolyte powder, heat at 1000 °C for 2 h and run XRD. No new peaks means they do not react."],""],
  ["T5","Measure oxygen activity (k*)",[`Use ECR (electrical conductivity relaxation): at ${N(R.temp_c,0)} °C, quickly change the oxygen level on a dense bar (0.21 to 0.10 atm) and record how fast its conductivity settles. This gives k*.`,`Pass: log₁₀(k*) of ${N(T.orr,2)} or higher.`,
    `Cross-check: make a symmetric cell and measure its resistance (ASR) by EIS at 500–700 °C.${A.asr!=null?` The model expects about ${N(A.asr,3)} Ω·cm²;`:""} below 0.15 is a good target.`,
    `Optional: measure electrical conductivity${A.electronic!=null?` (the model expects about ${N(A.electronic,1)} S/cm)`:""} and check the electrode under SEM for even thickness and no peeling.`],""]];
 return`<section class="page">${bar(R)}<div class="body">${sec("4","Laboratory validation protocol","Tests T1–T5")}
 ${t.map(x=>`<div class="card tcard"><span class="tn">${x[0]}</span><div><h3>${E(x[1])} ${x[3]?`<em class="rf">${x[3]}</em>`:""}</h3><ul>${x[2].map(b=>`<li>${E(b)}</li>`).join("")}</ul></div></div>`).join("")}
 <div class="note">All numbers in this report are predictions of the built-in SVR models at ${N(R.temp_c,0)} °C, not measurements. The preparation conditions are typical starting values; optimise them by XRD.</div></div>${foot(5,R)}</section>`;
}

/* ---------- FAIL report: why it failed + how to make it pass ---------- */
function page3fail(R){
 const T=R.thr,rows=R.metrics.map(m=>{const sp=m.key==="orr"?(m.ok?`${N(m.diff,2)} log units spare`:`${N(m.diff,2)} below the limit`):(m.ok?`${N(m.diff,m.dec)} spare`:`+${N(m.diff,m.dec)} (${N(100*m.diff/m.limit,0)} % over)`);
  return`<tr><td><b>${E(m.name)}</b></td><td class="mono">${N(m.value,m.dec)} ${E(m.unit==="log₁₀(cm/s)"?"":m.unit)}</td><td class="mono">${m.op} ${m.limit} ${E(m.unit==="log₁₀(cm/s)"?"":m.unit)}</td><td class="mono">${sp}</td><td class="${m.ok?"g":"r"}"><b>${m.ok?"PASS":"FAIL"}</b></td></tr>`}).join("");
 return`<section class="page">${bar(R)}<div class="body">${sec("3","Why this cathode failed","Each failed filter, how far it missed, and what in the model inputs points to the cause.")}
 <div class="card"><div class="lab">RESULT AGAINST EACH THRESHOLD</div><table class="tb"><thead><tr><th>PROPERTY</th><th>PREDICTION</th><th>THRESHOLD</th><th>MISS / MARGIN</th><th>VERDICT</th></tr></thead><tbody>${rows}</tbody></table></div>
 ${R.why.map((w,i)=>`<div class="card why"><span class="n red">${i+1}</span><div><h3>${E(w.title)}</h3><p>${E(w.lead)}</p><h5>WHY, FROM THE MODEL INPUTS</h5><ul>${w.bullets.map(b=>`<li>${E(b)}</li>`).join("")}</ul></div></div>`).join("")}
 <div class="card why"><span class="n grn">✓</span><div><h3>What is already good and worth keeping</h3>${R.good.length?`<p>These values leave room to trade activity for stability.</p><ul>${R.good.map(b=>`<li>${E(b)}</li>`).join("")}</ul>`:"<p>No filter passed with margin; start from the targets in Section 4.</p>"}${R.conf.level&&R.conf.level!=="ok"?`<ul><li>Model confidence: ${E(R.conf.label.toLowerCase())}, so confirm any final choice with a lab test.</li></ul>`:""}</div></div>
 <p class="fine">Reasons are rule-of-thumb readings of the model inputs (tolerance factor, O-vacancy energy, O p-band centre, B-site makeup); they explain likely causes and are not an exact attribution of the SVR.</p></div>${foot(3,R)}</section>`;
}
const resTxt=c=>c.final==="PASS"?"PASS":`FAIL (${c.fails.join(", ")})`;
function page4fail(R){
 const all=[R.start].concat(R.cands),best=R.best;
 return`<section class="page">${bar(R)}<div class="body">${sec("4","How to make it pass","Always re-screen any new composition with SCOPE before synthesis.")}
 <div class="card"><div class="lab">TARGET VALUES TO AIM FOR IN THE NEXT SCREENING ROUND</div><table class="tb"><thead><tr><th>DESCRIPTOR</th><th>THIS CATHODE</th><th>TARGET</th><th>HOW TO GET THERE</th></tr></thead><tbody>${R.targets.map(x=>`<tr><td><b>${E(x.d)}</b></td><td class="mono">${E(x.now)}</td><td class="mono">${E(x.target)}</td><td>${E(x.how)}</td></tr>`).join("")}</tbody></table></div>
 <div class="card"><div class="lab">RE-SCREEN OF CANDIDATE FIXES (REAL MODEL PREDICTIONS AT ${N(R.temp_c,0)} °C)</div><table class="tb cand"><thead><tr><th>CANDIDATE</th><th>FORMULA</th><th>EHULL</th><th>TEC</th><th>LOG K*</th><th>COST $/KG</th><th>RESULT</th></tr></thead><tbody>
 ${all.map((c,i)=>{const isB=best&&c.formula===best.formula&&i>0,cls=i===0?"s":c.final==="PASS"?"p":"";const lab=i===0?"Start":(isB?"★":String.fromCharCode(64+i));
  return`<tr class="${cls}${isB?" best":""}"><td><b>${lab}</b></td><td>${sf(c.formula)}${c.how&&i>0?`<small class="how">${E(c.how)}</small>`:""}</td><td class="mono">${N(c.ehull,1)}</td><td class="mono">${N(c.tec,2)}</td><td class="mono">${N(c.logk,2)}</td><td class="mono">${c.cost==null?"—":N(c.cost,1)}</td><td class="${c.final==="PASS"?"g":"r"}"><b>${E(resTxt(c))}${isB?" (best)":""}</b></td></tr>`}).join("")}</tbody></table>
 <p class="fine">${best?`★ Candidate ${E(best.formula)} is the best balance among the tested edits: it clears all three filters with the largest smallest margin.`:"None of the tested edits passes all three filters. The rows shown are the closest ones (largest smallest margin)."} Each composition was run through the same SVR pipeline as the screening, so these are real predictions, but still estimates.</p></div></div>${foot(4,R)}</section>`;
}
function page5fail(R){
 return`<section class="page">${bar(R)}<div class="body">${sec("4","How to make it pass (continued)","Recommended path from this failed result to a lab-ready cathode.")}
 ${R.steps.map((s,i)=>`<div class="card stp1"><span class="n">${i+1}</span><div><h3>${E(s[0])}</h3><ul>${s[1].map(b=>`<li>${E(b)}</li>`).join("")}</ul></div></div>`).join("")}
 <div class="bn green"><div><b>Bottom line:</b> ${E(R.bottom)}</div></div>
 <div class="note">All numbers in this document, including the candidate predictions, are SVR model estimates at ${N(R.temp_c,0)} °C. They are not measurements.</div></div>${foot(5,R)}</section>`;
}
const CSS=`*{box-sizing:border-box}body{margin:0;background:#e9edf3;font:13px/1.45 "Fira Sans","Segoe UI",Roboto,Arial,sans-serif;color:#10263c;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{width:794px;min-height:1123px;margin:18px auto;background:#f4f6fb;position:relative;box-shadow:0 6px 24px rgba(10,30,60,.18);display:flex;flex-direction:column;overflow:hidden}.page>.body{flex:1}
.top{background:linear-gradient(120deg,#0b2440,#0f3b52 70%,#12504f);border-bottom:5px solid #14a39a;color:#fff;display:flex;justify-content:space-between;align-items:center;padding:14px 40px;height:96px}
.ph{display:flex;gap:14px;align-items:center}.ph img{width:56px;height:56px;border-radius:50%}.ph-t{font-size:30px;letter-spacing:.28em;font-weight:600}.ph-s{font-size:12px;opacity:.8}
.top-r{text-align:right;display:flex;flex-direction:column;gap:2px}.top-r b{color:#5fe0d6;letter-spacing:.14em;font-size:12px}.top-r span{font-size:12px;opacity:.8}
.bar{background:linear-gradient(120deg,#0b2440,#0f3b52);border-bottom:4px solid #14a39a;color:#fff;display:flex;align-items:center;gap:10px;padding:10px 40px}.bar img{width:30px;height:30px;border-radius:50%}.bar b{letter-spacing:.2em}.bar span{opacity:.75;font-size:12px}.bar-f{flex:1;text-align:center;font-weight:700;font-size:12px}.bar-id{opacity:.7;font-size:12px}
.body{padding:14px 30px 6px}.title{display:flex;justify-content:space-between;align-items:flex-start;margin:2px 6px 8px}.fm{font-size:34px;font-weight:700;letter-spacing:-.01em}.fm sub,.bar-f sub{font-size:.62em}
.st{font-weight:700;font-size:20px;margin-top:6px;display:flex;align-items:center;gap:8px}.st i{width:16px;height:16px;border-radius:50%;background:currentColor}.st.g{color:#1f9d4c}.st.r{color:#d11a2a}
.tmp{font-size:34px;font-weight:700}.tmp small{font-size:18px;color:#6f8097}
.lab{font-size:10.5px;letter-spacing:.16em;color:#5d7088;font-weight:600;margin:4px 0 8px}.lab.rt{text-align:right}.lab.t{margin:2px 0 6px}.two{display:flex;justify-content:space-between}.pill{border:1px solid #c9d3e0;border-radius:99px;padding:2px 10px;margin-left:10px;letter-spacing:0;font-weight:500;color:#10263c;background:#fff}
.mcs{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:10px}.mc{background:#fff;border-radius:12px;padding:11px 14px;position:relative;box-shadow:0 2px 8px rgba(10,30,60,.1);border-bottom:4px solid #0f2a43}.mc.bad{border-bottom-color:#d11a2a}
.mc .ic{position:absolute;right:14px;top:14px}.mn{color:#506177}.mv{font-size:30px;font-weight:700;margin:3px 0 2px;letter-spacing:-.02em}.mv small{font-size:12px;font-weight:400;color:#7a8aa0}.mt{font-size:11.5px;font-weight:700}.mt.g{color:#1c8a45}.mt.r{color:#c4161f}
.ic{width:24px;height:24px;border-radius:50%;border:1.5px solid;display:inline-flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;flex:none}.ic.ok{color:#1f9d4c}.ic.no{color:#d11a2a}.ic.am{color:#b7791f;border-color:#b7791f}
.bn{display:flex;gap:12px;align-items:center;border-radius:10px;padding:9px 14px;margin-bottom:10px;border:1px solid}.bn.red{background:#fde8e8;border-color:#f3b4b4;color:#9b1c1c}.bn.amber{background:#fff3d6;border-color:#f1d28a;color:#8a5a00}.bn.green{background:#e6f5e9;border-color:#b6dfc0;color:#175e2c}.bn.blue{background:#e7f0fb;border-color:#c0d6f1;color:#173a63}
.card{background:#fff;border-radius:12px;padding:12px 16px;margin-bottom:10px;box-shadow:0 2px 8px rgba(10,30,60,.1);border-bottom:3px solid #0f2a43}
.viewrow{display:grid;grid-template-columns:1fr 1fr;gap:20px;align-items:center}.cube{background:#edf1f6;border-radius:10px;aspect-ratio:1/.86;display:flex}.cube svg{width:100%;height:100%}.nocube{margin:auto;color:#6f8097}
.pg{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.pg div{background:#f6f8fb;border:1px solid #e1e7ef;border-radius:10px;padding:8px 6px;text-align:center}.pg small{display:block;color:#7a8aa0;font-size:10.5px}.pg b{font-family:"Fira Mono",Consolas,monospace;font-size:13px}.pg em{font-style:normal;font-weight:400;color:#7a8aa0;font-size:10px}
.hr{border-top:1px solid #dfe5ee;margin:14px 0 10px}.leg>div{display:flex;gap:14px;align-items:center;margin:4px 0}.leg b{min-width:52px}.leg span{display:inline-flex;gap:6px;align-items:center}.leg i{width:12px;height:12px;border-radius:50%;display:inline-block}
.fine{font-size:11px;color:#6f8097;margin:10px 0 0}.sites{display:grid;grid-template-columns:1.1fr 1.1fr .6fr;gap:16px}.srow2{display:flex;gap:14px;align-items:center}
.donut{width:84px;height:84px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex:none}.donut i{width:50px;height:50px;border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center;font-style:normal;font-weight:700;font-size:18px}
.sl{flex:1}.srow{display:grid;grid-template-columns:14px auto 1fr auto;gap:4px 6px;align-items:center;margin:4px 0}.srow .dot{width:12px;height:12px;border-radius:50%}.srow small{color:#7a8aa0;font-size:10px}.srow em{font-style:normal;font-weight:700}.sbar{grid-column:2/5;height:4px;background:#e8edf4;border-radius:3px}.sbar i{display:block;height:4px;border-radius:3px}
.foot{margin:6px 30px 12px;border-top:1px solid #d9e0ea;padding-top:8px;display:flex;justify-content:space-between;color:#6f8097;font-size:11px}
.sec{display:flex;gap:10px;margin:2px 0 10px}.sec i{width:7px;border-radius:4px;background:#14a39a;flex:none}.sec h2{margin:0;font-size:24px}.sec p{margin:2px 0 0;color:#6f8097;font-size:12px}
.cols3{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}h4{font-size:10.5px;letter-spacing:.12em;color:#0b7f7a;margin:10px 0 6px}.kv{display:flex;justify-content:space-between;padding:6px 8px;border-radius:6px}.kv:nth-of-type(even){background:#f6f8fb}.kv b{font-family:"Fira Mono",Consolas,monospace;font-size:12px}.kv small{color:#7a8aa0;font-weight:400}
.row2{display:grid;grid-template-columns:1.6fr 1fr;gap:14px}.tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.tiles div{border:1px solid #e1e7ef;border-radius:10px;padding:8px 10px;background:#fafbfd}.tiles small{display:block;font-weight:600;font-size:11px}.tiles b{font-size:18px}.tiles em{font-style:normal;color:#7a8aa0;font-weight:400;font-size:11px}
.track{height:8px;background:#e8edf4;border-radius:4px;position:relative;margin:8px 0}.track i{display:block;height:8px;border-radius:4px;background:#1f9d4c}.track i.warn{background:#e1a420}.track i.bad{background:#d11a2a}.track u{position:absolute;top:-4px;width:2px;height:16px;background:#10263c}.cfl{font-weight:700}.cfl.ok{color:#1c8a45}.cfl.warn{color:#a8700b}.cfl.bad{color:#c4161f}
.cost{display:flex;gap:34px;align-items:center;padding:12px 6px}.big{font-size:42px;font-weight:700;letter-spacing:-.02em}.lv{display:inline-block;border-radius:99px;padding:2px 12px;font-weight:700;font-size:12px;margin-top:6px}.lv.g{background:#dff3e5;color:#176b34}.lv.y{background:#fdeebc;color:#8a5a00}.lv.r{background:#fbd9d9;color:#a11b1b}.cbars{flex:1}.cb{display:grid;grid-template-columns:70px 1fr 56px;gap:10px;align-items:center;margin:7px 0}.cb div{height:8px;background:#e8edf4;border-radius:4px}.cb i{display:block;height:8px;border-radius:4px;background:#14a39a}.cb b{text-align:right}
.note{background:#eef2f9;border:1px dashed #b9c6da;border-radius:10px;padding:10px 14px;color:#506177;font-size:12px;margin-bottom:14px}
.route{display:flex}.route span{flex:1;background:#17365a;color:#fff;font-weight:700;text-align:center;padding:10px 4px 10px 14px;clip-path:polygon(0 0,calc(100% - 12px) 0,100% 50%,calc(100% - 12px) 100%,0 100%,12px 50%);margin-right:-6px}.route span:first-child{clip-path:polygon(0 0,calc(100% - 12px) 0,100% 50%,calc(100% - 12px) 100%,0 100%)}
table.tb{width:100%;border-collapse:collapse;font-size:12px}.tb th{text-align:left;font-size:10px;letter-spacing:.1em;color:#0b7f7a;padding:5px 8px;border-bottom:2px solid #e0e6ee}.tb td{padding:6px 8px;border-bottom:1px solid #e8edf4;vertical-align:top}.mono{font-family:"Fira Mono",Consolas,monospace}.g{color:#1c8a45}.r{color:#c4161f}.tb sub{font-size:.7em}
.n,.tn{width:30px;height:30px;border-radius:50%;background:#0e8a8a;color:#fff;display:inline-flex;align-items:center;justify-content:center;font-weight:700;flex:none}.n.red{background:#d11a2a}.n.grn{background:#1f9d4c}.tn{background:#0f2a43;font-size:11px}
.stp,.why,.tcard,.stp1{display:flex;gap:14px;align-items:flex-start}.stp{padding:6px 0;border-bottom:1px solid #e8edf4}.stp:last-child{border:0}.steps{padding-top:4px;padding-bottom:4px}h3{margin:0 0 2px;font-size:14.5px}h5{margin:8px 0 4px;font-size:10px;letter-spacing:.12em;color:#0b7f7a}ul{margin:0;padding-left:18px}li{margin:1px 0}.why p{margin:0 0 4px;color:#506177}
.rf{background:#fdeebc;color:#8a5a00;border:1px solid #e9cd7b;border-radius:99px;font-size:10px;font-style:normal;padding:1px 9px;margin-left:8px;letter-spacing:.06em;vertical-align:middle}
.safety{background:#fff3d6;border:0;border-bottom:3px solid #0f2a43}.safety .lab{color:#8a5a00}
.cand tr.s td{background:#fdeeee}.cand tr.p td{background:#e9f6ec}.how{display:block;color:#7a8aa0;font-size:10.5px}
@page{size:A4;margin:0}@media print{body{background:#fff}.page{margin:0;box-shadow:none;width:210mm;min-height:297mm;page-break-after:always;break-after:page}.page:last-child{page-break-after:auto}}`;

function reportHtml(R){
 const pass=R.final==="PASS",pages=pass?[page1(R),page2(R),page3pass(R),page4pass(R),page5pass(R)]:[page1(R),page2(R),page3fail(R),page4fail(R),page5fail(R)];
 return`<!doctype html><html><head><meta charset="utf-8"><title>${E(R.id)} ${E(R.formula)}</title><base href="${location.origin}/"><style>${CSS}</style></head><body>${pages.join("")}</body></html>`;
}

/* ---------- overlay with the report + toolbar ---------- */
function closeReport(){const o=document.getElementById("rpov");if(o)o.remove();document.removeEventListener("keydown",rpKey)}
const rpKey=e=>{if(e.key==="Escape")closeReport()};
window.openReport=async(id,pred)=>{   // pred=true: id is a single-cathode prediction (Predict page), otherwise a screening result of the open dataset
 try{
  toast("Preparing the report…");
  const R=await api(pred?`/predictions/${id}/report`:`/datasets/${S.ds.id}/results/${id}/report`);
  closeReport();
  const o=document.createElement("div");o.id="rpov";
  o.style.cssText="position:fixed;inset:0;z-index:70;background:rgba(6,22,48,.75);display:flex;flex-direction:column";
  o.innerHTML=`<div style="display:flex;gap:10px;align-items:center;padding:10px 16px;background:#0b2440;color:#fff;flex-wrap:wrap"><b style="letter-spacing:.06em">${E(R.id)} · ${E(R.formula)} · ${R.final}</b><span style="flex:1"></span><button type="button" class="btn sm" id="rp_pdf">Download PDF</button><button type="button" class="btn sm sec" id="rp_cif">View .cif</button><button type="button" class="btn sm sec" id="rp_x">Close</button></div><iframe id="rp_fr" style="flex:1;border:0;background:#e9edf3;width:100%"></iframe>`;
  document.body.appendChild(o);document.addEventListener("keydown",rpKey);
  const fr=o.querySelector("#rp_fr");fr.srcdoc=reportHtml(R);
  o.querySelector("#rp_x").onclick=closeReport;o.querySelector("#rp_cif").onclick=()=>viewCif(id,pred);
  o.querySelector("#rp_pdf").onclick=()=>{try{fr.contentWindow.focus();fr.contentWindow.print()}catch(e){toast("Use your browser's Print and choose Save as PDF.")}};
 }catch(e){toast(e.message)}
};

/* ---------- .cif viewer (every cathode, PASS or FAIL) ---------- */
window.viewCif=async(id,pred)=>{
 try{
  const j=await api(pred?`/predictions/${id}/cif`:`/datasets/${S.ds.id}/results/${id}/cif`),c=j.cell||{};
  const prev=document.getElementById("rpov");
  const m=document.createElement("div");m.id="cifov";
  m.style.cssText="position:fixed;inset:0;z-index:80;background:rgba(6,22,48,.6);display:flex;justify-content:center;align-items:flex-start;overflow:auto;padding:32px 16px";
  m.innerHTML=`<div style="background:#fff;border-radius:16px;max-width:860px;width:100%;padding:22px 24px;box-shadow:0 30px 80px rgba(0,0,0,.35)"><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><h3 style="margin:0;flex:1">${E(j.formula)} <small style="font-weight:400;color:#6f8097">· ${E(j.filename)}</small></h3><button type="button" class="btn sm" id="cf_dl">Download .cif</button><button type="button" class="btn sm sec" id="cf_cp">Copy</button><button type="button" class="btn sm sec" id="cf_x">Close</button></div>
   <p style="color:#6f8097;font-size:12px;margin:8px 0">${E(c.spacegroup||"Pm-3m")} · a = ${N(c.a,4)} Å · volume ${N(c.volume,2)} Å³ · density ${N(c.density,2)} g/cm³ — an estimated cubic-perovskite cell (not a relaxed structure). Open it in VESTA, Mercury or any CIF viewer.</p>
   <pre style="background:#0f2236;color:#d6e6f5;border-radius:10px;padding:14px;max-height:60vh;overflow:auto;font-size:12px;line-height:1.5;margin:0;white-space:pre">${E(j.cif)}</pre></div>`;
  document.body.appendChild(m);
  const close=()=>{m.remove();document.removeEventListener("keydown",k)},k=e=>{if(e.key==="Escape"){e.stopPropagation();close()}};document.addEventListener("keydown",k);
  m.addEventListener("mousedown",e=>{if(e.target===m)close()});m.querySelector("#cf_x").onclick=close;
  m.querySelector("#cf_cp").onclick=async()=>{try{await navigator.clipboard.writeText(j.cif);toast("CIF copied")}catch(_){toast("Select the text and copy it manually.")}};
  m.querySelector("#cf_dl").onclick=()=>{const u=URL.createObjectURL(new Blob([j.cif],{type:"chemical/x-cif"})),a=document.createElement("a");a.href=u;a.download=j.filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),1000)};
 }catch(e){toast(e.message)}
};
window.openPredReport=id=>openReport(id,true);window.viewPredCif=id=>viewCif(id,true);
})();
