'use strict';
/**
 * Regla fija: "todas las fases y flujos se pueden con número, código, o
 * nombre". La fase de sabores (S1..Sn) solo aceptaba el código con prefijo
 * ("s1") o el nombre - un número pelado ("1") no seleccionaba nada (se
 * descartaba por el filtro de longitud >= 2, o caía a busqueda por nombre
 * que nunca matchea un digito). Este test cubre que "1 2" ahora selecciona
 * lo mismo que "s1 s2", tanto en el flujo normal como en personalización
 * por unidad (HELADO_PER_UNIT_SABORES).
 * Uso: node test_heladeria_bare_number_selection.js
 */
process.env.BUSINESS_KEY = 'heladeria';

const botCore = require('./services/bot_core');
const heladeriaFlow = require('./handlers/flows/heladeria.flow.js');
const PHASE = require('./utils/phases');

const sent = [];
const sock = { sendMessage: async (jid, text) => { sent.push(String(text)); }, getChatById: async () => null };
const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {}, botEnabled: true, geminiKey: null, geminiAvailable: false, productsCache: [] };
const JID = '573000000702@c.us';
let failures = 0;
function check(cond, msg) {
    if (cond) console.log('✅', msg);
    else { failures++; console.log('❌', msg); }
}

function makeSaboresSession() {
    const osito = (ctx.productsCache || []).find(p => /osito/i.test(String(p.NombreProducto || '')));
    return {
        phase: 'HELADO_SABORES', errorCount: 0, carrito: [],
        awaitingField: null, pendingVoiceGuided: null, lastMentionedProducts: [], lastBotReply: '',
        heladoFlow: { product: osito, counts: { sabores: 2, toppings: 23 }, saboresSeleccionados: [], toppingsSeleccionados: [], observaciones: '' }
    };
}

async function handle(text, userSession) {
    sent.length = 0;
    ctx.sessions[JID] = userSession;
    await heladeriaFlow.handle(sock, JID, text, userSession, ctx);
    return sent.join('\n');
}

(async () => {
    await botCore.loadAllProductsCache(ctx).catch(e => console.log('cache fail:', e.message));
    // Mismo orden que usa el flow internamente (buildOptionLists: sort por CodigoProducto)
    const saboresList = (ctx.productsCache || [])
        .filter(p => String(p.Categoria || '').toLowerCase() === 'sabores_helado')
        .sort((a, b) => String(a.CodigoProducto || '').localeCompare(String(b.CodigoProducto || '')));
    check(saboresList.length >= 2, `hay al menos 2 sabores en el catálogo (${saboresList.length})`);

    // "1 2" (numeros pelados) debe seleccionar los mismos 2 sabores que "s1 s2"
    const s1 = makeSaboresSession();
    await handle('1 2', s1);
    const nombres1 = (s1.heladoFlow.saboresSeleccionados || []).map(x => x.NombreProducto || x);
    check(nombres1.length === 2 && nombres1[0] === saboresList[0].NombreProducto && nombres1[1] === saboresList[1].NombreProducto,
        `"1 2" selecciona sabor #1 y #2 por número pelado (${nombres1.join(', ')})`);
    check(s1.phase === 'HELADO_TOPPINGS', `avanza a toppings tras completar con números pelados (fase: ${s1.phase})`);

    // Mezcla número pelado + código: "1 s2" también debe funcionar
    const s2 = makeSaboresSession();
    await handle('1 s2', s2);
    const nombres2 = (s2.heladoFlow.saboresSeleccionados || []).map(x => x.NombreProducto || x);
    check(nombres2.length === 2 && nombres2[0] === saboresList[0].NombreProducto && nombres2[1] === saboresList[1].NombreProducto,
        `mezcla "1 s2" (número pelado + código) funciona igual (${nombres2.join(', ')})`);

    // Personalización por unidad (HELADO_PER_UNIT_SABORES) también acepta número pelado
    const s3 = makeSaboresSession();
    s3.heladoFlow.counts = { sabores: 2, toppings: 5 };
    s3.phase = 'HELADO_QUANTITY';
    await handle('2', s3); // qty=2, con opciones -> pregunta personalizacion
    check(s3.phase === 'HELADO_UNITS_MODE', `qty=2 pregunta personalización (fase: ${s3.phase})`);
    await handle('2', s3); // "cada una diferente"
    check(s3.phase === 'HELADO_PER_UNIT_SABORES', `entra a sabores por unidad (fase: ${s3.phase})`);
    await handle('1 2', s3);
    check(s3.phase === 'HELADO_PER_UNIT_TOPPINGS', `número pelado también funciona en sabores POR UNIDAD (fase: ${s3.phase})`);

    console.log('\n' + (failures === 0 ? '✅ TODO OK' : `❌ ${failures} FALLOS`));
    process.exit(failures === 0 ? 0 : 1);
})();
