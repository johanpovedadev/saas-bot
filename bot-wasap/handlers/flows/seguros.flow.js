'use strict';

const axios = require('axios');
const PHASE = require('../../utils/phases');
const { say, sendImage } = require('../../services/bot_core');
const { logger } = require('../../utils/logger');
const envConfig = require('../../config/env.loader');
const notificationService = require('../../services/notificationService');

const INSURANCE_PHASES = [
    PHASE.INS_SALUDO,
    PHASE.INS_FLUJO_GATO,
    PHASE.INS_FLUJO_PERRO,
    PHASE.INS_FLUJO_PERRO_PREMIUM,
    PHASE.INS_DATOS_TITULAR,
    PHASE.INS_DATOS_MASCOTA,
    PHASE.INS_CONFIRMACION,
    PHASE.INS_PAGO,
    PHASE.INS_FINAL
];

function isInsurancePhase(phase) {
    return INSURANCE_PHASES.includes(phase);
}

async function handle(sock, jid, text, userSession, ctx) {
    const phase = userSession.phase;
    const t = (text || '').trim().toLowerCase();

    logger.info(`[${jid}] Seguros flow | Fase: ${phase} | Msg: "${text?.substring(0, 50)}"`);

    switch (phase) {
        case PHASE.INS_SALUDO:
            return await handleSaludo(sock, jid, t, userSession, ctx);
        case PHASE.INS_FLUJO_GATO:
            return await handleFlujoGato(sock, jid, t, userSession, ctx);
        case PHASE.INS_FLUJO_PERRO:
            return await handleFlujoPerro(sock, jid, t, userSession, ctx);
        case PHASE.INS_FLUJO_PERRO_PREMIUM:
            return await handleFlujoPerroPremium(sock, jid, t, userSession, ctx);
        case PHASE.INS_DATOS_TITULAR:
            return await handleDatosTitular(sock, jid, text, userSession, ctx);
        case PHASE.INS_DATOS_MASCOTA:
            return await handleDatosMascota(sock, jid, text, userSession, ctx);
        case PHASE.INS_CONFIRMACION:
            return await handleConfirmacion(sock, jid, t, userSession, ctx);
        case PHASE.INS_PAGO:
            return await handlePago(sock, jid, t, userSession, ctx);
        case PHASE.INS_FINAL:
            return await handleFinal(sock, jid, t, userSession, ctx);
        default:
            userSession.phase = PHASE.INS_SALUDO;
            await showWelcome(sock, jid, ctx);
    }
}

async function showWelcome(sock, jid, ctx) {
    const flow = envConfig.bot?.insuranceFlow;
    const msg = flow?.messages?.gato
        ? envConfig.bot.welcomeMessage
        : `🐾 Hola, bienvenido

Sabemos que tu mascota es parte de tu familia ❤️
Aquí puedes protegerla fácil, rápido y sin complicaciones.

¿A quién quieres cuidar hoy?

1️⃣ Perro 🐶
2️⃣ Gato 🐱`;
    await say(sock, jid, msg, ctx);
}

async function handleSaludo(sock, jid, t, userSession, ctx) {
    userSession.errorCount = 0;

    if (t === '1' || t.includes('perro')) {
        userSession.phase = PHASE.INS_FLUJO_PERRO;
        userSession.tipoMascota = 'perro';
        return await handleFlujoPerro(sock, jid, t, userSession, ctx);
    }

    if (t === '2' || t.includes('gato')) {
        userSession.phase = PHASE.INS_FLUJO_GATO;
        userSession.tipoMascota = 'gato';
        return await handleFlujoGato(sock, jid, t, userSession, ctx);
    }

    userSession.errorCount++;
    await say(sock, jid, `❌ Opción no válida

Por favor selecciona una opción del menú.

1️⃣ Perro 🐶
2️⃣ Gato 🐱`, ctx);
}

async function handleFlujoGato(sock, jid, t, userSession, ctx) {
    const flow = envConfig.bot?.insuranceFlow;

    // Primera vez: mostrar imagen + opciones
    if (!userSession._gatoOpcionMostrada) {
        try {
            if (flow?.images?.gato) {
                await sendImage(sock, jid, flow.images.gato, '', ctx);
            }
        } catch (e) {
            logger.warn(`[${jid}] No se pudo enviar imagen gato: ${e.message}`);
        }

        const msg = flow?.messages?.gato || `🐱 Protección para tu gato en todo momento

✨ Atención veterinaria
✨ Cobertura por accidentes
✨ Asistencia exequial

¿Deseas continuar?

1️⃣ Sí, continuar`;

        await say(sock, jid, msg, ctx);
        userSession.phase = PHASE.INS_FLUJO_GATO;
        userSession.planSeleccionado = 'Gato';
        userSession._gatoOpcionMostrada = true;
        return;
    }

    // Procesar respuesta
    if (t === '1' || /^(si|sí|continuar|dale|ok)$/i.test(t)) {
        delete userSession._gatoOpcionMostrada;
        userSession.datosTitular = {};
        userSession.pasoDatos = 0;
        userSession.phase = PHASE.INS_DATOS_TITULAR;
        setTimeout(() => handleDatosTitularStep(sock, jid, userSession, ctx), 1000);
        return;
    }

    userSession.errorCount++;
    await say(sock, jid, `❌ Opción no válida

1️⃣ Sí, continuar`, ctx);
}

