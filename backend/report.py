"""Per-cathode report data (the content of the SCOPE PASS / FAIL report PDFs) and the .cif file.

Nothing is made up: every number comes from the screening row (features, predictions, cost) or is calculated from the formula.
The 'how to make it pass' candidates are NOT illustrative - each one is run through the same SVR pipeline as the screening
(screening.run), so the numbers are real model predictions (still estimates, not measurements).
"""
import datetime, math
import pandas as pd
import formula_desc as fd
import cost as costmod
import screening as sc

O_R = fd.O_R
SQ2 = math.sqrt(2.0)

# ------------------------------------------------------------------ element classes (site-composition panel of the report)
_ALKALI, _AE = set("Li Na K Rb Cs".split()), set("Be Mg Ca Sr Ba".split())
_RE = set("Sc Y La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu".split())
_POST = set("Al Ga In Sn Tl Pb Bi".split())
_META = set("B Si Ge As Sb Te".split())


def element_class(el):
    if el in _ALKALI: return "alkali metal"
    if el in _AE: return "alkaline earth"
    if el in _RE: return "rare earth"
    if el in _POST: return "post-transition metal"
    if el in _META: return "metalloid"
    return "transition metal"


# ------------------------------------------------------------------ cell + CIF
def _frac(rows):
    tot = sum(n for _, n in rows) or 1.0
    return [(el, n, n / tot) for el, n in rows]


def cell(comp, ox, r_a=None, r_b=None):
    """Estimated pseudo-cubic ABO3 cell (Z = 1). Edge = same A-O / B-O contact-distance formula as the 'Density' descriptor of the app."""
    v = fd.compute({"A": comp["A"], "B": comp["B"]})["values"]
    r_a = r_a if r_a is not None else v.get("R_A"); r_b = r_b if r_b is not None else v.get("R_B")
    if r_a is None or r_b is None:
        unk = list(dict.fromkeys(fd.compute(comp)["unknownA"] + fd.compute(comp)["unknownB"]))
        raise ValueError("No built-in ionic-radius data for " + (", ".join(unk) if unk else "this composition") + ", so the cell size cannot be estimated.")
    a = 0.5 * (2 * (r_b + O_R) + SQ2 * (r_a + O_R))
    mass = sum(fd.MASS[el] * n for el, n in comp["A"] + comp["B"]) + fd.O_MASS * ox
    vol = a ** 3
    return {"a": a, "b": a, "c": a, "alpha": 90.0, "beta": 90.0, "gamma": 90.0, "volume": vol, "density": mass * fd.AMU_G_CM3 / vol, "Z": 1,
            "spacegroup": "Pm-3m", "sg_number": 221, "molar_mass": mass}


def _sym_ops():
    """The 48 operations of Pm-3m (all signed permutations of x, y, z; no translations)."""
    import itertools
    out = []
    for perm in itertools.permutations("xyz"):
        for sg in itertools.product("+-", repeat=3):
            out.append(", ".join(("-" if s == "-" else "") + p for s, p in zip(sg, perm)))
    return out


