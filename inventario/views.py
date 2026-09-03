from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.conf import settings
import unicodedata
import json
import gspread
from google.oauth2 import service_account
from datetime import datetime
import Levenshtein
from .models import Producto
import os
import tempfile
import base64
from pathlib import Path

# Resolve SERVICE_ACCOUNT_FILE: prefer env path, then base64 JSON, then default file
def _get_service_account_file():
    env_path = os.environ.get('GOOGLE_APPLICATION_CREDENTIALS')
    if env_path:
        return env_path

    sa_b64 = os.environ.get('GOOGLE_SERVICE_ACCOUNT_B64') or os.environ.get('GOOGLE_SERVICE_ACCOUNT')
    if sa_b64:
        try:
            data = base64.b64decode(sa_b64)
        except Exception:
            data = sa_b64.encode('utf8')
        tf = tempfile.NamedTemporaryFile(delete=False, suffix='.json')
        tf.write(data)
        tf.flush()
        return tf.name

    # fallback to project-local file
    return settings.BASE_DIR / 'service_account.json'

# --- Configuración de la API de Google Sheets ---
SERVICE_ACCOUNT_FILE = _get_service_account_file()
SCOPES = ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive']

# Lazy gspread client initialization: try env (base64), then file path, and load .env files if necessary
global_gs_client = None

def _load_dotenv_files_if_present():
    """Load .env files found in project root and bot-wasap into os.environ if keys are missing.
    This is a permissive loader that won't overwrite existing env vars."""
    try:
        candidates = [str(settings.BASE_DIR / '.env'), str(settings.BASE_DIR / 'bot-wasap' / '.env')]
        for p in candidates:
            if os.path.exists(p):
                try:
                    with open(p, 'r', encoding='utf8') as fh:
                        for line in fh:
                            line = line.strip()
                            if not line or line.startswith('#') or line.startswith('//'):
                                continue
                            if '=' not in line:
                                continue
                            k, v = line.split('=', 1)
                            k = k.strip(); v = v.strip().strip('"').strip("'")
                            if k and (k not in os.environ or not os.environ.get(k)):
                                os.environ[k] = v
                except Exception:
                    # ignore per-file errors
                    continue
    except Exception:
        pass

def get_gs_client(force_reload=False):
    """Return a cached gspread client or attempt to initialize it using env/file.
    This function tolerates missing credentials and returns None in that case."""
    global global_gs_client
    if global_gs_client is not None and not force_reload:
        return global_gs_client

    # Attempt to load .env into process env so Docker/Windows local .env are honored
    _load_dotenv_files_if_present()

    # 1) Try base64 JSON in env
    sa_b64 = os.environ.get('GOOGLE_SERVICE_ACCOUNT_B64') or os.environ.get('GOOGLE_SERVICE_ACCOUNT')
    if sa_b64:
        try:
            try:
                raw = base64.b64decode(sa_b64)
            except Exception:
                raw = sa_b64.encode('utf8')
            sa_info = json.loads(raw.decode('utf8'))
            creds = service_account.Credentials.from_service_account_info(sa_info, scopes=SCOPES)
            client = gspread.authorize(creds)
            client.http_client.set_timeout(10)
            global_gs_client = client
            return client
        except Exception as e:
            print('WARNING: failed to init gspread from GOOGLE_SERVICE_ACCOUNT_B64:', e)

    # 2) Try file path from env or resolved SERVICE_ACCOUNT_FILE
    sa_file = os.environ.get('GOOGLE_APPLICATION_CREDENTIALS') or str(SERVICE_ACCOUNT_FILE)
    if sa_file and os.path.exists(str(sa_file)) and os.path.getsize(str(sa_file)) > 10:
        try:
            creds = service_account.Credentials.from_service_account_file(str(sa_file), scopes=SCOPES)
            client = gspread.authorize(creds)
            client.http_client.set_timeout(10)
            global_gs_client = client
            return client
        except Exception as e:
            print('WARNING: failed to init gspread from file:', e)

    # If we reach here, gspread client cannot be created
    global_gs_client = None
    return None

