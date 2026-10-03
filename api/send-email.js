const { handle, getBody, isEmail, sendError } = require('../lib/security');
const { getPaidOrder } = require('../lib/razorpay');
const { fetchCatalog } = require('../lib/pricing');
const { sendEmail, orderConfirmationHtml } = require('../lib/notify');

// Order confirmation. Recipient and contents come from the paid Razorpay order (set server-side at create-order),
// never from the request, so this cannot be used to email arbitrary people.
module.exports = async (req, res) => {
  if (!handle(req, res)) return;
  try {
    const { razorpay_order_id } = getBody(req);
    const order = await getPaidOrder(razorpay_order_id);
    const notes = order.notes || {};
    if (!isEmail(notes.email)) return res.status(200).json({ skipped: true });

    const catalog = await fetchCatalog().catch(() => ({}));
    const items = String(notes.items || '').split(',').map(part => {
      const m = /^([A-Za-z0-9_-]+)x(\d+)@([\d.]+)$/.exec(part.trim());
      if (!m) return null;
      return { name: (catalog[m[1]] && catalog[m[1]].name) || m[1], qty: Number(m[2]), price: Number(m[3]) };
    }).filter(Boolean);

    const id = await sendEmail({
      to: notes.email,
      subject: `Order Confirmed - Order ID: ${order.id}`,
      html: orderConfirmationHtml({ name: notes.name, orderId: order.id, items, total: order.amount / 100, address: notes.address }),
    });
    res.status(200).json({ success: true, id });
  } catch (e) {
    sendError(res, e);
  }
};
