const axios = require('axios');
const { processIncomingMessage, stopBackgroundTasks } = require('./handlers/handler');

// Mock socket that logs actions
const mockSock = {
  sendPresenceUpdate: async (status, jid) => {
    console.log(`mockSock: sendPresenceUpdate(${status}, ${jid})`);
  },
  sendMessage: async (jid, message) => {
    const text = message.text || message.caption || JSON.stringify(message);
    console.log(`mockSock: sendMessage to ${jid}: ${text}`);
  }
};

// Simple mock for axios.get to return a matching product when searching
axios.get = async (url, opts) => {
  console.log(`axios.get called: ${url} params=${JSON.stringify(opts && opts.params)}`);
  // return a single product as if API returned direct product
  return {
    data: {
      CodigoProducto: 'C-VAIN-001',
      NombreProducto: 'Caja Vainilla',
      Precio_Venta: '25000',
      Numero_de_Sabores: '0',
      Numero_de_Toppings: '0'
    }
  };
};

// Build ctx matching initializeBotContext shape
const ctx = {
  sessions: {},
  botEnabled: true,
  startTime: Date.now(),
  mutedChats: new Set()
};

(async () => {
  const customerJid = '573100000000@s.whatsapp.net';
  console.log('--- Test: Parser E2E - simple order ---');

  const msg = { from: customerJid, text: 'Necesito 3 cajas de helado vainilla, sin toppings', key: { id: 'p-1', fromMe: false } };
  await processIncomingMessage(mockSock, msg, ctx);

  // Wait a bit for async processing
  await new Promise(r => setTimeout(r, 800));

  const session = ctx.sessions[customerJid];
  console.log('Session after message:', JSON.stringify(session, null, 2));

  const items = session && session.order && session.order.items ? session.order.items : [];
  console.log('Cart items:', JSON.stringify(items, null, 2));

  if (items.length === 1 && items[0].cantidad === 3) {
    console.log('TEST PASSED: item added with correct quantity');
    process.exit(0);
  } else {
    console.error('TEST FAILED: unexpected cart contents');
    process.exit(1);
  }
})();
