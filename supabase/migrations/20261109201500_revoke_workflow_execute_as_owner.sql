-- Remove owner-issued PUBLIC/anon EXECUTE grants from workflow RPCs while
-- preserving the intended authenticated and service_role grants.

grant movara_workflow_owner to postgres with set true, inherit false;
set role movara_workflow_owner;

revoke execute on function
  public.admin_review_identity(text, uuid, public.verification_status, text),
  public.admin_review_property(uuid, public.verification_status, text),
  public.admin_start_identity_review(text, uuid),
  public.assign_fee_configuration(uuid, uuid),
  public.cancel_property_viewing(uuid, text),
  public.close_tenancy_cycle(uuid, text),
  public.configure_landlord_connection_fee(
    bigint, timestamp with time zone, timestamp with time zone, integer),
  public.confirm_property_viewing(uuid),
  public.create_enquiry(uuid, text, uuid),
  public.create_property_viewing(
    uuid, uuid, timestamp with time zone, uuid),
  public.disable_future_landlord_connection_fee_setting(uuid, text),
  public.end_landlord_connection_fee_setting(
    uuid, timestamp with time zone, text),
  public.open_connection_fee_dispute(uuid, text),
  public.open_next_tenancy_cycle(uuid, uuid, uuid, text),
  public.prepare_landlord_fee_payment(uuid),
  public.provision_user_role(uuid, public.app_role, text),
  public.record_failed_fee_payment(
    uuid, text, text, text, bigint, character, text),
  public.record_verified_fee_payment(
    uuid, text, text, text, bigint, character),
  public.register_driver_document(uuid, text),
  public.register_landlord_document(uuid, text),
  public.register_property_image(uuid, uuid, smallint),
  public.request_marketplace_role(public.app_role),
  public.request_viewing_reschedule(uuid, timestamp with time zone),
  public.resolve_connection_fee_dispute(uuid, boolean, text),
  public.respond_viewing_reschedule(uuid, boolean, text),
  public.send_enquiry_message(uuid, text, uuid),
  public.submit_identity_for_review(text)
from public, anon;

grant execute on function
  public.admin_review_identity(text, uuid, public.verification_status, text),
  public.admin_review_property(uuid, public.verification_status, text),
  public.admin_start_identity_review(text, uuid),
  public.assign_fee_configuration(uuid, uuid),
  public.cancel_property_viewing(uuid, text),
  public.close_tenancy_cycle(uuid, text),
  public.configure_landlord_connection_fee(
    bigint, timestamp with time zone, timestamp with time zone, integer),
  public.confirm_property_viewing(uuid),
  public.create_enquiry(uuid, text, uuid),
  public.create_property_viewing(
    uuid, uuid, timestamp with time zone, uuid),
  public.disable_future_landlord_connection_fee_setting(uuid, text),
  public.end_landlord_connection_fee_setting(
    uuid, timestamp with time zone, text),
  public.open_connection_fee_dispute(uuid, text),
  public.open_next_tenancy_cycle(uuid, uuid, uuid, text),
  public.register_driver_document(uuid, text),
  public.register_landlord_document(uuid, text),
  public.register_property_image(uuid, uuid, smallint),
  public.request_marketplace_role(public.app_role),
  public.request_viewing_reschedule(uuid, timestamp with time zone),
  public.resolve_connection_fee_dispute(uuid, boolean, text),
  public.respond_viewing_reschedule(uuid, boolean, text),
  public.send_enquiry_message(uuid, text, uuid),
  public.submit_identity_for_review(text)
to authenticated;

grant execute on function
  public.prepare_landlord_fee_payment(uuid),
  public.provision_user_role(uuid, public.app_role, text),
  public.record_failed_fee_payment(
    uuid, text, text, text, bigint, character, text),
  public.record_verified_fee_payment(
    uuid, text, text, text, bigint, character)
to service_role;

reset role;
revoke movara_workflow_owner from postgres;