# ============================================================================
# CONFIGURACIÓN DE GOOGLE SHEETS - UN SOLO SPREADSHEET CON MÚLTIPLES HOJAS
# ============================================================================
# Usamos UN SOLO spreadsheet con dos hojas:
# 1. "Productos" → Inventario, categorías
# 2. "Domicilios" → Registro de pedidos/entregas
# ============================================================================

# ID único del spreadsheet (cargado dinámicamente desde .env)
# CRÍTICO: Leer dinámicamente para asegurar que se use el .env correcto
def get_spreadsheet_id():
    """Obtiene el SPREADSHEET_ID desde variables de entorno, recargando .env si es necesario."""
    # Compatibilidad: usar GOOGLE_SHEET_ID si existe, si no SPREADSHEET_ID
    # Prefer explicit per-business sheet id from env. Do NOT default to another business id.
    return os.environ.get('GOOGLE_SHEET_ID') or os.environ.get('SPREADSHEET_ID', '')

# Mantener variable global para compatibilidad, pero se actualiza dinámicamente
SPREADSHEET_ID = get_spreadsheet_id()

def get_deliveries_spreadsheet_id():
    """Obtiene el SPREADSHEET_ID de pedidos (puede ser distinto al de productos).
    Usa GOOGLE_SHEET_ID_ENTREGAS si existe, si no el mismo de productos."""
    return os.environ.get('GOOGLE_SHEET_ID_ENTREGAS') or get_spreadsheet_id()

# Nombres de las hojas dentro del spreadsheet (configurables por tenant desde .env)
def _env_or(name, default):
    return os.environ.get(name) or default

PRODUCTS_WORKSHEET_NAME = _env_or('SHEET_NAME_PRODUCTS', 'Inventario')  # Hoja con inventario (real en el sheet)
DELIVERIES_WORKSHEET_NAME = _env_or('SHEET_TAB_DOMICILIOS', 'Domicilios')  # Hoja con pedidos/entregas
LEADS_WORKSHEET_NAME = 'LEADS'  # Hoja con leads de seguros

# Hoja "Configuración" (Campo/Valor): tono, saludo, cuentas y mensajes editables
# por el dueño del negocio SIN tocar código. Se leen dinámicamente para que un
# cambio de .env.<BUSINESS_KEY> se aplique sin reiniciar el backend.
def get_config_worksheet_name():
    return _env_or('SHEET_NAME_CONFIG', 'Configuración')

def get_faq_worksheet_name():
    return _env_or('SHEET_NAME_FAQ', 'Preguntas_Frecuentes')

def _get_config_map():
    """Devuelve {campo: valor} desde la hoja 'Configuración' del Sheet del tenant."""
    data = _get_sheet_data(get_spreadsheet_id(), get_config_worksheet_name())
    if not data:
        return {}
    out = {}
    for row in data:
        campo = str(row.get('Campo', '') or '').strip()
        valor = row.get('Valor', '') or ''
        if campo:
            out[campo] = valor
    return out

def _get_faqs():
    """Devuelve [{Pregunta, Respuesta}] desde la hoja 'Preguntas_Frecuentes' del tenant."""
    data = _get_sheet_data(get_spreadsheet_id(), get_faq_worksheet_name())
    if not data:
        return []
    faqs = []
    for row in data:
        pregunta = str(row.get('Pregunta', '') or '').strip()
        if not pregunta:
            continue
        faqs.append({'Pregunta': pregunta, 'Respuesta': row.get('Respuesta', '') or ''})
    return faqs

# ---------- Helpers de normalización ----------
def _strip_accents(s: str) -> str:
    return ''.join(c for c in unicodedata.normalize('NFD', (s or '')) if unicodedata.category(c) != 'Mn')

def _norm(s: str) -> str:
    s = _strip_accents(s or '')
    return ' '.join(s.lower().strip().split())

