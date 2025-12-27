#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Script para eliminar BOM UTF-8 del archivo tmp/resp_sabores.json
"""

import codecs
from pathlib import Path

file_path = Path('tmp/resp_sabores.json')

if not file_path.exists():
    print(f"❌ Archivo no encontrado: {file_path}")
    exit(1)

# Leer archivo
with open(file_path, 'rb') as f:
    content = f.read()

# Verificar si tiene BOM UTF-8
if content.startswith(codecs.BOM_UTF8):
    print(f"⚠️  Archivo contiene BOM UTF-8")
    
    # Eliminar BOM
    content = content[3:]
    
    # Guardar archivo sin BOM
    with open(file_path, 'wb') as f:
        f.write(content)
    
    print(f"✓ BOM UTF-8 eliminado de: {file_path}")
else:
    print(f"ℹ  Archivo NO contiene BOM UTF-8: {file_path}")
