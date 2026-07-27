'use strict';

const axios = require('axios');
const PHASE = require('../../utils/phases');
const { say, sendImage } = require('../../services/bot_core');
const { logger } = require('../../utils/logger');
const envConfig = require('../../config/env.loader');
const notificationService = require('../../services/notificationService');
const writeQueue = require('../../services/writeQueue');

const INSURANCE_PHASES = [
    PHASE.INS_SALUDO,
    PHASE.INS_FLUJO_GATO,
    PHASE.INS_FLUJO_PERRO,
    PHASE.INS_FLUJO_PERRO_PREMIUM,
    PHASE.INS_DATOS_TITULAR,
    PHASE.INS_DATOS_MASCOTA,
    PHASE.INS_CONFIRMACION,
    PHASE.INS_RECHAZO,
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
        case PHASE.INS_RECHAZO:
            return await handleRechazo(sock, jid, t, userSession, ctx);
        case PHASE.INS_FINAL:
            return await handleFinal(sock, jid, t, userSession, ctx);
        default:
            userSession.phase = PHASE.INS_SALUDO;
            await showWelcome(sock, jid, ctx);
    }
}

// ===================================
// ISSUE #1 — Mensaje de bienvenida
// ===================================
async function showWelcome(sock, jid, ctx) {
    const msg = envConfig.bot.welcomeMessage || `🐾 Hola, bienvenido a ${envConfig.business.name}\n\n¿A quién deseas proteger hoy?\n\n1️⃣ Perro 🐶\n2️⃣ Gato 🐱`;
    await say(sock, jid, msg, ctx);
}

async function handleSaludo(sock, jid, t, userSession, ctx) {
    if (t === '1' || t.includes('perro')) {
        userSession.errorCount = 0;
        userSession.phase = PHASE.INS_FLUJO_PERRO;
        userSession.tipoMascota = 'perro';
        return await handleFlujoPerro(sock, jid, t, userSession, ctx);
    }

    if (t === '2' || t.includes('gato')) {
        userSession.errorCount = 0;
        userSession.phase = PHASE.INS_FLUJO_GATO;
        userSession.tipoMascota = 'gato';
        return await handleFlujoGato(sock, jid, t, userSession, ctx);
    }

    userSession.errorCount = (userSession.errorCount || 0) + 1;
    await say(sock, jid, `❌ Opción no válida

Por favor selecciona una opción del menú.

1️⃣ Perro 🐶
2️⃣ Gato 🐱`, ctx);
}

// ===================================
// ISSUE #2 — Imágenes + precios en planes
// ===================================
async function handleFlujoGato(sock, jid, t, userSession, ctx) {
    const flow = envConfig.bot?.insuranceFlow;

    if (!userSession._gatoOpcionMostrada) {
        try {
            if (flow?.images?.gato) {
                await sendImage(sock, jid, flow.images.gato, '', ctx);
            }
        } catch (e) {
            logger.warn(`[${jid}] No se pudo enviar imagen gato: ${e.message}`);
        }

        const msg = flow?.messages?.gato || `🐱 *Plan Gatos*

💰 Valor anual: $200.900

📅 Vigencia: 1 año

✅ Protección especializada para gatos
✅ Cobertura veterinaria
✅ Cobertura por accidentes
✅ Asistencia exequial

1️⃣ Elegir este plan
2️⃣ Volver al menu`;

        await say(sock, jid, msg, ctx);
        userSession.phase = PHASE.INS_FLUJO_GATO;
        userSession.planSeleccionado = 'Gato';
        userSession._gatoOpcionMostrada = true;
        return;
    }

    if (t === '1' || /^(si|sí|continuar|dale|ok|elegir)$/i.test(t)) {
        delete userSession._gatoOpcionMostrada;
        userSession.errorCount = 0;
        userSession.datosTitular = {};
        userSession.pasoDatos = 0;
        userSession._titularStepId = (userSession._titularStepId || 0) + 1;
        const stepId = userSession._titularStepId;
        userSession.phase = PHASE.INS_DATOS_TITULAR;
        setTimeout(() => {
            if (userSession._titularStepId === stepId) handleDatosTitularStep(sock, jid, userSession, ctx);
        }, 1000);
        return;
    }

    if (t === '2' || t.includes('volver') || t.includes('menu')) {
        delete userSession._gatoOpcionMostrada;
        userSession.planSeleccionado = null;
        userSession.phase = PHASE.INS_SALUDO;
        setTimeout(() => showWelcome(sock, jid, ctx), 1000);
        return;
    }

    userSession.errorCount++;
    await say(sock, jid, `❌ Opción no válida

1️⃣ Elegir este plan
2️⃣ Volver al menu`, ctx);
}

