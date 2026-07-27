/**
 * @fileoverview ENV Loader - Cargador de configuración desde variables de entorno
 * 
 * Este módulo centraliza TODA la configuración del bot que viene de variables ENV.
 * Hace el bot completamente genérico y multi-negocio.
 * 
 * CARACTERÍSTICAS:
 * - Carga variables de .env desde la RAÍZ del proyecto
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

const path = require('path');
const fs = require('fs');

// ============================================================================
// CARGAR .ENV: PRIMERO EL ESPECÍFICO DEL TENANT, LUEGO EL COMPARTIDO COMO BASE
// ============================================================================
// bot-wasap/ está dentro de la raíz, por lo tanto subimos 1 nivel
// dotenv.config() NUNCA sobreescribe una variable que ya esté en process.env,
// así que cargar primero .env.<BUSINESS_KEY> le da prioridad sobre el .env
// compartido sin romper a los tenants que todavía no tienen archivo propio.
const projectRoot = path.resolve(__dirname, '..', '..');
const envPath = path.join(projectRoot, '.env');
const businessKeyForEnv = (process.env.BUSINESS_KEY || '').replace(/\.json$/, '');
const tenantEnvPath = businessKeyForEnv ? path.join(projectRoot, `.env.${businessKeyForEnv}`) : null;

if (tenantEnvPath && fs.existsSync(tenantEnvPath)) {
    require('dotenv').config({ path: tenantEnvPath });
    console.log(`✅ Bot cargando .env propio del tenant: ${tenantEnvPath}`);
}

require('dotenv').config({ path: envPath });

console.log(`✅ Bot cargando .env compartido (base) desde: ${envPath}`);

// Cargar config de negocio dinámicamente
// ISSUE 41+45: JSON config via BUSINESS_KEY, fallback a JS config via BUSINESS_CONFIG
let businessConfig = null;
try {
    const businessKey = (process.env.BUSINESS_KEY || 'mascotas').replace(/\.json$/, '');
    const jsonPath = path.join(__dirname, 'businesses', `${businessKey}.json`);
    if (fs.existsSync(jsonPath)) {
        const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
        businessConfig = {
            business: {
                name: raw.business_name || 'Mi Negocio',
                shortName: raw.business_name || 'Mi Negocio',
                id: businessKey.toUpperCase(),
                type: raw.business_type || 'insurance',
                industry: (raw.business_type || '').toLowerCase(),
                city: raw.city || '',
                department: raw.department || '',
                timezone: raw.timezone || 'America/Bogota',
                currency: raw.currency || 'COP',
                location: {
                    city: raw.city || '',
                    timezone: raw.timezone || 'America/Bogota'
                },
                contact: {
                    phone: raw.contact_phone || '',
                    whatsapp: raw.contact_whatsapp || '',
                    email: raw.contact_email || '',
                    website: raw.contact_website || ''
                }
            },
            contact: {
                phone: raw.contact_phone || '',
                whatsapp: raw.contact_whatsapp || '',
                email: raw.contact_email || ''
            },
            admin: {
                business_admin_jids: raw.business_admin_jids || [],
                system_admin_jids: raw.system_admin_jids || [],
                jids: raw.business_admin_jids || []
            },
            backend: {
                apiBase: raw.api_base || process.env.API_BASE || 'http://127.0.0.1:8001/api',
                timeout: raw.api_timeout || 8000,
                endpoints: {
                    products: raw.endpoint_products || '/obtener_todos_los_productos/',
                    orders: raw.endpoint_orders || '/registrar_lead/',
                    reservations: raw.endpoint_reservations || '/registrar_lead/',
                    search: raw.endpoint_search || '',
                    productImage: raw.endpoint_product_image || ''
                },
                sheets: {
                    spreadsheetId: raw.sheet_id || '',
                    orders: raw.sheet_tab || 'LEADS'
                }
            },
            checkout: raw.checkout || {},
            catalog: raw.catalog || {},
            features: raw.features || {},
            nomenclature: {
                productType: raw.product_type_singular || '',
                productTypePlural: raw.product_type_plural || '',
                itemPrimary: raw.item_primary_plural || '',
                itemPrimarySingular: raw.item_primary_singular || '',
                itemSecondary: raw.item_secondary_plural || '',
                itemSecondarySingular: raw.item_secondary_singular || ''
            },
            bot: {
                flowModule: raw.flow_module || '',
                welcomeMessage: raw.welcome_message || '',
                mainMenu: raw.main_menu || null,
                insuranceFlow: {
                    enabled: raw.business_type === 'INSURANCE',
                    plans: raw.plans || {},
                    images: raw.insurance_images || {},
                    messages: raw.insurance_messages || {}
                }
            }
        };
        console.log(`✅ Cargada config JSON para negocio: ${raw.business_name} (${businessKey})`);
    } else {
        const configFile = process.env.BUSINESS_CONFIG || 'template.config.js';
        businessConfig = require(`./businesses/${configFile}`);
    }
} catch (e) {
    businessConfig = require('./businesses/template.config.js');
}

/**
 * Configuración completa cargada desde ENV
 */
