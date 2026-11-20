-- Do not silently represent non-Nigerian currency amounts as naira kobo.
alter table public.ride_cities
  alter column active set default false,
  add constraint ride_cities_launch_country_check check (country_code = 'NG'),
  add constraint ride_cities_launch_currency_check check (currency = 'NGN');