async function handleFlujoPerro(sock, jid, t, userSession, ctx) {
    const flow = envConfig.bot?.insuranceFlow;

    if (!userSession._perroOpcionMostrada) {
        try {
            if (flow?.images?.perroPlus) {
                await sendImage(sock, jid, flow.images.perroPlus, '', ctx);
            }
        } catch (e) {
            logger.warn(`[${jid}] No se pudo enviar imagen perro plus: ${e.message}`);
        }

        const msg = flow?.messages?.perroPlus || `🐶 *Plan PLUS*

💰 Valor anual: $259.900

📅 Vigencia: 1 año

✅ Cubrimiento veterinario básico
✅ Cobertura por accidentes
✅ Asistencia exequial

1️⃣ Elegir este plan
2️⃣ Ver plan PREMIUM`;

        await say(sock, jid, msg, ctx);
        userSession.phase = PHASE.INS_FLUJO_PERRO;
        userSession.planSeleccionado = 'PLUS';
        userSession._perroOpcionMostrada = true;
        return;
    }

    if (t === '1' || t.includes('elegir') || t.includes('plus')) {
        userSession.planSeleccionado = userSession.tipo === 'premium' ? 'PREMIUM' : 'PLUS';
        delete userSession._perroOpcionMostrada;
        userSession.errorCount = 0;
        userSession.phase = PHASE.INS_DATOS_TITULAR;
        userSession.datosTitular = {};
        userSession.pasoDatos = 0;
        userSession._titularStepId = (userSession._titularStepId || 0) + 1;
        const stepId = userSession._titularStepId;
        setTimeout(() => {
            if (userSession._titularStepId === stepId) handleDatosTitularStep(sock, jid, userSession, ctx);
        }, 1000);
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

        const msg = flow?.messages?.perroPremium || `🐶 *Plan PREMIUM*

💰 Valor anual: $354.900

📅 Vigencia: 1 año

✅ Cobertura ampliada
✅ Mayor protección veterinaria
✅ Cobertura por accidentes
✅ Asistencia exequial

1️⃣ Elegir este plan
2️⃣ Volver a planes`;

        await say(sock, jid, msg, ctx);
        userSession.phase = PHASE.INS_FLUJO_PERRO_PREMIUM;
        userSession.planSeleccionado = 'PREMIUM';
        userSession._premiumOpcionMostrada = true;
        return;
    }

    if (t === '1' || t.includes('elegir') || t.includes('premium')) {
        userSession.planSeleccionado = 'PREMIUM';
        delete userSession._premiumOpcionMostrada;
        userSession.errorCount = 0;
        userSession.phase = PHASE.INS_DATOS_TITULAR;
        userSession.datosTitular = {};
        userSession.pasoDatos = 0;
        userSession._titularStepId = (userSession._titularStepId || 0) + 1;
        const stepId = userSession._titularStepId;
        setTimeout(() => {
            if (userSession._titularStepId === stepId) handleDatosTitularStep(sock, jid, userSession, ctx);
        }, 1000);
        return;
    }

    if (t === '2' || t.includes('volver') || t.includes('planes')) {
        delete userSession._premiumOpcionMostrada;
        delete userSession._perroOpcionMostrada;
        delete userSession.tipo;
        userSession.phase = PHASE.INS_FLUJO_PERRO;
        return await handleFlujoPerro(sock, jid, t, userSession, ctx);
    }

    userSession.errorCount++;
    await say(sock, jid, `❌ Opción no válida

1️⃣ Elegir este plan
2️⃣ Volver a planes`, ctx);
}

// ===================================
// ISSUE #9 — Preguntas (8 titular + 5 mascota)
// ISSUE #4 — Tipo documento enumerado
// ISSUE #5 — Fecha nacimiento DD/MM/YYYY
// ISSUE #6 — Ciudad + departamento
// ===================================
const DATOS_TITULAR_PREGUNTAS = [
    { field: 'nombre', label: 'nombre completo', ask: true },
    { field: 'tipoDocumento', label: 'tipo de documento (1=Cédula, 2=NIT, 3=Tarjeta, 4=Extranjería)', ask: true },
    { field: 'numeroDocumento', label: 'número de identificación', ask: true },
    { field: 'fechaNacimiento', label: 'fecha de nacimiento (DD/MM/YYYY)', ask: true },
    { field: 'ciudad', label: 'ciudad y departamento', ask: true },
    { field: 'direccion', label: 'dirección de residencia', ask: true },
    { field: 'contacto', label: 'número de celular', ask: true },
    { field: 'correo', label: 'correo electrónico', ask: true }
];

