#!/usr/bin/env node
/**
 * Script de Validación: Detecta funciones duplicadas antes de commit
 * 
 * Uso:
 *   node scripts/validate_no_duplicates.js
 *   node scripts/validate_no_duplicates.js --file=path/to/file.js
 *   node scripts/validate_no_duplicates.js --function=nombreFuncion
 * 
 * Regla COPILOT:
 *   🚫 NO DUPLICAR funciones - Verificar en utils/ primero
 */

const fs = require('fs');
const path = require('path');

// ============================================================================
// CONFIGURACIÓN
// ============================================================================

const CONFIG = {
    // Directorios a escanear
    scanDirs: [
        'bot-wasap/utils',
        'bot-wasap/services',
        'bot-wasap/handlers',
        'bot-wasap/config'
    ],
    
    // Extensiones de archivo a analizar
    extensions: ['.js', '.ts'],
    
    // Archivos a excluir
    excludeFiles: [
        'node_modules',
        '.git',
        'test',
        'spec',
        '.backup',
        '.old'
    ],
    
    // Patrones de funciones a detectar
    functionPatterns: [
        /function\s+(\w+)\s*\(/g,           // function nombre()
        /const\s+(\w+)\s*=\s*function/g,    // const nombre = function
        /const\s+(\w+)\s*=\s*\(/g,          // const nombre = ()
        /(\w+)\s*:\s*function/g,            // nombre: function
        /async\s+function\s+(\w+)/g,        // async function nombre
        /const\s+(\w+)\s*=\s*async/g        // const nombre = async
    ]
};

// ============================================================================
// CLASES PRINCIPALES
// ============================================================================

class FunctionRegistry {
    constructor() {
        this.functions = new Map(); // nombre -> [{ file, line, code }]
    }

    /**
     * Agregar función al registro
     */
    add(name, file, line, code) {
        if (!this.functions.has(name)) {
            this.functions.set(name, []);
        }
        
        this.functions.get(name).push({
            file: file,
            line: line,
            code: code.trim()
        });
    }

    /**
     * Obtener todas las ocurrencias de una función
     */
    get(name) {
        return this.functions.get(name) || [];
    }

    /**
     * Verificar si función está duplicada
     */
    isDuplicated(name) {
        return this.functions.has(name) && this.functions.get(name).length > 1;
    }

    /**
     * Obtener todas las funciones duplicadas
     */
    getDuplicates() {
        const duplicates = [];
        
        for (const [name, occurrences] of this.functions.entries()) {
            if (occurrences.length > 1) {
                duplicates.push({
                    name: name,
                    count: occurrences.length,
                    occurrences: occurrences
                });
            }
        }
        
        return duplicates.sort((a, b) => b.count - a.count);
    }

    /**
     * Buscar función por nombre (búsqueda flexible)
     */
    search(query) {
        const results = [];
        const lowerQuery = query.toLowerCase();
        
        for (const [name, occurrences] of this.functions.entries()) {
            if (name.toLowerCase().includes(lowerQuery)) {
                results.push({
                    name: name,
                    count: occurrences.length,
                    occurrences: occurrences
                });
            }
        }
        
        return results;
    }

    /**
     * Estadísticas del registro
     */
    getStats() {
        let totalFunctions = 0;
        let duplicatedFunctions = 0;
        let totalOccurrences = 0;

        for (const [name, occurrences] of this.functions.entries()) {
            totalFunctions++;
            totalOccurrences += occurrences.length;
            
            if (occurrences.length > 1) {
                duplicatedFunctions++;
            }
        }

        return {
            totalFunctions,
            duplicatedFunctions,
            totalOccurrences,
            uniqueFunctions: totalFunctions - duplicatedFunctions
        };
    }
}

// ============================================================================
// FUNCIONES DE ESCANEO
// ============================================================================

/**
 * Escanear archivo y extraer funciones
 */
function scanFile(filePath, registry) {
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n');
        
        lines.forEach((line, index) => {
            // Ignorar comentarios
            const trimmedLine = line.trim();
            if (trimmedLine.startsWith('//') || trimmedLine.startsWith('/*') || trimmedLine.startsWith('*')) {
                return;
            }

            // Buscar patrones de función
            CONFIG.functionPatterns.forEach(pattern => {
                const matches = [...line.matchAll(pattern)];
                
                matches.forEach(match => {
                    const functionName = match[1];
                    
                    // Ignorar funciones privadas (_nombre) y callbacks comunes
                    if (functionName && 
                        !functionName.startsWith('_') &&
                        !['then', 'catch', 'finally', 'map', 'filter', 'reduce'].includes(functionName)) {
                        
                        registry.add(
                            functionName,
                            filePath,
                            index + 1,
                            line
                        );
                    }
                });
            });
        });
        
    } catch (error) {
        console.error(`⚠️  Error leyendo ${filePath}: ${error.message}`);
    }
}

/**
 * Escanear directorio recursivamente
 */
function scanDirectory(dirPath, registry) {
    try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        
        entries.forEach(entry => {
            const fullPath = path.join(dirPath, entry.name);
            
            // Verificar si debe excluirse
            const shouldExclude = CONFIG.excludeFiles.some(pattern => 
                fullPath.includes(pattern)
            );
            
            if (shouldExclude) {
                return;
            }
            
            if (entry.isDirectory()) {
                scanDirectory(fullPath, registry);
            } else if (entry.isFile()) {
                const ext = path.extname(entry.name);
                if (CONFIG.extensions.includes(ext)) {
                    scanFile(fullPath, registry);
                }
            }
        });
        
    } catch (error) {
        console.error(`⚠️  Error escaneando ${dirPath}: ${error.message}`);
    }
}

