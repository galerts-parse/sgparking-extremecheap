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
  return calculateHDBRatePrecise(carpark, arrivalTime, durationMins, inCentral);
}

/**
 * Highly precise HDB rate calculator that handles overnight capping.
 */
function calculateHDBRatePrecise(carpark, arrivalTime, durationMins, inCentral) {
  let currentTime = new Date(arrivalTime.getTime());
  const endTime = new Date(arrivalTime.getTime() + durationMins * 60 * 1000);
  
  let dayCost = 0.0;
  
  // Track night parking charges grouped by "night session" (e.g., "YYYY-MM-DD" of the night start)
  const nightSessions = {};
  
  while (currentTime < endTime) {
    const blockEnd = new Date(currentTime.getTime() + 30 * 60 * 1000);
    const dayOfWeek = currentTime.getDay();
    const hour = currentTime.getHours();
    const minutesIntoDay = hour * 60 + currentTime.getMinutes();
    
    // 1. Check Free Parking
    let isFree = false;
    if (carpark.free && carpark.free.includes("SUN & PH") && dayOfWeek === 0) {
      if (minutesIntoDay >= 420 && minutesIntoDay < 1350) { // 7am to 10:30pm
        isFree = true;
      }
    }
    
    if (isFree) {
      currentTime = blockEnd;
      continue;
    }
    
    // 2. Check if within Night Parking window (10:30 PM to 7:00 AM)
    const isNight = minutesIntoDay >= 1350 || minutesIntoDay < 420;
    
    if (isNight && carpark.night === "YES") {
      // Determine which night session this belongs to.
      // If hour is < 7, it belongs to the previous calendar day's night session.
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
      
      // Only charge if under the $5.00 cap for this night session
      if (nightSessions[sessionKey] < 5.0) {
        nightSessions[sessionKey] = Math.min(5.0, nightSessions[sessionKey] + 0.60);
      }
    } else {
      // Day parking rate
      if (inCentral && hour >= 7 && hour < 17 && dayOfWeek !== 0) {
        // Central area restricted hours
        dayCost += 1.20;
      } else {
        // Normal HDB rate
        dayCost += 0.60;
      }
    }
    
    currentTime = blockEnd;
  }
  
  // Sum up day costs and capped night sessions
  let totalNightCost = 0.0;
  for (const session in nightSessions) {
    totalNightCost += nightSessions[session];
  }
  
  return dayCost + totalNightCost;
}

/**
 * Calculates the parking cost for a Commercial Carpark (Shopping Mall).
 * @param {Object} carpark - Commercial carpark record
 * @param {Date} arrivalTime - Date object representing arrival time
 * @param {number} durationMins - Estimated duration in minutes
 * @returns {number} Calculated price in SGD
 */
function calculateCommercialRate(carpark, arrivalTime, durationMins) {
  const rates = carpark.rates;
  if (!rates) return 1.20 * (durationMins / 60); // Fallback to standard rate
  
  let totalCost = 0.0;
  
  // Determine if weekday, Saturday, or Sunday
  const dayOfWeek = arrivalTime.getDay(); // 0 = Sunday, 6 = Saturday, 1-5 = Weekday
  let dayRates = [];
  if (dayOfWeek === 0) {
    dayRates = rates.sunday || rates.saturday || rates.weekday;
  } else if (dayOfWeek === 6) {
    dayRates = rates.saturday || rates.weekday;
  } else {
    dayRates = rates.weekday;
  }
  
  // Parse hour and minute of arrival
  const arrivalHour = arrivalTime.getHours();
  const arrivalMins = arrivalTime.getMinutes();
  const arrivalTimeDecimal = arrivalHour + arrivalMins / 60.0;
  
  // Find which rate slot the entry falls into
  let matchingSlot = null;
  for (const slot of dayRates) {
    // If the slot crosses midnight (e.g. 17:00 to 24:00 or 17:00 to 08:00 next day)
    const slotStart = slot.start;
    const slotEnd = slot.end;
    
    if (arrivalTimeDecimal >= slotStart && arrivalTimeDecimal < slotEnd) {
      matchingSlot = slot;
      break;
    }
  }
  
  // If no slot matches, fallback to first slot
  if (!matchingSlot && dayRates.length > 0) {
    matchingSlot = dayRates[0];
  }
  
  if (!matchingSlot) {
    return 2.50; // Flat fallback
  }
  
  // Calculate pricing based on the matching entry slot's pricing model
  if (matchingSlot.per_entry !== undefined) {
    return matchingSlot.per_entry;
  }
  
  // Check hourly rate structures
  const durationHours = durationMins / 60.0;
  
  // First hour / first 90 mins rates
  let firstHourCost = 0.0;
  let firstHourDuration = 1.0;
  
  if (matchingSlot.first_hour !== undefined) {
    firstHourCost = matchingSlot.first_hour;
    firstHourDuration = 1.0;
  } else if (matchingSlot.first_90mins !== undefined) {
    firstHourCost = matchingSlot.first_90mins;
    firstHourDuration = 1.5;
  }
  
  if (durationHours <= firstHourDuration) {
    totalCost = firstHourCost;
  } else {
    totalCost = firstHourCost;
    const remainingHours = durationHours - firstHourDuration;
    
    if (matchingSlot.subsequent_30mins !== undefined) {
      // Round UP remaining duration to nearest 30 mins
      const blocks30 = Math.ceil(remainingHours * 2);
      totalCost += blocks30 * matchingSlot.subsequent_30mins;
    } else if (matchingSlot.subsequent_15mins !== undefined) {
      // Round UP remaining duration to nearest 15 mins
      const blocks15 = Math.ceil(remainingHours * 4);
      totalCost += blocks15 * matchingSlot.subsequent_15mins;
    } else if (matchingSlot.subsequent_10mins !== undefined) {
      // Round UP remaining duration to nearest 10 mins
      const blocks10 = Math.ceil(remainingHours * 6);
      totalCost += blocks10 * matchingSlot.subsequent_10mins;
    } else if (matchingSlot.per_hour !== undefined) {
      // Round UP remaining duration to nearest hour
      const blocksHour = Math.ceil(remainingHours);
      totalCost += blocksHour * matchingSlot.per_hour;
    } else {
      // Fallback
      totalCost += Math.ceil(remainingHours) * 1.50;
    }
  }
  
  // Apply maximum cap if specified in the slot
  if (matchingSlot.max_cap !== undefined) {
    totalCost = Math.min(matchingSlot.max_cap, totalCost);
  }
  
  return totalCost;
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
    return calculateHDBRate(carpark, arrivalTime, durationMins);
  }
}
