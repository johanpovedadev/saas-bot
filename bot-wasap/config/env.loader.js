/**
 * @fileoverview ENV Loader - Cargador de configuración desde variables de entorno
 * 
 * Este módulo centraliza TODA la configuración del bot que viene de variables ENV.
 * Hace el bot completamente genérico y multi-negocio.
 * 
 * CARACTERÍSTICAS:
 * - Carga variables de .env
 * - Valores por defecto para cada variable
 * - Validación automática
 * - Soporte para plantillas de mensajes con placeholders
 * - Hot reload (recarga sin reiniciar)
 * 
 * USO:
 * ```javascript
 * const envConfig = require('./config/env.loader');
 * const businessName = envConfig.business.name;
 * const primaryField = envConfig.backend.fields.itemPrimaryCount;
 * ```
 * 
 * @module config/env.loader
 */

require('dotenv').config();

/**
 * Configuración completa cargada desde ENV
 */
const envConfig = {
    
    // =========================================================================
    // INFORMACIÓN DEL NEGOCIO
    // =========================================================================
    business: {
        type: process.env.BUSINESS_TYPE || 'heladeria',
        name: process.env.BUSINESS_NAME || 'Mundo Helados',
        shortName: process.env.BUSINESS_SHORT_NAME || 'Mundo Helados',
        id: process.env.BUSINESS_ID || 'BUSINESS_DEFAULT',
        
        location: {
            city: process.env.BUSINESS_CITY || 'Riohacha',
            address: process.env.BUSINESS_ADDRESS || '',
            timezone: process.env.BUSINESS_TIMEZONE || 'America/Bogota',
        },
        
        contact: {
            phone: process.env.BUSINESS_PHONE || '',
            whatsapp: process.env.BUSINESS_WHATSAPP || '',
            email: process.env.BUSINESS_EMAIL || '',
            website: process.env.BUSINESS_WEBSITE || '',
        },
        
        socialMedia: {
            instagram: process.env.BUSINESS_INSTAGRAM || '',
            facebook: process.env.BUSINESS_FACEBOOK || '',
            tiktok: process.env.BUSINESS_TIKTOK || '',
        },
        
        hours: {
            weekday: {
                open: process.env.BUSINESS_HOURS_WEEKDAY_OPEN || '09:00',
                close: process.env.BUSINESS_HOURS_WEEKDAY_CLOSE || '20:00',
            },
            weekend: {
                open: process.env.BUSINESS_HOURS_WEEKEND_OPEN || '10:00',
                close: process.env.BUSINESS_HOURS_WEEKEND_CLOSE || '21:00',
            },
            closedDays: process.env.BUSINESS_CLOSED_DAYS 
                ? process.env.BUSINESS_CLOSED_DAYS.split(',').map(d => d.trim()) 
                : [],
        },
    },
    
    // =========================================================================
    // NOMENCLATURA (¡CRÍTICO PARA GENERICIDAD!)
    // =========================================================================
    nomenclature: {
        // Tipo de producto
        productType: process.env.PRODUCT_TYPE_SINGULAR || 'helado',
        productTypePlural: process.env.PRODUCT_TYPE_PLURAL || 'helados',
        
        // Item primario (sabores, ingredientes, tipos, etc.)
        itemPrimary: process.env.ITEM_PRIMARY_PLURAL || 'sabores',
        itemPrimarySingular: process.env.ITEM_PRIMARY_SINGULAR || 'sabor',
        
        // Item secundario (toppings, extras, acompañamientos, etc.)
        itemSecondary: process.env.ITEM_SECONDARY_PLURAL || 'toppings',
        itemSecondarySingular: process.env.ITEM_SECONDARY_SINGULAR || 'topping',
    },
    
    // =========================================================================
    // LABELS (para UI)
    // =========================================================================
    labels: {
        itemPrimaryLabel: process.env.ITEM_PRIMARY_LABEL || 'Sabores',
        itemPrimaryLabelSingular: process.env.ITEM_PRIMARY_LABEL_SINGULAR || 'Sabor',
        itemSecondaryLabel: process.env.ITEM_SECONDARY_LABEL || 'Toppings',
        itemSecondaryLabelSingular: process.env.ITEM_SECONDARY_LABEL_SINGULAR || 'Topping',
    },
    
    // =========================================================================
    // CAMPOS DE BASE DE DATOS
    // =========================================================================
    backend: {
        fields: {
            // Campos de producto
            productName: process.env.DB_FIELD_PRODUCT_NAME || 'NombreProducto',
            productCode: process.env.DB_FIELD_PRODUCT_CODE || 'CodigoProducto',
            productPrice: process.env.DB_FIELD_PRODUCT_PRICE || 'Precio_Venta',
            productCategory: process.env.DB_FIELD_PRODUCT_CATEGORY || 'Categoria',
            productImage: process.env.DB_FIELD_PRODUCT_IMAGE || 'Imagen_URL',
            
            // Campos de personalización
            itemPrimaryCount: process.env.DB_FIELD_ITEM_PRIMARY_COUNT || 'Numero_de_Sabores',
            itemSecondaryCount: process.env.DB_FIELD_ITEM_SECONDARY_COUNT || 'Numero_de_Toppings',
        },
        
        sheets: {
            products: process.env.SHEET_NAME_PRODUCTS || 'Productos',
            flavors: process.env.SHEET_NAME_FLAVORS || 'Sabores',
            toppings: process.env.SHEET_NAME_TOPPINGS || 'Toppings',
            orders: process.env.SHEET_NAME_ORDERS || 'Entregas',
        },
        
        ranges: {
            products: process.env.SHEET_RANGE_PRODUCTS || 'Productos!A:Z',
            flavors: process.env.SHEET_RANGE_FLAVORS || 'Sabores!A:Z',
            toppings: process.env.SHEET_RANGE_TOPPINGS || 'Toppings!A:Z',
            orders: process.env.SHEET_RANGE_ORDERS || 'Entregas!A:Z',
        },
    },
    
    // =========================================================================
    // BÚSQUEDA Y DETECCIÓN
    // =========================================================================
    search: {
        productKeywords: process.env.PRODUCT_KEYWORDS 
            ? process.env.PRODUCT_KEYWORDS.split(',').map(k => k.trim())
            : ['caja', 'copa', 'litro', 'paleta', 'helado'],
        
        preloadQueries: process.env.PRELOAD_SEARCH_QUERIES
            ? process.env.PRELOAD_SEARCH_QUERIES.split(',').map(q => q.trim())
            : ['Litros de Helado', 'Cajas de Helado'],
        
        productVariants: process.env.PRODUCT_VARIANTS
            ? process.env.PRODUCT_VARIANTS.split(',').map(v => v.trim())
            : [],
        
        // Genera regex para detectar keywords de productos
        get productKeywordsRegex() {
            const keywords = this.productKeywords.join('|');
            return new RegExp(`\\b(${keywords})\\b`, 'i');
        },
    },
    
    // =========================================================================
    // MENSAJES Y PLANTILLAS
    // =========================================================================
    messages: {
        templates: {
            greeting: process.env.MESSAGE_GREETING || '¿Cómo estás? Somos {businessName} en {city} 🍦',
            welcome: process.env.MESSAGE_WELCOME || '¡Bienvenido a {businessName}! 🍨',
            mainMenu: process.env.MESSAGE_MAIN_MENU || '🍨 *¡Bienvenido a {businessName}!* 🍨',
            customOrderStart: process.env.MESSAGE_CUSTOM_ORDER_START || '¡Claro! Con gusto te ayudamos...',
            selectPrimaryItems: process.env.MESSAGE_SELECT_PRIMARY_ITEMS || 'Por favor, selecciona {itemPrimaryLabel}...',
            selectSecondaryItems: process.env.MESSAGE_SELECT_SECONDARY_ITEMS || '¿Quieres agregar {itemSecondaryLabel}?',
            selectionError: process.env.MESSAGE_SELECTION_ERROR || '❌ No entendí tu respuesta.',
            orderConfirmation: process.env.MESSAGE_ORDER_CONFIRMATION || '✅ *¡Perfecto!* Tu pedido ha sido confirmado.',
            outOfHours: process.env.MESSAGE_OUT_OF_HOURS || '🕐 Actualmente estamos fuera de horario.',
        },
        
        /**
         * Renderiza una plantilla reemplazando placeholders
         * @param {string} template - Plantilla con placeholders {variable}
         * @param {Object} vars - Objeto con valores para reemplazar
         * @returns {string}
         */
        render(template, vars = {}) {
            // Valores por defecto del contexto
            const defaultVars = {
                businessName: envConfig.business.name,
                businessShortName: envConfig.business.shortName,
                city: envConfig.business.location.city,
                productType: envConfig.nomenclature.productType,
                productTypePlural: envConfig.nomenclature.productTypePlural,
                itemPrimary: envConfig.nomenclature.itemPrimary,
                itemPrimarySingular: envConfig.nomenclature.itemPrimarySingular,
                itemPrimaryPlural: envConfig.nomenclature.itemPrimary,
                itemSecondary: envConfig.nomenclature.itemSecondary,
                itemSecondarySingular: envConfig.nomenclature.itemSecondarySingular,
                itemSecondaryPlural: envConfig.nomenclature.itemSecondary,
                itemPrimaryLabel: envConfig.labels.itemPrimaryLabel,
                itemSecondaryLabel: envConfig.labels.itemSecondaryLabel,
                emoji: envConfig.ui.emoji.main,
                weekdayHours: `${envConfig.business.hours.weekday.open} - ${envConfig.business.hours.weekday.close}`,
                weekendHours: `${envConfig.business.hours.weekend.open} - ${envConfig.business.hours.weekend.close}`,
            };
            
            const allVars = { ...defaultVars, ...vars };
            
            return template.replace(/\{(\w+)\}/g, (match, key) => {
                return allVars[key] !== undefined ? allVars[key] : match;
            });
        },
    },
    
    // =========================================================================
    // ENTREGA Y CHECKOUT
    // =========================================================================
    checkout: {
        delivery: {
            enabled: process.env.DELIVERY_ENABLED === 'true',
            fee: parseInt(process.env.DELIVERY_FEE || '3000', 10),
            minOrder: parseInt(process.env.DELIVERY_MIN_ORDER || '10000', 10),
            freeAbove: parseInt(process.env.DELIVERY_FREE_ABOVE || '50000', 10),
        },
        
        payment: {
            methods: process.env.PAYMENT_METHODS
                ? process.env.PAYMENT_METHODS.split(',').map(m => m.trim())
                : ['Efectivo', 'Nequi'],
            currency: process.env.CURRENCY || 'COP',
            symbol: process.env.CURRENCY_SYMBOL || '$',
        },
    },
    
    // =========================================================================
    // BOT E IA
    // =========================================================================
    bot: {
        assistantName: process.env.BOT_ASSISTANT_NAME || 'MIA',
        
        ai: {
            enabled: process.env.BOT_AI_ENABLED === 'true',
            model: process.env.BOT_AI_MODEL || 'gpt-4',
            maxTokens: parseInt(process.env.BOT_AI_MAX_TOKENS || '500', 10),
            systemPrompt: process.env.BOT_AI_SYSTEM_PROMPT || '',
        },
        
        session: {
            timeout: parseInt(process.env.BOT_SESSION_TIMEOUT || '30', 10),
        },
    },
    
    // =========================================================================
    // UI
    // =========================================================================
    ui: {
        emoji: {
            main: process.env.UI_EMOJI_MAIN || '🍦',
            cart: process.env.UI_EMOJI_CART || '🛒',
            delivery: process.env.UI_EMOJI_DELIVERY || '🚚',
            payment: process.env.UI_EMOJI_PAYMENT || '💰',
            success: process.env.UI_EMOJI_SUCCESS || '✅',
            error: process.env.UI_EMOJI_ERROR || '❌',
            info: process.env.UI_EMOJI_INFO || 'ℹ️',
        },
        
        colors: {
            primary: process.env.UI_COLOR_PRIMARY || '#FF6B9D',
            secondary: process.env.UI_COLOR_SECONDARY || '#4ECDC4',
        },
    },
    
    // =========================================================================
    // API Y BACKEND
    // =========================================================================
    api: {
        baseUrl: process.env.API_BASE_URL || 'http://localhost:8000',
        
        endpoints: {
            searchProduct: process.env.API_ENDPOINT_SEARCH_PRODUCT || '/buscar_producto_por_nombre/',
            createOrder: process.env.API_ENDPOINT_CREATE_ORDER || '/crear_pedido/',
            getFlavors: process.env.API_ENDPOINT_GET_FLAVORS || '/sabores/',
            getToppings: process.env.API_ENDPOINT_GET_TOPPINGS || '/toppings/',
        },
    },
    
    // =========================================================================
    // GOOGLE SHEETS
    // =========================================================================
    googleSheets: {
        sheetId: process.env.GOOGLE_SHEET_ID || '',
    },
    
    // =========================================================================
    // SEGURIDAD
    // =========================================================================
    security: {
        whatsappToken: process.env.WHATSAPP_TOKEN || '',
        adminJid: process.env.ADMIN_JID || '',
        webhookSecret: process.env.WEBHOOK_SECRET || '',
    },
    
    // =========================================================================
    // DEBUG Y LOGS
    // =========================================================================
    debug: {
        logLevel: process.env.LOG_LEVEL || 'info',
        debugMode: process.env.DEBUG_MODE === 'true',
        logToFile: process.env.LOG_TO_FILE === 'true',
        logFilePath: process.env.LOG_FILE_PATH || './logs/bot.log',
    },
    
    // =========================================================================
    // AMBIENTE
    // =========================================================================
    env: {
        nodeEnv: process.env.NODE_ENV || 'development',
        port: parseInt(process.env.PORT || '3000', 10),
    },
};

