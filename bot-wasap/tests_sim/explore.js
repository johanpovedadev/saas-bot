'use strict';
// Exploración manual: node tests_sim/explore.js [sim|off|agent] "hola" "1" ...  (imprime la conversación)
const { createWorld } = require('./world');

(async () => {
    const [mode, ...mensajes] = process.argv.slice(2);
    const log = console.log;
    const w = await createWorld({ ai: mode === 'off' ? 'off' : 'sim', agent: mode === 'agent' });
    console.log = () => {}; console.warn = () => {}; console.error = () => {};
    const c = w.customer('explorador');
    for (const m of mensajes) {
        const replies = await c.say(m);
        log(`\n👤 ${m}`);
        for (const r of replies) log(`🤖 ${r.replace(/\n/g, '\n   ')}`);
        const tr = w.agentTraces.splice(0); log(`   [fase: ${c.session && c.session.phase}${tr.length ? ' | ' + tr.map(x => x.path + (x.executed ? ':' + x.executed.join(',') : '')).join(' ; ') : ''}]`);
    }
    if (w.backend.orders.length) log('\n📦 PEDIDO AL BACKEND:', JSON.stringify(w.backend.orders.map(o => ({ monto: o.payload.monto, producto: o.payload.producto, dir: o.payload.direccion, pago: o.payload.pago })), null, 1));
    process.exit(0);
})();
