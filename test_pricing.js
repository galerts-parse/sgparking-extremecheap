load('pricing.js');
load('data/commercial_carparks.js');

function findCp(name) {
  return COMMERCIAL_CARPARKS.find(c => c.name && c.name.includes(name));
}

print('=== 1. Testing Centennial Tower ===');
const centennial = findCp('Centennial Tower');
if (!centennial) {
  print('ERROR: Centennial Tower not found');
} else {
  // Sat 10am, 3 hours: Expected 1st 2hr ($2.20) + 1 sub hr ($1.10) = $3.30
  const sat10am = new Date('2026-06-06T10:00:00');
  const resSat = calculateCarparkCost(centennial, sat10am, 180);
  print('Sat 10am (3h): Cost =', resSat.cost, '| Log:', resSat.log[0]);

  // Fri 7pm, 4 hours: Expected $2.20 Per Entry
  const fri7pm = new Date('2026-06-05T19:00:00');
  const resFri = calculateCarparkCost(centennial, fri7pm, 240);
  print('Fri 7pm (4h): Cost =', resFri.cost, '| Log:', resFri.log[0]);

  // Fri 10pm, 4 hours: Cross midnight (single overnight per_entry charge)
  const fri10pm = new Date('2026-06-05T22:00:00');
  const resMidnight = calculateCarparkCost(centennial, fri10pm, 240);
  print('Fri 10pm cross midnight (4h): Cost =', resMidnight.cost, '| Log:', resMidnight.log[0]);

  // Fri 10am, 2 hours: 1st hr ($3.30) + 2x30m ($2.20) = $5.50
  const fri10am = new Date('2026-06-05T10:00:00');
  const resDay = calculateCarparkCost(centennial, fri10am, 120);
  print('Fri 10am (2h): Cost =', resDay.cost, '| Log:', resDay.log[0]);
}

print('\n=== 2. Testing Carpark Closure Check ===');
const martin = findCp('22 Martin Road');
if (martin) {
  // 3am (closed 2am-7am)
  const resClosed = calculateCarparkCost(martin, new Date('2026-06-05T03:00:00'), 60);
  print('22 Martin Rd at 3am: isClosed =', resClosed.isClosed, '| Log:', resClosed.log[0]);

  // 10am (open)
  const resOpen = calculateCarparkCost(martin, new Date('2026-06-05T10:00:00'), 60);
  print('22 Martin Rd at 10am: isClosed =', resOpen.isClosed, '| Cost =', resOpen.cost, '| Log:', resOpen.log[0]);
}

print('\n=== 3. Testing Haw Par Villa ===');
const hpv = findCp('Haw Par Villa');
if (hpv) {
  const resHpv = calculateCarparkCost(hpv, new Date('2026-06-05T10:00:00'), 120);
  print('Haw Par Villa (2h): Cost =', resHpv.cost, '| Log:', resHpv.log[0]);
}
