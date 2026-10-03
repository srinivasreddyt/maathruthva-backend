const { handle, getBody, cleanText, isEmail, normalizeIndianPhone, sendError } = require('../lib/security');
const { computeOrder } = require('../lib/pricing');
const { rz } = require('../lib/razorpay');

// The amount charged is computed here from Firestore prices; any amount sent by the browser is ignored.
module.exports = async (req, res) => {
  if (!handle(req, res)) return;
  try {
    const body = getBody(req);
    const order = await computeOrder({ items: body.items, promoCode: body.promoCode });

    const email = isEmail(body.email) ? body.email.trim().toLowerCase() : '';
    const phone = normalizeIndianPhone(body.phone) || '';
    const notes = {
      email,
      phone,
      name: cleanText(body.name, 80),
      address: cleanText(body.address, 250),
      items: order.items.map(i => `${i.productId}x${i.qty}@${i.price}`).join(',').slice(0, 250),
      promo: order.promoCode,
    };
    Object.keys(notes).forEach(k => { if (!notes[k]) delete notes[k]; });

    const rzOrder = await rz('POST', '/v1/orders', {
      amount: order.totalPaise,
      currency: 'INR',
      receipt: `mtr_${Date.now()}`,
      notes,
    });

    res.status(200).json({
      id: rzOrder.id,
      amount: rzOrder.amount,
      currency: rzOrder.currency,
      breakdown: {
        subtotal: order.subtotal,
        discount: order.discount,
        shipping: order.shipping,
        total: order.totalPaise / 100,
        promoCode: order.promoCode,
      },
      items: order.items,
    });
  } catch (e) {
    sendError(res, e);
  }
};
