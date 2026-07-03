#!/usr/bin/env python3
# ponytail: M1 query-validation spike. Stdlib only. Proves Lucenia's hybrid +
# geo + filter DSL works and that the semantic clause reorders results vs a
# structured-only query. Pseudo-vectors (not real MiniLM) are fine here: the
# goal is to de-risk the query DSL, not embedding quality. M2 swaps in MiniLM.
import json, os, ssl, time, urllib.request, urllib.error, base64

BASE = os.environ.get("ENGINE_URL", "https://localhost:9200")
AUTH = "Basic " + base64.b64encode(b"admin:RoofRank!2026Dev").decode()
CTX = ssl.create_default_context(); CTX.check_hostname = False; CTX.verify_mode = ssl.CERT_NONE

def req(method, path, body=None, ndjson=False):
    url = BASE + path
    data = None; ct = "application/json"
    if body is not None:
        if ndjson:
            data = ("\n".join(json.dumps(x) for x in body) + "\n").encode(); ct = "application/x-ndjson"
        else:
            data = json.dumps(body).encode()
    r = urllib.request.Request(url, data=data, method=method, headers={"Authorization": AUTH, "Content-Type": ct})
    try:
        with urllib.request.urlopen(r, context=CTX, timeout=30) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")

def wait_ready(timeout=180):
    for _ in range(timeout):
        try:
            s, b = req("GET", "/")
            if s == 200:
                print("node up:", b.get("version", {}).get("distribution") or b.get("cluster_name")); return True
        except Exception:
            pass
        time.sleep(1)
    return False

def vec(sig, val=1.0):
    v = [0.01] * 384; v[sig] = val; return v

QV = vec(0)  # query vector: "aging flat warehouse, re-roof + solar" topic lives in dim 0

