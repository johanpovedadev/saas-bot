// RUTA: utils/phases.js - ACTUALIZADO

const PHASE = {
    // Fases iniciales y de navegación
    AWAITING_NAME: 'awaiting_name',
    MENU_PRINCIPAL: 'menu_principal',
    SELECCION_OPCION: 'seleccion_opcion',
    BROWSE_IMAGES: 'browse_images',
    SELECCION_PRODUCTO: 'seleccion_producto',
    AWAITING_CONFIRMATION: 'awaiting_confirmation', // Sistema híbrido - confirmación de sugerencias

    // Fases de personalización del producto
    SELECT_DETAILS: 'select_details',
    SELECT_QUANTITY: 'select_quantity',

    // Fases del proceso de pago (Checkout)
    CHECK_DIR: 'checkout_dir',
    CHECK_NAME: 'checkout_name',
    CHECK_TELEFONO: 'checkout_tel', // clave usada en handlers
    CHECK_PAGO: 'checkout_pago',
    CHECK_REF: 'checkout_ref',

    // Confirmación/Finalización
    CONFIRM_ORDER: 'confirm_order',
    FINALIZE_ORDER: 'finalize_order',    // Ediciones y encargos
    EDIT_OPTIONS: 'edit_options',
    EDIT_CART_SELECTION: 'edit_cart_selection',
    ENCARGO: 'encargo',

    // Derivación a atención humana
    WAITING_HUMAN: 'waiting_human',

    // ===================================
    // 🐾 FASES FLUJO SEGURO MASCOTAS
    // ===================================
    INS_SALUDO: 'ins_saludo',                   // Seleccionar perro/gato
    INS_FLUJO_GATO: 'ins_flujo_gato',           // Mostrar info gato + continuar
    INS_FLUJO_PERRO: 'ins_flujo_perro',         // Mostrar plan PLUS perro
    INS_FLUJO_PERRO_PREMIUM: 'ins_flujo_perro_premium', // Mostrar plan PREMIUM
    INS_DATOS_TITULAR: 'ins_datos_titular',     // Recolectar datos del titular
    INS_DATOS_MASCOTA: 'ins_datos_mascota',     // Recolectar datos de la mascota
    INS_CONFIRMACION: 'ins_confirmacion',       // Confirmar datos
    INS_RECHAZO: 'ins_rechazo',                 // Rechazo por edad >12 años
    INS_FINAL: 'ins_final',                       // Finalización

    // ===================================
    // 🦁 FASES FLUJO FINANCE LEO (conversacional)
    // ===================================
    FIN_ONBOARDING: 'fin_onboarding',
    FIN_REFERRAL_ONBOARDING: 'fin_referral_onboarding', // Preguntando si tiene codigo de invitacion (apenas entra)
    FIN_DIAGNOSTIC: 'fin_diagnostic',
    FIN_GOAL_ONBOARDING: 'fin_goal_onboarding',
    FIN_GOALS: 'fin_goals',
    FIN_CHECKIN: 'fin_checkin',
    FIN_MAIN: 'fin_main',
    FIN_SETTINGS: 'fin_settings',                 // Menu de mejoras/configuracion
    FIN_SETTINGS_CURRENCY: 'fin_settings_currency', // Esperando elegir moneda
    FIN_FEEDBACK: 'fin_feedback',                  // Esperando el texto del feedback

    // ===================================
    // 🍦 FASES FLUJO GUIADO MUNDO HELADOS
    // ===================================
    HELADO_SABORES: 'HELADO_SABORES',       // Selección de sabores obligatorios
    HELADO_TOPPINGS: 'HELADO_TOPPINGS',     // Selección de toppings opcionales
    HELADO_QUANTITY: 'HELADO_QUANTITY',     // Cantidad + agregar al carrito
    HELADO_POST_ADD: 'HELADO_POST_ADD',     // Opciones post-compra (seguir/pagar/menú) - flujo heladería
    HELADO_UNITS_MODE: 'HELADO_UNITS_MODE', // Varias unidades: 1) todas iguales / 2) cada una diferente
    HELADO_PER_UNIT_SABORES: 'HELADO_PER_UNIT_SABORES',     // Sabores de una unidad específica
    HELADO_PER_UNIT_TOPPINGS: 'HELADO_PER_UNIT_TOPPINGS',     // Toppings de una unidad específica

    // ===================================
    // 🧘 FASES FLUJO AGENDA BRI PILATES
    // ===================================
    PIL_WELCOME: 'pil_welcome',           // Ofrece la clase de cortesia
    PIL_ASK_NAME: 'pil_ask_name',         // Pide el nombre
    PIL_ASK_DAY: 'pil_ask_day',           // Pide dia (lunes/miercoles/viernes)
    PIL_ASK_PERIOD: 'pil_ask_period',     // Pide manana/tarde
    PIL_ASK_TIME: 'pil_ask_time',         // Pide hora especifica dentro del periodo
    PIL_CONFIRM: 'pil_confirm',           // Confirma la reserva
    PIL_MAIN: 'pil_main',                 // Post-reserva / menu conversacional

    // ===================================
    // 🧘 FASES FLUJO BRI PILATES - CLIENTAS RECURRENTES
    // ===================================
    PILC_ASK_NAME: 'pilc_ask_name',                     // Primera vez: pide el nombre antes del menu
    PILC_MENU: 'pilc_menu',                             // Menu principal (agendar/reagendar/hablar con Bri)
    PILC_ASK_DAY: 'pilc_ask_day',                       // Pide dia (texto libre)
    PILC_ASK_TIME: 'pilc_ask_time',                     // Ofrece horarios reales libres ese dia
    PILC_CONFIRM: 'pilc_confirm',                       // Confirma la reserva nueva
    PILC_RESCHEDULE_FIND: 'pilc_reschedule_find',       // Cual cita quiere reagendar
    PILC_RESCHEDULE_DAY: 'pilc_reschedule_day',         // Pide el nuevo dia
    PILC_RESCHEDULE_TIME: 'pilc_reschedule_time',       // Ofrece horarios reales libres del nuevo dia
    PILC_RESCHEDULE_CONFIRM: 'pilc_reschedule_confirm', // Confirma el cambio (libera vieja + crea nueva)
    PILC_HUMAN: 'pilc_human',                           // Esperando que Bri atienda directo
    PILC_SATURDAY_REPLY: 'pilc_saturday_reply',         // Esperando respuesta a la campaña de sabados
    PILC_CREDIT_LIMIT_CONFIRM: 'pilc_credit_limit_confirm' // Confirma si quiere que Bri le gestione clases extra (ya agoto el mes)
};

module.exports = PHASE;