'use strict';
/**
 * Pruebas unitarias de checkoutHandler.handleFieldCorrection — la capacidad
 * COMPARTIDA (capa checkoutHandler.js, cualquier negocio de carrito) de
 * CAMBIAR o QUITAR un campo de entrega YA capturado en userSession.order
 * (dirección, nombre, teléfono, método de pago). Generaliza a la capa
 * compartida el patrón que heladería ya tenía para toppings ("quítale las
 * gomitas"): señal de intención clara + comparar contra lo YA guardado,
 * nunca reinterpretar un mensaje ambiguo.
 *
 * Casos cubiertos (pedido de Johan):
 *  - cambiar dirección con dato válido
 *  - quitar dirección
 *  - cambiar método de pago ("mejor pago con transferencia" con efectivo ya
 *    guardado)
 *  - mensaje ambiguo que NO debe disparar nada
 *  - mensaje con dato sensible que NO debe procesarse como corrección
 *  - "no era esa dirección" (quitar) y "no es esa dirección, es X" (cambiar)
 *  - cambiar nombre / teléfono, quitar teléfono
 *  - sin falsos positivos: "cambia la hora de entrega a las 6", "pago sin
 *    tarjeta", pedido normal
 * Uso: node test_checkout_field_correction.js
 */
process.env.BUSINESS_KEY = 'heladeria';

const checkoutHandler = require('./handlers/checkoutHandler');
const PHASE = require('./utils/phases');

let failures = 0;
function check(cond, msg) {
    if (cond) console.log('✅', msg);
    else { failures++; console.log('❌', msg); }
}

function makeSock(sent) {
    return { sendMessage: async (jid, text) => sent.push(String(text)), getChatById: async () => null };
}

function makeSession(overrides = {}) {
    return Object.assign({
        phase: PHASE.HELADO_POST_ADD, errorCount: 0, carrito: [], order: {},
        heladoFlow: null
    }, overrides);
}

