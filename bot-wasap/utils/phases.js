// RUTA: utils/phases.js - ACTUALIZADO

const PHASE = {
    // Fases iniciales y de navegación
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
    // 🦁 FASES FLUJO FINANCE LION AI (conversacional)
    // ===================================
    FIN_ONBOARDING: 'fin_onboarding',
    FIN_DIAGNOSTIC: 'fin_diagnostic',
    FIN_GOALS: 'fin_goals',
    FIN_CHECKIN: 'fin_checkin',
    FIN_MAIN: 'fin_main'
};

module.exports = PHASE;