const { handle, getBody, cleanText, isEmail, normalizeIndianPhone, getVerifiedUser, sendError } = require('../lib/security');
const { computeOrder } = require('../lib/pricing');
const { rz } = require('../lib/razorpay');
const { saveDraft } = require('../lib/orders');

function cleanAddress(a, fallbackLine) {
  const x = a && typeof a === 'object' ? a : {};
  const type = ['Home', 'Work', 'Other'].includes(x.type) ? x.type : 'Home';
  return {
    name: cleanText(x.name, 80),
    phone: cleanText(x.phone, 20),
    pin: /^\d{6}$/.test(String(x.pin || '')) ? String(x.pin) : '',
    addr1: cleanText(x.addr1, 150) || cleanText(fallbackLine, 250),
    addr2: cleanText(x.addr2, 150),
    city: cleanText(x.city, 60),
    state: cleanText(x.state, 60),
    type,
  };
}

// The amount charged is computed here from Firestore prices; any amount sent by the browser is ignored.
module.exports = async (req, res) => {
  if (!handle(req, res, { name: 'create-order', max: 20 })) return;
  try {
    const body = getBody(req);
    const user = await getVerifiedUser(req);
    const order = await computeOrder({ items: body.items, promoCode: body.promoCode });

    const email = isEmail(body.email) ? body.email.trim().toLowerCase() : '';
    const phone = normalizeIndianPhone(body.phone) || '';
    const name = cleanText(body.name, 80);
    const addressLine = cleanText(body.address, 250);
    const notes = {
      email,
      phone,
      name,
      address: addressLine,
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

    await saveDraft(rzOrder.id, {
      uid: user ? user.uid : '',
      items: order.items,
      subtotal: order.subtotal,
      discount: order.discount,
      shipping: order.shipping,
      totalPaise: order.totalPaise,
      promoCode: order.promoCode,
      address: cleanAddress(body.addressDetails, addressLine),
      name,
      email: email || (user ? user.email.toLowerCase() : ''),
      phone: cleanText(body.phone, 20),
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