# ---------- Funciones de la API de Google Sheets ----------
def _get_sheet_data(sheet_id, sheet_name):
    """Obtiene datos de una hoja de Google Sheets.
    Retorna lista de dicts con keys según la primera fila (headers)."""
    try:
        print(f"\n📖 _get_sheet_data('{sheet_name}')")
        client_local = get_gs_client()
        if client_local is None:
            print("   ⚠️  Cliente no disponible, intentando fallback...")
            return None
        print(f"   📊 Abriendo spreadsheet: {sheet_id[:20]}...")
        spreadsheet = client_local.open_by_key(sheet_id)
        print(f"   [OK] Spreadsheet: '{spreadsheet.title}'")
        print(f"   📑 Buscando hoja: '{sheet_name}'")
        sheet = spreadsheet.worksheet(sheet_name)
        print(f"   [OK] Hoja encontrada: {sheet.row_count} filas x {sheet.col_count} columnas")
        print(f"   📥 Obteniendo datos...")
        data = sheet.get_all_values()
        if not data:
            print(f"   ⚠️  Hoja vacía")
            return None
        print(f"   📊 {len(data)} filas obtenidas (incluyendo headers)")
        headers = data[0]
        print(f"   📋 Headers: {headers}")
        records = [dict(zip(headers, row)) for row in data[1:]]
        print(f"   [OK] {len(records)} registros procesados")
        return records
    except Exception as e:
        print(f"   ❌ Error en _get_sheet_data('{sheet_name}'): {e}")
        import traceback
        traceback.print_exc()
        return None

def obtener_categorias_genericas():
    """Obtiene las categorías genéricas definidas en la hoja de inventario y .env."""
    _load_dotenv_files_if_present()
    categoria1 = os.environ.get('ITEM_PRIMARY_PLURAL', 'categoria1')
    categoria2 = os.environ.get('ITEM_SECONDARY_PLURAL', 'categoria2')
    return categoria1, categoria2

def obtener_inventario():
    """
    Obtiene el inventario limpio y sin duplicados.
    Usa google_sheets.get_clean_inventory() para obtener datos limpios.
    """
    from . import google_sheets
    return google_sheets.get_clean_inventory()

def obtener_categorias_desde_inventario():
    """Obtiene las categorías presentes en la hoja de inventario, según columnas genéricas."""
    current_spreadsheet_id = get_spreadsheet_id()
    data = _get_sheet_data(current_spreadsheet_id, PRODUCTS_WORKSHEET_NAME)
    if not data:
        return []
    categorias = set(row.get('Categoria', '').strip() for row in data if row.get('Categoria'))
    return list(categorias)

def agregar_entrega(data):
    try:
        client = get_gs_client()
        # CRÍTICO: Leer SPREADSHEET_ID dinámicamente (puede ser distinto al de productos)
        current_spreadsheet_id = get_deliveries_spreadsheet_id()
        sheet = client.open_by_key(current_spreadsheet_id).worksheet(DELIVERIES_WORKSHEET_NAME)
        
        # Obtenemos la fecha y hora actuales
        fecha_actual = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

        # Creamos la fila con los datos en el orden correcto
        row = [
            fecha_actual,
            data.get('nombre', ''),
            data.get('producto', ''),
            data.get('codigo', ''),
            data.get('telefono', ''),
            data.get('direccion', ''),
            data.get('monto', 0),
            data.get('pago', ''),
            data.get('estado', ''),
            data.get('observaciones', ''),
            data.get('referido_por', '')
        ]
        
        sheet.append_row(row, value_input_option='USER_ENTERED')
        return True, "Entrega registrada con exito."
    except Exception as e:
        return False, str(e)

