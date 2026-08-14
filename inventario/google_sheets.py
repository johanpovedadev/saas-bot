"""
Microservicio de Datos - Google Sheets
Responsabilidad: Leer y limpiar datos de Google Sheets
PROHIBIDO: Lógica de negocio específica de productos
"""
import os
import tempfile
import base64
import json
import gspread
import pandas as pd
from oauth2client.service_account import ServiceAccountCredentials
from datetime import datetime

# ============================================================================
# CONFIGURACIÓN DE CREDENCIALES
# ============================================================================

def _get_service_account_file():
    """
    Resuelve la ruta del archivo de credenciales de servicio de Google.
    Prioridad: 1) GOOGLE_APPLICATION_CREDENTIALS, 2) Base64, 3) Fallback
    """
    # 1) explicit path to credentials file
    sa_path = os.environ.get('GOOGLE_APPLICATION_CREDENTIALS')
    if sa_path:
        return sa_path

    # 2) base64 encoded JSON or raw JSON in env var
    sa_b64 = os.environ.get('GOOGLE_SERVICE_ACCOUNT_B64') or os.environ.get('GOOGLE_SERVICE_ACCOUNT')
    if sa_b64:
        try:
            data = base64.b64decode(sa_b64)
        except Exception:
            # assume it's raw JSON string
            data = sa_b64.encode('utf8')
        tf = tempfile.NamedTemporaryFile(delete=False, suffix='.json')
        tf.write(data)
        tf.flush()
        return tf.name

    # 3) fallback to repo-local filename (legacy)
    return 'service_account.json'

SERVICE_ACCOUNT_FILE = _get_service_account_file()

# ============================================================================
# CONFIGURACIÓN DESDE .ENV (SIN VALORES POR DEFECTO)
# ============================================================================
# ARQUITECTURA MULTI-NEGOCIO: TODO debe venir del .env sin fallbacks hardcodeados
# 
# ESTRUCTURA DE GOOGLE SHEETS:
# - 1 archivo de Google Sheets por negocio
# - Página 1: Inventarios (productos)
# - Página 2: Entregas (domicilios)
# - Ambas páginas usan el MISMO SPREADSHEET_ID

GOOGLE_SHEET_ID = os.environ.get('GOOGLE_SHEET_ID')
INVENTARIO_SHEET_NAME = os.environ.get('SHEET_NAME_PRODUCTS')
ENTREGAS_SHEET_NAME = os.environ.get('SHEET_TAB_DOMICILIOS')
# Hoja de pedidos puede estar en un spreadsheet distinto al de productos.
# Por defecto usa el mismo spreadsheet que los productos (compatibilidad).
GOOGLE_SHEET_ID_ENTREGAS = os.environ.get('GOOGLE_SHEET_ID_ENTREGAS') or GOOGLE_SHEET_ID

# Validación de variables críticas al inicio
if not GOOGLE_SHEET_ID:
    raise ValueError("ERROR: GOOGLE_SHEET_ID no esta configurado en el .env")
if not INVENTARIO_SHEET_NAME:
    raise ValueError("ERROR: SHEET_NAME_PRODUCTS no esta configurado en el .env")
if not ENTREGAS_SHEET_NAME:
    raise ValueError("ERROR: SHEET_TAB_DOMICILIOS no esta configurado en el .env")

print(f"Configuracion cargada:")
print(f"   Google Sheet ID: {GOOGLE_SHEET_ID}")
print(f"   Pagina Inventario: {INVENTARIO_SHEET_NAME}")
print(f"   Pagina Entregas: {ENTREGAS_SHEET_NAME}")

# ============================================================================
# CLIENTE GSPREAD (SINGLETON)
# ============================================================================

_gspread_client = None

# ============================================================================
# ESTADO DE CONEXION (para health_check real, ver views.py:health_check)
# ============================================================================
_sheets_status = {'status': 'unknown', 'last_error': None, 'last_check': None}

def get_sheets_status():
    """Ultimo estado conocido de la conexion a Google Sheets (sin hacer una
    llamada nueva a la API) - se actualiza cada vez que get_clean_inventory()
    corre, exitoso o no."""
    return dict(_sheets_status)

def _report_sheets_ok():
    _sheets_status['status'] = 'ok'
    _sheets_status['last_error'] = None
    _sheets_status['last_check'] = datetime.now().isoformat()

