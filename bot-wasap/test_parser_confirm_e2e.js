const axios = require('axios');
const { processIncomingMessage } = require('./handlers/handler');

// Mock socket
const mockSock = {
  sendPresenceUpdate: async () => {},
  sendMessage: async (jid, message) => { console.log('mock sendMessage:', message); }
};

axios.get = async (url, opts) => {
  console.log('axios.get', url, opts.params);
  return { data: { matches: [{ CodigoProducto: 'C-VAIN-001', NombreProducto: 'Caja Vainilla', Precio_Venta: '25000' }] } };
};

const ctx = { sessions: {}, botEnabled: true, startTime: Date.now(), mutedChats: new Set() };

(async () => {
  const jid = '573100000001@s.whatsapp.net';
  // Send a medium-confidence message that parser should ask confirmation
  const msg1 = { from: jid, text: 'Vainilla, 3', key: { id: 'c1', fromMe: false } };
  await processIncomingMessage(mockSock, msg1, ctx);
  await new Promise(r => setTimeout(r, 300));
  // Simulate user replying 'si'
  const msg2 = { from: jid, text: 'si', key: { id: 'c2', fromMe: false } };
  await processIncomingMessage(mockSock, msg2, ctx);

  const session = ctx.sessions[jid];
  console.log('Session after confirm:', JSON.stringify(session, null, 2));
  const items = session.order.items || [];
  if (items.length === 1 && items[0].cantidad === 3) console.log('CONFIRM TEST PASSED'); else { console.error('CONFIRM TEST FAILED'); process.exit(1); }
  process.exit(0);
})();