LEADS_HEADERS = [
    'Fecha Registro', 'Estado', 'Motivo Cancelacion', 'Tipo Mascota',
    'Plan', 'Nombre Titular', 'Tipo Documento', 'Numero Documento',
    'Fecha Nacimiento Titular', 'Ciudad Departamento', 'Direccion',
    'Telefono', 'Correo Electronico', 'Nombre Mascota', 'Edad Mascota',
    'Raza', 'Color', 'Genero', 'Asesor', 'Fecha Contacto', 'Observaciones'
]

# Cache de encabezados: evitar leer Google Sheets en cada request (rate limit)
_leads_cache = {'verified': False, 'last_check': 0}

def asegurar_encabezados_leads(sheet):
    """Verifica que los encabezados de LEADS esten actualizados.
    Usa cache para evitar exceder quota de lectura de Google Sheets API."""
    now = __import__('time').time()
    # Re-verificar solo cada 5 minutos
    if _leads_cache['verified'] and (now - _leads_cache['last_check']) < 300:
        return
    try:
        existing = sheet.row_values(1)
        if len(existing) < len(LEADS_HEADERS) or existing != LEADS_HEADERS:
            sheet.update(range_name='A1', values=[LEADS_HEADERS], value_input_option='USER_ENTERED')
            print("   Encabezados LEADS actualizados")
        _leads_cache['verified'] = True
        _leads_cache['last_check'] = now
    except Exception:
        try:
            sheet.update(range_name='A1', values=[LEADS_HEADERS], value_input_option='USER_ENTERED')
            print("   Encabezados LEADS creados")
        except Exception:
            pass
        _leads_cache['verified'] = True
        _leads_cache['last_check'] = now

# Cache de worksheet LEADS para evitar abrir el spreadsheet en cada request
_leads_worksheet_cache = {'sheet': None, 'id': '', 'last_open': 0}

def _get_leads_worksheet():
    """Obtiene (con cache) la worksheet de LEADS."""
    now = __import__('time').time()
    sid = get_spreadsheet_id()
    # Re-abrir solo si cambia el ID o cada 5 minutos
    if (_leads_worksheet_cache['sheet'] is not None
            and _leads_worksheet_cache['id'] == sid
            and (now - _leads_worksheet_cache['last_open']) < 300):
        return _leads_worksheet_cache['sheet']
    client = get_gs_client()
    sheet = client.open_by_key(sid).worksheet(LEADS_WORKSHEET_NAME)
    _leads_worksheet_cache['sheet'] = sheet
    _leads_worksheet_cache['id'] = sid
    _leads_worksheet_cache['last_open'] = now
    return sheet

def agregar_lead(data):
    """Guarda un lead de seguro de mascotas en la hoja LEADS."""
    try:
        sheet = _get_leads_worksheet()
        asegurar_encabezados_leads(sheet)
        fecha_actual = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

        row = [
            fecha_actual,                     # FechaRegistro
            data.get('estado', ''),           # Estado
            data.get('motivoCancelacion', ''),# MotivoCancelacion
            data.get('tipoMascota', ''),      # TipoMascota
            data.get('plan', ''),             # Plan
            data.get('nombreTitular', ''),    # NombreTitular
            data.get('tipoDocumento', ''),    # TipoDocumento
            data.get('numeroDocumento', ''),  # NumeroDocumento
            data.get('fechaNacimiento', ''),  # FechaNacimientoTitular
            data.get('ciudadDepartamento', ''),# CiudadDepartamento
            data.get('direccion', ''),        # Direccion
            data.get('telefono', ''),         # Telefono
            data.get('correoElectronico', ''),# CorreoElectronico
            data.get('nombreMascota', ''),    # NombreMascota
            data.get('edadMascota', ''),      # EdadMascota
            data.get('raza', ''),             # Raza
            data.get('color', ''),            # Color
            data.get('genero', ''),           # Genero
            data.get('asesor', ''),           # Asesor
            fecha_actual,                     # FechaContacto
            data.get('observaciones', '')     # Observaciones
        ]
        
        sheet.append_row(row, value_input_option='USER_ENTERED')
        return True, "Lead registrado con exito."
    except Exception as e:
        err_str = str(e)
        # Si es rate limiting, reintentar una vez con backoff
        if '429' in err_str or 'Quota exceeded' in err_str:
            import time as _time
            _time.sleep(2)
            try:
                sheet.append_row(row, value_input_option='USER_ENTERED')
                return True, "Lead registrado con exito (tras reintento)."
            except Exception as e2:
                return False, f"Rate limit tras reintento: {e2}"
        return False, err_str