def _report_sheets_error(message):
    _sheets_status['status'] = 'error'
    _sheets_status['last_error'] = message
    _sheets_status['last_check'] = datetime.now().isoformat()

def _get_gspread_client():
    """Retorna un cliente gspread autenticado (singleton)"""
    global _gspread_client
    if _gspread_client is None:
        scope = ["https://spreadsheets.google.com/feeds", "https://www.googleapis.com/auth/drive"]
        creds = ServiceAccountCredentials.from_json_keyfile_name(SERVICE_ACCOUNT_FILE, scope)
        _gspread_client = gspread.authorize(creds)
    return _gspread_client

# ============================================================================
# FUNCIONES DE ACCESO A INVENTARIO (GENÉRICO)
# ============================================================================

def get_clean_inventory():
    """
    Obtiene el inventario desde Google Sheets y retorna JSON normalizado.
    
    ARQUITECTURA DE ATRIBUTOS DINÁMICOS:
    - NO conoce nombres de productos (helado, empanada, etc.)
    - Mapea columnas numéricas a atributos genéricos: Atributo_1_Cantidad, Atributo_2_Cantidad
    - Elimina duplicados por CodigoProducto usando Pandas
    - Valida tipos de datos y lanza errores descriptivos
    - Retorna Array de objetos con estructura predecible
    
    MAPEO DE COLUMNAS:
    - Numero_de_Sabores → Se mantiene como está (el bot mapea dinámicamente)
    - Numero_de_Toppings → Se mantiene como está (el bot mapea dinámicamente)
    - Precio_Venta → Convertido a float
    - Stock_Actual → Convertido a int
      Returns:
        list: Array de diccionarios con productos normalizados
        
    Raises:
        Exception: Si falta la columna CodigoProducto o hay error de conexión
    """
    try:
        client = _get_gspread_client()
        sheet = client.open_by_key(GOOGLE_SHEET_ID).worksheet(INVENTARIO_SHEET_NAME)
        
        print(f"Conectando a Sheet ID: {GOOGLE_SHEET_ID}, Hoja: {INVENTARIO_SHEET_NAME}")
        
        # Obtener todos los valores (sin procesar)
        all_values = sheet.get_all_values()
        
        if not all_values or len(all_values) < 2:
            print("El sheet esta vacio o solo tiene encabezados")
            return []
        
        # Separar encabezados y datos
        raw_headers = all_values[0]
        data_rows = all_values[1:]
        
        print(f"Encabezados originales: {raw_headers}")
        
        # Limpiar encabezados: renombrar duplicados y vacíos
        headers = []
        header_counts = {}
        
        for i, h in enumerate(raw_headers):
            h = str(h).strip()
            
            # Si está vacío, usar índice
            if not h:
                h = f"Column_{i}"
            
            # Si ya existe, agregar sufijo
            original_h = h
            count = header_counts.get(original_h, 0)
            header_counts[original_h] = count + 1
            
            if count > 0:
                h = f"{original_h}_{count}"
            
            headers.append(h)
        
        print(f"[OK] Encabezados limpios: {headers}")
        
        # Crear DataFrame con encabezados limpios
        df = pd.DataFrame(data_rows, columns=headers)
        
        # Eliminar filas completamente vacías
        df = df.dropna(how='all')
        
        # Eliminar columnas completamente vacías (ej: Column_X)
        df = df.dropna(axis=1, how='all')
        
        print(f"DataFrame: {len(df)} filas x {len(df.columns)} columnas")
        
        # Verificar que exista CodigoProducto
        if 'CodigoProducto' not in df.columns:
            print(f"ERROR: No se encontro la columna 'CodigoProducto'. Columnas disponibles: {list(df.columns)}")
            return []
        
        # Eliminar duplicados basándose en CodigoProducto
        df = df.drop_duplicates(subset=['CodigoProducto'], keep='first')
        
        # Eliminar filas donde CodigoProducto esté vacío
        df = df[df['CodigoProducto'].notna()]
        df = df[df['CodigoProducto'] != '']
        
        # Convertir de vuelta a lista de diccionarios
        clean_data = df.to_dict('records')
        
        print(f"[OK] Inventario limpio: {len(clean_data)} productos unicos")

        # Mostrar primer producto como ejemplo
        if clean_data:
            print(f"Ejemplo de producto: {clean_data[0]}")

        _report_sheets_ok()
        return clean_data

    except Exception as e:
        import traceback
        error_trace = traceback.format_exc()
        print(f"Error al obtener inventario limpio: {e}")
        print(f"Trace completo:\n{error_trace}")
        _report_sheets_error(str(e))
        return []

