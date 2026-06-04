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
      if (dayOfWeek === 0) { // Sunday (For MVP, Sunday represents holidays too)
        const currentHourMin = hour + currentTime.getMinutes() / 60;
        if (currentHourMin >= 7.0 && currentHourMin < 22.5) {
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
  
  let dayCost = 0.0;
  const nightSessions = {};
  const log = [];
  
  while (currentTime < endTime) {
    const blockEnd = new Date(currentTime.getTime() + 30 * 60 * 1000);
    const dayOfWeek = currentTime.getDay();
    const hour = currentTime.getHours();
    const minutesIntoDay = hour * 60 + currentTime.getMinutes();
    
    const timeStr = `${currentTime.getHours().toString().padStart(2, '0')}:${currentTime.getMinutes().toString().padStart(2, '0')} - ${blockEnd.getHours().toString().padStart(2, '0')}:${blockEnd.getMinutes().toString().padStart(2, '0')}`;
    
    // 1. Check Free Parking
    let isFree = false;
    if (carpark.free && carpark.free.includes("SUN & PH") && dayOfWeek === 0) {
      if (minutesIntoDay >= 420 && minutesIntoDay < 1350) { // 7am to 10:30pm
        isFree = true;
      }
    }
    
    if (isFree) {
      log.push(`[${timeStr}] Free Parking (Sun/PH)`);
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
        nightSessions[sessionKey] = Math.min(5.0, nightSessions[sessionKey] + 0.60);
        log.push(`[${timeStr}] Night Parking: +$0.60 (Session Total: $${nightSessions[sessionKey].toFixed(2)})`);
      } else {
        log.push(`[${timeStr}] Night Parking: Capped at $5.00`);
      }
    } else {
      // Day parking rate
      if (inCentral && hour >= 7 && hour < 17 && dayOfWeek !== 0) {
        dayCost += 1.20;
        log.push(`[${timeStr}] Central Area: +$1.20`);
      } else {
        dayCost += 0.60;
        log.push(`[${timeStr}] Standard Day: +$0.60`);
      }
    }
    
    currentTime = blockEnd;
  }
  
  let totalNightCost = 0.0;
  for (const session in nightSessions) {
    totalNightCost += nightSessions[session];
  }
  
  const totalCost = dayCost + totalNightCost;
  log.push(`Total Computed Cost: $${totalCost.toFixed(2)}`);
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
    if (decimalTime >= slot.start && decimalTime < slot.end) return slot;
  }
  return dayRates[0]; // fallback
}

/**
 * Calculates the parking cost for a Commercial Carpark (Shopping Mall).
 * @param {Object} carpark - Commercial carpark record
 * @param {Date} arrivalTime - Date object representing arrival time
 * @param {number} durationMins - Estimated duration in minutes
 * @returns {Object} { cost, log }
 */
function calculateCommercialRate(carpark, arrivalTime, durationMins) {
  const rates = carpark.rates;
  const log = [];
  
  if (!rates) {
    const cost = 1.20 * Math.ceil(durationMins / 60);
    log.push(`No precise rates found. Fallback flat rate: $${cost.toFixed(2)}`);
    return { cost, log };
  }
  
  let totalCost = 0.0;
  let currentTime = new Date(arrivalTime.getTime());
  let minsRemaining = durationMins;
  
  while (minsRemaining > 0) {
    const slot = getRateBlock(rates, currentTime);
    if (!slot) {
      totalCost += 1.50; // flat fallback
      log.push(`Unknown time block, adding fallback $1.50`);
      break;
    }

    let slotEndHour = Math.floor(slot.end);
    let slotEndMin = Math.round((slot.end - slotEndHour) * 60);
    let slotEndTime = new Date(currentTime.getTime());
    slotEndTime.setHours(slotEndHour, slotEndMin, 0, 0);
    
    // Roll over to next day if slot end is 24
    if (slot.end === 24) {
      slotEndTime.setHours(0, 0, 0, 0);
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
    
    const timeStr = `${currentTime.getHours().toString().padStart(2, '0')}:${currentTime.getMinutes().toString().padStart(2, '0')}`;
    const descStr = `(Rule: ${slot.start}-${slot.end})`;

    // Calculate cost for timeToSpendInSlot using this slot's rules
    if (slot.per_entry !== undefined) {
      totalCost += slot.per_entry;
      log.push(`[${timeStr}] ${timeToSpendInSlot} mins ${descStr}: Per Entry +$${slot.per_entry.toFixed(2)}`);
    } else {
      let durationHours = timeToSpendInSlot / 60.0;
      let slotCost = 0.0;
      
      let firstHourCost = 0.0;
      let firstHourDuration = 0.0;
      
      if (slot.first_hour !== undefined) {
        firstHourCost = slot.first_hour;
        firstHourDuration = 1.0;
      } else if (slot.first_90mins !== undefined) {
        firstHourCost = slot.first_90mins;
        firstHourDuration = 1.5;
      }
      
      if (durationHours <= firstHourDuration) {
        slotCost = firstHourCost;
        log.push(`[${timeStr}] ${timeToSpendInSlot} mins ${descStr}: 1st Hr base +$${slotCost.toFixed(2)}`);
      } else {
        slotCost = firstHourCost;
        let breakdownStr = `1st Hr base +$${firstHourCost.toFixed(2)}`;
        const remainingHours = durationHours - firstHourDuration;
        
        if (slot.subsequent_30mins !== undefined) {
          const added = Math.ceil(remainingHours * 2) * slot.subsequent_30mins;
          slotCost += added;
          breakdownStr += `, sub. 30min +$${added.toFixed(2)}`;
        } else if (slot.subsequent_15mins !== undefined) {
          const added = Math.ceil(remainingHours * 4) * slot.subsequent_15mins;
          slotCost += added;
          breakdownStr += `, sub. 15min +$${added.toFixed(2)}`;
        } else if (slot.subsequent_10mins !== undefined) {
          const added = Math.ceil(remainingHours * 6) * slot.subsequent_10mins;
          slotCost += added;
          breakdownStr += `, sub. 10min +$${added.toFixed(2)}`;
        } else if (slot.per_hour !== undefined) {
          const added = Math.ceil(remainingHours) * slot.per_hour;
          slotCost += added;
          breakdownStr += `, per hr +$${added.toFixed(2)}`;
        } else {
          const added = Math.ceil(remainingHours) * 1.50; // fallback
          slotCost += added;
          breakdownStr += `, fallback hr +$${added.toFixed(2)}`;
        }
        
        log.push(`[${timeStr}] ${timeToSpendInSlot} mins ${descStr}: ${breakdownStr} = +$${slotCost.toFixed(2)}`);
      }
      
      if (slot.max_cap !== undefined && slotCost > slot.max_cap) {
        slotCost = slot.max_cap;
        log.push(`[${timeStr}] Capped at max +$${slot.max_cap.toFixed(2)}`);
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
  
  log.push(`Total Computed Cost: $${totalCost.toFixed(2)}`);
  return { cost: totalCost, log: log };
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
