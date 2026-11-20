import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateFare } from './fare-engine.mjs';

const fareCard = {
  economy: { bookingFeeKobo: 50000, perKilometerKobo: 13000, perMinuteKobo: 2500, minimumFareKobo: 120000 },
  comfort: { bookingFeeKobo: 70000, perKilometerKobo: 17000, perMinuteKobo: 3000, minimumFareKobo: 200000 },
  xl: { bookingFeeKobo: 100000, perKilometerKobo: 22000, perMinuteKobo: 3500, minimumFareKobo: 300000 },
  executive: { bookingFeeKobo: 150000, perKilometerKobo: 30000, perMinuteKobo: 4000, minimumFareKobo: 500000 },
};

test('calculates base road fare for each service class', () => {
  const expected = { economy: 230000, comfort: 300000, xl: 390000, executive: 530000 };
  for (const [service, rates] of Object.entries(fareCard)) {
    assert.equal(calculateFare({ ...rates, distanceMeters: 10000, durationSeconds: 1200 }).totalKobo, expected[service]);
  }
});

test('enforces minimum fare before discounts', () => {
  assert.equal(calculateFare({ ...fareCard.economy, distanceMeters: 1000, durationSeconds: 60 }).totalKobo, 120000);
});

test('applies surge, airport surcharge, and discount transparently', () => {
  const quote = calculateFare({ ...fareCard.economy, distanceMeters: 10000, durationSeconds: 1200,
    airportSurchargeKobo: 50000, surgeMultiplier: 2, promoBasisPoints: 1000 });
  assert.equal(quote.totalKobo, 504000);
  assert.equal(quote.discountKobo, 56000);
});

test('clamps invalid or extreme rate inputs to a safe positive quote', () => {
  assert.equal(calculateFare({ ...fareCard.economy, distanceMeters: -10, durationSeconds: 0,
    promoBasisPoints: 10000 }).totalKobo, 100);
});