def cif_text(formula, comp, ox, cl, note=None):
    """CIF of the estimated cubic perovskite (average structure: mixed sites are written as partial occupancies on one position)."""
    lab = "".join(c if c.isalnum() else "_" for c in formula) or "cathode"
    sumf = " ".join(f"{el}{fd.fmt_n(n)}" for el, n in comp["A"] + comp["B"]) + f" O{fd.fmt_n(ox)}"
    L = ["# SCOPE (NGIT) - estimated structure, NOT a refined or relaxed crystal structure.",
         "# Ideal cubic perovskite (Pm-3m): A-site at (0,0,0), B-site at (1/2,1/2,1/2), oxygen at (1/2,1/2,0) and permutations.",
         "# Mixed sites are written as partial occupancies on one position (average / disordered model).",
         "# Cell edge from the Shannon ionic radii of the formula: a = 0.5 [ 2 (r_B + r_O) + sqrt(2) (r_A + r_O) ], r_O = 1.40 A."]
    if note: L.append("# " + note)
    L += [f"data_{lab}", "_audit_creation_method 'SCOPE (NGIT) estimated pseudo-cubic ABO3 model'", f"_chemical_name_common '{formula}'",
          f"_chemical_formula_sum '{sumf}'", f"_chemical_formula_weight {cl['molar_mass']:.3f}",
          f"_cell_length_a {cl['a']:.4f}", f"_cell_length_b {cl['b']:.4f}", f"_cell_length_c {cl['c']:.4f}",
          "_cell_angle_alpha 90.0", "_cell_angle_beta 90.0", "_cell_angle_gamma 90.0", f"_cell_volume {cl['volume']:.3f}", "_cell_formula_units_Z 1",
          "_symmetry_space_group_name_H-M 'P m -3 m'", "_symmetry_Int_Tables_number 221", f"_exptl_crystal_density_diffrn {cl['density']:.3f}",
          "loop_", "_symmetry_equiv_pos_as_xyz"] + [f"'{o}'" for o in _sym_ops()]
    L += ["loop_", "_atom_site_label", "_atom_site_type_symbol", "_atom_site_symmetry_multiplicity", "_atom_site_Wyckoff_symbol",
          "_atom_site_fract_x", "_atom_site_fract_y", "_atom_site_fract_z", "_atom_site_occupancy"]
    for el, _, f in _frac(comp["A"]): L.append(f"{el}_A {el} 1 1a 0.00000 0.00000 0.00000 {f:.4f}")
    for el, _, f in _frac(comp["B"]): L.append(f"{el}_B {el} 1 1b 0.50000 0.50000 0.50000 {f:.4f}")
    L.append(f"O1 O 3 3c 0.00000 0.50000 0.50000 {min(1.0, ox / 3.0):.4f}")
    return "\n".join(L) + "\n"


def formula_parts(formula):
    """(composition {A,B}, oxygen index) from a formula text, or raises ValueError."""
    a = fd.analyse(formula); errs = [m["t"] for m in a["msgs"] if m["l"] == "err"]
    if errs or not a["composition"]["A"] or not a["composition"]["B"]: raise ValueError("Formula not recognised: " + (errs[0] if errs else "no A-site / B-site found") + ".")
    c = a["composition"]; return {"A": [tuple(x) for x in c["A"]], "B": [tuple(x) for x in c["B"]]}, float(c["O"] or 3.0), a["formula"]


# ------------------------------------------------------------------ helpers
def _fm(n): return fd.fmt_n(round(n, 2))


def _formula_of(A, B, ox):
    part = lambda rows: "".join(f"{el}{'' if abs(n - 1) < 1e-9 else _fm(n)}" for el, n in rows if n > 1e-9)
    return part(A) + part(B) + f"O{'' if abs(ox - 1) < 1e-9 else _fm(ox)}"


def _site_view(rows):
    return [{"el": el, "pct": round(100 * f, 1), "cls": element_class(el)} for el, _, f in _frac(rows)]


_RE_HYGRO = set("La Nd Pr Sm Gd Dy".split())
_HAZ = {"Ni": "NiO is a suspected cancer-causing agent and can cause skin allergy.",
        "Co": "Co₃O₄ is a suspected cancer-causing agent and can cause allergy.",
        "Ba": "BaCO₃ is harmful if swallowed; keep it away from food and wash hands after use.",
        "Mn": "MnO₂ is harmful if swallowed or breathed in.",
        "Sb": "Sb₂O₃ is a suspected cancer-causing agent.",
        "Cu": "CuO is harmful if swallowed and toxic to aquatic life.",
        "Rb": "Rb₂CO₃ is irritating to skin and eyes and absorbs moisture strongly.",
        "Cs": "Cs₂CO₃ is irritating to skin and eyes and absorbs moisture strongly."}