// ============================================================================
// REPORTES
// ============================================================================

/**
 * Generar reporte de duplicados
 */
function generateDuplicatesReport(registry) {
    const duplicates = registry.getDuplicates();
    
    console.log('\n' + '='.repeat(80));
    console.log('  🔍 REPORTE DE FUNCIONES DUPLICADAS');
    console.log('='.repeat(80));
    
    if (duplicates.length === 0) {
        console.log('\n✅ ¡Excelente! No se encontraron funciones duplicadas.\n');
        return true;
    }
    
    console.log(`\n❌ Encontradas ${duplicates.length} funciones duplicadas:\n`);
    
    duplicates.forEach((dup, index) => {
        console.log(`${index + 1}. 🔴 ${dup.name} (${dup.count} ocurrencias):`);
        
        dup.occurrences.forEach((occ, i) => {
            const relPath = path.relative(process.cwd(), occ.file);
            console.log(`   ${i + 1}) ${relPath}:${occ.line}`);
            console.log(`      ${occ.code.substring(0, 60)}...`);
        });
        
        console.log('');
    });
    
    console.log('💡 Sugerencia: Consolidar en utils/ y eliminar duplicados\n');
    
    return false;
}

/**
 * Generar reporte de búsqueda
 */
function generateSearchReport(registry, query) {
    const results = registry.search(query);
    
    console.log('\n' + '='.repeat(80));
    console.log(`  🔎 BÚSQUEDA: "${query}"`);
    console.log('='.repeat(80));
    
    if (results.length === 0) {
        console.log(`\n❌ No se encontraron funciones que coincidan con "${query}"\n`);
        return;
    }
    
    console.log(`\n✅ Encontradas ${results.length} funciones:\n`);
    
    results.forEach((result, index) => {
        const status = result.count > 1 ? '🔴 DUPLICADA' : '✅ ÚNICA';
        console.log(`${index + 1}. ${status} ${result.name} (${result.count} ocurrencia${result.count > 1 ? 's' : ''}):`);
        
        result.occurrences.forEach((occ, i) => {
            const relPath = path.relative(process.cwd(), occ.file);
            console.log(`   ${i + 1}) ${relPath}:${occ.line}`);
        });
        
        console.log('');
    });
}

/**
 * Generar reporte de estadísticas
 */
function generateStatsReport(registry) {
    const stats = registry.getStats();
    
    console.log('\n' + '='.repeat(80));
    console.log('  📊 ESTADÍSTICAS DEL PROYECTO');
    console.log('='.repeat(80));
    console.log('');
    console.log(`  Total de funciones únicas:    ${stats.totalFunctions}`);
    console.log(`  Total de ocurrencias:         ${stats.totalOccurrences}`);
    console.log(`  Funciones únicas (sin dupl.): ${stats.uniqueFunctions}`);
    console.log(`  Funciones duplicadas:         ${stats.duplicatedFunctions}`);
    
    if (stats.totalFunctions > 0) {
        const dupPercentage = ((stats.duplicatedFunctions / stats.totalFunctions) * 100).toFixed(1);
        console.log(`  Porcentaje de duplicación:    ${dupPercentage}%`);
        
        if (dupPercentage > 10) {
            console.log('\n  ⚠️  Advertencia: Alta tasa de duplicación (> 10%)');
        } else if (dupPercentage > 0) {
            console.log('\n  ℹ️  Hay algunas duplicaciones que podrían consolidarse');
        } else {
            console.log('\n  ✅ Código limpio: Sin duplicaciones');
        }
    }
    
    console.log('');
}

// ============================================================================
// FUNCIÓN PRINCIPAL
// ============================================================================

function main() {
    console.log('\n🔍 Validador de Código - Detección de Funciones Duplicadas\n');
    
    // Parsear argumentos
    const args = process.argv.slice(2);
    const options = {
        file: null,
        function: null,
        stats: false
    };
    
    args.forEach(arg => {
        if (arg.startsWith('--file=')) {
            options.file = arg.split('=')[1];
        } else if (arg.startsWith('--function=')) {
            options.function = arg.split('=')[1];
        } else if (arg === '--stats') {
            options.stats = true;
        } else if (arg === '--help' || arg === '-h') {
            console.log('Uso:');
            console.log('  node validate_no_duplicates.js                  # Escanear todo');
            console.log('  node validate_no_duplicates.js --stats          # Solo estadísticas');
            console.log('  node validate_no_duplicates.js --file=path.js   # Escanear archivo');
            console.log('  node validate_no_duplicates.js --function=nom   # Buscar función');
            console.log('');
            process.exit(0);
        }
    });
    
    // Crear registro
    const registry = new FunctionRegistry();
    
    // Escanear según opciones
    if (options.file) {
        console.log(`📂 Escaneando archivo: ${options.file}\n`);
        scanFile(options.file, registry);
    } else {
        console.log('📂 Escaneando directorios:');
        CONFIG.scanDirs.forEach(dir => {
            const fullPath = path.join(process.cwd(), dir);
            if (fs.existsSync(fullPath)) {
                console.log(`   - ${dir}`);
                scanDirectory(fullPath, registry);
            }
        });
        console.log('');
    }
    
    // Generar reportes
    if (options.function) {
        generateSearchReport(registry, options.function);
    } else if (options.stats) {
        generateStatsReport(registry);
    } else {
        const isClean = generateDuplicatesReport(registry);
        generateStatsReport(registry);
        
        // Exit code para CI/CD
        process.exit(isClean ? 0 : 1);
    }
}

// ============================================================================
// EJECUTAR
// ============================================================================

if (require.main === module) {
    main();
}

module.exports = { FunctionRegistry, scanFile, scanDirectory };