(async () => {
    // ---- 1) Cambiar dirección con dato válido (ya había una guardada) ----
    {
        const sent = [];
        const sock = makeSock(sent);
        const s = makeSession({ order: { address: 'Calle 10 #20-30', name: 'Juan', telefono: '3139848800', paymentMethod: 'efectivo' } });
        const r = await checkoutHandler.handleFieldCorrection(sock, '573900000001@c.us', 'cambia mi dirección a Cra 45 #12-30', s, {});
        check(r.changed === true && r.field === 'address', `cambiar dirección → changed:true, field:address (real: ${JSON.stringify(r)})`);
        check(s.order.address === 'Cra 45 #12-30', `la dirección quedó actualizada (real: ${s.order.address})`);
        check(/quedó: \*Cra 45 #12-30\*/.test(sent.join('\n')), 'confirma el cambio al cliente');
        check(s.order.name === 'Juan' && s.order.telefono === '3139848800' && s.order.paymentMethod === 'efectivo',
            'los demás campos NO se tocaron');
    }

    // ---- 2) Quitar dirección ----
    {
        const sent = [];
        const sock = makeSock(sent);
        const s = makeSession({ order: { address: 'Calle 10 #20-30', name: 'Juan' } });
        const r = await checkoutHandler.handleFieldCorrection(sock, '573900000002@c.us', 'quita la dirección', s, {});
        check(r.changed === true && r.field === 'address' && r.value === null, 'quitar dirección → changed:true, value:null');
        check(s.order.address === null, `la dirección quedó en null para que la vuelvan a pedir (real: ${JSON.stringify(s.order.address)})`);
        check(/quité tu \*dirección\*/.test(sent.join('\n')), 'confirma la quita al cliente');
    }

    // ---- 3) Cambiar método de pago ("mejor pago con transferencia") ----
    {
        const sent = [];
        const sock = makeSock(sent);
        const s = makeSession({ order: { address: 'Cra 45 #12-30', name: 'Juan', telefono: '3139848800', paymentMethod: 'efectivo' } });
        const r = await checkoutHandler.handleFieldCorrection(sock, '573900000003@c.us', 'mejor pago con transferencia', s, {});
        check(r.changed === true && r.field === 'paymentMethod' && r.value === 'transferencia',
            `"mejor pago con transferencia" → paymentMethod:transferencia (real: ${JSON.stringify(r)})`);
        check(s.order.paymentMethod === 'transferencia', `el método de pago quedó actualizado (real: ${s.order.paymentMethod})`);
    }

    // ---- 4) Mensaje ambiguo que NO debe disparar nada ----
    {
        const sent = [];
        const sock = makeSock(sent);
        const s = makeSession({ order: { address: 'Cra 45 #12-30' } });
        const r = await checkoutHandler.handleFieldCorrection(sock, '573900000004@c.us', 'cambia eso', s, {});
        check(r.changed === false, `"cambia eso" (sin campo) → changed:false (real: ${JSON.stringify(r)})`);
        check(s.order.address === 'Cra 45 #12-30', 'no tocó nada');
        check(sent.length === 0, 'no respondió nada (no consumió el mensaje)');
    }

    // ---- 5) Mensaje con dato sensible que NO debe procesarse como corrección ----
    {
        const sent = [];
        const sock = makeSock(sent);
        const s = makeSession({ order: { address: 'Cra 45 #12-30', paymentMethod: 'efectivo' } });
        const r = await checkoutHandler.handleFieldCorrection(sock, '573900000005@c.us', 'cambia mi tarjeta a 1234 5678 9012 3456', s, {});
        check(r.changed === false, `tarjeta (16 dígitos) → changed:false, no se procesa como corrección (real: ${JSON.stringify(r)})`);
        check(s.order.paymentMethod === 'efectivo' && s.order.address === 'Cra 45 #12-30', 'no tocó ningún campo');
        const r2 = await checkoutHandler.handleFieldCorrection(sock, '573900000005@c.us', 'cambia mi clave a 1234', s, {});
        check(r2.changed === false, `"cambia mi clave a 1234" → changed:false (dato sensible)`);
    }

    // ---- 6) "no era esa dirección" → quitar ----
    {
        const sent = [];
        const sock = makeSock(sent);
        const s = makeSession({ order: { address: 'Calle 10 #20-30', name: 'Juan' } });
        const r = await checkoutHandler.handleFieldCorrection(sock, '573900000006@c.us', 'no era esa dirección', s, {});
        check(r.changed === true && r.value === null, `"no era esa dirección" → quita la dirección (real: ${JSON.stringify(r)})`);
        check(s.order.address === null, 'dirección en null');
    }

    // ---- 7) "no es esa dirección, es Cra 45 #12-30" → cambiar ----
    {
        const sent = [];
        const sock = makeSock(sent);
        const s = makeSession({ order: { address: 'Calle 10 #20-30', name: 'Juan' } });
        const r = await checkoutHandler.handleFieldCorrection(sock, '573900000007@c.us', 'no es esa dirección, es Cra 45 #12-30', s, {});
        check(r.changed === true && r.value === 'Cra 45 #12-30', `"no es esa dirección, es X" → cambia (real: ${JSON.stringify(r)})`);
        check(s.order.address === 'Cra 45 #12-30', `dirección actualizada (real: ${s.order.address})`);
    }

    // ---- 8) Cambiar nombre ----
    {
        const sent = [];
        const sock = makeSock(sent);
        const s = makeSession({ order: { address: 'Cra 45 #12-30', name: 'Juan', telefono: '3139848800', paymentMethod: 'efectivo' } });
        const r = await checkoutHandler.handleFieldCorrection(sock, '573900000008@c.us', 'cambia el nombre a Juan Pérez', s, {});
        check(r.changed === true && r.field === 'name' && r.value === 'Juan Pérez', `cambiar nombre (real: ${JSON.stringify(r)})`);
        check(s.order.name === 'Juan Pérez', `nombre actualizado (real: ${s.order.name})`);
    }

    // ---- 9) Cambiar teléfono ----
    {
        const sent = [];
        const sock = makeSock(sent);
        const s = makeSession({ order: { address: 'Cra 45 #12-30', name: 'Juan', telefono: '3139848800', paymentMethod: 'efectivo' } });
        const r = await checkoutHandler.handleFieldCorrection(sock, '573900000009@c.us', 'cambia mi teléfono a 3009998877', s, {});
        check(r.changed === true && r.field === 'telefono' && r.value === '3009998877', `cambiar teléfono (real: ${JSON.stringify(r)})`);
        check(s.order.telefono === '3009998877', `teléfono actualizado (real: ${s.order.telefono})`);
    }

    // ---- 10) Quitar teléfono ----
    {
        const sent = [];
        const sock = makeSock(sent);
        const s = makeSession({ order: { address: 'Cra 45 #12-30', name: 'Juan', telefono: '3139848800', paymentMethod: 'efectivo' } });
        const r = await checkoutHandler.handleFieldCorrection(sock, '573900000010@c.us', 'quita el teléfono', s, {});
        check(r.changed === true && r.value === null, `quitar teléfono (real: ${JSON.stringify(r)})`);
        check(s.order.telefono === null, 'teléfono en null');
    }

    // ---- 11) Sin intención → no dispara nada ----
    {
        const sent = [];
        const sock = makeSock(sent);
        const s = makeSession({ order: { address: 'Cra 45 #12-30' } });
        const r = await checkoutHandler.handleFieldCorrection(sock, '573900000011@c.us', 'quiero una copa de fresa', s, {});
        check(r.changed === false, `pedido normal → changed:false (real: ${JSON.stringify(r)})`);
    }

    // ---- 12) Cambiar dirección cuando NO había ninguna guardada (captura) ----
    {
        const sent = [];
        const sock = makeSock(sent);
        const s = makeSession({ order: {} });
        const r = await checkoutHandler.handleFieldCorrection(sock, '573900000012@c.us', 'cambia mi dirección a Cra 45 #12-30', s, {});
        check(r.changed === true && s.order.address === 'Cra 45 #12-30', `cambiar dirección sin una previa → la guarda (real: ${s.order.address})`);
    }

    // ---- 13) Sin falsos positivos ----
    {
        const sent = [];
        const sock = makeSock(sent);
        const s = makeSession({ order: { address: 'Cra 45 #12-30', paymentMethod: 'efectivo' } });
        const r1 = await checkoutHandler.handleFieldCorrection(sock, '573900000013@c.us', 'cambia la hora de entrega a las 6', s, {});
        check(r1.changed === false, `"cambia la hora de entrega a las 6" → changed:false (no es una dirección)`);
        const r2 = await checkoutHandler.handleFieldCorrection(sock, '573900000013@c.us', 'pago sin tarjeta', s, {});
        check(r2.changed === false, `"pago sin tarjeta" → changed:false (no quita el método de pago)`);
        check(s.order.address === 'Cra 45 #12-30' && s.order.paymentMethod === 'efectivo', 'no tocó nada');
    }

    // ---- 14) En fase de checkout, tras corregir, sigue pidiendo lo que falta ----
    {
        const sent = [];
        const sock = makeSock(sent);
        const s = makeSession({ phase: PHASE.CHECK_TELEFONO, order: { address: 'Cra 45 #12-30', name: 'Juan', telefono: '3139848800', paymentMethod: 'efectivo' } });
        const r = await checkoutHandler.handleFieldCorrection(sock, '573900000014@c.us', 'cambia mi teléfono a 3009998877', s, {});
        check(r.changed === true && s.order.telefono === '3009998877', 'corrige el teléfono en fase de checkout');
        check(s.phase === PHASE.FINALIZE_ORDER, `tras corregir en checkout, avanza al resumen final (fase: ${s.phase})`);
        check(/Resumen final del pedido/.test(sent.join('\n')), 'muestra el resumen final con el dato corregido');
    }

    console.log(failures === 0 ? '\n✅ TODOS LOS CHECKS PASARON' : `\n❌ ${failures} fallos`);
    process.exitCode = failures === 0 ? 0 : 1;
    setTimeout(() => process.exit(process.exitCode || 0), 50);
})().catch(e => {
    console.error('Test failed:', e.stack || e.message);
    process.exitCode = 1;
    setTimeout(() => process.exit(1), 50);
});