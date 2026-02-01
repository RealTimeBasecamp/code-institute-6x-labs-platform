from django.urls import path
from . import views

app_name = 'reports'

urlpatterns = [
    path('', views.ReportsListView.as_view(), name='reports_list'),
    path('report-generator/', views.report_generator, name='report_generator'),
    # path('reports-analytics/', views.reports_analytics, name='reports_analytics'),
    # path('reports-compliance/', views.reports_compliance, name='reports_compliance'),
]