def _sub(s): return "".join("₀₁₂₃₄₅₆₇₈₉"[int(c)] if c.isdigit() else c for c in s)


def _prep(formula, comp, ox, price_table, grams=5.0):
    """Solid-state recipe: precursor masses for `grams` g of cathode from the same precursor list the cost estimate uses."""
    ci = costmod.cost_index(formula, price_table)
    if ci["status"] != "OK": ci = costmod.cost_index(formula, costmod.PriceTable(costmod.DEFAULT_ROWS))      # masses do not depend on the prices
    if ci["status"] != "OK": return None
    m_cat = ci["cathode_molar_mass"]; sc_ = grams / m_cat; rows = []
    for p in ci["parts"]:
        el = p["element"]
        if el in _RE_HYGRO: pre = f"Heat at 900 °C for 2 h; weigh straight away (absorbs moisture and CO₂)"
        elif el in ("Rb", "Cs"): pre = "Dry at 200 °C for 2 h; weigh straight away (absorbs moisture strongly)"
        else: pre = "Dry at 120 °C for 2 h"
        rows.append({"metal": el, "precursor": p["precursor"], "mol": p["mol_precursor"], "mass": p["mass_g"] * sc_, "pre": pre, "excess_pct": p["excess_pct"]})
    tot = sum(r["mass"] for r in rows)
    for r in rows: r["wt"] = 100 * r["mass"] / tot if tot else 0
    els = [p["element"] for p in ci["parts"]]
    return {"grams": grams, "rows": rows, "total_powder": tot, "gas_loss_pct": 100 * (1 - grams / tot) if tot > 0 else 0, "has_hygro": any(e in _RE_HYGRO for e in els),
            "safety": [_HAZ[e] for e in els if e in _HAZ], "excess": [f"{r['metal']} {r['excess_pct']:g} %" for r in rows if r["excess_pct"]]}


def _sites_pct(rows):
    return ", ".join(f"{el} {round(100 * f)} %" for el, _, f in _frac(rows))


def _margin(res, lim, kind):
    """Fractional margin to the limit: >0 passes. kind 'max' (value must stay below lim) or 'min' (value must stay above lim)."""
    if res is None: return None
    return (lim - res) / abs(lim) if kind == "max" else (res - lim) / abs(lim)


# ------------------------------------------------------------------ re-screen of candidate fixes (real model predictions)
def _a_variants(A, t):
    """A-site edits: move part of the largest-radius A ion (t > 1) or the smallest (t < 0.96) to a better-sized ion."""
    Ad = dict(A); out = [("", dict(Ad))]
    if not Ad or t is None: return out
    if t > 1.0:
        src = max(Ad, key=lambda e: fd.A_TAB.get(e, [0, 0, 0])[2])
        for part in ("Nd", "Sm", "Ca", "La"):
            if part == src: continue
            for d in (0.2, 0.3, 0.5):
                if Ad[src] + 1e-9 >= d:
                    v = dict(Ad); v[src] -= d; v[part] = v.get(part, 0.0) + d; out.append((f"Replace {d:g} {src} with {part}", v))
    elif t < 0.96:
        src = min(Ad, key=lambda e: fd.A_TAB.get(e, [0, 0, 9])[2])
        for part in ("Sr", "Ba"):
            if part == src: continue
            for d in (0.2, 0.3, 0.5):
                if Ad[src] + 1e-9 >= d:
                    v = dict(Ad); v[src] -= d; v[part] = v.get(part, 0.0) + d; out.append((f"Replace {d:g} {src} with {part}", v))
    return out


