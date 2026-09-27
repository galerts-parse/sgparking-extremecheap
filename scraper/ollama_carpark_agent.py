#!/usr/bin/env python3
"""
Ollama Carpark Rate Parser Agent
Runs on Mac Studio (msunus) or via SSH tunnel (127.0.0.1:11434)
Uses qwen3.6:quick (17.4 GB) with zero cost and completely within spare RAM limits.
"""

import json
import re
import os
import sys
import time
import urllib.request
import urllib.error

OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434/api/generate")
MODEL_NAME = os.environ.get("OLLAMA_MODEL", "qwen3.6:quick")

SYSTEM_PROMPT = """You are an expert parking fee parser for Singapore carparks.
Parse the given Singapore Carpark rate text into a strict JSON object.
The JSON object MUST have keys: "weekday", "saturday", and "sunday".
Each key must be an array of time slot objects.
Each slot object MUST have:
  - "start": float (0.0 to 24.0 in 24hr decimal, e.g. 7.0 for 7am, 18.0 for 6pm)
  - "end": float (0.0 to 24.0)
And one or more of these pricing properties:
  - "first_hours": float (e.g. 1.0, 2.0, 0.5)
  - "first_hours_cost": float
  - "subsequent_hour": float
  - "subsequent_30mins": float
  - "subsequent_15mins": float
  - "per_entry": float (if flat rate)
  - "entry_group": string (e.g. "overnight" if per_entry crosses midnight or covers evening to morning)
  - "per_hour": float (if flat hourly from start)
  - "per_30mins": float (if flat 30min from start)
  - "closed": true (if carpark is closed during this time)
  - "free": true (if parking is free)

Return ONLY valid JSON. No markdown backticks, no explanatory text.
"""

def call_ollama(prompt, retries=2):
    payload = {
        "model": MODEL_NAME,
        "prompt": prompt,
        "system": SYSTEM_PROMPT,
        "format": "json",
        "stream": False,
        "options": {
            "temperature": 0.1,
            "num_predict": 1024
        }
    }
    
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(OLLAMA_URL, data=data, headers={"Content-Type": "application/json"})
    
    for attempt in range(retries + 1):
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                res = json.loads(resp.read().decode("utf-8"))
                txt = res.get("response") or res.get("thinking") or ""
                # Extract JSON if surrounded by markdown or thinking
                json_match = re.search(r'(\{[\s\S]*\})', txt)
                if json_match:
                    return json.loads(json_match.group(1))
                return json.loads(txt)
        except Exception as e:
            if attempt == retries:
                print(f"Ollama call error: {e}")
                return None
            time.sleep(2)
    return None

def validate_rates_json(rates):
    if not isinstance(rates, dict):
        return False
    for day in ["weekday", "saturday", "sunday"]:
        if day not in rates or not isinstance(rates[day], list):
            return False
        for slot in rates[day]:
            if not isinstance(slot, dict):
                return False
            if "start" not in slot or "end" not in slot:
                return False
            if not (0 <= slot["start"] <= 24 and 0 <= slot["end"] <= 24):
                return False
    return True

def parse_carpark_with_agent(cp):
    txt = cp.get("rates_text", "")
    if not txt:
        return None
        
    prompt = f"""Carpark: {cp.get('name', 'Unknown')}
Rates Text:
{txt}

Output strict JSON representation of the rates for weekday, saturday, sunday.
"""
    result = call_ollama(prompt)
    if result and validate_rates_json(result):
        return result
    return None

CACHE_FILE = os.path.join(os.path.dirname(__file__), "..", "data", "commercial_carparks_llm_cache.json")

def load_cache():
    if os.path.exists(CACHE_FILE):
        try:
            with open(CACHE_FILE, "r") as f:
                return json.load(f)
        except Exception:
            return {}
    return {}

def save_cache(cache):
    with open(CACHE_FILE, "w") as f:
        json.dump(cache, f, indent=2)

if __name__ == "__main__":
    data_path = os.path.join(os.path.dirname(__file__), "..", "data", "commercial_carparks.js")
    with open(data_path, "r") as f:
        content = f.read()
    carparks = json.loads(re.search(r'COMMERCIAL_CARPARKS\s*=\s*(\[[\s\S]*\]);', content).group(1))
    
    cache = load_cache()
    
    # Check command line args
    if len(sys.argv) > 1 and sys.argv[1] == "--test":
        test_cp = next((c for c in carparks if "Centennial Tower" in c.get("name", "")), carparks[0])
        print(f"Testing on {test_cp['name']}...")
        parsed = parse_carpark_with_agent(test_cp)
        print("Result:", json.dumps(parsed, indent=2))
    elif len(sys.argv) > 1 and sys.argv[1] in ["--batch", "--all"]:
        is_all = sys.argv[1] == "--all"
        limit = len(carparks) if is_all else (int(sys.argv[2]) if len(sys.argv) > 2 else 10)
        print(f"Running agent on {limit} commercial carparks (Cached already: {len(cache)})...")
        success = 0
        skipped = 0
        
        for i, cp in enumerate(carparks[:limit]):
            name = cp.get("name", "")
            if not cp.get("rates_text"):
                continue
            if name in cache:
                skipped += 1
                continue
                
            print(f"[{i+1}/{limit}] Parsing '{name}' via Ollama...")
            res = parse_carpark_with_agent(cp)
            if res:
                cache[name] = res
                save_cache(cache)
                success += 1
                print(f"  ✓ Saved to cache ({len(cache)} total cached)")
            else:
                print(f"  ✗ Failed/Skipped")
                
        print(f"Run complete. New parsed: {success}, Skipped (already cached): {skipped}, Total cache: {len(cache)}")
        
        # Apply to commercial_carparks.js if requested or all done
        if "--apply" in sys.argv:
            applied = 0
            for cp in carparks:
                if cp.get("name") in cache:
                    cp["rates"] = cache[cp["name"]]
                    applied += 1
            new_content = f"// Singapore Commercial Carpark Rates Database (AI/LLM-parsed)\nconst COMMERCIAL_CARPARKS = {json.dumps(carparks, indent=2)};\n\nif (typeof module !== 'undefined' && module.exports) {{\n  module.exports = { COMMERCIAL_CARPARKS };\n}}\n"
            with open(data_path, "w") as f:
                f.write(new_content)
            print(f"Applied {applied} cached rate structures to {data_path}")
    elif len(sys.argv) > 1 and sys.argv[1] == "--apply":
        applied = 0
        for cp in carparks:
            if cp.get("name") in cache:
                cp["rates"] = cache[cp["name"]]
                applied += 1
        new_content = f"// Singapore Commercial Carpark Rates Database (AI/LLM-parsed)\nconst COMMERCIAL_CARPARKS = {json.dumps(carparks, indent=2)};\n\nif (typeof module !== 'undefined' && module.exports) {{\n  module.exports = { COMMERCIAL_CARPARKS };\n}}\n"
        with open(data_path, "w") as f:
            f.write(new_content)
        print(f"Applied {applied} cached rate structures to {data_path}")
    else:
        print("Usage:")
        print("  python3 ollama_carpark_agent.py --test")
        print("  python3 ollama_carpark_agent.py --batch <num> [--apply]")
        print("  python3 ollama_carpark_agent.py --all [--apply]")
        print("  python3 ollama_carpark_agent.py --apply")

