from django.urls import path
from . import views

app_name = 'customers'

urlpatterns = [
    # Dashboard
    path('', views.customers_dashboard, name='customers_dashboard'),

    # Customers list / search
    path('search/', views.CustomersListView.as_view(), name='customers_list'),
    path('customers/<username>/', views.customer_detail, name='customer_detail'),

    # Global analytics
    path('usage/', views.customers_usage, name='customers_usage'),
    path('retention/', views.customers_retention, name='customers_retention'),
    path('revenue/', views.customers_revenue, name='customers_revenue'),

    # Per customer
    path('<username>/usage/', views.customer_usage, name='customer_usage'),
    path('<username>/retention/', views.customer_retention, name='customer_retention'),
    path('<username>/revenue/', views.customer_revenue, name='customer_revenue'),
]