def _b_variants(B):
    Bd = dict(B); out = [("", dict(Bd))]; co = Bd.get("Co", 0.0)
    for new in (0.5, 0.3):
        if co > new + 0.05:
            v = dict(Bd); v["Co"] = new; v["Fe"] = v.get("Fe", 0.0) + (co - new); out.append((f"Co {co:g} → {new:g}, Fe up", v))
            if "Nb" not in v:
                w = {e: n * 0.9 for e, n in v.items()}; w["Nb"] = 0.1; out.append((f"Co {co:g} → {new:g}, Fe up, 10 % Nb", w))
    if "Nb" not in Bd:
        w = {e: n * 0.9 for e, n in Bd.items()}; w["Nb"] = 0.1; out.append(("10 % Nb on the B-site", w))
    return out


def candidates(formula, comp, ox, feats, temp_c, bundle, props, thr, price_table):
    A, B = list(comp["A"]), list(comp["B"]); forms, meta, seen = [], [], {formula}
    for an, av in _a_variants(A, feats.get("t")):
        for bn, bv in _b_variants(B):
            if not an and not bn: continue
            a_ = [(e, v) for e, v in av.items() if v > 1e-9]; b_ = [(e, v) for e, v in bv.items() if v > 1e-9]
            fx = _formula_of(a_, b_, ox)
            if fx in seen: continue
            seen.add(fx); forms.append(fx); meta.append("; ".join(x for x in (an, bn) if x))
    if not forms: return []
    rows, _ = sc.run(pd.DataFrame({"f": forms}), "f", temp_c, bundle, props, thr["ehull"], thr["tec"], thr["orr"])
    out = []
    for r, how in zip(rows, meta):
        if r["final"] == "INCOMPLETE": continue
        cost = costmod.cost_index(r["formula"], price_table); fails = [n for n, k in (("Ehull", "ehull_result"), ("TEC", "tec_result"), ("log k*", "orr_result")) if r[k] == "FAIL"]
        mg = min(_margin(r["ehull"], thr["ehull"], "max"), _margin(r["tec"], thr["tec"], "max"), _margin(r["pred_log"], thr["orr"], "min"))
        out.append({"formula": r["formula"], "how": how, "ehull": r["ehull"], "tec": r["tec"], "logk": r["pred_log"], "cost": cost.get("index") if cost["status"] == "OK" else None,
                    "final": r["final"], "fails": fails, "margin": mg, "t": r["detail"]["features"].get("t"), "ad": r["ad"]})
    out.sort(key=lambda c: (c["final"] != "PASS", -c["margin"]))
    return out[:5]