// =============================================================================
// UTILIDADES
// =============================================================================

/**
 * Obtiene un valor anidado de configuración usando notación de punto
 * @param {string} path - Ruta en notación de punto (ej: 'business.name')
 * @param {*} defaultValue - Valor por defecto si no existe
 * @returns {*}
 * 
 * @example
 * const name = envConfig.get('business.name', 'Default Name');
 * const fee = envConfig.get('checkout.delivery.fee', 0);
 */
envConfig.get = function(path, defaultValue = undefined) {
    const keys = path.split('.');
    let value = this;
    
    for (const key of keys) {
        if (value && typeof value === 'object' && key in value) {
            value = value[key];
        } else {
            return defaultValue;
        }
    }
    
    return value !== undefined ? value : defaultValue;
};

/**
 * Valida que todas las variables críticas estén configuradas
 * @returns {Object} { valid: boolean, errors: string[] }
 */
envConfig.validate = function() {
    const errors = [];
    
    // Validaciones críticas
    if (!this.business.name) {
        errors.push('BUSINESS_NAME es requerido');
    }
    
    if (!this.backend.fields.productName) {
        errors.push('DB_FIELD_PRODUCT_NAME es requerido');
    }
    
    if (!this.backend.fields.itemPrimaryCount) {
        errors.push('DB_FIELD_ITEM_PRIMARY_COUNT es requerido');
    }
    
    if (this.checkout.delivery.enabled && !this.checkout.delivery.fee) {
        errors.push('DELIVERY_FEE es requerido si DELIVERY_ENABLED=true');
    }
    
    return {
        valid: errors.length === 0,
        errors,
    };
};

