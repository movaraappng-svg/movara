-- Ride creation and the estimated fare must be decided by trusted server code.
revoke insert (customer_id, pickup_label, destination_label, passenger_count, estimated_fare_ngn_kobo)
  on public.rides from authenticated;
revoke insert (
  pickup_latitude, pickup_longitude, destination_latitude, destination_longitude,
  service_level, scheduled_for, special_instructions, payment_method
) on public.rides from authenticated;

-- Drivers can read their accepted/in-progress rides, in addition to eligible offers.
create policy rides_read_assigned_driver on public.rides
  for select to authenticated using (driver_id = (select auth.uid()));
