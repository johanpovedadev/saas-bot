'use strict';
/**
 * Mensajes de seguimiento a usuarios reales de Leo que quedaron atascados en
 * el onboarding, pedido y confirmado por Johan. Usa el token propio de Leo
 * (TELEGRAM_BOT_TOKEN, no HERMES_BOT_TOKEN de Jarvis) via la API HTTP directa
 * de Telegram - un simple POST, sin levantar una instancia de polling nueva,
 * asi que no compite con el proceso de bot-finance-telegram ya corriendo.
 * Uso: node scripts/send_finance_followups.js
 */
process.env.BUSINESS_KEY = 'finance';
require('../config/env.loader');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TOKEN) { console.error('Falta TELEGRAM_BOT_TOKEN'); process.exit(1); }

const MSG_DIAGNOSTICO = (nombre) =>
    `🦁 ¡Hola de nuevo${nombre ? `, *${nombre}*` : ''}! Vi que te quedaste en la pregunta de qué querés lograr con tus finanzas. Ya lo mejoré: ahora podés responder con el número (1, 2, 3 o 4), la letra (A, B, C o D), o directamente la palabra — por ejemplo *"ahorrar"*, *"deudas"*, *"control"* u *"organizarme"*. ¿Seguimos? 🙌`;

const MSG_META = (nombre) =>
    `🦁 ¡Hola *${nombre}*! Quedamos justo antes de la última pregunta: ¿para qué te gustaría ahorrar? Puede ser un viaje, salir de una deuda, lo que sea — contame corto y armamos el camino juntos. Cuando quieras, seguimos donde quedamos 🙌`;

const MSG_NUNCA_USO = (nombre) =>
    `🦁 ¡Hola *${nombre}*! Ya quedaste listo en Leo, solo falta que registres tu primer movimiento para empezar a ver para dónde se va tu plata. Podés escribirme algo como *"Compré 15 mil en almuerzo"* o *"Recibí 500 mil de sueldo"* — así de fácil 😉`;

const RECIPIENTS = [
    // Grupo 1 - atascados en la pregunta de diagnostico
    { chatId: '5802323886', nombre: 'Benja', msg: MSG_DIAGNOSTICO('Benja') },
    { chatId: '731558012', nombre: 'Ale', msg: MSG_DIAGNOSTICO('Ale') },
    { chatId: '5307355836', nombre: 'Peter', msg: MSG_DIAGNOSTICO('Peter') },
    { chatId: '8361044325', nombre: '(sin nombre real)', msg: MSG_DIAGNOSTICO(null) },
    // Grupo 2 - contestaron diagnostico, nunca dieron su meta
    { chatId: '2074009996', nombre: 'Luis', msg: MSG_META('Luis') },
    { chatId: '7137585078', nombre: 'Julian', msg: MSG_META('Julian') },
    { chatId: '7513306801', nombre: 'Brigitte', msg: MSG_META('Brigitte') },
    // Grupo 3 - terminaron onboarding, nunca registraron nada
    { chatId: '8025517133', nombre: 'Luis', msg: MSG_NUNCA_USO('Luis') },
    { chatId: '5207524728', nombre: 'Luis Fernando', msg: MSG_NUNCA_USO('Luis Fernando') },
    { chatId: '8592441011', nombre: 'Jorge', msg: MSG_NUNCA_USO('Jorge') },
    { chatId: '1140654820', nombre: 'Felipe', msg: MSG_NUNCA_USO('Felipe') },
    { chatId: '6443185114', nombre: 'Liliana', msg: MSG_NUNCA_USO('Liliana') }
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function sendOne(chatId, text) {
    const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: String(chatId), text, parse_mode: 'Markdown' })
    });
    const data = await res.json();
    return data;
}

(async () => {
    let ok = 0, fail = 0;
    for (const r of RECIPIENTS) {
        try {
            const data = await sendOne(r.chatId, r.msg);
            if (data.ok) {
                ok++;
                console.log(`OK  -> ${r.nombre} (${r.chatId})`);
            } else {
                fail++;
                console.log(`FAIL -> ${r.nombre} (${r.chatId}): ${data.description}`);
            }
        } catch (e) {
            fail++;
            console.log(`FAIL -> ${r.nombre} (${r.chatId}): ${e.message}`);
        }
        // Espaciado entre envios para no verse como spam masivo instantaneo.
        await sleep(1500);
    }
    console.log(`\nTotal: ${ok} enviados, ${fail} fallidos de ${RECIPIENTS.length}.`);
})();
