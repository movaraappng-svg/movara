-- Publish the approved NG-DEFAULT launch tariff and a configurable airport baseline.
-- Values are in kobo. These are MoVara's launch prices, not competitor API quotes.
insert into public.ride_pricing_rules
  (city_code, service_level, base_fare_ngn_kobo, booking_fee_ngn_kobo,
   per_kilometer_ngn_kobo, per_minute_ngn_kobo, minimum_fare_ngn_kobo,
   cancellation_fee_ngn_kobo, commission_basis_points, active)
values
  ('NG-DEFAULT', 'economy',   50000,  50000, 13000, 2500, 120000,  50000, 1000, true),
  ('NG-DEFAULT', 'comfort',   70000,  70000, 17000, 3000, 200000,  70000, 1200, true),
  ('NG-DEFAULT', 'xl',       100000, 100000, 22000, 3500, 300000, 100000, 1500, true),
  ('NG-DEFAULT', 'executive',150000, 150000, 30000, 4000, 500000, 150000, 1500, true)
on conflict (city_code, service_level) do update set
  base_fare_ngn_kobo = excluded.base_fare_ngn_kobo,
  booking_fee_ngn_kobo = excluded.booking_fee_ngn_kobo,
  per_kilometer_ngn_kobo = excluded.per_kilometer_ngn_kobo,
  per_minute_ngn_kobo = excluded.per_minute_ngn_kobo,
  minimum_fare_ngn_kobo = excluded.minimum_fare_ngn_kobo,
  cancellation_fee_ngn_kobo = excluded.cancellation_fee_ngn_kobo,
  commission_basis_points = excluded.commission_basis_points,
  active = true;

-- Nigeria's initial airport surcharge sits at the low end of the requested
-- ₦500–₦1,500 range and remains editable in the admin fare engine.
insert into public.ride_pricing_adjustments
  (city_code, adjustment_type, name, code, amount_ngn_kobo, multiplier,
   discount_basis_points, active, configuration)
values
  ('NG-DEFAULT', 'airport', 'Airport pickup baseline', 'AIRPORT-BASELINE',
   50000, 1.00, 0, true,
   '{"basis":"MoVara launch baseline; configurable per market in admin","currency":"NGN"}'::jsonb)
on conflict (city_code, adjustment_type, lower(code)) where code is not null
do update set amount_ngn_kobo = excluded.amount_ngn_kobo,
  multiplier = excluded.multiplier,
  active = true,
  configuration = excluded.configuration,
  updated_at = now();
