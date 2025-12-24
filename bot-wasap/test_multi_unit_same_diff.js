const { processIncomingMessage, initializeUserSession, stopBackgroundTasks } = require('./handlers/handler');
const PHASE = require('./utils/phases');

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

const ctx = { sessions: {}, botEnabled: true, startTime: Date.now(), mutedChats: new Set() };

(async () => {
  const jid = '3000000000@lid';

  // Initialize session and inject a sample product requiring 1 sabor and 1 topping
  initializeUserSession(jid, ctx);
  const session = ctx.sessions[jid];
  const sampleProduct = {
    CodigoProducto: 'P-TEST-001',
    NombreProducto: 'Parfait Test',
    Precio_Venta: 13000,
    Numero_de_Sabores: 1,
    Numero_de_Toppings: 1,
    sabores: [{ NombreProducto: 'Chocolate' }],
    toppings: [{ NombreProducto: 'Fresas Frescas', Precio_Venta: 500 }],
    Descripcion: 'Producto de prueba'
  };

  session.currentProduct = sampleProduct;
  session.phase = PHASE.SELECT_DETAILS;
  session.awaitingField = 'sabores';
  session.saboresSeleccionados = [];
  session.toppingsSeleccionados = [];

  console.log('--- Step 1: select sabor S1 ---');
  await processIncomingMessage(mockSock, { from: jid, text: 's1', key: { id: 'm-1', fromMe: false } }, ctx);
  await new Promise(r => setTimeout(r, 200));

  console.log('\n--- Step 2: select topping T1 ---');
  await processIncomingMessage(mockSock, { from: jid, text: 't1', key: { id: 'm-2', fromMe: false } }, ctx);
  await new Promise(r => setTimeout(r, 200));

  console.log('\n--- Step 3: send quantity 2 ---');
  await processIncomingMessage(mockSock, { from: jid, text: '2', key: { id: 'm-3', fromMe: false } }, ctx);
  await new Promise(r => setTimeout(r, 200));

  console.log('\n--- Step 4: reply "mismo" to apply same options ---');
  await processIncomingMessage(mockSock, { from: jid, text: 'mismo', key: { id: 'm-4', fromMe: false } }, ctx);
  await new Promise(r => setTimeout(r, 500));

  console.log('\n--- Final session state ---');
  console.log(JSON.stringify(ctx.sessions[jid], null, 2));

  try { stopBackgroundTasks(); console.log('Background tasks stopped.'); } catch (e) { console.error('Error stopping background tasks:', e.message); }
})();
