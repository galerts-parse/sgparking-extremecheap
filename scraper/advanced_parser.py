import json
import re
import os

def parse_time(time_str):
    s = time_str.strip().lower()
    if '12midnight' in s or '12 midnight' in s or '12.00midnight' in s or 'midnight' in s:
        return 24.0
    if '12noon' in s or '12 noon' in s or '12pm' in s or '12.00pm' in s:
        return 12.0
    m = re.search(r'(\d{1,2})(?:[\.:](\d{2}))?\s*(am|pm)', s)
    if not m:
        return None
    h = int(m.group(1))
    mins = int(m.group(2)) if m.group(2) else 0
    ampm = m.group(3)
    if ampm == 'pm' and h != 12:
        h += 12
    if ampm == 'am' and h == 12:
        h = 0
    return round(h + mins / 60.0, 2)

def parse_carpark_rates(rates_text, cp_name=""):
    if not rates_text:
        return None

    # Handle known manual specials
    if 'Suntec City' in cp_name:
        return {
            "weekday": [
                { "start": 0, "end": 4, "per_entry": 3.0, "entry_group": "suntec_night" },
                { "start": 4, "end": 17, "first_hours": 1, "first_hours_cost": 2.60, "subsequent_30mins": 1.30 },
                { "start": 17, "end": 24, "per_entry": 3.0, "entry_group": "suntec_night" }
            ],
            "saturday": [
                { "start": 0, "end": 4, "per_entry": 3.0, "entry_group": "suntec_night" },
                { "start": 4, "end": 7, "first_hours": 1, "first_hours_cost": 2.60, "subsequent_30mins": 1.30 },
                { "start": 7, "end": 24, "first_hours": 1, "first_hours_cost": 2.60, "subsequent_hour": 0.43 }
            ],
            "sunday": [
                { "start": 0, "end": 4, "per_entry": 3.0, "entry_group": "suntec_night" },
                { "start": 4, "end": 7, "first_hours": 1, "first_hours_cost": 2.60, "subsequent_30mins": 1.30 },
                { "start": 7, "end": 24, "first_hours": 1, "first_hours_cost": 2.60, "subsequent_hour": 0.43 }
            ]
        }
    if 'East Coast Park' in cp_name:
        return {
            "weekday": [ { "start": 0, "end": 24, "per_30mins": 0.60 } ],
            "saturday": [ { "start": 0, "end": 24, "per_30mins": 0.60 } ],
            "sunday": [ { "start": 0, "end": 24, "per_30mins": 0.60 } ]
        }

    rates = {"weekday": [], "saturday": [], "sunday": []}
    
    # Split text into sections based on standard SGCarMart headers
    raw_sections = re.split(r'(MON\s*-\s*FRI\s*Before[^\n]*|MON\s*-\s*FRI\s*After[^\n]*|MON\s*-\s*FRI[^\n]*|WEEKDAY[^\n]*|SATURDAY[^\n]*|SAT[^\n]*|SUN\s*/\s*PUBLIC\s*HOLIDAYS[^\n]*|SUN\s*&\s*PH[^\n]*|SUNDAY[^\n]*|REMARKS[^\n]*)', rates_text, flags=re.IGNORECASE)
    
    section_map = {}
    current_key = "DEFAULT"
    for part in raw_sections:
        part_clean = part.strip()
        if not part_clean:
            continue
        up = part_clean.upper()
        if 'MON' in up and 'BEFORE' in up:
            current_key = "MF_DAY"
        elif 'MON' in up and 'AFTER' in up:
            current_key = "MF_NIGHT"
        elif 'MON' in up or 'WEEKDAY' in up:
            current_key = "MF_ALL"
        elif 'SAT' in up:
            current_key = "SAT"
        elif 'SUN' in up or 'PUBLIC' in up or 'PH' in up:
            current_key = "SUN"
        elif 'REMARKS' in up:
            current_key = "REMARKS"
        else:
            section_map[current_key] = section_map.get(current_key, "") + "\n" + part_clean

    def extract_slots(text, day_type):
        slots = []
        if not text:
            return slots
            
        # Check if closed
        if re.search(r'\bcarpark\s+closed\b|\bclosed\s+on\b|\bno\s+parking\b', text, re.I):
            close_time_m = re.search(r'closed\s+(?:from|after)?\s*([0-9\.:]+[a-z]+)?\s*(?:to|till|-)?\s*([0-9\.:]+[a-z]+)?', text, re.I)
            if close_time_m and close_time_m.group(1):
                c_start = parse_time(close_time_m.group(1))
                c_end = parse_time(close_time_m.group(2)) if close_time_m.group(2) else 24.0
                if c_start is not None:
                    slots.append({"start": c_start, "end": c_end if c_end > c_start else 24.0, "closed": True})
            elif not re.search(r'\$[0-9]', text):
                return [{"start": 0, "end": 24, "closed": True}]

        # Split text into distinct rules
        raw_lines = [l.strip() for l in text.split('\n') if l.strip()]
        rules = []
        for line in raw_lines:
            if line.lower().count('from ') > 1:
                parts = re.split(r',\s*(?=[$]|carpark\s+closed)', line, flags=re.I)
                rules.extend([p.strip() for p in parts if p.strip()])
            else:
                rules.append(line)
        
        for rule in rules:
            if '$' not in rule and not re.search(r'\bfree\b', rule, re.I):
                continue
                
            slot = {}
            
            # Time window: "from 7am to 6pm" or "from 6pm to 7am the following day"
            time_m = re.search(r'from\s+([0-9\.:]+\s*[a-z]+)\s+to\s+([0-9\.:]+\s*[a-z]+(?:\s+the\s+following\s+day)?)', rule, re.I)
            start_t = 0.0
            end_t = 24.0
            spans_next_day = False
            
            if time_m:
                st = parse_time(time_m.group(1))
                end_str = time_m.group(2)
                spans_next_day = 'following day' in end_str.lower() or 'next day' in end_str.lower()
                et = parse_time(end_str)
                if st is not None: start_t = st
                if et is not None: end_t = et
            
            # Free parking
            if re.search(r'\bfree\s+(?:parking|carpark)\b', rule, re.I):
                slot["free"] = True
                
            # Per entry: "$2.20/entry", "$3.00 per entry"
            entry_m = re.search(r'\$([0-9]+\.[0-9]+)\s*(?:/|\s*per\s*)entry', rule, re.I)
            if entry_m:
                slot["per_entry"] = float(entry_m.group(1))
                if spans_next_day or (end_t <= start_t and end_t > 0):
                    slot["entry_group"] = f"{day_type}_{start_t}"
            
            # Initial duration: "$3.30 for 1st hr", "$2.20 for 1st 2hr", "$1.50 for 1st 30min"
            first_m = re.search(r'\$([0-9]+\.[0-9]+)\s+(?:for\s+)?(?:1st|first)\s+([0-9]+(?:\.[0-9]+)?)?\s*(hr|hour|hrs|min|mins)', rule, re.I)
            if first_m:
                cost = float(first_m.group(1))
                qty_str = first_m.group(2)
                unit = first_m.group(3).lower()
                qty = float(qty_str) if qty_str else 1.0
                init_hours = (qty / 60.0) if 'min' in unit else qty
                slot["first_hours"] = init_hours
                slot["first_hours_cost"] = cost
                
            # Subsequent rates
            sub_hr_m = re.search(r'\$([0-9]+\.[0-9]+)\s+(?:for\s+)?(?:next\s+)?(?:subsequent\s+)?(?:1\s*)?(?:hr|hour)', rule, re.I)
            sub_30_m = re.search(r'\$([0-9]+\.[0-9]+)\s+(?:for\s+)?(?:next\s+)?(?:subsequent\s+)?30\s*min', rule, re.I)
            sub_15_m = re.search(r'\$([0-9]+\.[0-9]+)\s+(?:for\s+)?(?:next\s+)?(?:subsequent\s+)?15\s*min', rule, re.I)
            
            if sub_hr_m:
                slot["subsequent_hour"] = float(sub_hr_m.group(1))
            elif sub_30_m:
                slot["subsequent_30mins"] = float(sub_30_m.group(1))
            elif sub_15_m:
                slot["subsequent_15mins"] = float(sub_15_m.group(1))
                
            # Flat per hr / 30min if no first_hours and not per_entry
            if "first_hours" not in slot and "per_entry" not in slot and not slot.get("free"):
                hr_flat_m = re.search(r'\$([0-9]+\.[0-9]+)\s*(?:/|\s*per\s*)(?:hr|hour)', rule, re.I)
                min30_flat_m = re.search(r'\$([0-9]+\.[0-9]+)\s*(?:/|\s*per\s*)30\s*min', rule, re.I)
                if hr_flat_m:
                    slot["per_hour"] = float(hr_flat_m.group(1))
                elif min30_flat_m:
                    slot["per_30mins"] = float(min30_flat_m.group(1))
                    
            if not any(k in slot for k in ["per_entry", "first_hours", "per_hour", "per_30mins", "closed", "free"]):
                continue
                
            # Handle overnight / spans next day
            if spans_next_day or (end_t <= start_t and end_t > 0):
                s1 = dict(slot)
                s1["start"] = start_t
                s1["end"] = 24.0
                slots.append(s1)
                
                s2 = dict(slot)
                s2["start"] = 0.0
                s2["end"] = end_t
                slots.append(s2)
            else:
                slot["start"] = start_t
                slot["end"] = end_t
                slots.append(slot)
                
        return slots

    mf_day_slots = extract_slots(section_map.get("MF_DAY", ""), "mf_day")
    mf_night_slots = extract_slots(section_map.get("MF_NIGHT", ""), "mf_night")
    mf_all_slots = extract_slots(section_map.get("MF_ALL", ""), "mf_all")
    sat_slots = extract_slots(section_map.get("SAT", ""), "sat")
    sun_slots = extract_slots(section_map.get("SUN", ""), "sun")

    weekday_slots = mf_day_slots + mf_night_slots if (mf_day_slots or mf_night_slots) else mf_all_slots
    
    # Check remarks for general closure
    rem = section_map.get("REMARKS", "")
    rem_close = re.search(r'closed\s+(?:from|after)?\s*([0-9\.:]+[a-z]+)\s*(?:to|till|-)?\s*([0-9\.:]+[a-z]+)?', rem, re.I)
    
    def fill_and_sort(slot_list, fallback_source=None):
        if not slot_list and fallback_source:
            slot_list = [dict(s) for s in fallback_source]
        if not slot_list:
            return [{"start": 0, "end": 24, "per_hour": 1.50}]
            
        slot_list.sort(key=lambda s: s["start"])
        
        # Inject remark closure if applicable
        if rem_close and rem_close.group(1):
            c_st = parse_time(rem_close.group(1))
            c_et = parse_time(rem_close.group(2)) if rem_close.group(2) else 7.0
            if c_st is not None and c_et is not None:
                if c_et <= c_st:
                    slot_list.append({"start": c_st, "end": 24.0, "closed": True})
                    slot_list.append({"start": 0.0, "end": c_et, "closed": True})
                else:
                    slot_list.append({"start": c_st, "end": c_et, "closed": True})
                slot_list.sort(key=lambda s: s["start"])
                
        return slot_list

    rates["weekday"] = fill_and_sort(weekday_slots)
    rates["saturday"] = fill_and_sort(sat_slots, rates["weekday"])
    rates["sunday"] = fill_and_sort(sun_slots, rates["saturday"])
    
    return rates

if __name__ == '__main__':
    data_path = os.path.join(os.path.dirname(__file__), '..', 'data', 'commercial_carparks.js')
    with open(data_path, 'r') as f:
        content = f.read()
    carparks = json.loads(re.search(r'COMMERCIAL_CARPARKS\s*=\s*(\[[\s\S]*\]);', content).group(1))
    
    parsed_count = 0
    for cp in carparks:
        if cp.get('rates_text'):
            res = parse_carpark_rates(cp['rates_text'], cp.get('name', ''))
            if res:
                cp['rates'] = res
                parsed_count += 1
                
    print(f"Successfully parsed {parsed_count} / {len(carparks)} carparks.")
    
    # Save back
    new_js = content[:content.find('[' )] + json.dumps(carparks, indent=2) + ';\n'
    with open(data_path, 'w') as f:
        f.write(new_js)
    print("Updated data/commercial_carparks.js successfully.")