# 9 docs. P1,P2 pass every filter AND are semantic matches (dim 0).
# P3 passes filters, has the HIGHEST solar_score, but is a NEW roof (semantic dim 5, low match).
# P4-P9 each fail exactly one hard filter.
DOCS = [
 {"parcel_id":"P1","address":"1200 Cargo Way","zip":"75207","sector":"warehouse","roof_type":"flat","owner_occupied":True,"hoa_restricted":False,"best_azimuth_deg":180,"usable_roof_area_sqft":45000,"sunshine_kwh_per_kw_yr":1650,"roof_age_years":22,"annual_kwh_dc":610000,"solar_score":88,"centroid":{"lat":32.80,"lon":-96.85},"description":"aging flat warehouse roof, worn membrane, prime re-roof plus solar candidate, unshaded","description_vector":vec(0)},
 {"parcel_id":"P2","address":"55 Industrial Blvd","zip":"75061","sector":"industrial","roof_type":"flat","owner_occupied":True,"hoa_restricted":False,"best_azimuth_deg":160,"usable_roof_area_sqft":30000,"sunshine_kwh_per_kw_yr":1600,"roof_age_years":18,"annual_kwh_dc":410000,"solar_score":80,"centroid":{"lat":32.75,"lon":-96.75},"description":"older flat industrial roof nearing end of life, good for re-roof and solar array","description_vector":vec(0,0.9)},
 {"parcel_id":"P3","address":"900 New Commerce Dr","zip":"75201","sector":"warehouse","roof_type":"flat","owner_occupied":True,"hoa_restricted":False,"best_azimuth_deg":200,"usable_roof_area_sqft":60000,"sunshine_kwh_per_kw_yr":1700,"roof_age_years":3,"annual_kwh_dc":820000,"solar_score":94,"centroid":{"lat":32.79,"lon":-96.80},"description":"brand new flat warehouse roof, recently replaced membrane, large clear span","description_vector":vec(5)},
 {"parcel_id":"P4-pitched","address":"12 Gable St","zip":"75204","sector":"retail","roof_type":"pitched","owner_occupied":True,"hoa_restricted":False,"best_azimuth_deg":180,"usable_roof_area_sqft":40000,"sunshine_kwh_per_kw_yr":1650,"roof_age_years":20,"annual_kwh_dc":500000,"solar_score":70,"centroid":{"lat":32.78,"lon":-96.79},"description":"aging pitched retail roof","description_vector":vec(0)},
 {"parcel_id":"P5-small","address":"3 Tiny Unit","zip":"75210","sector":"retail","roof_type":"flat","owner_occupied":True,"hoa_restricted":False,"best_azimuth_deg":180,"usable_roof_area_sqft":8000,"sunshine_kwh_per_kw_yr":1650,"roof_age_years":20,"annual_kwh_dc":90000,"solar_score":60,"centroid":{"lat":32.77,"lon":-96.78},"description":"small aging flat roof","description_vector":vec(0)},
 {"parcel_id":"P6-lowsun","address":"7 Shady Ln","zip":"75211","sector":"warehouse","roof_type":"flat","owner_occupied":True,"hoa_restricted":False,"best_azimuth_deg":180,"usable_roof_area_sqft":35000,"sunshine_kwh_per_kw_yr":1400,"roof_age_years":20,"annual_kwh_dc":300000,"solar_score":58,"centroid":{"lat":32.76,"lon":-96.77},"description":"aging flat warehouse roof but heavily shaded low sun","description_vector":vec(0)},
 {"parcel_id":"P7-eastfacing","address":"8 Sunrise Rd","zip":"75212","sector":"warehouse","roof_type":"flat","owner_occupied":True,"hoa_restricted":False,"best_azimuth_deg":90,"usable_roof_area_sqft":35000,"sunshine_kwh_per_kw_yr":1650,"roof_age_years":20,"annual_kwh_dc":320000,"solar_score":62,"centroid":{"lat":32.74,"lon":-96.74},"description":"aging flat warehouse roof east facing","description_vector":vec(0)},
 {"parcel_id":"P8-hoa","address":"9 Gated Pkwy","zip":"75213","sector":"office","roof_type":"flat","owner_occupied":True,"hoa_restricted":True,"best_azimuth_deg":180,"usable_roof_area_sqft":35000,"sunshine_kwh_per_kw_yr":1650,"roof_age_years":20,"annual_kwh_dc":330000,"solar_score":64,"centroid":{"lat":32.73,"lon":-96.73},"description":"aging flat office roof but HOA restricted","description_vector":vec(0)},
 {"parcel_id":"P9-nyc","address":"1 Broadway","zip":"10004","sector":"warehouse","roof_type":"flat","owner_occupied":True,"hoa_restricted":False,"best_azimuth_deg":180,"usable_roof_area_sqft":50000,"sunshine_kwh_per_kw_yr":1650,"roof_age_years":25,"annual_kwh_dc":500000,"solar_score":85,"centroid":{"lat":40.70,"lon":-74.01},"description":"aging flat warehouse roof in New York outside the target region","description_vector":vec(0)},
]

INDEX = "parcels"
MAPPING = {
 "settings": {"index": {"number_of_shards":1,"number_of_replicas":0,"knn":True}},
 "mappings": {"properties": {
   "parcel_id":{"type":"keyword"},"address":{"type":"text"},"zip":{"type":"keyword"},
   "sector":{"type":"keyword"},"roof_type":{"type":"keyword"},
   "owner_occupied":{"type":"boolean"},"hoa_restricted":{"type":"boolean"},
   "best_azimuth_deg":{"type":"float"},"usable_roof_area_sqft":{"type":"float"},
   "sunshine_kwh_per_kw_yr":{"type":"float"},"roof_age_years":{"type":"integer"},
   "annual_kwh_dc":{"type":"float"},"solar_score":{"type":"float"},
   "centroid":{"type":"geo_point"},"description":{"type":"text"},
   "description_vector":{"type":"knn_vector","dimension":384,
     "method":{"name":"hnsw","space_type":"cosinesimil","engine":"lucene"}}
 }}
}

# hard constraints reused by both queries
FILTERS = [
 {"term":{"roof_type":"flat"}},
 {"range":{"usable_roof_area_sqft":{"gte":20000}}},
 {"range":{"sunshine_kwh_per_kw_yr":{"gte":1500}}},
 {"range":{"best_azimuth_deg":{"gte":135,"lte":225}}},
 {"geo_bounding_box":{"centroid":{"top_left":{"lat":33.0,"lon":-97.4},"bottom_right":{"lat":32.6,"lon":-96.6}}}},
]
MUST_NOT = [{"term":{"hoa_restricted":True}}]