def conectar_sheet():
    """DEPRECATED: Usar get_clean_inventory() en su lugar"""
    client = _get_gspread_client()
    sheet = client.open_by_key(GOOGLE_SHEET_ID).worksheet(INVENTARIO_SHEET_NAME)
    return sheet

def obtener_inventario():
    """
    Obtiene el inventario sin limpiar duplicados.
    RECOMENDADO: Usar get_clean_inventory() en su lugar.
    """
    sheet = conectar_sheet()
    data = sheet.get_all_records()
    return data

def obtener_datos_inventario():
    """Alias para mantener compatibilidad. Usa get_clean_inventory()."""
    return get_clean_inventory()


# ============================================================================
# FUNCIONES DE ACCESO A ENTREGAS/PEDIDOS
# ============================================================================

def _get_entregas_worksheet():
    """Obtiene la hoja de entregas, creándola si no existe"""
    client = _get_gspread_client()
    ss = client.open_by_key(GOOGLE_SHEET_ID_ENTREGAS)
    try:
        return ss.worksheet(ENTREGAS_SHEET_NAME)
    except gspread.WorksheetNotFound:
        ws = ss.add_worksheet(title=ENTREGAS_SHEET_NAME, rows=1000, cols=20)
        ws.append_row([
            'Fecha', 'Nombre', 'Producto', 'Codigo', 'Telefono', 'Direccion',
            'Monto', 'Pago', 'Estado', 'Observaciones', 'ReferidoPor'
        ])
        return ws

def agregar_entrega(data: dict):
    """
    Agrega una nueva entrega/pedido a Google Sheets.
    
    Args:
        data (dict): Datos del pedido con llaves genéricas
        
    Returns:
        tuple: (success: bool, error_message: str)
    """
    try:
        ws = _get_entregas_worksheet()
        fecha = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

        fila = [
            fecha,
            data.get('nombre', ''),
            data.get('producto', ''),
            data.get('codigo', ''),
            data.get('telefono', ''),
            data.get('direccion', ''),
            data.get('monto', ''),
            data.get('pago', 'Pendiente'),
            data.get('estado', 'Por despachar'),
            data.get('observaciones', ''),
            data.get('referido_por', '')
        ]
        ws.append_row(fila, value_input_option='USER_ENTERED')
        return True, ''
    except Exception as e:
        return False, str(e)

def marcar_pago(codigo: str, pagado: bool):
    """Marca un pedido como pagado o pendiente"""
    try:
        ws = _get_entregas_worksheet()
        c = ws.find(codigo)
        if not c:
            return False, 'Código no encontrado en Entregas'
        row = c.row
        ws.update_cell(row, 8, 'Pagado' if pagado else 'Pendiente')
        return True, ''
    except Exception as e:
        return False, str(e)

def marcar_entrega(codigo: str, entregado: bool):
    """Marca un pedido como entregado o en ruta"""
    try:
        ws = _get_entregas_worksheet()
        c = ws.find(codigo)
        if not c:
            return False, 'Código no encontrado en Entregas'
        row = c.row
        ws.update_cell(row, 9, 'Entregado' if entregado else 'En ruta')
        return True, ''
    except Exception as e:
        return False, str(e)

# ============================================================================
# FUNCIONES LEGACY (MANTENER COMPATIBILIDAD)
# ============================================================================

def _client():
    """DEPRECATED: Usar _get_gspread_client()"""
    return _get_gspread_client()

def conectar_sheet_inventario():
    """DEPRECATED: Usar get_clean_inventory()"""
    client = _get_gspread_client()
    return client.open_by_key(GOOGLE_SHEET_ID).worksheet(INVENTARIO_SHEET_NAME)

def _cliente_gs():
    """DEPRECATED: Usar _get_gspread_client()"""
    return _get_gspread_client()

def _ws_entregas():
    """DEPRECATED: Usar _get_entregas_worksheet()"""
    return _get_entregas_worksheet()
