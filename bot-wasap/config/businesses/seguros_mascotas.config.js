'use strict';

module.exports = {
    business: {
        id: 'SEGUROS_MASCOTAS',
        name: 'TE ASEGURAMOS',
        shortName: 'TE ASEGURAMOS',
        brand: 'TE ASEGURAMOS',
        partner: 'Seguros Mundial',
        type: 'seguros_mascotas',
        industry: 'insurance',
        city: 'Bogotá',
        department: 'Cundinamarca',
        country: 'Colombia',
        timezone: 'America/Bogota',
        language: 'es-CO',
        currency: 'COP'
    },

    contact: {
        phone: '+57 313 877 7115',
        whatsapp: '+573138777115',
        email: 'seguros@mascotas.co',
        website: 'https://www.segurosmundial.com.co/pagos/',
        address: {
            street: 'Av Principal #123',
            neighborhood: 'Centro',
            city: 'Bogotá',
            department: 'Cundinamarca',
            postalCode: '110111',
            coordinates: { lat: 4.711, lng: -74.0721 },
            googleMapsUrl: null
        },
        socialMedia: {
            facebook: null,
            instagram: null,
            twitter: null,
            tiktok: null
        }
    },

    schedule: {
        monday: { open: '08:00', close: '18:00', closed: false },
        tuesday: { open: '08:00', close: '18:00', closed: false },
        wednesday: { open: '08:00', close: '18:00', closed: false },
        thursday: { open: '08:00', close: '18:00', closed: false },
        friday: { open: '08:00', close: '18:00', closed: false },
        saturday: { open: '09:00', close: '14:00', closed: false },
        sunday: { open: '00:00', close: '00:00', closed: true },
        holidays: [],
        specialDays: []
    },

    plans: {
        perroPlus: {
            name: 'Plan PLUS',
            price: 259900,
            label: 'Plan PLUS Perro',
            code: 'PLUS'
        },
        perroPremium: {
            name: 'Plan PREMIUM',
            price: 354900,
            label: 'Plan PREMIUM Perro',
            code: 'PREMIUM'
        },
        gato: {
            name: 'Plan Gato',
            price: 200900,
            label: 'Plan Gato',
            code: 'GATO'
        }
    },

    bot: {
        welcomeMessage: `🐾 Hola, bienvenido a TE ASEGURAMOS
Aliados de Seguros Mundial ❤️

Sabemos que tu mascota es parte de tu familia.

¿A quién deseas proteger hoy?

1️⃣ Perro 🐶
2️⃣ Gato 🐱`,

        mainMenu: {
            options: [
                { id: '1', label: 'Perro 🐶', emoji: '🐶' },
                { id: '2', label: 'Gato 🐱', emoji: '🐱' }
            ],
            message: `🐾 Hola, bienvenido a TE ASEGURAMOS
Aliados de Seguros Mundial ❤️

Sabemos que tu mascota es parte de tu familia.

¿A quién deseas proteger hoy?

1️⃣ Perro 🐶
2️⃣ Gato 🐱

Escribe el número de la opción.`
        },

        infoMessage: `📍 *TE ASEGURAMOS*
Aliados de Seguros Mundial

Protege a tu mascota con los mejores planes.

*Contacto:*
📱 WhatsApp: +57 313 877 7115
🌐 Web: segurosmundial.com.co/pagos/`,

        phases: {
            enableBrowseImages: false,
            enableProductSelection: false,
            enableCustomOrders: false,
            enableReservations: false,
            enableAIAssistant: false
        },

        ai: {
            enabled: false,
            model: '',
            temperature: 0.7,
            maxTokens: 0,
            systemPrompt: ''
        },

        frustration: {
            enabled: true,
            maxErrors: 2,
            notifyAdmin: true,
            muteAfterErrors: true
        },

        greetings: {
            type: 'colombia',
            customGreetings: [
                'hola te aseguramos',
                'hola seguro mascotas',
                'hola seguros mascotas',
                'buenas te aseguramos',
                'proteccion mascotas',
                'seguro perro',
                'seguro gato',
                'quiero proteger'
            ]
        },

        // 🐾 FLUJO COMPLETO DE SEGURO MASCOTAS
        insuranceFlow: {
            enabled: true,

            // Imágenes (rutas relativas a bot-wasap/)
            images: {
                gato: 'assets/plan_gato.jpeg',
                perroPlus: 'assets/plan_perro_plus.jpeg',
                perroPremium: 'assets/plan_perro_premium.jpeg'
            },

            messages: {
                gato: `🐱 *Plan Gatos*

💰 *Valor anual: $200.900*

📅 Vigencia: 1 año

✅ Protección especializada para gatos
✅ Cobertura veterinaria
✅ Cobertura por accidentes
✅ Asistencia exequial

1️⃣ Elegir este plan
2️⃣ Volver al menu`,

                perroPlus: `🐶 *Plan PLUS*

💰 *Valor anual: $259.900*

📅 Vigencia: 1 año

✅ Cubrimiento veterinario básico
✅ Cobertura por accidentes
✅ Asistencia exequial

1️⃣ Elegir este plan
2️⃣ Ver plan PREMIUM`,

                perroPremium: `🐶 *Plan PREMIUM*

💰 *Valor anual: $354.900*

📅 Vigencia: 1 año

✅ Cobertura ampliada
✅ Mayor protección veterinaria
✅ Cobertura por accidentes
✅ Asistencia exequial

1️⃣ Elegir este plan
2️⃣ Volver a planes`,

                datosTitularNombre: `Perfecto 🙌

Vamos a proteger a tu mascota 🐾

✍️ ¿Cuál es tu nombre completo?`,

                datosTitularDocumento: `📄 ¿Qué tipo de documento tienes?

1️⃣ Cédula de Ciudadanía
2️⃣ NIT
3️⃣ Tarjeta de Identidad
4️⃣ Cédula de Extranjería`,

                datosTitularNumero: `🔢 ¿Cuál es tu número de identificación?`,

                datosTitularFechaNacimiento: `🎂 ¿Cuál es tu fecha de nacimiento?

📝 Formato: DD/MM/YYYY
Ejemplo: 15/03/1990`,

                datosTitularCiudad: `📍 ¿Ciudad y departamento?

Ejemplo: Bogota, Cundinamarca`,

                datosTitularDireccion: `🏠 Dirección de residencia

Ejemplo: Calle 123 #45-67, Barrio Centro`,

                datosTitularContacto: `📞 ¿Cuál es tu número de celular?

Ejemplo: 3138777115`,

                datosMascotaNombre: `🐾 ¿Cómo se llama tu mascota?`,

                datosMascotaEdad: `🎂 ¿Cuántos años tiene tu mascota?

📝 Solo números (ej: 3, 5, 8)`,

                datosMascotaRazaPerro: `🦴 ¿Que raza es tu perro?

Ejemplos:
• Labrador
• Golden Retriever
• Pastor Aleman
• Bulldog
• Criollo

✍️ Puedes escribir cualquier otra raza si no aparece en los ejemplos.`,

                datosMascotaRazaGato: `🐱 ¿Que raza es tu gato?

Ejemplos:
• Criollo
• Siamés
• Persa
• Angora

✍️ Puedes escribir cualquier otra raza si no aparece en los ejemplos.`,

                confirmacion: `💛 Ya casi terminamos

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
2️⃣ Corregir`,

                rechazoEdad: `😔 Lo sentimos, {nombre}.

Actualmente no es posible asegurar mascotas mayores de 12 años.

Gracias por comunicarte con TE ASEGURAMOS, aliados de Seguros Mundial ❤️`,

                final: `💛 Perfecto, {nombre}.

Tu solicitud fue registrada exitosamente.

📞 Un asesor de TE ASEGURAMOS y Seguros Mundial se pondrá en contacto contigo para continuar el proceso de emisión y pago de la póliza.

¡Gracias por proteger a tu compañero de vida! 🐾`,

                error: `❌ Opción no válida.

Por favor selecciona una opción del menú.`
            }
        }
    },

    catalog: {
        categories: [],
        products: {
            requireImage: false,
            allowCustomization: false,
            maxCustomOptions: 0,
            customFields: {}
        },
        inventory: {
            trackStock: false,
            showOutOfStock: true,
            allowBackorder: false
        }
    },

    checkout: {
        requiredFields: {
            name: true,
            phone: true,
            address: false,
            email: false
        },
        paymentMethods: [
            { id: 'transferencia', name: 'Transferencia Bancaria 🏦', enabled: true }
        ],
        delivery: {
            enabled: false,
            freeDeliveryMinAmount: 0,
            deliveryFee: 0,
            estimatedTime: '',
            zones: []
        },
        pickup: {
            enabled: false,
            estimatedTime: ''
        },
        validation: {
            minOrderAmount: 0,
            maxOrderAmount: 0,
            maxItemsPerOrder: 0
        }
    },

    admin: {
        business_admin_jids: [
            '573138777115@c.us'
        ],
        system_admin_jids: [
            '573138777115@c.us'
        ],
        jids: [], // DEPRECATED - usar business_admin_jids y system_admin_jids
        notifications: {
            newOrder: true,
            orderCancelled: true,
            customerIssue: true,
            lowStock: false,
            dailySummary: false
        },
        commands: {
            prefix: '/',
            enabled: ['stats', 'users', 'broadcast', 'reload', 'clear', 'mute', 'unmute']
        }
    },

    backend: {
        apiBase: process.env.API_BASE || 'http://127.0.0.1:8001/api',
        timeout: 8000,
        endpoints: {
            products: '',
            productImage: '',
            search: '',
            orders: '',
            reservations: ''
        },
        sheets: {
            enabled: false,
            spreadsheetId: '',
            worksheets: {}
        }
    },

    features: {
        textParser: {
            enabled: false,
            confidence: 0.9
        },
        fuzzySearch: {
            enabled: false,
            threshold: 0.6
        },
        productCache: {
            enabled: false,
            ttl: 300000
        },
        logging: {
            level: 'info',
            saveConversations: true,
            saveErrors: true
        }
    }
};
