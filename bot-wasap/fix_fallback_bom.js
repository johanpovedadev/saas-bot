/**
 * Script para eliminar BOM UTF-8 del archivo de fallback
 * Corrige el error: "Unexpected UTF-8 BOM (decode using utf-8-sig)"
 */

const fs = require('fs');
const path = require('path');

console.log('\n' + '='.repeat(60));
console.log('🔧 ELIMINANDO BOM UTF-8 DEL ARCHIVO FALLBACK');
console.log('='.repeat(60) + '\n');

const fallbackPath = path.join(__dirname, 'sabores_toppings_fallback.json');

// Verificar que el archivo existe
if (!fs.existsSync(fallbackPath)) {
    console.log('❌ Archivo no encontrado: sabores_toppings_fallback.json');
    console.log('   Ruta buscada:', fallbackPath);
    console.log('\n⚠️  Este archivo no es crítico, el bot puede funcionar sin él.\n');
    process.exit(0);
}

try {
    // Leer el archivo como buffer para detectar BOM
    const buffer = fs.readFileSync(fallbackPath);
    
    // Detectar BOM UTF-8 (EF BB BF)
    const hasBOM = buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF;
    
    if (hasBOM) {
        console.log('⚠️  BOM UTF-8 detectado (bytes: EF BB BF)');
        
        // Eliminar los primeros 3 bytes (BOM)
        const contentWithoutBOM = buffer.slice(3);
        
        // Guardar sin BOM
        fs.writeFileSync(fallbackPath, contentWithoutBOM);
        
        console.log('✅ BOM eliminado correctamente');
    } else {
        console.log('ℹ️  No se detectó BOM UTF-8 (el archivo está limpio)');
    }
    
    // Validar que el JSON sea válido
    const content = fs.readFileSync(fallbackPath, 'utf8');
    
    try {
        const data = JSON.parse(content);
        console.log('✅ JSON válido');
        console.log(`   Sabores: ${data.sabores?.length || 0}`);
        console.log(`   Toppings: ${data.toppings?.length || 0}`);
    } catch (jsonError) {
        console.log('❌ Error al parsear JSON:');
        console.log(`   ${jsonError.message}`);
        console.log('\n   Primeros 200 caracteres del archivo:');
        console.log(`   ${content.substring(0, 200)}...\n`);
        process.exit(1);
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('✅ ARCHIVO CORREGIDO Y VALIDADO');
    console.log('='.repeat(60) + '\n');
    
} catch (error) {
    console.log('❌ Error al procesar archivo:');
    console.log(`   ${error.message}\n`);
    process.exit(1);
}