def ids(resp):
    return [h["_source"]["parcel_id"] for h in resp["hits"]["hits"]]

def main():
    assert wait_ready(), "node did not become ready"
    req("DELETE", "/"+INDEX)
    s,b = req("PUT", "/"+INDEX, MAPPING); print("create index:", s, b.get("error",{}).get("type","ok"))
    assert s==200, b
    # hybrid requires a normalization search pipeline
    s,b = req("PUT", "/_search/pipeline/solar-hybrid", {
      "description":"normalize+combine BM25 and kNN",
      "phase_results_processors":[{"normalization-processor":{
        "normalization":{"technique":"min_max"},
        "combination":{"technique":"arithmetic_mean","parameters":{"weights":[0.4,0.6]}}}}]})
    print("create pipeline:", s, b.get("error",{}).get("type","ok")); assert s==200, b
    bulk=[]
    for d in DOCS:
        bulk.append({"index":{"_index":INDEX,"_id":d["parcel_id"]}}); bulk.append(d)
    s,b = req("POST","/_bulk?refresh=true",bulk,ndjson=True); print("bulk:", s, "errors=", b.get("errors")); assert s==200 and not b.get("errors"), b

    # 1) STRUCTURED-ONLY: filters + sort by solar_score
    s,structured = req("GET", "/"+INDEX+"/_search", {
      "size":10,"query":{"bool":{"filter":FILTERS,"must_not":MUST_NOT}},
      "sort":[{"solar_score":"desc"}]})
    assert s==200, structured
    s_ids = ids(structured)

    # 2) HYBRID: match + filtered knn, scored (no sort -> _score order)
    s,hybrid = req("GET", "/"+INDEX+"/_search?search_pipeline=solar-hybrid", {
      "size":10,"query":{"hybrid":{"queries":[
        {"bool":{"must":[{"match":{"description":"aging flat warehouse roof re-roof solar"}}],
                 "filter":FILTERS,"must_not":MUST_NOT}},
        {"knn":{"description_vector":{"vector":QV,"k":10,
                 "filter":{"bool":{"filter":FILTERS,"must_not":MUST_NOT}}}}}
      ]}}})
    if s!=200:
        print("HYBRID ERROR", s, json.dumps(hybrid)[:800]); raise SystemExit(1)
    h_ids = ids(hybrid)

    # 3) geohex heatmap aggregation
    s,agg = req("GET","/"+INDEX+"/_search", {"size":0,"aggregations":{
      "heat":{"geohash_grid":{"field":"centroid","precision":5}}}})
    buckets = agg.get("aggregations",{}).get("heat",{}).get("buckets",[]) if s==200 else []

    print("\n--- structured (sort solar_score):", s_ids)
    print("--- hybrid     (sort _score)    :", h_ids)
    print("--- geohash buckets:", len(buckets), "| agg status", s)

    passing = {"P1","P2","P3"}
    checks = {
      "structured returns exactly the 3 passing parcels": set(s_ids)==passing,
      "structured top is P3 (highest solar_score)": s_ids and s_ids[0]=="P3",
      "hybrid hits are within the filtered set": set(h_ids)<=passing and len(h_ids)>0,
      "hybrid top is a semantic match (P1/P2), NOT P3": h_ids and h_ids[0] in {"P1","P2"},
      "semantic REORDERED vs structured (diff #1)": s_ids and h_ids and s_ids[0]!=h_ids[0],
      "filters excluded pitched/small/lowsun/east/hoa/nyc": set(s_ids).isdisjoint(
          {"P4-pitched","P5-small","P6-lowsun","P7-eastfacing","P8-hoa","P9-nyc"}),
      "geohash grid aggregation returned >=1 bucket": len(buckets)>=1,
    }
    print("\n=== CHECKS ===")
    ok=True
    for k,v in checks.items():
        print(("PASS" if v else "FAIL"), "-", k); ok = ok and v
    print("\n"+("ALL PASS - hybrid+geo+filter DSL validated (Lucenia or any OpenSearch-2.14-compatible engine)" if ok else "SOME CHECKS FAILED"))
    raise SystemExit(0 if ok else 1)

if __name__=="__main__":
    main()
