const { isConfigured, getDocument, createDocument, deleteDocument } = require('./firestore-admin');
const { getPaidOrder } = require('./razorpay');

const DRAFTS = 'pending_orders';
const SAFE_UID = /^[A-Za-z0-9_-]{1,128}$/;

function istDate() {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

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

// Turns a paid order's draft into the customer's order and the admin ledger entry. Safe to call any number of times
// (browser confirmation and Razorpay webhook both call it): existing documents are never overwritten.
async function finalizeOrder(orderId) {
  if (!isConfigured()) return { saved: false, reason: 'not_configured' };

  if (await getDocument(`all_orders/${orderId}`)) return { saved: true, already: true };

  const draft = await getDocument(`${DRAFTS}/${orderId}`);
  if (!draft) return { saved: false, reason: 'no_draft' };

  const order = await getPaidOrder(orderId);
  const payment = order.payment;
  if (Number(order.amount) !== Number(draft.totalPaise) || Number(payment.amount) !== Number(order.amount)) {
    console.error('Order amount mismatch, not saving:', orderId);
    return { saved: false, reason: 'amount_mismatch' };
  }

  const uid = SAFE_UID.test(String(draft.uid || '')) ? draft.uid : '';
  const personalPath = uid ? `users/${uid}/orders` : 'orders';
  const record = {
    paymentId: payment.id,
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
    status: 'confirmed',
    createdAt: new Date(),
    date: istDate(),
  };

  await createDocument(personalPath, orderId, record);
  await createDocument('all_orders', orderId, { ...record, docId: orderId, userPath: personalPath });
  await deleteDocument(`${DRAFTS}/${orderId}`).catch(() => {});
  return { saved: true };
}

module.exports = { saveDraft, finalizeOrder };