def marcar_pago(codigo, pagado):
    return True, "Estado de pago actualizado."

def marcar_entrega(codigo, entregado):
    return True, "Estado de entrega actualizado."

# ---------- Vistas de la API ----------

@csrf_exempt
def consultar_productos_gsheet(request):
    # CRÍTICO: Verificar que el BIZ_ID coincida (si se proporciona)
    request_biz_id = request.GET.get('biz_id') or request.GET.get('business_id')
    env_biz_id = os.environ.get('BIZ_ID') or os.environ.get('BUSINESS_ID')
    
    if request_biz_id and env_biz_id and request_biz_id != env_biz_id:
        return JsonResponse({
            'error': f'BIZ_ID mismatch: request={request_biz_id}, env={env_biz_id}'
        }, status=403)
    
    inv_raw = obtener_inventario()
    if not inv_raw:
        return JsonResponse({'error': 'No se pudieron obtener los datos de los productos.'}, status=500)
    
    limit = int(request.GET.get('limit', '0') or 0)
    q_categoria = _norm(request.GET.get('categoria', ''))
    q_producto = _norm(request.GET.get('producto', ''))
    debug = request.GET.get('debug', '') == '1'

    normalized = []
    for it in inv_raw:
        codigo = str(it.get('CodigoProducto', '')).strip()
        nombre = str(it.get('NombreProducto', '')).strip()
        precio = it.get('Precio_Venta', 0)
        categoria = str(it.get('Categoria', '')).strip()
        
        normalized.append({
            'nombre': nombre,
            'codigo': codigo,
            'precio': precio,
            'categoria': categoria,
        })

    out = []
    for it in normalized:
        cat_ok = True
        if q_categoria and q_categoria != 'todas':
            cat_ok = (q_categoria in _norm(it['categoria'])) or (q_categoria in _norm(it['nombre']))

        prod_ok = True
        if q_producto:
            prod_ok = (q_producto in _norm(it['nombre']))

        if cat_ok and prod_ok:
            out.append(it)

    if limit and limit > 0:
        out = out[:limit]

    if debug:
        return JsonResponse({
            'query': {
                'categoria': q_categoria, 'producto': q_producto, 'limit': limit
            },
            'counts': {
                'raw': len(inv_raw), 'normalized': len(normalized), 'filtered': len(out)
            },
            'sample_raw': inv_raw[:5],
            'sample_normalized': normalized[:5],
            'result': out[:5]
        }, safe=False)

    return JsonResponse(out, safe=False)

@csrf_exempt
def consultar_stock(request, codigo):
    inv_raw = obtener_inventario()
    if not inv_raw:
        return JsonResponse({'error': 'No se pudieron obtener los datos del inventario.'}, status=500)

    code_q = _norm(codigo)
    for it in inv_raw:
        code_val = _norm(str(it.get('CodigoProducto', '')))
        if code_val == code_q:
            return JsonResponse({
                'nombre': it.get('NombreProducto', ''),
                'stock': it.get('Stock_Actual', ''),
                'precio': it.get('Precio_Venta', 0),
            })
    return JsonResponse({'error': 'Producto no encontrado'}, status=404)

@csrf_exempt
def _norm(text):
    """Normaliza el texto para la búsqueda."""
    return text.lower().strip().replace(" ", "")

