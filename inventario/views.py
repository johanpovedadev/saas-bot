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
            global_gs_client = client
            return client
        except Exception as e:
            print('WARNING: failed to init gspread from file:', e)

    # If we reach here, gspread client cannot be created
    global_gs_client = None
    return None

# ID de la hoja de cálculo de PRODUCTOS, SABORES Y TOPPINGS
PRODUCTS_SHEET_ID = '10twtfwsAbyxZ4D_0ChD34oFkwa_EWKAWPGVfk1FdEHM'

# ID de la hoja de cálculo de ENTREGAS
DELIVERIES_SHEET_ID = '1479sKgwA2ES503noFusdM-rOYv412-ogcqEouI6zQgI'

# Local fallback file (useful when gspread client can't be initialized)
LOCAL_SABORES_PATH = os.path.join(str(settings.BASE_DIR), 'tmp', 'resp_sabores.json')

def _load_local_sabores_toppings():
    """Attempt to load a local JSON fallback for sabores/toppings.
    The file may contain a leading comment line produced by tools; strip leading '//' lines before parsing."""
    try:
        if not os.path.exists(LOCAL_SABORES_PATH):
            return None
        raw = open(LOCAL_SABORES_PATH, 'r', encoding='utf8').read()
        # Remove leading lines that start with '//' (some debug dumps include a filepath comment)
        lines = raw.splitlines()
        while lines and lines[0].strip().startswith('//'):
            lines.pop(0)
        cleaned = '\n'.join(lines).strip()
        if not cleaned:
            return None
        return json.loads(cleaned)
    except Exception as e:
        print('WARN: Failed to load local sabores/toppings fallback:', e)
        return None

# ---------- Helpers de normalización ----------
def _strip_accents(s: str) -> str:
    return ''.join(c for c in unicodedata.normalize('NFD', (s or '')) if unicodedata.category(c) != 'Mn')

def _norm(s: str) -> str:
    s = _strip_accents(s or '')
    return ' '.join(s.lower().strip().split())

# ---------- Funciones de la API de Google Sheets ----------
def _get_sheet_data(sheet_id, sheet_name):
    # Attempt to ensure the client is initialized lazily
    client_local = get_gs_client()
    if client_local is None:
        # Try local fallback file
        fallback = _load_local_sabores_toppings()
        if fallback:
            print('INFO: gspread client no configurado, usando fallback local tmp/resp_sabores.json')
            # If caller expects 'Productos' sheet, we return flattened list
            if sheet_name.lower().startswith('producto') or sheet_name.lower() in ('productos', 'productos'):
                data = []
                data.extend(fallback.get('sabores', []))
                data.extend(fallback.get('toppings', []))
                return data
            # Otherwise, return fallback dict
            return fallback
        print('ERROR: gspread client no configurado. Revise credenciales.')
        return None
    try:
        sheet = client_local.open_by_key(sheet_id).worksheet(sheet_name)
        data = sheet.get_all_values()
        if not data:
            return None
        headers = data[0]
        records = [dict(zip(headers, row)) for row in data[1:]]
        return records
    except Exception as e:
        print(f"Error al obtener datos de '{sheet_name}': {e}")
        return None

def obtener_inventario():
    # If gspread client isn't configured, try to use local fallback for offline testing
    client = get_gs_client()
    if client is None:
        fallback = _load_local_sabores_toppings()
        if fallback and isinstance(fallback, dict) and 'sabores' in fallback:
            # Build a flattened inventory from the sample data: combine sabores + toppings
            data = []
            data.extend(fallback.get('sabores', []))
            data.extend(fallback.get('toppings', []))
        else:
            return None
    else:
        data = _get_sheet_data(PRODUCTS_SHEET_ID, 'Productos')
        if not data:
            return None
    productos = [row for row in data if _norm(row.get('Categoria', '')) not in ['sabores_helado', 'toppings']]
    return productos

def obtener_sabores_y_toppings():
    # Prefer live Google Sheets, but fall back to local sample JSON when client is not available
    client = get_gs_client()
    if client is None:
        fallback = _load_local_sabores_toppings()
        if fallback and isinstance(fallback, dict):
            return {
                'sabores': fallback.get('sabores', []),
                'toppings': fallback.get('toppings', [])
            }
        return None
    data = _get_sheet_data(PRODUCTS_SHEET_ID, 'Productos')
    if not data:
        return None
    sabores = [row for row in data if _norm(row.get('Categoria', '')) == 'sabores_helado']
    toppings = [row for row in data if _norm(row.get('Categoria', '')) == 'toppings']
    return {"sabores": sabores, "toppings": toppings}

def agregar_entrega(data):
    try:
        client = get_gs_client()
        sheet = client.open_by_key(DELIVERIES_SHEET_ID).worksheet('Entregas')
        
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
        return True, "Entrega registrada con éxito."
    except Exception as e:
        return False, str(e)

def marcar_pago(codigo, pagado):
    return True, "Estado de pago actualizado."

def marcar_entrega(codigo, entregado):
    return True, "Estado de entrega actualizado."

# ---------- Vistas de la API ----------

@csrf_exempt
def consultar_productos_gsheet(request):
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
        num_sabores = int(it.get('Numero_de_Sabores', 0) or 0)
        num_toppings = int(it.get('Numero_de_Toppings', 0) or 0)
        
        normalized.append({
            'nombre': nombre,
            'codigo': codigo,
            'precio': precio,
            'categoria': categoria,
            'numSabores': num_sabores,
            'numToppings': num_toppings,
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

    inv_raw = obtener_inventario()
    if not inv_raw:
        return JsonResponse({'error': 'No se pudo obtener el inventario de Google Sheets.'}, status=500)

    sabores_y_toppings_data = obtener_sabores_y_toppings()
    if not sabores_y_toppings_data:
        return JsonResponse({'error': 'No se pudieron cargar los sabores y toppings.'}, status=500)

    # Normalizar la consulta del usuario y dividirla en palabras clave
    query_normalized = _norm(query)
    query_words = query_normalized.split()

    matched_products = []

    for producto in inv_raw:
        nombre_normalized = _norm(producto.get('NombreProducto', ''))
        codigo_normalized = _norm(producto.get('CodigoProducto', ''))
        
        # Verificar si TODAS las palabras clave del usuario se encuentran en el nombre del producto
        if all(word in nombre_normalized for word in query_words) or query_normalized in codigo_normalized:
            matched_products.append(producto)

    if not matched_products:
        return JsonResponse({'error': 'Producto no encontrado.'}, status=404)
    elif len(matched_products) == 1:
        producto_encontrado = matched_products[0]
        producto_encontrado['sabores'] = sabores_y_toppings_data.get('sabores', [])
        producto_encontrado['toppings'] = sabores_y_toppings_data.get('toppings', [])
        return JsonResponse(producto_encontrado)
    else:
        return JsonResponse({'matches': matched_products})

@csrf_exempt
def consultar_sabores_y_toppings(request):
    data = obtener_sabores_y_toppings()
    if data:
        return JsonResponse(data)
    
    return JsonResponse({'error': 'No se pudieron obtener los datos de sabores y toppings.'}, status=500)

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