const envConfig = {
    // =========================================================================
    // INFORMACIÓN DEL NEGOCIO
    // =========================================================================
    business: {
        // Merge businessConfig.business con defaults (businessConfig tiene prioridad)
        ...(businessConfig.business || {}),
        
        // Pero SIEMPRE garantizar que existan estos campos con defaults
        type: (businessConfig.business && businessConfig.business.type) || process.env.BUSINESS_TYPE || 'heladeria',
        name: (businessConfig.business && businessConfig.business.name) || process.env.BUSINESS_NAME || 'Mundo Helados',
        shortName: (businessConfig.business && businessConfig.business.shortName) || process.env.BUSINESS_SHORT_NAME || 'Mundo Helados',
        id: (businessConfig.business && businessConfig.business.id) || process.env.BUSINESS_ID || 'BUSINESS_DEFAULT',
        
        location: {
            ...(businessConfig.business && businessConfig.business.location || {}),
            city: (businessConfig.business && businessConfig.business.location && businessConfig.business.location.city) || process.env.BUSINESS_CITY || 'Riohacha',
            address: (businessConfig.business && businessConfig.business.location && businessConfig.business.location.address) || process.env.BUSINESS_ADDRESS || '',
            timezone: (businessConfig.business && businessConfig.business.location && businessConfig.business.location.timezone) || process.env.BUSINESS_TIMEZONE || 'America/Bogota',
        },
        
        contact: {
            ...(businessConfig.business && businessConfig.business.contact || {}),
            phone: (businessConfig.business && businessConfig.business.contact && businessConfig.business.contact.phone) || process.env.BUSINESS_PHONE || '',
            whatsapp: (businessConfig.business && businessConfig.business.contact && businessConfig.business.contact.whatsapp) || process.env.BUSINESS_WHATSAPP || '',
            email: (businessConfig.business && businessConfig.business.contact && businessConfig.business.contact.email) || process.env.BUSINESS_EMAIL || '',
            website: (businessConfig.business && businessConfig.business.contact && businessConfig.business.contact.website) || process.env.BUSINESS_WEBSITE || '',
            googleMapsLink: (businessConfig.business && businessConfig.business.contact && businessConfig.business.contact.googleMapsLink) || process.env.BUSINESS_GOOGLE_MAPS_LINK || '',
        },
        
        socialMedia: {
            ...(businessConfig.business && businessConfig.business.socialMedia || {}),
            instagram: (businessConfig.business && businessConfig.business.socialMedia && businessConfig.business.socialMedia.instagram) || process.env.BUSINESS_INSTAGRAM || '',
            facebook: (businessConfig.business && businessConfig.business.socialMedia && businessConfig.business.socialMedia.facebook) || process.env.BUSINESS_FACEBOOK || '',
            tiktok: (businessConfig.business && businessConfig.business.socialMedia && businessConfig.business.socialMedia.tiktok) || process.env.BUSINESS_TIKTOK || '',
        },
        
        // ✅ SIEMPRE incluir hours, aunque businessConfig.business exista
        hours: {
            weekday: {
                open: (businessConfig.business && businessConfig.business.hours && businessConfig.business.hours.weekday && businessConfig.business.hours.weekday.open) || process.env.BUSINESS_HOURS_WEEKDAY_OPEN || '09:00',
                close: (businessConfig.business && businessConfig.business.hours && businessConfig.business.hours.weekday && businessConfig.business.hours.weekday.close) || process.env.BUSINESS_HOURS_WEEKDAY_CLOSE || '20:00',
            },
            weekend: {
                open: (businessConfig.business && businessConfig.business.hours && businessConfig.business.hours.weekend && businessConfig.business.hours.weekend.open) || process.env.BUSINESS_HOURS_WEEKEND_OPEN || '10:00',
                close: (businessConfig.business && businessConfig.business.hours && businessConfig.business.hours.weekend && businessConfig.business.hours.weekend.close) || process.env.BUSINESS_HOURS_WEEKEND_CLOSE || '21:00',
            },
            closedDays: (businessConfig.business && businessConfig.business.hours && businessConfig.business.hours.closedDays) || (process.env.BUSINESS_CLOSED_DAYS ? process.env.BUSINESS_CLOSED_DAYS.split(',').map(d => d.trim()) : []),
        },
    },
    
    contact: businessConfig.contact || {},
    schedule: businessConfig.schedule || {},
    // bot: se mergea más abajo con valores ENV (línea 350)
    catalog: businessConfig.catalog || {},
    checkout: businessConfig.checkout || {},
    admin: businessConfig.admin || {},
    
    // =========================================================================
    // BACKEND - SIEMPRE desde ENV, NO desde businessConfig
    // =========================================================================
    backend: {
        fields: {
            // Campos de producto
            productName: process.env.DB_FIELD_PRODUCT_NAME || 'NombreProducto',
            productCode: process.env.DB_FIELD_PRODUCT_CODE || 'CodigoProducto',
            productPrice: process.env.DB_FIELD_PRODUCT_PRICE || 'Precio_Venta',
            productCategory: process.env.DB_FIELD_PRODUCT_CATEGORY || 'Categoria',
            productImage: process.env.DB_FIELD_PRODUCT_IMAGE || 'Imagen_URL',
            // Campos de personalización (si no existen, poner string vacío para evitar undefined)
            itemPrimaryCount: process.env.DB_FIELD_ITEM_PRIMARY_COUNT || '',
            itemSecondaryCount: process.env.DB_FIELD_ITEM_SECONDARY_COUNT || '',
            
            // 🎯 TICKET 3: Opciones extra genéricas para salto automático
            // Mapea a diferentes columnas según el negocio:
            // - Empanadas: Numero_de_Sabores
            // - Pescadería: NumeroEntrada
            // - Heladería: Numero_de_Toppings
            opcionesExtra1: process.env.DB_FIELD_OPCIONES_EXTRA_1 || 'Numero_de_Sabores',
            opcionesExtra2: process.env.DB_FIELD_OPCIONES_EXTRA_2 || 'Numero_de_Toppings',
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
        
        // ✅ API Base y Endpoints (desde businessConfig o process.env)
        apiBase: (businessConfig.backend && businessConfig.backend.apiBase) || process.env.API_BASE || 'http://127.0.0.1:8000/api',
        timeout: (businessConfig.backend && businessConfig.backend.timeout) || 8000,
        
        endpoints: {
            products: (businessConfig.backend && businessConfig.backend.endpoints && businessConfig.backend.endpoints.products) || '/productos/',
            productImage: (businessConfig.backend && businessConfig.backend.endpoints && businessConfig.backend.endpoints.productImage) || '/producto_imagen/',
            search: (businessConfig.backend && businessConfig.backend.endpoints && businessConfig.backend.endpoints.search) || '/buscar_producto/',
            orders: (businessConfig.backend && businessConfig.backend.endpoints && businessConfig.backend.endpoints.orders) || '/registrar_entrega/',
            reservations: (businessConfig.backend && businessConfig.backend.endpoints && businessConfig.backend.endpoints.reservations) || '/registrar_entrega/',
        },
    },
    features: businessConfig.features || {},
    
    // =========================================================================
    // NOMENCLATURA (¡CRÍTICO PARA GENERICIDAD!)
    // =========================================================================
    nomenclature: {
        // Tipo de producto
        productType: (businessConfig.nomenclature && businessConfig.nomenclature.productType) || process.env.PRODUCT_TYPE_SINGULAR || 'helado',
        productTypePlural: (businessConfig.nomenclature && businessConfig.nomenclature.productTypePlural) || process.env.PRODUCT_TYPE_PLURAL || 'helados',
        
        // Item primario (sabores, ingredientes, tipos, etc.)
        itemPrimary: (businessConfig.nomenclature && businessConfig.nomenclature.itemPrimary) || process.env.ITEM_PRIMARY_PLURAL || 'sabores',
        itemPrimarySingular: (businessConfig.nomenclature && businessConfig.nomenclature.itemPrimarySingular) || process.env.ITEM_PRIMARY_SINGULAR || 'sabor',
        
        // Aliases para compatibilidad (apuntan a las mismas propiedades)
        get itemPrimaryPlural() { return this.itemPrimary; },
        
        // Item secundario (toppings, extras, acompañamientos, etc.)
        itemSecondary: (businessConfig.nomenclature && businessConfig.nomenclature.itemSecondary) || process.env.ITEM_SECONDARY_PLURAL || 'toppings',
        itemSecondarySingular: (businessConfig.nomenclature && businessConfig.nomenclature.itemSecondarySingular) || process.env.ITEM_SECONDARY_SINGULAR || 'topping',
        
        // Aliases para compatibilidad
        get itemSecondaryPlural() { return this.itemSecondary; },
        
        // Labels para UI (con mayúscula inicial)
        get itemPrimaryLabel() { 
            const label = process.env.ITEM_PRIMARY_LABEL || 'Sabores';
            return label.charAt(0).toUpperCase() + label.slice(1);
        },
        get itemPrimaryLabelSingular() { 
            const label = process.env.ITEM_PRIMARY_LABEL_SINGULAR || 'Sabor';
            return label.charAt(0).toUpperCase() + label.slice(1);
        },
        get itemSecondaryLabel() { 
            const label = process.env.ITEM_SECONDARY_LABEL || 'Toppings';
            return label.charAt(0).toUpperCase() + label.slice(1);
        },
        get itemSecondaryLabelSingular() { 
            const label = process.env.ITEM_SECONDARY_LABEL_SINGULAR || 'Topping';
            return label.charAt(0).toUpperCase() + label.slice(1);
        },
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
    // KEYWORDS (para compatibilidad con código existente)
    // =========================================================================
    keywords: {
        get products() {
            return process.env.PRODUCT_KEYWORDS 
                ? process.env.PRODUCT_KEYWORDS.split(',').map(k => k.trim())
                : ['caja', 'copa', 'litro', 'paleta', 'helado'];
        },
        get greetings() {
            return ['hola', 'buenos dias', 'buenas tardes', 'buenas noches', 'saludos', 'que tal'];
        },
    },
    
    // =========================================================================
    // MENÚ CONFIGURABLE (Genérico - activar/desactivar opciones)
    // =========================================================================
    menu: {
        // Opciones del menú principal (activar/desactivar desde .env)
        options: {
            showProducts: process.env.MENU_OPTION_PRODUCTS !== 'false', // Por defecto: true
            showLocation: process.env.MENU_OPTION_LOCATION !== 'false', // Por defecto: true
            showCustomOrders: process.env.MENU_OPTION_CUSTOM_ORDERS !== 'false', // Por defecto: true
        },
        
        // Textos de las opciones del menú
        labels: {
            option1: process.env.MENU_LABEL_OPTION1 || 'Ver Menú de Productos',
            option1Description: process.env.MENU_DESC_OPTION1 || 'Explora nuestros deliciosos {productTypePlural}',
            option2: process.env.MENU_LABEL_OPTION2 || 'Dirección y Horarios',
            option2Description: process.env.MENU_DESC_OPTION2 || 'Encuentra nuestra ubicación',
            option3: process.env.MENU_LABEL_OPTION3 || 'Encargar para Evento',
            option3Description: process.env.MENU_DESC_OPTION3 || 'Pedidos especiales',
        },
        
        // Mensajes adicionales del menú
        footer: process.env.MENU_FOOTER || '💬 También puedes escribir:\n• El nombre de un producto\n• "hablar" para atención humana\n• "carrito" para ver tu pedido actual',
        helpText: process.env.MENU_HELP_TEXT || '¿Cómo te puedo ayudar? 😊',
    },
    
    // =========================================================================
    // MENSAJES Y PLANTILLAS
    // =========================================================================
    messages: {
        templates: {
            greeting: process.env.MESSAGE_GREETING || '¿Cómo estás? Somos {businessName} en {city} {emoji}',
            welcome: process.env.MESSAGE_WELCOME || '¡Bienvenido a {businessName}! {emoji}',
            mainMenu: process.env.MESSAGE_MAIN_MENU || '{emoji} *¡Bienvenido a {businessName}!* {emoji}',
            customOrderStart: process.env.MESSAGE_CUSTOM_ORDER_START || '¡Claro! Con gusto te ayudamos con tu pedido por encargo. 😊\nPor favor, describe con detalle el pedido que necesitas:\n_Ej: 50 {productTypePlural} para un evento, etc._',
            customOrderExamples: process.env.MESSAGE_CUSTOM_ORDER_EXAMPLES || '📝 *Escribe tu pedido así:*\n"3 {productTypePlural} de {itemPrimarySingular} y 2 {productTypePlural} de {itemPrimarySingular}"\n\nO simplemente describe lo que necesitas:\n"Quiero {productType} para una fiesta de 20 personas"',
            selectPrimaryItems: process.env.MESSAGE_SELECT_PRIMARY_ITEMS || 'Por favor, selecciona {itemPrimaryLabel}...',
            selectSecondaryItems: process.env.MESSAGE_SELECT_SECONDARY_ITEMS || '¿Quieres agregar {itemSecondaryLabel}?',
            selectionError: process.env.MESSAGE_SELECTION_ERROR || '❌ No entendí tu respuesta.',
            orderConfirmation: process.env.MESSAGE_ORDER_CONFIRMATION || '✅ *¡Perfecto!* Tu pedido ha sido confirmado.',
            outOfHours: process.env.MESSAGE_OUT_OF_HOURS || '🕐 Actualmente estamos fuera de horario.',
            browseInstructions: process.env.MESSAGE_BROWSE_INSTRUCTIONS || '🔍 Paso 1:\nEscribe el nombre o una palabra del producto\nEjemplos: {productKeywords}\n(si no coincide exacto, te muestro opciones parecidas)',
            menuDay: process.env.MESSAGE_MENU_DAY || '📋 ¡Aquí está nuestro delicioso menú del día!',
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
                productKeywords: envConfig.keywords.products.slice(0, 4).join(', '), // Primeros 4 keywords como ejemplos
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
        // Spread config file data first (welcomeMessage, mainMenu, insuranceFlow, etc.)
        ...(businessConfig.bot || {}),
        
        assistantName: process.env.BOT_ASSISTANT_NAME || 'MIA',
        
        ai: {
            ...((businessConfig.bot && businessConfig.bot.ai) || {}),
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
        baseUrl: process.env.API_BASE_URL || 'http://localhost:8000/api',
        
        endpoints: {
            searchProduct: process.env.API_ENDPOINT_SEARCH_PRODUCT || '/buscar_producto_por_nombre/',
            createOrder: process.env.API_ENDPOINT_CREATE_ORDER || '/crear_pedido/',
            getFlavors: process.env.API_ENDPOINT_GET_FLAVORS || '/sabores/',
            getToppings: process.env.API_ENDPOINT_GET_TOPPINGS || '/toppings/',
            getAllProducts: process.env.API_ENDPOINT_GET_ALL_PRODUCTS || '/obtener_todos_los_productos/',
        },
    },
    
    // =========================================================================
    // GOOGLE SHEETS
    // =========================================================================
    googleSheets: {
        sheetId: (businessConfig && businessConfig.backend && businessConfig.backend.sheets && businessConfig.backend.sheets.spreadsheetId) || process.env.GOOGLE_SHEET_ID || '',
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

// Fallback robusto para horarios de atención
if (!envConfig.business.hours) {
    envConfig.business.hours = {};
}
if (!envConfig.business.hours.weekday || typeof envConfig.business.hours.weekday !== 'object') {
    envConfig.business.hours.weekday = {
        open: process.env.BUSINESS_HOURS_WEEKDAY_OPEN || '09:00',
        close: process.env.BUSINESS_HOURS_WEEKDAY_CLOSE || '20:00',
    };
}
if (!envConfig.business.hours.weekend || typeof envConfig.business.hours.weekend !== 'object') {
    envConfig.business.hours.weekend = {
        open: process.env.BUSINESS_HOURS_WEEKEND_OPEN || '10:00',
        close: process.env.BUSINESS_HOURS_WEEKEND_CLOSE || '21:00',
    };
}

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
    
    if (!(this.backend.fields && this.backend.fields.productName)) {
        errors.push('DB_FIELD_PRODUCT_NAME es requerido');
    }
    
    if (!(this.backend.fields && this.backend.fields.itemPrimaryCount)) {
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
    console.log(`📍 Ubicación: ${(this.business.location && this.business.location.city) ? this.business.location.city : (this.business.city || 'Ciudad')}`);
    console.log(`📦 Producto: ${this.nomenclature.productType} → ${this.nomenclature.productTypePlural}`);
    console.log(`🔧 Item Primario: ${this.nomenclature.itemPrimary} (Campo: ${(this.backend.fields && this.backend.fields.itemPrimaryCount) ? this.backend.fields.itemPrimaryCount : (this.itemPrimaryCount || 'Campo no definido')})`);
    console.log(`🔧 Item Secundario: ${this.nomenclature.itemSecondary} (Campo: ${(this.backend.fields && this.backend.fields.itemSecondaryCount) ? this.backend.fields.itemSecondaryCount : (this.itemSecondaryCount || 'Campo no definido')})`);
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