def buscar_producto_por_nombre(request):
    query = request.GET.get('q', '').strip()
    if not query:
        return JsonResponse({'error': 'Falta el parámetro de búsqueda "q"'}, status=400)

    # CRÍTICO: Verificar que el BIZ_ID coincida (si se proporciona)
    request_biz_id = request.GET.get('biz_id') or request.GET.get('business_id')
    env_biz_id = os.environ.get('BIZ_ID') or os.environ.get('BUSINESS_ID')
    
    if request_biz_id and env_biz_id and request_biz_id != env_biz_id:
        return JsonResponse({
            'error': f'BIZ_ID mismatch: request={request_biz_id}, env={env_biz_id}'
        }, status=403)

    inv_raw = obtener_inventario()
    if not inv_raw:
        return JsonResponse({'error': 'No se pudo obtener el inventario de Google Sheets.'}, status=500)

    # Normalizar la consulta del usuario y dividirla en palabras clave
    query_normalized = _norm(query)
    query_words = query_normalized.split()

    matched_products = []

    for producto in inv_raw:
        # Concatenar todos los campos string relevantes del producto para búsqueda
        searchable_fields = []
        for k, v in producto.items():
            if isinstance(v, str):
                searchable_fields.append(_norm(v))
        searchable_text = ' '.join(searchable_fields)

        # Verificar si TODAS las palabras clave del usuario se encuentran en cualquier campo relevante
        if all(word in searchable_text for word in query_words):
            matched_products.append(producto)

    if not matched_products:
        return JsonResponse({'error': 'Producto no encontrado.'}, status=404)
    elif len(matched_products) == 1:
        producto_encontrado = matched_products[0]
        return JsonResponse(producto_encontrado)
    else:
        return JsonResponse({'matches': matched_products})

@csrf_exempt
def registrar_entrega(request):
    if request.method != 'POST':
        return JsonResponse({'error': 'Método no permitido'}, status=405)
    try:
        data = json.loads(request.body.decode('utf-8'))
        ok, msg = agregar_entrega(data)
        if not ok:
            return JsonResponse({'ok': False, 'error': msg}, status=400)
        return JsonResponse({'ok': True})
    except Exception as e:
        return JsonResponse({'ok': False, 'error': str(e)}, status=500)

@csrf_exempt
def registrar_lead(request):
    if request.method != 'POST':
        return JsonResponse({'error': 'Metodo no permitido'}, status=405)
    try:
        data = json.loads(request.body.decode('utf-8'))
        ok, msg = agregar_lead(data)
        if not ok:
            return JsonResponse({'ok': False, 'error': msg}, status=400)
        return JsonResponse({'ok': True})
    except Exception as e:
        return JsonResponse({'ok': False, 'error': str(e)}, status=500)

@csrf_exempt
def actualizar_pago(request):
    if request.method != 'POST':
        return JsonResponse({'error': 'Método no permitido'}, status=405)
    try:
        data = json.loads(request.body.decode('utf-8'))
        codigo = data.get('codigo', '')
        pagado = bool(data.get('pagado', False))
        ok, msg = marcar_pago(codigo, pagado)
        if not ok:
            return JsonResponse({'ok': False, 'error': msg}, status=400)
        return JsonResponse({'ok': True})
    except Exception as e:
        return JsonResponse({'ok': False, 'error': str(e)}, status=500)

@csrf_exempt
def actualizar_entrega(request):
    if request.method != 'POST':
        return JsonResponse({'error': 'Método no permitido'}, status=405)
    try:
        data = json.loads(request.body.decode('utf-8'))
        codigo = data.get('codigo', '')
        entregado = bool(data.get('entregado', False))
        ok, msg = marcar_entrega(codigo, entregado)
        if not ok:
            return JsonResponse({'ok': False, 'error': msg}, status=400)
        return JsonResponse({'ok': True})
    except Exception as e:
        return JsonResponse({'ok': False, 'error': str(e)}, status=500)
    
