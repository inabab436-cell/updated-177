/**
 * Single source of truth for the "no fulfilment before payment" rule.
 *
 * An order can only move to prepared / shipped / delivered after its payment
 * has been confirmed (payment_status !== 'pending').
 */
export const PAYMENT_REQUIRED_MESSAGE =
  "لا يمكن بدء تنفيذ الطلب قبل تأكيد الدفع، لضمان عدم تجهيز أو شحن طلب غير مدفوع.";

export function isOrderPaid(paymentStatus: string | null | undefined): boolean {
  return String(paymentStatus ?? "confirmed") !== "pending";
}

export function canStartFulfillment(paymentStatus: string | null | undefined): boolean {
  return isOrderPaid(paymentStatus);
}

export const PENDING_ADDITION_MESSAGE =
  "الطلب يحتوي على إضافة لم يتم تأكيد دفعها بعد. أكّد دفع الإضافة أولاً قبل التجهيز أو الشحن.";

/**
 * Whole-order gate: an order that carries an unpaid ADDITION cannot start
 * fulfilment either, even though its original part is already paid.
 */
export function canStartFulfillmentForOrder(order: {
  payment_status?: string | null;
  status?: string | null;
  pending_items?: unknown;
}): { ok: boolean; message?: string } {
  if (!isOrderPaid(order?.payment_status)) {
    return { ok: false, message: PAYMENT_REQUIRED_MESSAGE };
  }
  const pending = Array.isArray(order?.pending_items) ? order.pending_items : [];
  const hasPending = pending.some(
    (it) => Number((it as Record<string, unknown>)?.["quantity"] ?? 0) > 0,
  );
  if (hasPending) return { ok: false, message: PENDING_ADDITION_MESSAGE };
  return { ok: true };
}

/**
 * Cash on delivery is NOT a paid order.
 *
 * The stock/booking pipeline stores such an order with payment_status
 * 'confirmed' because nothing is waiting on the merchant, but the money is
 * only collected from the customer at delivery. This helper is the single
 * place that says so, from the order's own `payment_timing` stamp or, for
 * rows written before that column existed, from the merchant's own list of
 * collect-on-delivery method names.
 */
function norm(v: unknown): string {
  return String(v ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

export function isCollectedOnDelivery(
  order: { payment_timing?: string | null; payment_method?: string | null } | null | undefined,
  onDeliveryMethodNames: string[] = [],
): boolean {
  if (!order) return false;
  if (norm(order.payment_timing) === "on_delivery") return true;
  const method = norm(order.payment_method);
  if (!method) return false;
  return onDeliveryMethodNames.some((n) => norm(n) && norm(n) === method);
}

/** English one-liner describing the real payment state for the agent context. */
export function describeOrderPaymentState(
  order: { payment_status?: string | null; payment_timing?: string | null; payment_method?: string | null },
  onDeliveryMethodNames: string[] = [],
): string {
  if (isCollectedOnDelivery(order, onDeliveryMethodNames)) {
    return "NOT PAID — cash on delivery: the customer pays the courier when the order is delivered. Never call this order paid and never thank the customer for a payment.";
  }
  return isOrderPaid(order?.payment_status)
    ? "CONFIRMED (paid)"
    : "PENDING (not paid yet)";
}
