const handler = require('./handlers/handler');
const bot_core = require('./services/bot_core');

(async () => {
  const jid = '573100000000@s.whatsapp.net';
  const sock = {
    messages: [],
    async sendMessage(j, msg, ctx) { this.messages.push({ to: j, msg }); },
    async say(j, text, ctx) { this.messages.push({ to: j, text }); }
  };

  // Monkeypatch bot_core.addToCart to a simple implementation that stores into ctx.sessions[jid].order.items
  const originalAddToCart = bot_core.addToCart;
  bot_core.addToCart = function(ctx, j, item, qty) {
    if (!ctx.sessions[j]) ctx.sessions[j] = { order: { items: [] } };
    if (!ctx.sessions[j].order) ctx.sessions[j].order = { items: [] };
    const existing = ctx.sessions[j].order.items.find(i => i.codigo === item.codigo && JSON.stringify(i.sabores) === JSON.stringify(item.sabores) && JSON.stringify(i.toppings) === JSON.stringify(item.toppings));
    if (existing) {
      existing.cantidad = (existing.cantidad || 1) + qty;
    } else {
      const toAdd = Object.assign({}, item, { cantidad: qty });
      ctx.sessions[j].order.items.push(toAdd);
    }
    console.log('[mock addToCart] Added', qty, 'x', item.nombre);
  };

  // Create ctx with sabores/toppings
  const ctx = { sessions: {}, saboresYToppings: { sabores: [ { NombreProducto: 'Vainilla', CodigoProducto: 'S-VAINILLA' }, { NombreProducto: 'Chocolate', CodigoProducto: 'S-CHOCOLATE' } ], toppings: [ { NombreProducto: 'Chispas', CodigoProducto: 'T-CHISPAS' } ] } };

  // Initialize session
  const session = handler.initializeUserSession(jid, ctx);

  // Set current product with sabores/toppings info
  const product = { NombreProducto: 'Caja Helado', CodigoProducto: 'P-CAJA', Precio_Venta: 10000, sabores: ctx.saboresYToppings.sabores, toppings: ctx.saboresYToppings.toppings, Numero_de_Sabores: 2, Numero_de_Toppings: 1 };
  session.currentProduct = product;

  // Simulate that user already selected sabores and toppings before quantity
  session.saboresSeleccionados = ['s1'];
  session.toppingsSeleccionados = ['t1'];

  console.log('>> Calling handleSelectQuantity with quantity 2');
  await handler.handleSelectQuantity(sock, jid, '2', session, ctx);

  console.log('Messages after quantity request:', sock.messages.map(m => m.text || m.msg).slice(-3));

  // Now simulate user replies 'diferente'
  console.log('>> Simulating user reply: diferente');
  await handler.processIncomingMessage(sock, { from: jid, text: 'diferente', key: {} }, ctx);

  console.log('Messages after reply diferente:', sock.messages.map(m => m.text || m.msg).slice(-5));

  // Verify that first unit was auto-added
  const items = ctx.sessions[jid].order && ctx.sessions[jid].order.items ? ctx.sessions[jid].order.items : [];
  const passed1 = items.length >= 1 && items[0].cantidad >= 1;
  console.log('Assertion: first unit auto-added?', passed1, 'items:', items);

  // Expect pendingQuantity remaining > 0
  const pending = ctx.sessions[jid].pendingQuantity || null;
  console.log('Pending quantity state:', pending);
  const passed2 = pending && pending.remaining === 1;

  // Now simulate providing detalles for unit 2: S1 | T1
  console.log('>> Simulating unit 2 details input: S1 | T1');
  await handler.processIncomingMessage(sock, { from: jid, text: 'S1 | T1', key: {} }, ctx);

  // Now simulate setting quantity 1 for this unit
  console.log('>> Simulating quantity 1 for unit 2');
  await handler.processIncomingMessage(sock, { from: jid, text: '1', key: {} }, ctx);

  // After adding second unit, pendingQuantity should be null and phase should be CHECK_DIR or ask for address
  const finalPending = ctx.sessions[jid].pendingQuantity || null;
  const phase = ctx.sessions[jid].phase;
  console.log('Final pending:', finalPending, 'Phase:', phase);

  // Print captured messages for inspection
  console.log('\nCaptured messages:');
  sock.messages.forEach((m,i) => console.log(i, m.to, m.text || m.msg));

  // Restore original addToCart
  bot_core.addToCart = originalAddToCart;

  // Summarize assertions
  if (passed1 && passed2 && finalPending === null && (phase && phase.toString().toLowerCase().includes('check'))) {
    console.log('\nTEST RESULT: PASS');
    process.exit(0);
  } else {
    console.log('\nTEST RESULT: FAIL');
    process.exit(2);
  }
})();