async function handleFlujoPerro(sock, jid, t, userSession, ctx) {
    const flow = envConfig.bot?.insuranceFlow;

    // Primera vez en esta fase: mostrar imagen + opciones
    if (!userSession._perroOpcionMostrada) {
        try {
            if (flow?.images?.perroPlus) {
                await sendImage(sock, jid, flow.images.perroPlus, '', ctx);
            }
        } catch (e) {
            logger.warn(`[${jid}] No se pudo enviar imagen perro plus: ${e.message}`);
        }

        const msg = flow?.messages?.perroPlus || `🐶 Plan PLUS

Protección esencial para tu compañero de vida 🐾

1️⃣ Elegir este plan
2️⃣ Ver plan PREMIUM`;

        await say(sock, jid, msg, ctx);
        userSession.phase = PHASE.INS_FLUJO_PERRO;
        userSession.planSeleccionado = 'PLUS';
        userSession._perroOpcionMostrada = true;
        return;
    }

    // Ya mostramos opciones, procesar selección
    if (t === '1' || t.includes('elegir') || t.includes('plus')) {
        userSession.planSeleccionado = userSession.tipo === 'premium' ? 'PREMIUM' : 'PLUS';
        delete userSession._perroOpcionMostrada;
        userSession.phase = PHASE.INS_DATOS_TITULAR;
        userSession.datosTitular = {};
        userSession.pasoDatos = 0;
        setTimeout(() => handleDatosTitularStep(sock, jid, userSession, ctx), 1000);
        return;
    }
    if (t === '2' || t.includes('premium') || t.includes('premiun')) {
        userSession.tipo = 'premium';
        userSession.planSeleccionado = 'PREMIUM';
        userSession.phase = PHASE.INS_FLUJO_PERRO_PREMIUM;
        delete userSession._perroOpcionMostrada;
        return await handleFlujoPerroPremium(sock, jid, t, userSession, ctx);
    }

    userSession.errorCount++;
    await say(sock, jid, `❌ Opción no válida

1️⃣ Elegir este plan
2️⃣ Ver plan PREMIUM`, ctx);
}

async function handleFlujoPerroPremium(sock, jid, t, userSession, ctx) {
    const flow = envConfig.bot?.insuranceFlow;

    if (!userSession._premiumOpcionMostrada) {
        try {
            if (flow?.images?.perroPremium) {
                await sendImage(sock, jid, flow.images.perroPremium, '', ctx);
            }
        } catch (e) {
            logger.warn(`[${jid}] No se pudo enviar imagen perro premium: ${e.message}`);
        }

        const msg = flow?.messages?.perroPremium || `🐶 Plan PREMIUM

Máxima protección para quien más quieres ❤️

1️⃣ Elegir este plan`;

        await say(sock, jid, msg, ctx);
        userSession.phase = PHASE.INS_FLUJO_PERRO_PREMIUM;
        userSession.planSeleccionado = 'PREMIUM';
        userSession._premiumOpcionMostrada = true;
        return;
    }

    if (t === '1' || t.includes('elegir') || t.includes('premium')) {
        userSession.planSeleccionado = 'PREMIUM';
        delete userSession._premiumOpcionMostrada;
        userSession.phase = PHASE.INS_DATOS_TITULAR;
        userSession.datosTitular = {};
        userSession.pasoDatos = 0;
        setTimeout(() => handleDatosTitularStep(sock, jid, userSession, ctx), 1000);
        return;
    }

    userSession.errorCount++;
    await say(sock, jid, `❌ Opción no válida

1️⃣ Elegir este plan`, ctx);
}

const DATOS_TITULAR_PREGUNTAS = [
    { field: 'nombre', label: 'nombre completo', ask: true },
    { field: 'tipoDocumento', label: 'tipo de documento', ask: true },
    { field: 'numeroDocumento', label: 'número de identificación', ask: true },
    { field: 'fechaExpedicion', label: 'fecha de expedición', ask: true },
    { field: 'ciudad', label: 'ciudad', ask: true },
    { field: 'direccion', label: 'dirección', ask: true },
    { field: 'contacto', label: 'número de contacto', ask: true },
    { field: 'email', label: 'correo electrónico', ask: true }
];

