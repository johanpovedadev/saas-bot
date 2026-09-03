'use strict';

/**
 * Lista fija de datos de negocio que se preguntan de a uno por día cuando no
 * queda ninguna pregunta real sin responder en la cola (ver
 * services/unansweredQuestionsStore.js) - relleno genérico mientras esa cola
 * está vacía, para ir completando la base de conocimiento del negocio sin un
 * formulario largo. Cada tenant puede reemplazar el orden/campos con la env
 * var ONBOARDING_FIELDS (lista de keys separadas por coma, ej.
 * "contacto,pagos"), mismo patrón que ENCARGO_CATEGORIES.
 *
 * `sheetTab`/`matchLabel` los usa services/sheetsWriter.js#updateConfigField
 * para campos puntuales de la pestaña Configuración; los campos tipo FAQ
 * (kind: 'faq') se agregan como una fila nueva en Preguntas_Frecuentes vía
 * appendFaqRow en vez de buscar una celda existente.
 */

const DEFAULT_FIELDS = [
    {
        key: 'contacto',
        question: '¿Cuál es el teléfono o correo de contacto del negocio (el que le damos a un cliente si necesita hablar con una persona)?',
        kind: 'config',
        sheetTab: 'Configuración',
        matchLabel: 'Teléfono'
    },
    {
        key: 'descuentos',
        question: '¿Manejan algún descuento (por cantidad, por cliente frecuente, etc.)? Si es así, ¿cuál?',
        kind: 'faq',
        faqQuestion: '¿Tienen descuentos?'
    },
    {
        key: 'devoluciones',
        question: '¿Cuál es la política de devoluciones o garantías si un cliente recibe algo en mal estado?',
        kind: 'faq',
        faqQuestion: '¿Cuál es la política de devoluciones o garantías?'
    },
    {
        key: 'pagos',
        question: '¿Qué pasa si un cliente se atrasa con un pago o un domicilio contra entrega? ¿Manejan algún recargo o plazo?',
        kind: 'faq',
        faqQuestion: '¿Qué pasa si me atraso con un pago?'
    },
    {
        key: 'festivos',
        question: '¿El horario de atención cambia en festivos o fechas especiales?',
        kind: 'faq',
        faqQuestion: '¿Atienden en festivos?'
    }
];

function getFieldsForTenant() {
    const override = process.env.ONBOARDING_FIELDS;
    if (!override) return DEFAULT_FIELDS;
    const keys = override.split(',').map(k => k.trim()).filter(Boolean);
    if (!keys.length) return DEFAULT_FIELDS;
    const byKey = new Map(DEFAULT_FIELDS.map(f => [f.key, f]));
    return keys.map(k => byKey.get(k)).filter(Boolean);
}

module.exports = { DEFAULT_FIELDS, getFieldsForTenant };
