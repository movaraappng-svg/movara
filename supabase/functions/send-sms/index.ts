import { notificationDeliveryHandler } from '../_shared/notification-delivery.ts';
Deno.serve(notificationDeliveryHandler('sms'));
