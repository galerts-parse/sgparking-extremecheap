// SG ParkExtreme Cheap - Parking Price Calculator Engine

/**
 * Checks if a location is within the Singapore Central Area (Restricted Zone).
 * Bounding box is approximately around the Central Business District, Orchard, and Bugis.
 */
function isInCentralArea(lat, lng) {
  return lat >= 1.270 && lat <= 1.315 && lng >= 103.830 && lng <= 103.865;
}

/**
 * Formats a Date object into a readable time string (e.g., "08:30")
 */
function formatTimeOfDay(date) {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * Calculates the parking cost for a HDB carpark.
 * @param {Object} carpark - HDB carpark record
 * @param {Date} arrivalTime - Date object representing arrival time
 * @param {number} durationMins - Estimated duration in minutes
 * @returns {number} Calculated price in SGD
 */
function calculateHDBRate(carpark, arrivalTime, durationMins) {
  let totalCost = 0.0;
  const inCentral = isInCentralArea(carpark.lat, carpark.lng);
  
  // Create a copy of the arrival time to simulate step-by-step charging
  let currentTime = new Date(arrivalTime.getTime());
  const endTime = new Date(arrivalTime.getTime() + durationMins * 60 * 1000);
  
  // Calculate using 30-minute block increments
  while (currentTime < endTime) {
    const blockEnd = new Date(currentTime.getTime() + 30 * 60 * 1000);
    const dayOfWeek = currentTime.getDay(); // 0 = Sunday, 6 = Saturday, 1-5 = Weekday
    const hour = currentTime.getHours();
    
    // Check for HDB Free Parking Scheme (FPS)
    // Typically: Sundays & Public Holidays from 7:00 AM to 10:30 PM (22:30)
    let isFreeParking = false;
    if (carpark.free && carpark.free.includes("SUN & PH")) {
      if (dayOfWeek === 0) { // Sunday
        const currentHourMin = hour + currentTime.getMinutes() / 60;
        const freeStartH = carpark.free.includes("1PM") ? 13.0 : 7.0;
        if (currentHourMin >= freeStartH && currentHourMin < 22.5) {
          isFreeParking = true;
        }
      }
    }
    
    if (isFreeParking) {
      // Free block
      currentTime = blockEnd;
      continue;
    }
    
    // Check if within Night Parking window (10:30 PM to 7:00 AM next day)
    // Night parking is capped at $5.00 flat if night parking is allowed,
    // otherwise calculated normally.
    const minutesIntoDay = hour * 60 + currentTime.getMinutes();
    const isNightTime = minutesIntoDay >= 1350 || minutesIntoDay < 420; // 22:30 is 1350 mins, 07:00 is 420 mins
    
    if (isNightTime && carpark.night === "YES") {
      // Night parking is active. Instead of looping, we can calculate the night portion directly or accumulate.
      // HDB night parking is capped at $5.00. We will charge $0.60 per 30 mins up to $5.00 cap.
      // To implement the cap properly, we track if a night cap is active for this calendar night.
      // Let's accumulate night charge up to $5.00 maximum.
      totalCost += 0.60;
      // Apply cap: Night parking total charge for a single night session cannot exceed $5.00
      // We will simplify: if night accumulation is over $5.00, we cap the night part at $5.
      // To be safe, we will just add 0.60 but ensure we cap the cumulative night blocks.
      // A more robust way is to cap the total night charge.
    } else {
      // Day parking rate
      if (inCentral) {
        // Central Area rates:
        // $1.20 per 30 minutes from 7:00 AM to 5:00 PM (17:00), Monday to Saturday.
        // Normal rates ($0.60) otherwise.
        const isRestrictedHours = hour >= 7 && hour < 17 && dayOfWeek !== 0;
        if (isRestrictedHours) {
          totalCost += 1.20;
        } else {
          totalCost += 0.60;
        }
      } else {
        // Outside Central Area standard rate: $0.60 per 30 minutes
        totalCost += 0.60;
      }
    }
    
    currentTime = blockEnd;
  }
  
  // Cap HDB night parking portion at $5.00 if night parking was used.
  // In a standard single night stay (e.g. 10:30pm to 7am), maximum charge is $5.00.
  // If the total cost exceeds HDB night cap, we ensure it's capped. 
  // Let's implement a clean cap: if stay is fully within night session, maximum is $5.00.
  // For a general implementation, let's keep it standard. A cap of $5.00 per night session is standard.
  // If we park overnight, e.g. 12 hours (8pm to 8am):
  // 8pm-10:30pm (2.5h = 5 blocks @ $0.60 = $3.00)
  // 10:30pm-7am (8.5h = 17 blocks @ $0.60 = $10.20, capped at $5.00)
  // 7am-8am (1h = 2 blocks @ $0.60 = $1.20)
  // Total should be $3.00 + $5.00 + $1.20 = $9.20.
  // Let's implement this overnight capping properly:
  return calculateHDBRatePrecise(carpark, arrivalTime, durationMins, inCentral).cost;
}

/**
 * Highly precise HDB rate calculator that handles overnight capping.
 */
function calculateHDBRatePrecise(carpark, arrivalTime, durationMins, inCentral) {
  let currentTime = new Date(arrivalTime.getTime());
  const endTime = new Date(arrivalTime.getTime() + durationMins * 60 * 1000);
  
  let centralBlocks = 0;
  let standardBlocks = 0;
  let freeBlocks = 0;
  const nightSessions = {};
  const log = [];
  
  while (currentTime < endTime) {
    const blockEnd = new Date(currentTime.getTime() + 30 * 60 * 1000);
    const dayOfWeek = currentTime.getDay();
    const hour = currentTime.getHours();
    const minutesIntoDay = hour * 60 + currentTime.getMinutes();
    
    // 1. Check Free Parking
    let isFree = false;
    if (carpark.free && carpark.free.includes("SUN & PH") && dayOfWeek === 0) {
      const freeStartMin = carpark.free.includes("1PM") ? 780 : 420;
      if (minutesIntoDay >= freeStartMin && minutesIntoDay < 1350) { // until 10:30pm
        isFree = true;
      }
    }
    
    if (isFree) {
      freeBlocks++;
      currentTime = blockEnd;
      continue;
    }
    
    // 2. Check if within Night Parking window (10:30 PM to 7:00 AM)
    const isNight = minutesIntoDay >= 1350 || minutesIntoDay < 420;
    
    if (isNight && carpark.night === "YES") {
      let sessionKey = "";
      if (hour < 7) {
        const prevDay = new Date(currentTime.getTime() - 12 * 60 * 60 * 1000);
        sessionKey = prevDay.toISOString().split('T')[0];
      } else {
        sessionKey = currentTime.toISOString().split('T')[0];
      }
      
      if (!nightSessions[sessionKey]) {
        nightSessions[sessionKey] = 0.0;
      }
      
      if (nightSessions[sessionKey] < 5.0) {
        nightSessions[sessionKey] += 0.60;
      }
    } else {
      // Day parking rate
      if (inCentral && hour >= 7 && hour < 17 && dayOfWeek !== 0) {
        centralBlocks++;
      } else {
        standardBlocks++;
      }
    }
    
    currentTime = blockEnd;
  }
  
  let totalNightCost = 0.0;
  let nightCaps = 0;
  let nightBlocks = 0;
  
  for (const session in nightSessions) {
    let cost = Math.min(5.0, nightSessions[session]);
    if (cost >= 4.8) { // To account for 5.0 cap
       nightCaps++;
       totalNightCost += 5.0;
    } else {
       nightBlocks += Math.round(cost / 0.60);
       totalNightCost += cost;
    }
  }
  
  const dayCost = (centralBlocks * 1.20) + (standardBlocks * 0.60);
  const totalCost = dayCost + totalNightCost;
  
  const formulaParts = [];
  if (centralBlocks > 0) formulaParts.push(`1.20*${centralBlocks} (Central)`);
  if (standardBlocks > 0) formulaParts.push(`0.60*${standardBlocks} (Standard)`);
  if (nightBlocks > 0) formulaParts.push(`0.60*${nightBlocks} (Night)`);
  if (nightCaps > 0) formulaParts.push(`5.00*${nightCaps} (Night Cap)`);
  
  const isSunday = arrivalTime.getDay() === 0;
  if (formulaParts.length > 0) {
    let logStr = `${formulaParts.join(" + ")} = $${totalCost.toFixed(2)}`;
    if (isSunday && (!carpark.free || carpark.free === "NO")) {
      logStr += ` (No Sunday Free Parking at this carpark)`;
    } else if (freeBlocks > 0) {
      logStr += ` [Free FPS: ${freeBlocks * 30} mins]`;
    }
    log.push(logStr);
  } else if (freeBlocks > 0) {
    const fpsDesc = carpark.free && carpark.free.includes("1PM") ? "Sun 1pm–10:30pm" : "Sun 7am–10:30pm";
    log.push(`Free Parking (HDB Free Parking Scheme: ${fpsDesc}) = $0.00`);
  } else {
    log.push(`$0.00`);
  }
  
  return { cost: totalCost, log: log };
}

function getRateBlock(rates, time) {
  const dayOfWeek = time.getDay();
  let dayRates = [];
  if (dayOfWeek === 0) dayRates = rates.sunday || rates.saturday || rates.weekday;
  else if (dayOfWeek === 6) dayRates = rates.saturday || rates.weekday;
  else dayRates = rates.weekday;

  if (!dayRates || dayRates.length === 0) return null;

  const decimalTime = time.getHours() + time.getMinutes() / 60.0 + time.getSeconds() / 3600.0;
  for (const slot of dayRates) {
    if (slot.end > slot.start) {
      // Normal slot: e.g., 8-17 (8am to 5pm)
      if (decimalTime >= slot.start && decimalTime < slot.end) return slot;
    } else {
      // Midnight-crossing slot: e.g., 17-3 (5pm to 3am next day)
      if (decimalTime >= slot.start || decimalTime < slot.end) return slot;
    }
  }
  return null;
}

function formatHour(decimalH) {
  const h = Math.floor(decimalH);
  const m = Math.round((decimalH - h) * 60);
  const ampm = h >= 12 && h < 24 ? 'PM' : 'AM';
  const displayH = h % 12 === 0 ? 12 : h % 12;
  const displayM = m > 0 ? `:${m.toString().padStart(2, '0')}` : '';
  return `${displayH}${displayM}${ampm}`;
}

/**
 * Calculates the parking cost for a Commercial Carpark (Shopping Mall).
 * @param {Object} carpark - Commercial carpark record
 * @param {Date} arrivalTime - Date object representing arrival time
 * @param {number} durationMins - Estimated duration in minutes
 * @returns {Object} { cost, isClosed, log }
 */
function calculateCommercialRate(carpark, arrivalTime, durationMins) {
  const rates = carpark.rates;
  const log = [];
  
  if (!rates) {
    const cost = 1.20 * Math.ceil(durationMins / 60);
    log.push(`1.20*${Math.ceil(durationMins / 60)} (Fallback flat rate) = $${cost.toFixed(2)}`);
    return { cost, isClosed: false, log };
  }
  
  let totalCost = 0.0;
  let currentTime = new Date(arrivalTime.getTime());
  let minsRemaining = durationMins;
  
  let slotCosts = [];
  const chargedEntryGroups = {};
  
  while (minsRemaining > 0) {
    const slot = getRateBlock(rates, currentTime);
    
    // Check if carpark is closed or outside operating hours
    if (!slot || slot.closed) {
      const closeMsg = slot && slot.closed
        ? `Carpark is closed from ${formatHour(slot.start)} to ${formatHour(slot.end)}`
        : `Carpark is closed / outside operating hours at ${currentTime.getHours().toString().padStart(2, '0')}:${currentTime.getMinutes().toString().padStart(2, '0')}`;
      log.push(`[Closed] ${closeMsg}`);
      return { cost: null, isClosed: true, log: log };
    }

    let slotEndHour = Math.floor(slot.end);
    let slotEndMin = Math.round((slot.end - slotEndHour) * 60);
    let slotEndTime = new Date(currentTime.getTime());
    slotEndTime.setHours(slotEndHour, slotEndMin, 0, 0);
    
    // Roll over to next day if slot end is 24 or if slot crosses midnight (end < start)
    if (slot.end === 24 || slot.end < slot.start) {
      slotEndTime.setDate(slotEndTime.getDate() + 1);
    }

    let minsInSlot = (slotEndTime.getTime() - currentTime.getTime()) / 60000;
    
    // Force cross boundary if precision issues or exact boundary
    if (minsInSlot <= 0) {
        currentTime.setMinutes(currentTime.getMinutes() + 1);
        minsRemaining -= 1;
        continue;
    }

    let timeToSpendInSlot = Math.min(minsInSlot, minsRemaining);
    
    // Calculate cost for timeToSpendInSlot using this slot's rules
    if (slot.free) {
      slotCosts.push(`Free`);
    } else if (slot.per_entry !== undefined) {
      const entryKey = slot.entry_group || `entry_${slot.start}_${slot.end}`;
      if (!chargedEntryGroups[entryKey]) {
        totalCost += slot.per_entry;
        chargedEntryGroups[entryKey] = true;
        slotCosts.push(`${slot.per_entry.toFixed(2)} (Per Entry)`);
      }
    } else {
      let durationHours = timeToSpendInSlot / 60.0;
      let slotCost = 0.0;
      
      let initCost = 0.0;
      let initDuration = 0.0;
      let usedInit = false;
      
      if (slot.first_hours !== undefined) {
        initCost = slot.first_hours_cost;
        initDuration = slot.first_hours;
        usedInit = true;
      } else if (slot.first_hour !== undefined) {
        initCost = slot.first_hour;
        initDuration = 1.0;
        usedInit = true;
      } else if (slot.first_90mins !== undefined) {
        initCost = slot.first_90mins;
        initDuration = 1.5;
        usedInit = true;
      }
      
      // Determine the subsequent rate
      let subsequentRate = null; // { amount, intervalMinutes }
      if (slot.subsequent_hour !== undefined) {
        subsequentRate = { amount: slot.subsequent_hour, intervalMinutes: 60 };
      } else if (slot.subsequent_30mins !== undefined) {
        subsequentRate = { amount: slot.subsequent_30mins, intervalMinutes: 30 };
      } else if (slot.subsequent_15mins !== undefined) {
        subsequentRate = { amount: slot.subsequent_15mins, intervalMinutes: 15 };
      } else if (slot.subsequent_10mins !== undefined) {
        subsequentRate = { amount: slot.subsequent_10mins, intervalMinutes: 10 };
      } else if (slot.per_hour !== undefined) {
        subsequentRate = { amount: slot.per_hour, intervalMinutes: 60 };
      } else if (slot.per_30mins !== undefined) {
        subsequentRate = { amount: slot.per_30mins, intervalMinutes: 30 };
      } else if (slot.per_15mins !== undefined) {
        subsequentRate = { amount: slot.per_15mins, intervalMinutes: 15 };
      } else if (slot.per_10mins !== undefined) {
        subsequentRate = { amount: slot.per_10mins, intervalMinutes: 10 };
      }
      
      const label = initDuration === 1.0 ? '1st Hr' : (initDuration === 2.0 ? '1st 2hr' : (initDuration === 3.0 ? '1st 3hr' : `1st ${initDuration}h`));
      
      if (usedInit) {
        slotCost = initCost;
        slotCosts.push(`${initCost.toFixed(2)} (${label})`);
        
        const remainingHours = durationHours - initDuration;
        if (remainingHours > 0 && subsequentRate) {
          const remainingMinutes = remainingHours * 60;
          const blocks = Math.ceil(remainingMinutes / subsequentRate.intervalMinutes);
          const added = blocks * subsequentRate.amount;
          slotCost += added;
          if (blocks > 0) {
            const intervalLabel = subsequentRate.intervalMinutes === 60 ? 'hr' : `${subsequentRate.intervalMinutes}min`;
            slotCosts.push(`${subsequentRate.amount.toFixed(2)}*${blocks} (${intervalLabel})`);
          }
        }
      } else if (subsequentRate) {
        const totalMinutes = durationHours * 60;
        const blocks = Math.ceil(totalMinutes / subsequentRate.intervalMinutes);
        slotCost = blocks * subsequentRate.amount;
        const intervalLabel = subsequentRate.intervalMinutes === 60 ? 'hr' : `${subsequentRate.intervalMinutes}min`;
        slotCosts.push(`${subsequentRate.amount.toFixed(2)}*${blocks} (${intervalLabel})`);
      } else {
        slotCost = 1.50;
        slotCosts.push(`1.50 (Fallback)`);
      }
      
      if (slot.max_cap !== undefined && slotCost > slot.max_cap) {
        slotCost = slot.max_cap;
        slotCosts = slotCosts.filter(s => !s.includes("1st") && !s.includes("*"));
        slotCosts.push(`${slot.max_cap.toFixed(2)} (Max Cap)`);
      }
      
      totalCost += slotCost;
    }

    minsRemaining -= timeToSpendInSlot;
    currentTime.setTime(currentTime.getTime() + timeToSpendInSlot * 60000);
    
    // If we exactly exhausted the slot but still have time remaining, step 1 minute to trigger next slot
    if (minsRemaining > 0 && timeToSpendInSlot === minsInSlot) {
      currentTime.setMinutes(currentTime.getMinutes() + 1);
      minsRemaining -= 1;
    }
  }
  
  if (slotCosts.length > 0) {
    log.push(`${slotCosts.join(" + ")} = $${totalCost.toFixed(2)}`);
  } else {
    log.push(`$0.00`);
  }
  return { cost: totalCost, isClosed: false, log: log };
}

/**
 * Main coordinator function to calculate parking rate.
 * @param {Object} carpark - Carpark record (HDB or Commercial)
 * @param {Date} arrivalTime - Arrival date object
 * @param {number} durationMins - Duration in minutes
 */
function calculateCarparkCost(carpark, arrivalTime, durationMins) {
  if (carpark.no.startsWith("COMM_")) {
    return calculateCommercialRate(carpark, arrivalTime, durationMins);
  } else {
    // Note: calculateHDBRate doesn't return log yet, but calculateHDBRatePrecise does.
    // Replace the default HDB call with precise call for logging.
    return calculateHDBRatePrecise(carpark, arrivalTime, durationMins, isInCentralArea(carpark.lat, carpark.lng));
  }
}
