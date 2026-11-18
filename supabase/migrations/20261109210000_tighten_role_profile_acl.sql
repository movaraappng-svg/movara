-- Limit role-profile table privileges to the authenticated profile flow.

revoke all on table public.customer_profiles,
  public.driver_profile_details,
  public.landlord_profiles
  from public, anon, authenticated;

grant select, insert, update on table public.customer_profiles,
  public.driver_profile_details,
  public.landlord_profiles
  to authenticated;

drop policy if exists customer_profile_self on public.customer_profiles;
create policy customer_profile_select_self on public.customer_profiles
  for select to authenticated
  using (customer_id = (select auth.uid()));
create policy customer_profile_insert_self on public.customer_profiles
  for insert to authenticated
  with check (customer_id = (select auth.uid()));
create policy customer_profile_update_self on public.customer_profiles
  for update to authenticated
  using (customer_id = (select auth.uid()))
  with check (customer_id = (select auth.uid()));

drop policy if exists driver_profile_details_self on public.driver_profile_details;
create policy driver_profile_details_select_self on public.driver_profile_details
  for select to authenticated
  using (driver_id = (select auth.uid()));
create policy driver_profile_details_insert_self on public.driver_profile_details
  for insert to authenticated
  with check (driver_id = (select auth.uid()));
create policy driver_profile_details_update_self on public.driver_profile_details
  for update to authenticated
  using (driver_id = (select auth.uid()))
  with check (driver_id = (select auth.uid()));

drop policy if exists landlord_profile_self on public.landlord_profiles;
create policy landlord_profile_select_self on public.landlord_profiles
  for select to authenticated
  using (landlord_id = (select auth.uid()));
create policy landlord_profile_insert_self on public.landlord_profiles
  for insert to authenticated
  with check (landlord_id = (select auth.uid()));
create policy landlord_profile_update_self on public.landlord_profiles
  for update to authenticated
  using (landlord_id = (select auth.uid()))
  with check (landlord_id = (select auth.uid()));
