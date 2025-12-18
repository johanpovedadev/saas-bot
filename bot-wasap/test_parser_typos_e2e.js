const axios = require('axios');
const { processIncomingMessage } = require('./handlers/handler');

// Mock socket
const mockSock = {
  sendPresenceUpdate: async () => {},
  sendMessage: async (jid, message) => { console.log('mock sendMessage:', message); }
};

// Make axios.get return a product for queries containing 'vainilla'
axios.get = async (url, opts) => {
  console.log('axios.get', url, opts && opts.params);
  const q = (opts && opts.params && opts.params.q) || '';
  if (q.toLowerCase().includes('vainilla') || q.toLowerCase().includes('helado vainilla')) {
    return { data: { CodigoProducto: 'C-VAIN-001', NombreProducto: 'Caja Vainilla', Precio_Venta: '25000' } };
  }
  // default: empty
  return { data: {} };
};

const ctx = { sessions: {}, botEnabled: true, startTime: Date.now(), mutedChats: new Set() };

(async () => {
  const jid1 = '573100000010@s.whatsapp.net';
  console.log('--- Test: typo "sin topong" ---');
  const msg1 = { from: jid1, text: 'quiero una caja de helado sin topong', key: { id: 't1', fromMe: false } };
  await processIncomingMessage(mockSock, msg1, ctx);
  await new Promise(r => setTimeout(r, 400));

  const session1 = ctx.sessions[jid1];
  console.log('Session1:', JSON.stringify(session1 && session1.order, null, 2));

  const jid2 = '573100000011@s.whatsapp.net';
  console.log('--- Test: unit-only "caja de vainilla" ---');
  const msg2 = { from: jid2, text: 'caja de vainilla', key: { id: 't2', fromMe: false } };
  await processIncomingMessage(mockSock, msg2, ctx);
  await new Promise(r => setTimeout(r, 400));

  const session2 = ctx.sessions[jid2];
  console.log('Session2:', JSON.stringify(session2 && session2.order, null, 2));

  const ok1 = session1 && session1.order && Array.isArray(session1.order.items) && session1.order.items.length >= 1;
  const ok2 = session2 && session2.order && Array.isArray(session2.order.items) && session2.order.items.length >= 1;

  if (ok1 && ok2) {
    console.log('TYPO TESTS PASSED');
    process.exit(0);
  } else {
    console.error('TYPO TESTS FAILED');
    process.exit(1);
  }
})();
