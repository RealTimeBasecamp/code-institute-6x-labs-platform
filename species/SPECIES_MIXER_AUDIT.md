# Species Mixer — System Audit

**Date:** 2026-03-10
**Key files:** `species/services/ai_agent.py`, `species/services/environmental_data.py`

---

## 1. Data Sources

| API Name | What It Does | Notes |
|---|---|---|
| **GBIF Occurrence API** | Returns plant species observations within a radius of the target location. Sorted by observation count. | Primary candidate source. Includes iNaturalist research-grade records (GBIF ingests them weekly). 25 km search radius. |
| **GBIF Species API** | Fetches taxonomic trait data (family, vernacular names) for each candidate species. | Called in parallel for all 60 candidates (10 threads). Family name is critical — all elimination and scoring rules are family-based. |
| **NBN Atlas** | UK-specific botanical survey records (includes BSBI data). Returns species observed near the location. | Merged with GBIF records; duplicates de-duplicated by scientific name. Adds +1 to `observation_count` and appends `'nbn'` to sources if already in GBIF list. |
| **SoilGrids (ISRIC)** | Returns soil pH, clay %, organic carbon % for the location. | Used for pH and moisture filters + scoring bonuses. Occasionally returns incomplete data — logged as warning. |
| **OpenLandMap** | Returns mean annual rainfall (mm), mean temperature (°C), frost days/year, growing season days. | Used for rainfall + temperature filters and scoring bonuses. Falls back to heuristic estimates if unavailable. |
| **EA Flood Map (WFS)** | England-only. Returns flood risk zone (high / medium / low) via WFS query. | Used in flood filter and scoring. |
| **SEPA Flood Risk (ArcGIS)** | Scotland-only. Returns flood risk zone via ArcGIS REST API. | Complements EA for Scottish locations. |
| **Photon (Komoot)** | Reverse geocoding — converts lat/lng to human-readable place name. | Display only; not used in filtering or scoring. |
| **Local DB (planting.Species)** | Django model query for species already in the project database. | Secondary source; merged into candidates if present. |

---

## 2. The 5-Phase Pipeline

```
60 candidates (Phase 1–2)
     │
     ▼  Phase 3: Hard Elimination (family-based disqualifiers)
     │   → Eliminates X species (often 0 in mild UK climates)
     ▼
  ~60 survivors (pool)
     │
     ▼  Phase 4: Scoring (all survivors ranked by score)
     │
     ▼  Phase 5: Diversity-first selection — HARD CAP OF 15
15 final species
```

---

## 3. Phase 3 — Elimination Rules

These are **hard disqualifiers**. A species is removed entirely if its family matches and the site condition applies.

| Filter | Condition Trigger | Disqualified Families | Typical UK Impact |
|---|---|---|---|
| **Flood Risk** | `flood_risk == 'high'` | `pinaceae, cupressaceae, fagaceae, aceraceae, sapindaceae, cistaceae, lamiaceae` | Low impact — high flood risk is rare in most UK locations |
| **Extreme Acid (pH)** | `ph < 4.5` | `orchidaceae, fabaceae, brassicaceae` | Low — very few UK soils are pH < 4.5 |
| **Extreme Alkaline (pH)** | `ph > 8.0` | `ericaceae, pinaceae, sphagnaceae` | Low — pH > 8.0 is rare |
| **Dry Soil** | `moisture == 'dry'` | `typhaceae, sphagnaceae, amblystegiaceae` | Low — only 3 families, all niche wetland plants |
| **Wet Soil** | `moisture == 'wet'` | `cistaceae` | Very low — only 1 family (rockroses) |
| **Low Rainfall** | `rainfall < 450 mm` | `typhaceae, osmundaceae, sphagnaceae` | Very low — almost no UK sites below 450 mm |
| **High Rainfall** | `rainfall > 1500 mm` | `cistaceae` | Very low — only 1 family |
| **Cold Climate** | `mean_temp < 3°C` | `oleaceae` | Very low — only 1 family |
| **Warm Climate** | `mean_temp > 16°C` | `sphagnaceae` | Very low — only 1 family |

**Why "Eliminated 0" is common:** The disqualified family lists are very small (1–7 families each) and the conditions are set to extreme thresholds. In a typical mild UK climate, none of these conditions trigger, so the full 60 candidates survive to scoring.

---

## 4. Phase 5 — Selection Cap (The Real Bottleneck)

This is where 60 → 15 happens. It is **intentional**, not a side effect of elimination.

| Step | Logic | Species Added |
|---|---|---|
| Mandatory: Trees | Pick top 2 trees by score | 2 |
| Mandatory: Shrubs | Pick top 2 shrubs by score | 2 |
| Mandatory: Wildflowers | Pick top 3 wildflowers by score | 3 |
| Mandatory: Grasses | Pick top 1 grass by score | 1 |
| Optional: Ferns | Pick top 1 fern (if slots remain) | 0–1 |
| Optional: Mosses | Pick top 1 moss (if slots remain) | 0–1 |
| Fill remaining slots | Pick highest-scoring species from any category | up to 5–7 |
| **Total** | | **Up to 15** |

The hard cap is `SPECIES_MIX_MAX_SPECIES = 15` in `settings.py`.

---

## 5. Why the Mix Feels Small / Narrow

### Problem 1: Hard cap of 15 species
Even with 60 good candidates, only 15 are shown. The remaining 45 are silently discarded by Phase 5.

### Problem 2: Only a small number of families get eliminated
The elimination filters cover very few families (see table above). This means the pool entering Phase 4 is still ~60, but scoring then concentrates on the top scorers — and the same families tend to win repeatedly.

### Problem 3: Scoring heavily favours high-observation species
`score += min(observation_count * 2, 40)` — species with many GBIF observations (common/widespread species) get a big head-start. Rarer but ecologically appropriate native species with fewer records get lower scores and are less likely to make the top 15.

### Problem 4: Category minimums are conservative
The mandatory mix (2 trees, 2 shrubs, 3 wildflowers, 1 grass = 8) is the floor, not the ceiling. After filling these 8, only 7 slots remain to be filled by scoring. Only 1 fern and 1 moss are allowed in the optional step — all other ferns/mosses are dropped even if 10 were in the scored pool.

### Problem 5: Observation bias correction helps trees/grasses but not enough
The +30 for Trees and +25 for Grasses partially corrects for under-recording, but if GBIF has very few local observations for native trees, even the bias boost may not rank them above abundant wildflowers.

---

## 6. Recommended Changes (for discussion)

| Change | Effect |
|---|---|
| Increase `SPECIES_MIX_MAX_SPECIES` from 15 → 25–30 | More species in the final mix |
| Increase `CATEGORY_MINIMUMS` — e.g. Wildflower: 5, Tree: 3, Shrub: 3 | More diversity by category |
| Increase `CATEGORY_OPTIONALS` — e.g. Fern: 2, Moss: 2 | More cryptogams included |
| Increase candidate pool from 60 → 100 | Wider pool to draw from before scoring |
| Widen elimination conditions (already quite permissive — low priority) | Minimal gain |
| Add nativeness scoring bonus (prefer species native to UK/Ireland) | Better ecological quality without reducing quantity |
| Reduce scoring weight of raw observation count (currently up to 40 pts) | Levels playing field for rarer native species |
