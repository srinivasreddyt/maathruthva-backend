const { isConfigured, getDocument, createDocument, updateDocument, deleteDocument } = require('./firestore-admin');
const { getPaidOrder } = require('./razorpay');

const DRAFTS = 'pending_orders';
const SAFE_UID = /^[A-Za-z0-9_-]{1,128}$/;

function istDate() {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

const cap = (s, n) => String(s == null ? '' : s).slice(0, n);

// Stored when the Razorpay order is created, from server-verified prices and the verified login (never the browser's totals).
async function saveDraft(orderId, draft) {
  if (!isConfigured()) return false;
  try {
    await createDocument(DRAFTS, orderId, { ...draft, createdAt: new Date() });
    return true;
  } catch (e) {
    console.error('Could not save order draft:', e && e.message);
    return false;
  }
}

function baseRecord(orderId, draft) {
  const uid = SAFE_UID.test(String(draft.uid || '')) ? draft.uid : '';
  return {
    uid,
    record: {
      orderId,
      items: draft.items,
      address: draft.address,
      subtotal: draft.subtotal,
      discount: draft.discount,
      promoCode: draft.promoCode || '',
      shipping: draft.shipping,
      total: draft.totalPaise / 100,
      userPhone: draft.phone || '',
      userId: uid || 'guest',
      userName: draft.name || '',
      userEmail: draft.email || '',
      date: istDate(),
    },
  };
}

// A payment that went wrong is kept in the admin ledger only (never in the customer's own orders) as
// status "cancelled" + paymentStatus "rejected", so it can never be shipped or counted as revenue.
// A completed order is never downgraded; a later successful payment upgrades a rejected one.
async function recordRejection(orderId, draft, reason, detail) {
  const existing = await getDocument(`all_orders/${orderId}`);
  if (existing && existing.paymentStatus !== 'rejected') return false;

  const rejected = {
    ...baseRecord(orderId, draft).record,
    paymentId: '',
    status: 'cancelled',
    paymentStatus: 'rejected',
    paymentRejectReason: reason,
    paymentRejectDetail: cap(detail, 200),
    docId: '',
    userPath: '',
  };
  if (existing) {
    await updateDocument(`all_orders/${orderId}`, rejected);
    return true;
  }
  return createDocument('all_orders', orderId, { ...rejected, createdAt: new Date() });
}

// For callers that only know the order id (forged signature, failed-payment webhook). Does nothing unless this server
// created the order (a draft exists), so it cannot be used to fill the ledger with made-up order ids.
async function rejectOrder(orderId, reason, detail) {
  if (!isConfigured()) return false;
  try {
    const draft = await getDocument(`${DRAFTS}/${orderId}`);
    if (!draft) return false;
    return await recordRejection(orderId, draft, reason, detail);
  } catch (e) {
    console.error('Could not record rejected payment:', e && e.message);
    return false;
  }
}

// Turns a paid order's draft into the customer's order and the admin ledger entry, marked paymentStatus "completed".
// Safe to call any number of times (browser confirmation and Razorpay webhook both call it): existing documents are never overwritten.
async function finalizeOrder(orderId) {
  if (!isConfigured()) return { saved: false, reason: 'not_configured' };

  const existing = await getDocument(`all_orders/${orderId}`);
  if (existing && existing.paymentStatus !== 'rejected') return { saved: true, already: true };

  const draft = await getDocument(`${DRAFTS}/${orderId}`);
  if (!draft) return { saved: false, reason: 'no_draft' };

  const order = await getPaidOrder(orderId);
  const payment = order.payment;
  if (Number(order.amount) !== Number(draft.totalPaise) || Number(payment.amount) !== Number(order.amount)) {
    console.error('Order amount mismatch, not saving:', orderId);
    await recordRejection(
      orderId, draft, 'amount_mismatch',
      `Razorpay collected ₹${Number(payment.amount) / 100} on an order of ₹${Number(order.amount) / 100}; the checkout expected ₹${Number(draft.totalPaise) / 100}`,
    ).catch(e => console.error('Could not record rejected payment:', e && e.message));
    return { saved: false, reason: 'amount_mismatch' };
  }

  const { uid, record } = baseRecord(orderId, draft);
  const personalPath = uid ? `users/${uid}/orders` : 'orders';
  const completed = {
    ...record,
    paymentId: payment.id,
    status: 'confirmed',
    paymentStatus: 'completed',
    paymentVerifiedAt: new Date(),
    createdAt: new Date(),
  };

  await createDocument(personalPath, orderId, completed);
  const ledger = { ...completed, docId: orderId, userPath: personalPath };
  if (!(await createDocument('all_orders', orderId, ledger))) {
    const current = await getDocument(`all_orders/${orderId}`);
    if (current && current.paymentStatus === 'rejected') {
      await updateDocument(`all_orders/${orderId}`, ledger, ['paymentRejectReason', 'paymentRejectDetail']);
    }
  }
  await deleteDocument(`${DRAFTS}/${orderId}`).catch(() => {});
  return { saved: true };
}

module.exports = { saveDraft, finalizeOrder, rejectOrder };