/**
 * Imprime resumen de configuración (para debug)
 */
envConfig.printSummary = function() {
    console.log('\n' + '='.repeat(60));
    console.log('📋 CONFIGURACIÓN ENV CARGADA');
    console.log('='.repeat(60));
    console.log(`🏢 Negocio: ${this.business.name} (${this.business.type})`);
    console.log(`📍 Ubicación: ${this.business.location.city}`);
    console.log(`📦 Producto: ${this.nomenclature.productType} → ${this.nomenclature.productTypePlural}`);
    console.log(`🔧 Item Primario: ${this.nomenclature.itemPrimary} (Campo: ${this.backend.fields.itemPrimaryCount})`);
    console.log(`🔧 Item Secundario: ${this.nomenclature.itemSecondary} (Campo: ${this.backend.fields.itemSecondaryCount})`);
    console.log(`🔍 Keywords: ${this.search.productKeywords.slice(0, 5).join(', ')}...`);
    console.log(`🤖 Asistente: ${this.bot.assistantName}`);
    console.log(`🌐 Ambiente: ${this.env.nodeEnv}`);
    
    const validation = this.validate();
    if (validation.valid) {
        console.log('✅ Configuración válida');
    } else {
        console.log('❌ Errores de configuración:');
        validation.errors.forEach(err => console.log(`   - ${err}`));
    }
    console.log('='.repeat(60) + '\n');
};

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = envConfig;

// Auto-validación en modo debug
if (envConfig.debug.debugMode) {
    envConfig.printSummary();
}
