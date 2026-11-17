# SCOPE (NGIT)
Dataset-based batch screening following *Deng et al., "Machine-Learning-Based Screening of Perovskite Cathodes for Low-Temperature SOFC Operation", Crystals 2026, 16, 68*.
Stack (all free): Python · Flask · scikit-learn · SQLite · vanilla HTML/CSS/JS.

## Run locally (free)
Windows: double-click `run.bat`  ·  Mac/Linux: `./run.sh`  → open http://localhost:5000
Login: any valid roll number (e.g. `23CSE001`, 6–15 letters/digits) + the shared password. A user is created on first login.

## Free hosting
* **PythonAnywhere (free)** – recommended: persistent disk, so SQLite DB, uploads and models survive. Upload the folder, create a Flask web app, point WSGI to `backend/wsgi.py`, `pip install -r requirements.txt`.
* **Render free web service** – works (`Procfile` included) but its free disk is **ephemeral**: data is lost on redeploy/restart. Use only for demos.
* Set `STORAGE_DIR` to change where `app.db`, `uploads/` and `models/` are kept; set `SECRET_KEY` / `APP_SHARED_PASSWORD` env vars for deployment.

## What it does
Upload CSV/XLSX → auto column detection (editable) → all usable descriptors from the paper's list, basic + enhanced + 1000/T (unavailable ones are dropped, never invented; no feature selection) →
Pipeline(median imputer → StandardScaler → model) → grouped 5-fold CV GridSearchCV for the **SVR** (the only classical model; KNN/MLP/RF/GBR were removed to save training time) →
predict log10(k*) and k*=10^x for every cathode → Mahalanobis AD (0.8 quantile of training distances) → Ehull ≤ 57 meV/atom → log10(k*) ≥ −6.40 (*LSC benchmark used in the research paper*) →
PASS / FAIL / NOT FULLY EVALUABLE → top-5 candidate cards, screening funnel, log10(k*)-vs-Ehull scatter plot, filters, details modal, Shapley feature contributions, Excel/CSV export. Everything is saved per roll number in SQLite + disk.

## Where your data is stored
In `~/.perovskite_screening` (Windows: `C:\Users\<you>\.perovskite_screening`), outside the code folder, so unzipping a new version never wipes your history. An older `pcs/storage` folder is copied there automatically on first start. Login is a per-tab session: the login page appears every time you open the app fresh.

## Honest limitations (please read)
* **Cost is now an automatic estimate, not a filter.** From each cathode's formula the app works out the moles of every precursor (e.g. La2O3, SrCO3, MnO2), converts them to grams, multiplies by the price per kg (99 % purity basis), adds the costs and divides by the theoretical mass of cathode times the synthesis yield (95 %, `COST_YIELD_PERCENT`; small excess for Li/Na/K/Bi/Pb). The result is an **estimated USD per kg of cathode**, shown with a **Cheap / Moderate / Expensive** level (cheapest / middle / dearest third of the screened cathodes). It does **not** change PASS / FAIL. Prices are built-in approximate estimates (`DEFAULT_ROWS` in `backend/cost.py`, not live quotes). To override an element, edit `precursor_prices.csv` in the data folder by hand (columns: element, precursor, price_per_kg, purity_percent, pack_size_g); it is re-read automatically.
* **Not an exact reproduction**: the paper's Arrhenius-normalised dataset, Table S2 hyper-parameters, and RF-generated enhanced descriptors are not available. Enhanced columns (Gap, TEC, O_pband …) are ordinary SVR inputs. Ehull is taken from your column.
* Hyper-parameter grids are deliberately small so training finishes in about a minute; .
* The AD threshold is the 0.8 quantile of the *training* distances, so ~20 % of your own cathodes are outside by construction.
* Predictions for uploaded rows come from a model trained on those rows (in-sample); the cross-validated value is shown in each cathode's details.
* Same formula (e.g. `La0.6Sr0.4CoO3` = `La0.6Sr0.4Co1O3`) is counted once; the same dataset uploaded twice is stored once.
* Column abbreviations (`Sa`, `Ionic`, `Ion`) follow the paper's Fig. 3 labels. Shapley values use a built-in Monte-Carlo estimator, not the `shap` package.
* Shared-password login (stored hashed, 7-day tokens, no rate limiting) – fine for a college project, not for the open internet.

## ANN option (PyTorch) – added
* **Model Training** page → *Model* dropdown: **SVR** (all descriptors) or **ANN (PyTorch)**. Both are stored side by side; choosing one never replaces the other.
* ANN: `Linear→ReLU` network (`TorchANN` in `backend/ml.py`), AdamW + cosine LR, MSE loss, **all features, no feature selection**, same grouped 60:40 split as the SVR, hyper-parameters (hidden layers, weight decay) tuned with grouped 3-fold CV (80 epochs; Shapley on a 300-row sample). Median imputer + StandardScaler sit in the same sklearn Pipeline, so AD, Shapley, screening and predictions use the same code as the SVR.
* Page flow: train SVR on *ML Training* as before → *Model Training* → choose **ANN** → *Train ANN* → *Screen using ANN* (or *Train using SVR* for the SVR). The Screening Results page shows which model produced the results.
* **Predict Cathode** page has a *Prediction model* dropdown (SVR and ANN both use all descriptor inputs).
* Needs `pip install torch` (listed in `requirements.txt`). Without it the SVR still works and the ANN button shows a clear message.
* **Best in category** (results page + export): among the PASS cathodes only, the most stable (lowest Ehull), lowest estimated cost, most active (highest predicted log10(k*)) and most balanced (lowest rank-sum of the three ranks). Ties are listed, and a category whose criterion is missing is skipped with a note. Only values already in the results are used.

## Built-in SVR + ANN (no upload / training for first-time users)
The **Predict Single Cathode** page works immediately for every new user: pick **SVR** or **ANN** and predict. The two models are trained once on your dataset and shipped *inside the code folder* (`backend/builtin_models/`), so they survive re-deploys (also on Render's ephemeral disk).
To create / refresh them (run once on your computer, then zip or deploy the whole folder):
```
pip install -r requirements.txt
cd backend
python build_builtin_models.py path/to/your_dataset.xlsx
```
This writes `svr_pipeline.joblib`, `ann_pipeline.joblib` and `meta.json` to `backend/builtin_models/`. Both models use the same full descriptor set (basic + enhanced + 1000/T). Keep the library versions in `requirements.txt` the same on the server as on the machine that built the models (joblib files are version-sensitive).

**Status:** `backend/builtin_models/` already contains the SVR trained on `Kstar_Combined.xlsx` (386 rows, 23 descriptors). To add the ANN, install PyTorch and run `python build_builtin_models.py Kstar_Combined.xlsx --ann-only` (the SVR files are kept). Until then the ANN button on the Predict page is greyed out.
