// RUTA: utils/phases.js - ACTUALIZADO

const PHASE = {
    // Fases iniciales y de navegación
    MENU_PRINCIPAL: 'menu_principal',
    SELECCION_OPCION: 'seleccion_opcion',
    BROWSE_IMAGES: 'browse_images',
    SELECCION_PRODUCTO: 'seleccion_producto',

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
    WAITING_HUMAN: 'waiting_human'
};

module.exports = PHASE;