@csrf_exempt
def registrar_confirmacion(request):
    """
    Recibe la confirmación del pedido y los datos de entrega para registrarlos.
    """
    if request.method != 'POST':
        return JsonResponse({'error': 'Método no permitido'}, status=405)

    try:
        data = json.loads(request.body.decode('utf-8'))
        
        # Validar que los datos esenciales estén presentes
        if not all(k in data for k in ['nombre', 'telefono', 'direccion', 'monto', 'producto', 'codigo']):
            return JsonResponse({'ok': False, 'error': 'Faltan datos obligatorios para el registro.'}, status=400)

        # Llamar a la función que guarda la entrega en la hoja de cálculo
        ok, msg = agregar_entrega(data)

        if not ok:
            return JsonResponse({'ok': False, 'error': f'Error al registrar la entrega: {msg}'}, status=400)
        
        return JsonResponse({'ok': True, 'mensaje': 'Pedido registrado con éxito.'})

    except json.JSONDecodeError:
        return JsonResponse({'ok': False, 'error': 'JSON inválido'}, status=400)
    except Exception as e:
        return JsonResponse({'ok': False, 'error': str(e)}, status=500)

# Elimina endpoint legacy y reemplaza por uno genérico
# Ejemplo: consultar_categorias_genericas
from django.views.decorators.http import require_GET

@require_GET
def consultar_categorias_genericas(request):
    """Endpoint genérico para consultar categorías desde inventario."""
    categorias = obtener_categorias_desde_inventario()
    return JsonResponse({'categorias': categorias})

@csrf_exempt
def obtener_todos_los_productos(request):
    """Endpoint para traer todos los productos del inventario sin filtro."""
    inv_raw = obtener_inventario()
    if not inv_raw:
        return JsonResponse({'error': 'No se pudo obtener el inventario de Google Sheets.'}, status=500)
    return JsonResponse({'matches': inv_raw})

@csrf_exempt
def consultar_configuracion(request):
    """Config editable del negocio (pestaña 'Configuración' del Sheet).
    Devuelve {'config': {campo: valor}}. La usa el bot para tono, saludo,
    cuentas bancarias y mensajes sin reiniciar código."""
    request_biz_id = request.GET.get('biz_id') or request.GET.get('business_id')
    env_biz_id = os.environ.get('BIZ_ID') or os.environ.get('BUSINESS_ID')
    if request_biz_id and env_biz_id and request_biz_id != env_biz_id:
        return JsonResponse({
            'error': f'BIZ_ID mismatch: request={request_biz_id}, env={env_biz_id}'
        }, status=403)

    config_map = _get_config_map()
    if not config_map:
        return JsonResponse({
            'config': {},
            'error': 'No se encontraron datos en la hoja de Configuración.'
        }, status=500)
    return JsonResponse({'config': config_map})

@csrf_exempt
def consultar_preguntas_frecuentes(request):
    """Preguntas frecuentes del negocio (pestaña 'Preguntas_Frecuentes').
    Devuelve {'faqs': [{Pregunta, Respuesta}]}. La usa el bot como base de
    conocimiento antes de dejar que la IA invente respuestas."""
    request_biz_id = request.GET.get('biz_id') or request.GET.get('business_id')
    env_biz_id = os.environ.get('BIZ_ID') or os.environ.get('BUSINESS_ID')
    if request_biz_id and env_biz_id and request_biz_id != env_biz_id:
        return JsonResponse({
            'error': f'BIZ_ID mismatch: request={request_biz_id}, env={env_biz_id}'
        }, status=403)

    faqs = _get_faqs()
    if not faqs:
        return JsonResponse({
            'faqs': [],
            'error': 'No se encontraron datos en la hoja de Preguntas Frecuentes.'
        }, status=500)
    return JsonResponse({'faqs': faqs})

# ISSUE #33 - Health Check Django
@require_GET
def health_check(request):
    from . import google_sheets
    sheets_status = google_sheets.get_sheets_status()
    return JsonResponse({
        'status': 'ok',
        'timestamp': datetime.now().isoformat(),
        'service': f"django-{os.environ.get('BUSINESS_KEY', 'unknown')}",
        'version': '1.0.0',
        'google_sheets': sheets_status
    })