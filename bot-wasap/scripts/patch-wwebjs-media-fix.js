'use strict';

/**
 * Parche para un bug conocido y ampliamente reportado de whatsapp-web.js
 * 1.34.7 (la ultima version publicada): desde el rollout de WhatsApp Web del
 * 2026-09-17, TODO envio de media (imagen/video/audio/documento) falla con
 * "Data passed to getter must include an id property (it's how we memoize)
 * but got undefined" - los mensajes de TEXTO siguen funcionando normal.
 *
 * Causa raiz (confirmada en el issue upstream, PR #201923 sin mergear
 * todavia, sin release nueva de la libreria que la incluya): mediaOptions
 * (el resultado de processMediaData) trae una propiedad privada __x_id
 * enumerable que, al spreadearse en la construccion del mensaje saliente
 * (src/util/Injected/Utils.js), pisa el id: newMsgKey correcto.
 *
 * Fix de una linea (el mismo que ya circula como parche no oficial en varios
 * proyectos basados en esta libreria): borrar message.__x_id justo despues
 * de construir el objeto, antes de que WhatsApp Web arme el modelo Msg real.
 *
 * Este script se corre solo (ver "postinstall" en package.json) porque
 * node_modules no se versiona en git - sin esto, cualquier `npm install`
 * nuevo perderia el parche y el envio de imagenes volveria a romperse en
 * silencio. Es idempotente: si el parche ya esta aplicado (o si una version
 * nueva de la libreria ya trae el fix de origen), no hace nada.
 */

const fs = require('fs');
const path = require('path');

const TARGET_FILE = path.join(__dirname, '..', 'node_modules', 'whatsapp-web.js', 'src', 'util', 'Injected', 'Utils.js');

const ANCHOR = `            ...botOptions,
            ...extraOptions,
        };

        // Bot's won't reply if canonicalUrl is set (linking)`;

const PATCHED = `            ...botOptions,
            ...extraOptions,
        };

        // PARCHE (issue conocido de WhatsApp Web desde el rollout del
        // 2026-09-17, sin release nueva de whatsapp-web.js todavia - ver
        // scripts/patch-wwebjs-media-fix.js, que reaplica esto tras cada
        // npm install): mediaOptions trae una propiedad privada __x_id
        // enumerable que, al spreadearse arriba, pisa el id: newMsgKey
        // correcto - eso rompe TODO envio de imagen/video/audio/documento
        // con "Data passed to getter must include an id property". Se borra
        // antes de construir el modelo Msg real.
        delete message.__x_id;

        // Bot's won't reply if canonicalUrl is set (linking)`;

function main() {
    if (!fs.existsSync(TARGET_FILE)) {
        console.log('[patch-wwebjs-media-fix] whatsapp-web.js no esta instalado todavia, se omite (normal en un primer `npm install`).');
        return;
    }

    const content = fs.readFileSync(TARGET_FILE, 'utf8');

    if (content.includes('delete message.__x_id;')) {
        console.log('[patch-wwebjs-media-fix] Ya aplicado, nada que hacer.');
        return;
    }

    if (!content.includes(ANCHOR)) {
        console.warn(
            '[patch-wwebjs-media-fix] ADVERTENCIA: no se encontro el punto exacto donde aplicar el parche - ' +
            'probablemente whatsapp-web.js se actualizo de version (puede que ya traiga el fix de origen, o que ' +
            'haya cambiado el codigo). Revisar manualmente si el envio de imagenes vuelve a fallar con ' +
            '"Data passed to getter must include an id property".'
        );
        return;
    }

    fs.writeFileSync(TARGET_FILE, content.replace(ANCHOR, PATCHED), 'utf8');
    console.log('[patch-wwebjs-media-fix] Parche aplicado - envio de imagenes/video/audio deberia funcionar de nuevo.');
}

main();