const DATOS_MASCOTA_PREGUNTAS = [
    { field: 'nombreMascota', label: 'nombre de la mascota', ask: true },
    { field: 'edadMascota', label: 'edad de la mascota (solo números)', ask: true },
    { field: 'raza', label: 'raza', ask: true },
    { field: 'color', label: 'color del pelaje', ask: true },
    { field: 'genero', label: 'género (1=Macho, 2=Hembra)', ask: true }
];

function getMensajeDato(field) {
    const flow = envConfig.bot?.insuranceFlow?.messages;
    if (!flow) return null;

    const map = {
        nombre: flow.datosTitularNombre,
        tipoDocumento: flow.datosTitularDocumento,
        numeroDocumento: flow.datosTitularNumero,
        fechaNacimiento: flow.datosTitularFechaNacimiento,
        ciudad: flow.datosTitularCiudad,
        direccion: flow.datosTitularDireccion,
        contacto: flow.datosTitularContacto,
        correo: flow.datosTitularCorreo,
        nombreMascota: flow.datosMascotaNombre,
        edadMascota: flow.datosMascotaEdad,
        raza: flow.datosMascotaRaza,
        color: flow.datosMascotaColor,
        genero: flow.datosMascotaGenero
    };
    return map[field] || null;
}

// ===================================
// ISSUE #4 — Tipo documento enumerado
// ===================================
function normalizarTipoDocumento(input) {
    const t = input.trim().toLowerCase();
    if (t === '1' || t.includes('cedula') || t === 'cc') return 'Cedula de Ciudadania';
    if (t === '2' || t.includes('nit')) return 'NIT';
    if (t === '3' || t.includes('tarjeta') || t === 'ti') return 'Tarjeta de Identidad';
    if (t === '4' || t.includes('extranjeria') || t.includes('extranjeria')) return 'Cedula de Extranjeria';
    return input.trim();
}

function normalizarGenero(input) {
    const t = input.trim().toLowerCase();
    if (t === '1' || t.includes('macho') || t === 'm') return 'Macho';
    if (t === '2' || t.includes('hembra') || t === 'h') return 'Hembra';
    return input.trim();
}