# ------------------------------------------------------------------ the report
def build(row, did, bundle, props, price_table):
    """row = a stored batch-screening row (dict with detail). Returns everything the report pages show."""
    det = row["detail"]; f = det.get("features") or {}; thr = det["thresholds"]; temp = det.get("temperature_c")
    if row["final_result"] == "INCOMPLETE" or not f or row.get("tec") is None:
        raise ValueError("This cathode could not be evaluated, so there is no report for it: " + " ".join(det.get("not_available") or ["no model inputs"]))
    comp, ox, canon = formula_parts(row["formula"]); cl = cell(comp, ox, f.get("R_A"), f.get("R_B"))
    eh, tc, lk = row["ehull"], row["tec"], row["orr_value"] if row.get("orr_value") is not None else row["predicted_log_kstar"]
    metrics = [{"key": "ehull", "name": "Energy above hull (Ehull)", "value": eh, "unit": "meV/atom", "limit": thr["ehull"], "op": "≤", "ok": row["ehull_result"] == "PASS",
                "diff": abs(eh - thr["ehull"]), "dec": 1},
               {"key": "tec", "name": "Thermal expansion (TEC)", "value": tc, "unit": "×10⁻⁶ K⁻¹", "limit": thr["tec"], "op": "≤", "ok": row["tec_result"] == "PASS", "diff": abs(tc - thr["tec"]), "dec": 2},
               {"key": "orr", "name": "ORR activity, log₁₀(k*)", "value": lk, "unit": "log₁₀(cm/s)", "limit": thr["orr"], "op": "≥", "ok": row["orr_result"] == "PASS", "diff": abs(lk - thr["orr"]), "dec": 2}]
    mg = {"ehull": _margin(eh, thr["ehull"], "max"), "tec": _margin(tc, thr["tec"], "max"), "orr": _margin(lk, thr["orr"], "min")}
    close = [m["name"].split(" (")[0].split(",")[0] for m in metrics if m["ok"] and mg[m["key"]] < 0.05]
    # additional predicted properties (same SVRs as the Predict page)
    add = {}
    try:
        for key, nm in (("Bulk_Ionic", "ionic"), ("Total_Electronic", "electronic"), ("ASR", "asr")):
            e = props[key]; y = float(e["model"].predict([[f[k] for k in e["features"]]])[0]); add[nm] = 10 ** y if e["log10"] else y
    except Exception: add = {}
    ratio = (row["mahalanobis_distance"] / thr["ad"]) if row.get("mahalanobis_distance") is not None and thr.get("ad") else None
    conf = {"ad": row.get("applicability_domain"), "dist": row.get("mahalanobis_distance"), "limit": thr.get("ad"), "ratio": ratio,
            "label": None if ratio is None else ("Outside applicability domain" if ratio > 1 else "Near edge of applicability domain" if ratio >= 0.8 else "Inside applicability domain"),
            "level": None if ratio is None else ("bad" if ratio > 1 else "warn" if ratio >= 0.8 else "ok")}
    ci = det.get("cost") or {}
    cost = {"value": row.get("cost"), "level": row.get("cost_result"), "parts": [{"precursor": p["precursor"], "share": round(100 * p["share"], 1)} for p in (ci.get("parts") or [])]}
    inputs = {"A": [("Ion_A", "Ion. energy (A)", "eV"), ("EN_A", "Electronegativity (A)", ""), ("R_A", "Ionic radius (A)", "Å"), ("Sa_A", "Lewis acidity (A)", "v.u."), ("Ionic_A", "Ionicity index (A)", ""), ("SmithAcid_A", "Smith acidity (A)", "")],
              "B": [("Ion_B", "Ion. energy (B)", "eV"), ("EN_B", "Electronegativity (B)", ""), ("R_B", "Ionic radius (B)", "Å"), ("Sa_B", "Lewis acidity (B)", "v.u."), ("Delec_B", "d-electron count (B)", "e⁻"),
                    ("Ionic_B", "Ionicity index (B)", ""), ("SmithAcid_B", "Smith acidity (B)", "")],
              "W": [("t", "Tolerance factor t", ""), ("Avg_Ionic_Character", "Avg. ionic character", ""), ("1000/T", "1000/T", "10³ K⁻¹")],
              "M": [("Gap", "Band gap", "eV"), ("Oxide_vacancy", "O-vacancy energy", "eV"), ("Work_Function", "Work function", "eV"), ("Log_dieletric", "Log dielectric constant", ""), ("O_pband", "O p-band centre", "eV")],
              "P": [("E_above_hull", "Ehull", "meV/atom"), ("TEC", "TEC", "×10⁻⁶ K⁻¹")]}
    inputs = {g: [{"label": l, "value": f.get(k), "unit": u, "src": (det.get("sources") or {}).get(k)} for k, l, u in rows] for g, rows in inputs.items()}
    out = {"id": f"SCOPE-{did}-{row['id']}", "issued": datetime.date.today().strftime("%d %b %Y").lstrip("0"), "formula": row["formula"], "temp_c": temp, "final": row["final_result"],
           "rank": row.get("rank"), "metrics": metrics, "margins": mg, "close": close, "cell": cl,
           "A": _site_view(comp["A"]), "B": _site_view(comp["B"]), "ox": ox, "inputs": inputs, "add": add, "conf": conf, "cost": cost,
           "thr": thr, "notes": [n["t"] for n in (det.get("notes") or [])]}
    if row["final_result"] == "PASS":
        out["prep"] = _prep(row["formula"], comp, ox, price_table)
        out["lab"] = _lab(row, comp, cl, f, add, thr, mg, ox)
    else:
        out.update(_fail(row, comp, f, add, thr, mg, temp, bundle, props, price_table, ox))
    return out