const DATOS_MASCOTA_PREGUNTAS = [
    { field: 'nombreMascota', label: 'nombre de la mascota', ask: true },
    { field: 'anioNacimiento', label: 'año de nacimiento', ask: true },
    { field: 'raza', label: 'raza', ask: true },
    { field: 'color', label: 'color', ask: true },
    { field: 'genero', label: 'género', ask: true }
];

function getMensajeDato(field) {
    const flow = envConfig.bot?.insuranceFlow?.messages;
    if (!flow) return null;

    const map = {
        nombre: flow.datosTitular,
        tipoDocumento: flow.datosTitularDocumento,
        numeroDocumento: flow.datosTitularNumero,
        fechaExpedicion: flow.datosTitularFechaExp,
        ciudad: flow.datosTitularCiudad,
        direccion: flow.datosTitularDireccion,
        contacto: flow.datosTitularContacto,
        email: flow.datosTitularEmail,
        nombreMascota: flow.datosMascotaNombre,
        anioNacimiento: flow.datosMascotaEdad,
        raza: flow.datosMascotaRaza,
        color: flow.datosMascotaColor,
        genero: flow.datosMascotaGenero
    };
    return map[field] || null;
}

async function handleDatosTitularStep(sock, jid, userSession, ctx) {
    const paso = userSession.pasoDatos || 0;
    if (paso >= DATOS_TITULAR_PREGUNTAS.length) {
        userSession.phase = PHASE.INS_DATOS_MASCOTA;
        userSession.pasoDatos = 0;
        userSession.datosMascota = {};
        setTimeout(() => handleDatosMascotaStep(sock, jid, userSession, ctx), 1000);
        return;
    }

    const pregunta = DATOS_TITULAR_PREGUNTAS[paso];
    const msg = getMensajeDato(pregunta.field) || `✍️ ¿Cuál es tu ${pregunta.label}?`;
    await say(sock, jid, msg, ctx);
}

async function handleDatosTitular(sock, jid, text, userSession, ctx) {
    const paso = userSession.pasoDatos || 0;

    if (paso > 0 || userSession.datosTitular?.nombre) {
        const pregunta = DATOS_TITULAR_PREGUNTAS[paso - 1];
        if (pregunta) {
            userSession.datosTitular[pregunta.field] = text.trim();
        }
    }

    if (paso === 0 && !userSession.datosTitular?.nombre) {
        userSession.datosTitular.nombre = text.trim();
        userSession.pasoDatos = 1;
    } else {
        userSession.pasoDatos = paso + 1;
    }

    setTimeout(() => handleDatosTitularStep(sock, jid, userSession, ctx), 1000);
}

async function handleDatosMascotaStep(sock, jid, userSession, ctx) {
    const paso = userSession.pasoDatos || 0;
    if (paso >= DATOS_MASCOTA_PREGUNTAS.length) {
        userSession.phase = PHASE.INS_CONFIRMACION;
        await mostrarConfirmacion(sock, jid, userSession, ctx);
        return;
    }

    const pregunta = DATOS_MASCOTA_PREGUNTAS[paso];
    const msg = getMensajeDato(pregunta.field) || `🐾 ¿Cuál es el ${pregunta.label}?`;
    await say(sock, jid, msg, ctx);
}

async function handleDatosMascota(sock, jid, text, userSession, ctx) {
    const paso = userSession.pasoDatos || 0;

    if (paso > 0 || userSession.datosMascota?.nombreMascota) {
        const pregunta = DATOS_MASCOTA_PREGUNTAS[paso - 1];
        if (pregunta) {
            if (pregunta.field === 'genero') {
                const t = text.trim().toLowerCase();
                userSession.datosMascota.genero = t === '1' || t.includes('macho') ? 'Macho' : 'Hembra';
            } else {
                userSession.datosMascota[pregunta.field] = text.trim();
            }
        }
    }

    if (paso === 0 && !userSession.datosMascota?.nombreMascota) {
        userSession.datosMascota.nombreMascota = text.trim();
        userSession.pasoDatos = 1;
    } else {
        userSession.pasoDatos = paso + 1;
    }

    setTimeout(() => handleDatosMascotaStep(sock, jid, userSession, ctx), 1000);
}