// ===================================
// ISSUE #5 — Validar fecha DD/MM/YYYY
// ===================================
function validarFecha(text) {
    const limpio = text.trim();
    const regex = /^(\d{2})\/(\d{2})\/(\d{4})$/;
    const match = limpio.match(regex);
    if (!match) return false;
    const dia = parseInt(match[1], 10);
    const mes = parseInt(match[2], 10);
    const anio = parseInt(match[3], 10);
    if (mes < 1 || mes > 12) return false;
    if (anio < 1900 || anio > new Date().getFullYear()) return false;
    const diasPorMes = [31, (anio % 4 === 0 && (anio % 100 !== 0 || anio % 400 === 0)) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (dia < 1 || dia > diasPorMes[mes - 1]) return false;
    return true;
}

// ===================================
// ISSUE #7 — Validar edad mascota
// ===================================
function validarEdadMascota(text) {
    const limpio = text.trim();
    const edad = parseInt(limpio, 10);
    if (isNaN(edad) || edad < 0 || edad > 50) return null;
    return edad;
}

// ===================================
// DATOS TITULAR
// ===================================
async function handleDatosTitularStep(sock, jid, userSession, ctx) {
    const paso = userSession.pasoDatos || 0;
    if (paso >= DATOS_TITULAR_PREGUNTAS.length) {
        userSession.phase = PHASE.INS_DATOS_MASCOTA;
        userSession.pasoDatos = 0;
        userSession.datosMascota = {};
        userSession._mascotaStepId = (userSession._mascotaStepId || 0) + 1;
        const stepId = userSession._mascotaStepId;
        setTimeout(() => {
            if (userSession._mascotaStepId === stepId) handleDatosMascotaStep(sock, jid, userSession, ctx);
        }, 1000);
        return;
    }

    const pregunta = DATOS_TITULAR_PREGUNTAS[paso];

    // ISSUE #4 — Para tipoDocumento mostrar el mensaje enumerado
    if (pregunta.field === 'tipoDocumento') {
        const msg = getMensajeDato('tipoDocumento') || `📄 ¿Qué tipo de documento tienes?\n\n1️⃣ Cédula de Ciudadanía\n2️⃣ NIT\n3️⃣ Tarjeta de Identidad\n4️⃣ Cédula de Extranjería`;
        await say(sock, jid, msg, ctx);
        return;
    }

    const msg = getMensajeDato(pregunta.field) || `✍️ ¿Cuál es tu ${pregunta.label}?`;
    await say(sock, jid, msg, ctx);
}

async function handleDatosTitular(sock, jid, text, userSession, ctx) {
    const paso = userSession.pasoDatos || 0;
    const valor = text.trim();
    const pregunta = DATOS_TITULAR_PREGUNTAS[paso];

    if (pregunta) {
        if (pregunta.field === 'tipoDocumento') {
            userSession.datosTitular.tipoDocumento = normalizarTipoDocumento(valor);
        } else if (pregunta.field === 'fechaNacimiento') {
            if (!validarFecha(valor)) {
                userSession.errorCount = (userSession.errorCount || 0) + 1;
                await say(sock, jid, `❌ Formato inválido. Por favor escribe la fecha así: DD/MM/YYYY

Ejemplo: 15/03/1990`, ctx);
                return;
            }
            userSession.datosTitular.fechaNacimiento = valor;
        } else {
            userSession.datosTitular[pregunta.field] = valor;
        }
    }

    userSession.errorCount = 0;
    userSession.pasoDatos = paso + 1;
    userSession._titularStepId = (userSession._titularStepId || 0) + 1;
    const stepId = userSession._titularStepId;
    setTimeout(() => {
        if (userSession._titularStepId === stepId) handleDatosTitularStep(sock, jid, userSession, ctx);
    }, 1000);
}

// ===================================
// DATOS MASCOTA
// ===================================
async function handleDatosMascotaStep(sock, jid, userSession, ctx) {
    const paso = userSession.pasoDatos || 0;
    if (paso >= DATOS_MASCOTA_PREGUNTAS.length) {
        // ISSUE #7 — Validar edad mascota antes de confirmación
        const edad = validarEdadMascota(userSession.datosMascota?.edadMascota || '');
        if (edad !== null && edad > 12) {
            userSession.phase = PHASE.INS_RECHAZO;
            await handleRechazo(sock, jid, '', userSession, ctx);
            return;
        }
        userSession.phase = PHASE.INS_CONFIRMACION;
        await mostrarConfirmacion(sock, jid, userSession, ctx);
        return;
    }

    const pregunta = DATOS_MASCOTA_PREGUNTAS[paso];
    let msg;

    if (pregunta.field === 'raza') {
        const tipoMascota = userSession.tipoMascota || userSession.tipoAnimal || '';
        const flowMsgs = envConfig.bot?.insuranceFlow?.messages;
        if (tipoMascota === 'perro') {
            msg = flowMsgs?.datosMascotaRazaPerro || `🦴 ¿Que raza es tu perro?\n\nEjemplos:\n• Labrador\n• Golden Retriever\n• Pastor Aleman\n• Bulldog\n• Criollo\n\n✍️ Puedes escribir cualquier otra raza si no aparece en los ejemplos.`;
        } else {
            msg = flowMsgs?.datosMascotaRazaGato || `🐱 ¿Que raza es tu gato?\n\nEjemplos:\n• Criollo\n• Siamés\n• Persa\n• Angora\n\n✍️ Puedes escribir cualquier otra raza si no aparece en los ejemplos.`;
        }
    } else {
        msg = getMensajeDato(pregunta.field) || `🐾 ¿Cual es ${pregunta.label}?`;
    }

    await say(sock, jid, msg, ctx);
}

async function handleDatosMascota(sock, jid, text, userSession, ctx) {
    const paso = userSession.pasoDatos || 0;
    const valor = text.trim();
    const pregunta = DATOS_MASCOTA_PREGUNTAS[paso];

    if (pregunta) {
        if (pregunta.field === 'edadMascota') {
            const edad = validarEdadMascota(valor);
            if (edad === null) {
                userSession.errorCount = (userSession.errorCount || 0) + 1;
                await say(sock, jid, `❌ Por favor escribe solo números (ej: 3, 5, 8)`, ctx);
                return;
            }
            userSession.datosMascota.edadMascota = String(edad);
        } else if (pregunta.field === 'genero') {
            userSession.datosMascota.genero = normalizarGenero(valor);
        } else {
            userSession.datosMascota[pregunta.field] = valor;
        }
    }

    userSession.errorCount = 0;
    userSession.pasoDatos = paso + 1;
    userSession._mascotaStepId = (userSession._mascotaStepId || 0) + 1;
    const stepId = userSession._mascotaStepId;
    setTimeout(() => {
        if (userSession._mascotaStepId === stepId) handleDatosMascotaStep(sock, jid, userSession, ctx);
    }, 1000);
}

// ===================================
// CONFIRMACIÓN
// ===================================
async function mostrarConfirmacion(sock, jid, userSession, ctx) {
    const flow = envConfig.bot?.insuranceFlow?.messages;
    const template = flow?.confirmacion || `💛 Ya casi terminamos

Confirma tu informacion:

👤 *Titular:*
Nombre: {nombre}
Documento: {documento}
Fecha Nac.: {fechaNac}
Ciudad/Dep: {ciudad}
Direccion: {direccion}
Celular: {contacto}
Email: {correo}

🐾 *Mascota:*
Nombre: {mascota}
Edad: {edad} anos
Raza: {raza}
Color: {color}
Genero: {genero}

📦 *Plan:* {plan}

1️⃣ Confirmar
2️⃣ Corregir`;

    const dt = userSession.datosTitular || {};
    const dm = userSession.datosMascota || {};

    const msg = template
        .replace(/{nombre}/g, dt.nombre || '___')
        .replace(/{documento}/g, `${dt.tipoDocumento || '___'}: ${dt.numeroDocumento || '___'}`)
        .replace(/{fechaNac}/g, dt.fechaNacimiento || '___')
        .replace(/{ciudad}/g, dt.ciudad || '___')
        .replace(/{direccion}/g, dt.direccion || '___')
        .replace(/{contacto}/g, dt.contacto || '___')
        .replace(/{correo}/g, dt.correo || '___')
        .replace(/{mascota}/g, dm.nombreMascota || '___')
        .replace(/{edad}/g, dm.edadMascota || '___')
        .replace(/{raza}/g, dm.raza || '___')
        .replace(/{color}/g, dm.color || '___')
        .replace(/{genero}/g, dm.genero || '___')
        .replace(/{plan}/g, userSession.planSeleccionado || '___');

    await say(sock, jid, msg, ctx);
    userSession.phase = PHASE.INS_CONFIRMACION;
}

async function handleConfirmacion(sock, jid, t, userSession, ctx) {
    if (t === '1' || /^(si|sí|confirmar|confirmo|correcto|ok|dale)$/i.test(t)) {
        userSession.errorCount = 0;
        await guardarSolicitud(sock, jid, userSession, ctx, 'pendiente', '');
        userSession.phase = PHASE.INS_FINAL;
        await handleFinal(sock, jid, '', userSession, ctx);
        return;
    }

    if (t === '2' || /^(no|corregir|editar|modificar)$/i.test(t)) {
        userSession.errorCount = 0;
        userSession.phase = PHASE.INS_DATOS_TITULAR;
        userSession.pasoDatos = 0;
        userSession.datosTitular = {};
        userSession.datosMascota = {};
        userSession._titularStepId = (userSession._titularStepId || 0) + 1;
        const stepId = userSession._titularStepId;
        setTimeout(() => {
            if (userSession._titularStepId === stepId) handleDatosTitularStep(sock, jid, userSession, ctx);
        }, 500);
        return;
    }

    userSession.errorCount++;
    await say(sock, jid, `❌ Opción no válida

1️⃣ Confirmar
2️⃣ Corregir`, ctx);
}

// ===================================
// ISSUE #7 — Rechazo por edad > 12
// ISSUE #8 — Guardar rechazos en Sheets
// ===================================
async function handleRechazo(sock, jid, t, userSession, ctx) {
    if (userSession._rechazoSent) {
        delete userSession._rechazoSent;
        userSession.phase = PHASE.INS_SALUDO;
        await showWelcome(sock, jid, ctx);
        return;
    }
    userSession._rechazoSent = true;

    const msg = envConfig.bot?.insuranceFlow?.messages?.rechazoEdad
        ? envConfig.bot.insuranceFlow.messages.rechazoEdad.replace('{nombre}', userSession.datosTitular?.nombre || '')
        : `😔 Lo sentimos, ${userSession.datosTitular?.nombre || ''}.\n\nActualmente no es posible asegurar mascotas mayores de 12 años.\n\nGracias por comunicarte con ${envConfig.business.name}.`;

    // ISSUE #8 — Guardar rechazo en Google Sheets
    await guardarSolicitud(sock, jid, userSession, ctx, 'rechazado', 'edad mayor a 12 años');

    await say(sock, jid, msg, ctx);
    userSession.phase = PHASE.INS_FINAL;
}

// ===================================
// ISSUE #10, #11 — Guardar solicitud con estados
// ===================================
async function guardarSolicitud(sock, jid, userSession, ctx, status, cancelReason) {
    try {
        const dt = userSession.datosTitular || {};
        const dm = userSession.datosMascota || {};
        const plan = userSession.planSeleccionado || '';
        const tipoMascota = userSession.tipoMascota || '';

        const productoTexto = `Plan ${plan} - ${tipoMascota === 'gato' ? 'Gato' : 'Perro'}` +
            (dm.nombreMascota ? ` (${dm.nombreMascota})` : '');

        const payload = {
            tipoMascota: tipoMascota,
            plan: plan,
            nombreTitular: dt.nombre || '',
            tipoDocumento: dt.tipoDocumento || '',
            numeroDocumento: dt.numeroDocumento || '',
            fechaNacimiento: dt.fechaNacimiento || '',
            ciudadDepartamento: dt.ciudad || '',
            direccion: dt.direccion || '',
            telefono: dt.contacto || '',
            correoElectronico: dt.correo || '',
            nombreMascota: dm.nombreMascota || '',
            edadMascota: dm.edadMascota || '',
            raza: dm.raza || '',
            color: dm.color || '',
            genero: dm.genero || '',
            estado: status,
            motivoCancelacion: cancelReason || '',
            asesor: '',
            observaciones: cancelReason || '',
            cliente_jid: jid
        };

        const baseUrl = (envConfig.backend.apiBase || 'http://127.0.0.1:8001').replace(/\/+$/, '');
        const url = baseUrl.includes('/api') ? `${baseUrl}/registrar_lead/` : `${baseUrl}/api/registrar_lead/`;

        logger.info(`[${jid}] Guardando solicitud (${status}) en backend: ${url}`);
        const result = await writeQueue.enqueue(url, payload, { retries: 3, timeout: 15000 });
        if (result.ok) {
            logger.info(`[${jid}] Backend respondió: ${result.status} - ${status}`);
            logger.info({ jid, status, plan, nombre: dt.nombre }, 'Solicitud registrada en Google Sheets');
        } else {
            logger.error(`[${jid}] Error al guardar en backend (${result.status}): ${result.error}`);
        }

        await notificationService.notifyAdminsNewOrder(sock, jid, payload, 0, ctx);
    } catch (e) {
        logger.error(`[${jid}] Error al guardar solicitud en Sheets: ${e.message}`);
    }
}

// ===================================
// ISSUE #10 — Mensaje final con nombre
// ===================================
async function handleFinal(sock, jid, t, userSession, ctx) {
    if (userSession._finalSent && t) {
        delete userSession._finalSent;
        userSession.phase = PHASE.INS_SALUDO;
        userSession.datosTitular = {};
        userSession.datosMascota = {};
        userSession.planSeleccionado = null;
        userSession.tipoMascota = null;
        userSession.pasoDatos = 0;
        await showWelcome(sock, jid, ctx);
        return;
    }
    if (userSession._finalSent) return;
    userSession._finalSent = true;

    const flow = envConfig.bot?.insuranceFlow?.messages;
    const dt = userSession.datosTitular || {};
    const nombre = dt.nombre || '';

    const msg = flow?.final
        ? flow.final.replace(/{nombre}/g, nombre)
        : `✅ Solicitud registrada exitosamente.

💛 Gracias por confiar en ${envConfig.business.name}.
 
📞 Un asesor se pondrá en contacto contigo para continuar con la validacion y emision de la poliza.`;

    await say(sock, jid, msg, ctx);
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
    INSURANCE_PHASES,
    // Interfaz estándar para flowRegistry
    getInitialPhase: () => PHASE.INS_SALUDO,
    isFlowPhase: (phase) => typeof phase === 'string' && phase.toLowerCase().startsWith('ins_'),
    getPhases: () => INSURANCE_PHASES
};