def _lab(row, comp, cl, f, add, thr, mg, ox):
    a = cl["a"]
    return {"cell_lo": a - 0.05, "cell_hi": a + 0.05, "a_sites": _sites_pct(comp["A"]), "b_sites": _sites_pct(comp["B"]), "density": cl["density"],
            "tec_close": mg["tec"] is not None and mg["tec"] < 0.05, "co_rich": dict(comp["B"]).get("Co", 0) >= 0.5,
            "asr": add.get("asr"), "elec": add.get("electronic"), "asr_target": 0.15}


def _fail(row, comp, f, add, thr, mg, temp, bundle, props, price_table, ox):
    A, B = dict(comp["A"]), dict(comp["B"]); t, ev, op, ds = f.get("t"), f.get("Oxide_vacancy"), f.get("O_pband"), f.get("SmithAcid_A")
    ra, rb = f.get("R_A"), f.get("R_B"); aname = ", ".join(e for e in A); big = max(A, key=lambda e: fd.A_TAB.get(e, [0, 0, 0])[2]) if A else None
    co = B.get("Co", 0.0); why = []
    if row["ehull_result"] == "FAIL":
        eh = row["ehull"]; b = []
        if t is not None and t > 1.02: b.append(f"Tolerance factor is {t:.3f}, above 1. The A-site ({aname}; radius {ra:.3f} Å) is too large for the B-site cage ({rb:.3f} Å), which favours non-cubic phases.")
        elif t is not None and t < 0.96: b.append(f"Tolerance factor is {t:.3f}, below 0.96. The A-site ({aname}; radius {ra:.3f} Å) is too small for the B-site cage ({rb:.3f} Å), so the octahedra tilt and the cubic phase is strained.")
        if ev is not None and ev < 1.7: b.append(f"Low O-vacancy energy of {ev:.3f} eV (target ≥ 1.7 eV): oxygen leaves the lattice easily, which weakens it.")
        if op is not None and op > -2.0: b.append(f"High O p-band centre ({op:.3f} eV, target below −2.0 eV): the oxygen states sit close to the Fermi level, so the lattice is more reactive and less stable.")
        if A.get("Ba", 0) >= 0.4: b.append(f"{round(100 * A['Ba'])} % large Ba on the A-site adds strain.")
        why.append({"key": "ehull", "title": f"Stability fails: Ehull {eh:.1f} meV/atom (limit {thr['ehull']:g})",
                    "lead": "The structure sits too far above the most stable phase mix, so it is likely to break down into other phases during long use at " + f"{temp:g} °C.",
                    "bullets": b or ["No single descriptor stands out; the SVR judges the combination of all 23 inputs."], "diff": eh - thr["ehull"]})
    if row["tec_result"] == "FAIL":
        tc = row["tec"]; b = []
        if co >= 0.5: b.append(f"Cobalt makes up {round(100 * co)} % of the B-site. Cobalt changes spin state and is easily reduced on heating, which swells the lattice.")
        if ev is not None and ev < 1.7: b.append(f"Easy oxygen loss (O-vacancy energy {ev:.3f} eV) adds extra \"chemical\" expansion on top of normal heat expansion.")
        if ds is not None and ds < -8: b.append(f"Weakly bound heavy A-site ions (Smith acidity {ds:.3f}, ionicity {f.get('Ionic_A', float('nan')):.3f}) make the lattice soft.")
        why.append({"key": "tec", "title": f"Thermal expansion fails: TEC {tc:.2f} ×10⁻⁶ K⁻¹ (limit {thr['tec']:g})",
                    "lead": "The cathode would expand much more than the GDC electrolyte on heating and cooling, which causes cracks and peeling.",
                    "bullets": b or ["No single descriptor stands out; the SVR judges the combination of all 23 inputs."], "diff": tc - thr["tec"]})
    if row["orr_result"] == "FAIL":
        lk = row["orr_value"] if row.get("orr_value") is not None else row["predicted_log_kstar"]; b = []
        if ev is not None and ev >= 2.0: b.append(f"High O-vacancy energy of {ev:.3f} eV: oxygen is held tightly, so few vacancies form and oxygen exchange at the surface is slow.")
        if op is not None and op <= -2.5: b.append(f"Low O p-band centre ({op:.3f} eV): the oxygen states are far from the Fermi level, which usually means less active oxygen exchange.")
        act = sum(B.get(e, 0) for e in ("Co", "Fe", "Mn", "Ni", "Cu"))
        if act < 0.5: b.append(f"Only {round(100 * act)} % of the B-site is a redox-active metal (Co, Fe, Mn, Ni, Cu).")
        why.append({"key": "orr", "title": f"Activity fails: log₁₀(k*) {lk:.2f} (limit {thr['orr']:g})", "lead": "The predicted oxygen surface-exchange rate is too slow for a cathode at this temperature.",
                    "bullets": b or ["No single descriptor stands out; the SVR judges the combination of all 23 inputs."], "diff": thr["orr"] - lk})
    good = []
    for m in ("ehull", "tec", "orr"):
        if row[f"{m}_result"] == "PASS":
            nm = {"ehull": "Ehull", "tec": "TEC", "orr": "ORR activity"}[m]; v = {"ehull": row["ehull"], "tec": row["tec"], "orr": row["orr_value"]}[m]
            lim = thr[m]; d = abs(v - lim)
            good.append({"ehull": f"Ehull {v:.1f} is {d:.1f} meV/atom under the {lim:g} limit.", "tec": f"TEC {v:.2f} is {d:.2f} ×10⁻⁶ K⁻¹ under the {lim:g} limit.",
                         "orr": f"ORR activity {v:.2f} is {d:.2f} log units above the {lim:g} limit."}[m])
    if add.get("asr") is not None and add["asr"] < 0.15: good.append(f"ASR {add['asr']:.3f} Ω·cm² is below the 0.15 target.")
    if add.get("electronic") is not None and add["electronic"] >= 10: good.append(f"Electronic conductivity ({add['electronic']:.1f} S/cm) is healthy.")
    targets = [{"d": "Tolerance factor t", "now": f"{t:.3f}" if t is not None else "—", "target": "0.96 – 1.02", "how": "Move the A-site toward a size that matches the B-site cage (a smaller A-site ion such as Nd if t is high)"},
               {"d": "O-vacancy energy", "now": f"{ev:.3f} eV" if ev is not None else "—", "target": "≥ 1.7 eV", "how": "Less Co, more Fe, small Nb dopant"}]
    if "Co" in B: targets.append({"d": "Co fraction on B-site", "now": f"{co:.2f}", "target": "≤ 0.50", "how": "Replace Co with Fe"})
    targets.append({"d": "Safety margin on TEC", "now": (f"{row['tec'] - thr['tec']:+.2f} over" if row["tec"] > thr["tec"] else f"{thr['tec'] - row['tec']:.2f} under"), "target": "≥ 0.5 under limit",
                    "how": f"Aim for TEC ≤ {thr['tec'] - 0.5:g} so lab scatter does not fail it"})
    cands = candidates(row["formula"], comp, ox, f, temp, bundle, props, thr, price_table)
    start = {"formula": row["formula"], "ehull": row["ehull"], "tec": row["tec"], "logk": row["orr_value"], "cost": row.get("cost"), "final": row["final_result"], "fails": [], "how": "Start",
             "margin": min(mg["ehull"], mg["tec"], mg["orr"])}
    start["fails"] = [n for n, k in (("Ehull", "ehull_result"), ("TEC", "tec_result"), ("log k*", "orr_result")) if row[k] == "FAIL"]
    best = next((c for c in cands if c["final"] == "PASS"), None)
    return {"why": why, "good": good, "targets": targets, "start": start, "cands": cands, "best": best,
            "steps": _steps(row, comp, f, thr, mg, best, cands), "bottom": _bottom(row, B, A, best, thr)}