async function mostrarConfirmacion(sock, jid, userSession, ctx) {
    const flow = envConfig.bot?.insuranceFlow?.messages;
    const template = flow?.confirmacion || `💛 Ya casi terminamos

Confirma tu información:

👤 {nombre}
🐾 {mascota}
📦 {plan}

1️⃣ Confirmar
2️⃣ Corregir`;

    const msg = template
        .replace('{nombre}', userSession.datosTitular?.nombre || '___')
        .replace('{mascota}', userSession.datosMascota?.nombreMascota || '___')
        .replace('{plan}', userSession.planSeleccionado || '___');

    await say(sock, jid, msg, ctx);
    userSession.phase = PHASE.INS_CONFIRMACION;
}

async function handleConfirmacion(sock, jid, t, userSession, ctx) {
    if (t === '1' || /^(si|sí|confirmar|confirmo|correcto|ok|dale)$/i.test(t)) {
        const flow = envConfig.bot?.insuranceFlow?.messages;
        const msg = flow?.pago || `✨ Estás a un paso de proteger a quien amas

Realiza tu pago aquí:

https://www.segurosmundial.com.co/pagos/

Cuando termines escribe:
LISTO`;

        await say(sock, jid, msg, ctx);
        userSession.phase = PHASE.INS_PAGO;
        return;
    }

    if (t === '2' || /^(no|corregir|editar|modificar)$/i.test(t)) {
        userSession.phase = PHASE.INS_DATOS_TITULAR;
        userSession.pasoDatos = 0;
        userSession.datosTitular = {};
        userSession.datosMascota = {};
        setTimeout(() => handleDatosTitularStep(sock, jid, userSession, ctx), 500);
        return;
    }

    userSession.errorCount++;
    await say(sock, jid, `❌ Opción no válida

1️⃣ Confirmar
2️⃣ Corregir`, ctx);
}

async function handlePago(sock, jid, t, userSession, ctx) {
    if (t === 'listo' || t.includes('listo') || t.includes('pague') || t.includes('pagado') || t.includes('ya')) {
        const flow = envConfig.bot?.insuranceFlow?.messages;
        const msg = flow?.final || `🎉 ¡Listo!

Tu solicitud fue registrada 💛

Un asesor validará tu pago y te enviará la póliza.

Gracias por cuidar a tu compañero de vida 🐾`;

        // Enviar datos al backend (Google Sheets - Domicilios)
        try {
            const dt = userSession.datosTitular || {};
            const dm = userSession.datosMascota || {};
            const plan = userSession.planSeleccionado || '';
            const tipoMascota = userSession.tipoMascota || '';

            const productoTexto = `Plan ${plan} - ${tipoMascota === 'gato' ? 'Gato' : 'Perro'}` +
                (dm.nombreMascota ? ` (${dm.nombreMascota})` : '');

            const observacionesTexto = JSON.stringify({
                titular: dt,
                mascota: dm,
                plan: plan,
                tipoMascota: tipoMascota
            }, null, 2);

            const payload = {
                nombre: dt.nombre || '',
                producto: productoTexto,
                codigo: plan,
                telefono: dt.contacto || '',
                direccion: dt.direccion || '',
                monto: 0,
                pago: 'Transferencia',
                estado: 'Por despachar',
                observaciones: observacionesTexto,
                referido_por: '',
                cliente_jid: jid
            };

            const baseUrl = (envConfig.backend.apiBase || 'http://127.0.0.1:8001').replace(/\/+$/, '');
            const url = baseUrl.includes('/api') ? `${baseUrl}/registrar_entrega/` : `${baseUrl}/api/registrar_entrega/`;

            logger.info(`[${jid}] Enviando solicitud seguro al backend: ${url}`);
            const resp = await axios.post(url, payload, { timeout: 10000 });
            logger.info(`[${jid}] Backend respondió: ${resp.status}`);

            // Notificar admins
            await notificationService.notifyAdminsNewOrder(sock, jid, payload, 0, ctx);
        } catch (e) {
            logger.error(`[${jid}] Error al registrar solicitud seguro: ${e.message}`);
            // No bloquear al usuario, solo loggear
        }

        await say(sock, jid, msg, ctx);
        userSession.phase = PHASE.INS_FINAL;
        return;
    }

    await say(sock, jid, `Cuando hayas realizado el pago, escribe:
LISTO`, ctx);
}

async function handleFinal(sock, jid, t, userSession, ctx) {
    await say(sock, jid, `Tu solicitud ya fue registrada 💛

Un asesor se comunicará contigo pronto.

Gracias por cuidar a tu compañero de vida 🐾`, ctx);
}

async function handleUnknown(sock, jid, text, userSession, ctx) {
    userSession.phase = PHASE.INS_SALUDO;
    await showWelcome(sock, jid, ctx);
}

module.exports = {
    isInsurancePhase,
    handle,
    handleUnknown,
    showWelcome,
    INSURANCE_PHASES
};
