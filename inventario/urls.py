from django.urls import path
from . import views

urlpatterns = [
    path('consultar_stock/<str:codigo>/', views.consultar_stock, name='consultar_stock'),
    path('buscar_producto_por_nombre/', views.buscar_producto_por_nombre, name='buscar_producto_por_nombre'),
    path('registrar_entrega/', views.registrar_entrega, name='registrar_entrega'),
    path('registrar_lead/', views.registrar_lead, name='registrar_lead'),
    path('actualizar_pago/', views.actualizar_pago, name='actualizar_pago'),
    path('actualizar_entrega/', views.actualizar_entrega, name='actualizar_entrega'),
    path('consultar_categorias_genericas/', views.consultar_categorias_genericas, name='consultar_categorias_genericas'),
    path('registrar_confirmacion/', views.registrar_confirmacion, name='registrar_confirmacion'),
    path('obtener_todos_los_productos/', views.obtener_todos_los_productos, name='obtener_todos_los_productos'),
    path('health/', views.health_check, name='health_check'),
]