def _steps(row, comp, f, thr, mg, best, cands):
    B = dict(comp["B"]); co = B.get("Co", 0.0); t = f.get("t"); st = []
    tec_fail, eh_fail, orr_fail = row["tec_result"] == "FAIL", row["ehull_result"] == "FAIL", row["orr_result"] == "FAIL"
    if tec_fail and co >= 0.5:
        st.append(("Fix thermal expansion first", [f"Cut cobalt from {co:g} to about 0.4–0.5 and raise iron to match. This is the biggest single lever on TEC.",
                                                   "If the candidate table shows TEC still above the limit after this edit, combine it with the A-site step."]))
    if eh_fail or (t is not None and (t > 1.02 or t < 0.96)):
        st.append(("Bring the A-site back into balance", [f"The tolerance factor is {t:.3f}; aim for 0.96–1.02 by exchanging part of the largest (or smallest) A-site ion for a better-sized one.",
                                                           "This is what lifts stability (Ehull) below the " + f"{thr['ehull']:g} meV/atom limit with room to spare."]))
    if not orr_fail and mg["orr"] is not None and mg["orr"] > 0.1:
        low = (best["logk"] if best else None)
        st.append(("Spend some of the spare activity", [f"The cathode has {row['orr_value'] - thr['orr']:.2f} log units of activity margin. Accept a lower log₁₀(k*)" + (f" (down to about {low:.1f})" if low is not None else "") + " in return for passing the other filters.",
                                                       f"Do not go below {thr['orr']:g}, which is the activity limit."]))
    if orr_fail:
        st.append(("Recover activity", ["Compare the log k* column of the candidate table: keep the edits that raised it and avoid the ones that lowered it.", f"The limit is {thr['orr']:g}."]))
    st.append(("Re-screen and keep a safety margin", ["Run each new composition through SCOPE again at the same temperature. Only continue with ones that pass all three filters.",
                                                       f"Prefer values with margin: TEC ≤ {thr['tec'] - 0.5:g}, Ehull ≤ {thr['ehull'] - 7:g} meV/atom, and a result inside the model's applicability domain."]))
    lab = [f"Prepare the new cathode by the solid-state route and run the validation tests. Do the dilatometer TEC test (average of {thr['tec']:g} ×10⁻⁶ K⁻¹ or lower) before the others."]
    if best and row.get("cost") and best.get("cost") and best["cost"] > row["cost"] * 1.2: lab.append("Check cost: the best candidate costs more than the starting composition; compare a smaller dopant share against your budget.")
    st.append(("Then go to the lab, TEC test first", lab))
    return st


def _bottom(row, B, A, best, thr):
    bits = []
    if row["tec_result"] == "FAIL" or row["ehull_result"] == "FAIL":
        bits.append(f"{row['formula']} " + (" and ".join(x for x in (["is too unstable"] if row["ehull_result"] == "FAIL" else []) + (["expands too much"] if row["tec_result"] == "FAIL" else []))) + ".")
    if row["orr_result"] == "FAIL": bits.append(f"{row['formula']} is also not active enough (log₁₀(k*) {row['orr_value']:.2f}).")
    if best: bits.append(f"In the simple edits tested here, {best['formula']} ({best['how']}) is predicted to pass all three filters.")
    else: bits.append("None of the simple edits tested here passes all three filters yet; use the candidate table to see which edit moved each value the right way.")
    return " ".join(bits)
