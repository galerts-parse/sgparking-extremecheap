load('pricing.js');
load('data/hdb_carparks.js');
load('data/commercial_carparks.js');

function findHdb(no) {
  return HDB_CARPARKS.find(c => c.no === no);
}

function findComm(name) {
  return COMMERCIAL_CARPARKS.find(c => c.name && c.name.includes(name));
}

print('=== 1. Testing HDB Sunday Parking Around Nex ===');
// SE14: BLK 231/237 SERANGOON AVENUE 3 (free: SUN & PH FR 7AM-10.30PM)
const se14 = findHdb('SE14');
const sun10am = new Date('2026-06-07T10:00:00'); // Sunday
const resSE14 = calculateCarparkCost(se14, sun10am, 120);
print('SE14 (Nex nearby, has FPS): Cost = $' + resSE14.cost.toFixed(2) + ' | Log:', resSE14.log[0]);

// SE15: BLK 238/246 SERANGOON AVENUE 3 (free: NO)
const se15 = findHdb('SE15');
const resSE15 = calculateCarparkCost(se15, sun10am, 120);
print('SE15 (Nex adjacent, NO FPS): Cost = $' + resSE15.cost.toFixed(2) + ' | Log:', resSE15.log[0]);

// Test 1PM-start FPS carpark on Sunday 11am for 3 hours (11am to 2pm)
// Should charge 11am-1pm (2 hours = 4 blocks = $2.40) and 1pm-2pm free!
const cp1pm = HDB_CARPARKS.find(c => c.free && c.free.includes('1PM'));
if (cp1pm) {
  const sun11am = new Date('2026-06-07T11:00:00');
  const res1pm = calculateCarparkCost(cp1pm, sun11am, 180);
  print(cp1pm.no + ' (' + cp1pm.addr + ', FPS starts 1pm): Cost = $' + res1pm.cost.toFixed(2) + ' | Log:', res1pm.log[0]);
}

print('\n=== 2. Testing Centennial Tower ===');
const centennial = findComm('Centennial Tower');
const sat10am = new Date('2026-06-06T10:00:00');
const resSat = calculateCarparkCost(centennial, sat10am, 180);
print('Sat 10am (3h): Cost = $' + resSat.cost.toFixed(2) + ' | Log:', resSat.log[0]);

const fri10pm = new Date('2026-06-05T22:00:00');
const resMidnight = calculateCarparkCost(centennial, fri10pm, 240);
print('Fri 10pm cross midnight (4h): Cost = $' + resMidnight.cost.toFixed(2) + ' | Log:', resMidnight.log[0]);

print('\n=== 3. Testing Closed Carpark Check ===');
const martin = findComm('22 Martin Road');
const resClosed = calculateCarparkCost(martin, new Date('2026-06-05T03:00:00'), 60);
print('22 Martin Rd at 3am: isClosed =', resClosed.isClosed, '| Log:', resClosed.log[0]);
