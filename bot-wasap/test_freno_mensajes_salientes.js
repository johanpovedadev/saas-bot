'use strict';
/**
 * Freno de mensajes salientes (Johan, 6 nov 2026). El bot de las clientas de Pilates entró en un bucle y le escribió
 * sin parar al celular de la dueña unas 3 horas, hasta que WhatsApp le bloqueó el número. Esta prueba fija que eso ya
 * no puede pasar, venga de donde venga el bucle, y que una conversación normal no se frena.
 * Uso: node test_freno_mensajes_salientes.js
 */
process.env.NODE_ENV = 'test';
process.env.BUSINESS_KEY = process.env.BUSINESS_KEY || 'heladeria';
const guard = require('./services/outboundGuard');

let failures = 0;
let passed = 0;
function check(cond, msg) { if (cond) { passed++; console.log('✅', msg); } else { failures++; console.log('❌', msg); } }

const MIN = 60 * 1000;
const DUENA = '573001112233@c.us';
const CLIENTE = '573004445566@c.us';
const BASE = Date.parse('2026-11-06T15:00:00Z');

(async () => {
    try {
        // ---- 1) El bucle de Pilates: un mensaje cada 5 s durante 3 horas al número de la dueña ----
        {
            guard._reset();
            let salieron = 0;
            let frenoEn = null;
            for (let t = 0; t < 3 * 60 * MIN; t += 5000) {
                const r = guard.check(DUENA, `Hola Bri, tienes una nueva reserva #${t}`, undefined, BASE + t);
                if (r.ok) salieron++;
                else if (r.block && frenoEn === null) frenoEn = t;
            }
            check(frenoEn !== null && frenoEn <= 10 * MIN, `el bucle se frena en los primeros 10 minutos (a los ${Math.round((frenoEn || 0) / 1000)} s)`);
            check(salieron <= 80, `en 3 horas salen como mucho 80 mensajes, no 2.160 (salieron ${salieron})`);
            const despues = guard.check(DUENA, 'sigue el bucle', undefined, BASE + 3 * 60 * MIN + MIN);
            check(!despues.ok, 'frenado otra vez el mismo día, queda frenado 24 h (no se reanuda cada hora)');
        }

        // ---- 2) El mismo texto en bucle se corta antes ----
        {
            guard._reset();
            const texto = '⏰ Recordatorio: tienes una clase de pilates hoy a las 6:00 pm, ¡te esperamos!';
            const r = [];
            for (let i = 0; i < 8; i++) r.push(guard.check(CLIENTE, texto, undefined, BASE + i * MIN).ok);
            check(r.filter(Boolean).length === 5, `el mismo mensaje largo sale como mucho 5 veces en 15 min (salió ${r.filter(Boolean).length})`);
            check(guard.check(CLIENTE, '¿Te lo confirmo así? Responde sí y lo envío 😊', undefined, BASE + 9 * MIN).ok, 'otro mensaje distinto sí sale');
            check(guard.check(CLIENTE, texto, undefined, BASE + 30 * MIN).ok, 'pasados 15 min, puede volver a salir');
        }

        // ---- 3) Una conversación normal no se frena ----
        {
            guard._reset();
            const turno = ['🍦 ¡Hola! Aquí tienes nuestro menú', { image: 1 }, { image: 2 }, { image: 3 }, { image: 4 }, { image: 5 }, { image: 6 }, '¿Qué se te antoja hoy?'];
            let ok = true;
            for (let i = 0; i < turno.length; i++) ok = guard.check(CLIENTE, turno[i], undefined, BASE + i * 200).ok && ok;
            check(ok, 'el menú con 6 fotos sale completo');
            let pedido = true;
            for (let i = 0; i < 30; i++) pedido = guard.check(CLIENTE, `Paso ${i} del pedido`, undefined, BASE + 2 * MIN + i * 20000).ok && pedido;
            check(pedido, 'un pedido largo (30 mensajes en 10 min) sale completo');
            let cortos = true;
            for (let i = 0; i < 10; i++) cortos = guard.check(CLIENTE, '✅ Sin toppings.', undefined, BASE + 13 * MIN + i * 1000).ok && cortos;
            check(cortos, 'un texto corto que se repite ("✅ Sin toppings.") no se frena');
        }

        // ---- 4) Cada número por separado ----
        {
            guard._reset();
            for (let i = 0; i < 25; i++) guard.check(DUENA, `msg ${i}`, undefined, BASE + i * 1000);
            check(!guard.check(DUENA, 'otro', undefined, BASE + 26000).ok, 'el número en bucle queda frenado');
            check(guard.check(CLIENTE, 'hola', undefined, BASE + 26000).ok, 'los demás clientes siguen recibiendo normal');
            check(guard.check(DUENA, 'ya pasó la hora', undefined, BASE + 26000 + 61 * MIN).ok, 'pasada la hora del freno, vuelve a recibir');
        }

        // ---- 5) Instalado en el socket: frena, avisa una sola vez y nunca al número frenado ----
        {
            guard._reset();
            process.env.OUTBOUND_MAX_PER_MINUTE = '5';
            const envConfig = require('./config/env.loader');
            const ADMIN = '573009990000@c.us';
            envConfig.admin = { ...(envConfig.admin || {}), system_admin_jids: [ADMIN, DUENA] };
            const enviados = [];
            const sock = { sendMessage: async (to, c) => { enviados.push({ to, c: String(c) }); return { id: { _serialized: 'x' } }; } };
            guard.install(sock);
            guard.install(sock);
            const res = [];
            for (let i = 0; i < 12; i++) res.push(await sock.sendMessage(DUENA, `bucle ${i}`));
            const aDuena = enviados.filter((m) => m.to === DUENA).length;
            const avisos = enviados.filter((m) => m.to === ADMIN && /Freno de mensajes/.test(m.c));
            check(aDuena === 5 && res.filter((x) => x === null).length === 7, `con el tope en 5/min, salen 5 y los otros 7 no (salieron ${aDuena})`);
            check(avisos.length === 1, `un solo aviso a los admins de sistema (${avisos.length})`);
            check(!enviados.some((m) => m.to === DUENA && /Freno de mensajes/.test(m.c)), 'el aviso nunca va al número frenado (aunque sea admin)');
            delete process.env.OUTBOUND_MAX_PER_MINUTE;
        }
    } catch (e) {
        failures++;
        console.log('❌ excepción:', e.stack || e.message);
    }
    console.log(`\n${passed} pasaron, ${failures} fallaron`);
    process.exit(failures ? 1 : 0);
})();
