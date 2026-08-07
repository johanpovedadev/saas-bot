#!/usr/bin/env node
/**
 * Git Pre-Commit Hook: Validar que no se agreguen funciones duplicadas
 * 
 * Instalación:
 *   1. Copiar a .git/hooks/pre-commit
 *   2. chmod +x .git/hooks/pre-commit (Linux/Mac)
 * 
 * O usar Husky:
 *   npm install husky --save-dev
 *   npx husky install
 *   npx husky add .git/hooks/pre-commit "node scripts/pre-commit-validate.js"
 */

const { execSync } = require('child_process');
const path = require('path');

console.log('\n🔍 Pre-commit: Validando funciones duplicadas...\n');

try {
    // Ejecutar validador
    const result = execSync('node scripts/validate_no_duplicates.js --stats', {
        cwd: process.cwd(),
        encoding: 'utf-8'
    });
    
    console.log(result);
    
    // Verificar si hay duplicados
    const hasError = execSync('node scripts/validate_no_duplicates.js', {
        cwd: process.cwd(),
        encoding: 'utf-8',
        stdio: 'pipe'
    });
    
    if (hasError.includes('❌')) {
        console.log('\n⚠️  ADVERTENCIA: Se detectaron funciones duplicadas');
        console.log('💡 Revisa el reporte arriba y consolida antes de hacer commit\n');
        
        // Opción: Bloquear commit (descomentar para activar)
        // process.exit(1);
        
        // Por ahora solo advertencia
        console.log('⏭️  Permitiendo commit (solo advertencia)\n');
    } else {
        console.log('✅ Pre-commit: Validación exitosa - No hay duplicados\n');
    }
    
} catch (error) {
    console.error('\n❌ Error en validación pre-commit:', error.message);
    console.log('⏭️  Continuando con commit (validación falló)\n');
    
    // No bloquear commit si el script falla
    process.exit(0);
}
