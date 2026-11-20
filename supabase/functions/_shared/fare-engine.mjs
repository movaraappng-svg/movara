export function calculateFare({
  bookingFeeKobo,
  distanceMeters,
  durationSeconds,
  perKilometerKobo,
  perMinuteKobo,
  minimumFareKobo,
  airportSurchargeKobo = 0,
  zoneSurchargeKobo = 0,
  surgeMultiplier = 1,
  zoneMultiplier = 1,
  eventMultiplier = 1,
  promoAmountKobo = 0,
  promoBasisPoints = 0,
  corporateAmountKobo = 0,
  corporateBasisPoints = 0,
}) {
  const positive = (value) => Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : 0;
  const booking = positive(bookingFeeKobo);
  const distance = Math.round(positive(distanceMeters) / 1000 * positive(perKilometerKobo));
  const time = Math.round(positive(durationSeconds) / 60 * positive(perMinuteKobo));
  const airport = positive(airportSurchargeKobo);
  const zone = positive(zoneSurchargeKobo);
  const multipliers = [surgeMultiplier, zoneMultiplier, eventMultiplier].map((value) => Number.isFinite(Number(value)) && Number(value) >= 1 ? Number(value) : 1);
  const beforeDiscount = Math.max(positive(minimumFareKobo), Math.round((booking + distance + time + airport + zone) * multipliers.reduce((a, b) => a * b, 1)));
  const rawDiscount = positive(promoAmountKobo) + beforeDiscount * Math.min(10000, positive(promoBasisPoints)) / 10000
    + positive(corporateAmountKobo) + beforeDiscount * Math.min(10000, positive(corporateBasisPoints)) / 10000;
  const totalKobo = Math.max(100, Math.round(beforeDiscount - Math.min(beforeDiscount - 100, rawDiscount)));
  return {
    totalKobo,
    bookingFeeKobo: booking,
    distanceFareKobo: distance,
    timeFareKobo: time,
    airportSurchargeKobo: airport,
    zoneSurchargeKobo: zone,
    surgeMultiplier: multipliers[0],
    zoneMultiplier: multipliers[1],
    eventMultiplier: multipliers[2],
    discountKobo: beforeDiscount - totalKobo,
  };
}
