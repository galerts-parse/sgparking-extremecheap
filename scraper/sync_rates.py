#!/usr/bin/env python3
"""
SGCarMart Online Rates Scraper & Synchronizer
Fetches latest parking rates from SGCarMart REST API and updates rates_text in commercial_carparks.js.
"""
import urllib.request
import urllib.parse
import json
import re
import sys
import os
import time

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.5"
}

RAW_CACHE_FILE = os.path.join(os.path.dirname(__file__), "..", "data", "sgcarmart_raw_rates.json")
COMMERCIAL_JS = os.path.join(os.path.dirname(__file__), "..", "data", "commercial_carparks.js")

def fetch_sgc_index():
    url = "https://www.sgcarmart.com/carpark"
    print("Fetching SGCarMart main index...")
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=15) as resp:
        html = resp.read().decode("utf-8", errors="ignore")
    m = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', html)
    if not m:
        raise Exception("Could not find __NEXT_DATA__ in SGCarMart index")
    data = json.loads(m.group(1))
    cp_list = data.get("props", {}).get("pageProps", {}).get("carparksData", {}).get("data", [])
    print(f"Found {len(cp_list)} carparks in SGCarMart index.")
    return cp_list

def fetch_carpark_rates(cp_id):
    url = f"https://www.sgcarmart.com/api/carpark/fetch-carpark-detail-data?id={cp_id}"
    req = urllib.request.Request(url, headers=HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            res = json.loads(resp.read().decode("utf-8"))
            if res.get("data", {}).get("success"):
                return res["data"]["data"]
    except Exception as e:
        pass
    return None

def format_rates_text(detail):
    parts = []
    wd1 = (detail.get("wd1") or "").strip()
    wd2 = (detail.get("wd2") or "").strip()
    sat = (detail.get("sat") or "").strip()
    sun = (detail.get("sun") or "").strip()
    remarks = (detail.get("remarks") or "").strip()
    
    if wd1:
        parts.append(f"MON-FRI Before 5/6 PM\n{wd1}")
    if wd2:
        parts.append(f"MON-FRI After 5/6 PM\n{wd2}")
    if sat:
        parts.append(f"SAT\n{sat}")
    if sun:
        parts.append(f"SUN / PUBLIC HOLIDAYS\n{sun}")
    if remarks:
        parts.append(f"REMARKS\n{remarks}")
        
    return "\n\n".join(parts)

def load_raw_cache():
    if os.path.exists(RAW_CACHE_FILE):
        try:
            with open(RAW_CACHE_FILE, "r") as f:
                return json.load(f)
        except Exception:
            return {}
    return {}

def save_raw_cache(cache):
    with open(RAW_CACHE_FILE, "w") as f:
        json.dump(cache, f, indent=2)

def sync_all_rates(limit=None):
    with open(COMMERCIAL_JS, "r") as f:
        content = f.read()
    carparks = json.loads(re.search(r'COMMERCIAL_CARPARKS\s*=\s*(\[[\s\S]*\]);', content).group(1))
    
    # 1. Fetch SGCarMart index to map names to IDs
    try:
        sgc_index = fetch_sgc_index()
        name_to_id = {item["name"].lower().strip(): item["id"] for item in sgc_index}
    except Exception as e:
        print(f"Warning: Index fetch failed ({e}), relying on existing IDs.")
        name_to_id = {}
        
    cache = load_raw_cache()
    print(f"Existing raw cache: {len(cache)} carparks.")
    
    targets = []
    for cp in carparks:
        m = re.match(r'COMM_SGC_(\d+)', cp.get("no", ""))
        cp_id = int(m.group(1)) if m else name_to_id.get(cp.get("name", "").lower().strip())
        targets.append((cp, cp_id))
        
    if limit:
        targets = targets[:limit]
        
    print(f"Syncing rates for {len(targets)} carparks...")
    updated_count = 0
    new_scrapes = 0
    
    for i, (cp, cp_id) in enumerate(targets):
        name = cp.get("name", "Unknown")
        if not cp_id:
            continue
            
        str_id = str(cp_id)
        detail = cache.get(str_id)
        
        if not detail:
            detail = fetch_carpark_rates(cp_id)
            if detail:
                cache[str_id] = detail
                save_raw_cache(cache)
                new_scrapes += 1
                time.sleep(0.08) # gentle rate limiting
                
        if detail:
            new_text = format_rates_text(detail)
            if new_text and new_text != cp.get("rates_text"):
                cp["rates_text"] = new_text
                updated_count += 1
                
        if (i + 1) % 50 == 0 or i + 1 == len(targets):
            print(f"  Progress: {i+1}/{len(targets)} (New scraped: {new_scrapes}, Rates updated: {updated_count})")
            
    # Save back to commercial_carparks.js
    dumped = json.dumps(carparks, indent=2)
    new_js = f"// SG ParkExtreme Cheap - Merged Curated and Scraped Private Parking Database\n// Total Commercial Carparks: {len(carparks)}\n\nconst COMMERCIAL_CARPARKS = {dumped};\n\nif (typeof module !== 'undefined' && module.exports) {{\n  module.exports = {{ COMMERCIAL_CARPARKS }};\n}}\n"
    with open(COMMERCIAL_JS, "w") as f:
        f.write(new_js)
        
    print(f"\nDone! Scraped {new_scrapes} new entries online. Updated {updated_count} carpark rate descriptions in commercial_carparks.js.")

if __name__ == "__main__":
    limit = int(sys.argv[2]) if len(sys.argv) > 2 else None
    if len(sys.argv) > 1 and sys.argv[1] == "--scrape":
        sync_all_rates(limit)
    elif len(sys.argv) > 1 and sys.argv[1] == "--test":
        print("Testing single fetch on Centennial Tower (581)...")
        detail = fetch_carpark_rates(581)
        if detail:
            print("Successfully fetched!")
            print(format_rates_text(detail))
    else:
        print("Usage:")
        print("  python3 scraper/sync_rates.py --test")
        print("  python3 scraper/sync_rates.py --scrape [limit]")
