-- Secure landlord property creation and resubmission.
grant movara_workflow_owner to postgres with set true, inherit false;
grant create on schema public to movara_workflow_owner;

create policy workflow_insert_properties on public.properties
  for insert to movara_workflow_owner with check (true);
grant select on public.nigerian_lgas, public.neighbourhoods
  to movara_workflow_owner;
create policy workflow_read_listing_locations on public.nigerian_lgas
  for select to movara_workflow_owner using (true);
create policy workflow_read_listing_neighbourhoods on public.neighbourhoods
  for select to movara_workflow_owner using (true);

create function public.submit_property_listing(
  p_property_id uuid,
  p_title text,
  p_description text,
  p_category public.property_category,
  p_transaction_type public.rent_sale_type,
  p_price_ngn_kobo bigint,
  p_state_code text,
  p_lga_id uuid,
  p_neighbourhood_id uuid,
  p_address text
)
returns uuid language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_property uuid;
  v_action text;
begin
  if v_user is null or not private.has_role('landlord') then
    raise exception 'Landlord access required' using errcode = '42501';
  end if;
  if length(pg_catalog.btrim(coalesce(p_title, ''))) not between 3 and 160
    or length(coalesce(p_description, '')) > 10000
    or p_price_ngn_kobo is null or p_price_ngn_kobo <= 0
    or length(pg_catalog.btrim(coalesce(p_address, ''))) = 0
    or not exists (
      select 1 from public.nigerian_lgas l
      where l.id = p_lga_id and l.state_code = p_state_code
    )
    or (p_neighbourhood_id is not null and not exists (
      select 1 from public.neighbourhoods n
      where n.id = p_neighbourhood_id and n.lga_id = p_lga_id
    )) then
    raise exception 'Listing details are invalid' using errcode = '22023';
  end if;

  if p_property_id is null then
    insert into public.properties(
      landlord_id, title, description, category, transaction_type,
      price_ngn_kobo, state_code, lga_id, neighbourhood_id, address,
      status, verification
    ) values (
      v_user, pg_catalog.btrim(p_title), p_description, p_category,
      p_transaction_type, p_price_ngn_kobo, p_state_code, p_lga_id,
      p_neighbourhood_id, pg_catalog.btrim(p_address),
      'pending_review', 'pending'
    ) returning id into v_property;
    v_action := 'property_listing_submitted';
  else
    update public.properties set
      title = pg_catalog.btrim(p_title), description = p_description,
      category = p_category, transaction_type = p_transaction_type,
      price_ngn_kobo = p_price_ngn_kobo, state_code = p_state_code,
      lga_id = p_lga_id, neighbourhood_id = p_neighbourhood_id,
      address = pg_catalog.btrim(p_address), status = 'pending_review',
      verification = 'pending'
    where id = p_property_id and landlord_id = v_user
    returning id into v_property;
    if v_property is null then
      raise exception 'Listing not found or access denied' using errcode = '42501';
    end if;
    v_action := 'property_listing_resubmitted';
  end if;

  perform private.write_audit(v_user, v_action, 'property', v_property,
    pg_catalog.jsonb_build_object('status', 'pending_review'));
  return v_property;
end;
$$;

alter function public.submit_property_listing(
  uuid, text, text, public.property_category, public.rent_sale_type,
  bigint, text, uuid, uuid, text
) owner to movara_workflow_owner;
revoke create on schema public from movara_workflow_owner;
revoke all on function public.submit_property_listing(
  uuid, text, text, public.property_category, public.rent_sale_type,
  bigint, text, uuid, uuid, text
) from public, anon;
grant execute on function public.submit_property_listing(
  uuid, text, text, public.property_category, public.rent_sale_type,
  bigint, text, uuid, uuid, text
) to authenticated;

revoke movara_workflow_owner from postgres;
