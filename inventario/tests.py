from unittest.mock import MagicMock, patch

from django.test import TestCase

from . import google_sheets


def _fake_sheet(values):
    """Construye un mock de gspread.Worksheet.get_all_values() con estas filas."""
    sheet = MagicMock()
    sheet.get_all_values.return_value = values
    client = MagicMock()
    client.open_by_key.return_value.worksheet.return_value = sheet
    return client


HEADERS = ['CodigoProducto', 'NombreProducto', 'Precio_Venta', 'Stock_Actual']
ROW_A = ['A1', 'Producto A', '10000', '5']
ROW_B = ['B1', 'Producto B', '20000', '3']


class GetCleanInventoryCacheTests(TestCase):
    """Pedido de Johan (2026-09-04): "se está refrescando muy rápido" — cada
    búsqueda de producto le pegaba a Google Sheets sin ningún caché. Ahora
    get_clean_inventory() cachea indefinido hasta un refresco explícito
    (force_refresh=True / invalidate_inventory_cache()), y si el fetch falla
    devuelve el último inventario bueno conocido en vez de vaciarlo.
    """

    def setUp(self):
        google_sheets.invalidate_inventory_cache()

    def tearDown(self):
        google_sheets.invalidate_inventory_cache()

    @patch.object(google_sheets, '_get_gspread_client')
    def test_segunda_llamada_no_vuelve_a_pedirle_a_sheets(self, mock_get_client):
        mock_get_client.return_value = _fake_sheet([HEADERS, ROW_A])

        primero = google_sheets.get_clean_inventory()
        segundo = google_sheets.get_clean_inventory()

        self.assertEqual(len(primero), 1)
        self.assertEqual(segundo, primero)
        mock_get_client.assert_called_once()

    @patch.object(google_sheets, '_get_gspread_client')
    def test_force_refresh_si_vuelve_a_pedirle_a_sheets(self, mock_get_client):
        mock_get_client.return_value = _fake_sheet([HEADERS, ROW_A])
        google_sheets.get_clean_inventory()

        mock_get_client.return_value = _fake_sheet([HEADERS, ROW_A, ROW_B])
        actualizado = google_sheets.get_clean_inventory(force_refresh=True)

        self.assertEqual(len(actualizado), 2)
        self.assertEqual(mock_get_client.call_count, 2)

    @patch.object(google_sheets, '_get_gspread_client')
    def test_invalidate_inventory_cache_fuerza_refresco_en_la_proxima_llamada(self, mock_get_client):
        mock_get_client.return_value = _fake_sheet([HEADERS, ROW_A])
        google_sheets.get_clean_inventory()

        google_sheets.invalidate_inventory_cache()
        mock_get_client.return_value = _fake_sheet([HEADERS, ROW_B])
        resultado = google_sheets.get_clean_inventory()

        self.assertEqual(resultado[0]['CodigoProducto'], 'B1')
        self.assertEqual(mock_get_client.call_count, 2)

    @patch.object(google_sheets, '_get_gspread_client')
    def test_si_falla_con_cache_bueno_devuelve_el_cache_en_vez_de_vacio(self, mock_get_client):
        mock_get_client.return_value = _fake_sheet([HEADERS, ROW_A])
        bueno = google_sheets.get_clean_inventory()

        mock_get_client.side_effect = Exception('DNS: getaddrinfo failed')
        resultado = google_sheets.get_clean_inventory(force_refresh=True)

        self.assertEqual(resultado, bueno)

    @patch.object(google_sheets, '_get_gspread_client')
    def test_si_falla_sin_cache_previo_devuelve_lista_vacia(self, mock_get_client):
        mock_get_client.side_effect = Exception('DNS: getaddrinfo failed')

        resultado = google_sheets.get_clean_inventory()

        self.assertEqual(resultado, [])
