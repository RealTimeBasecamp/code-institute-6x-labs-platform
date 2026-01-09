from django.urls import path
from . import views

app_name = 'core'

urlpatterns = [
    path('', views.login_view, name='login'),
    path('sign-up/', views.sign_up_view, name='sign_up'),
    path('dashboard/', views.dashboard_view, name='dashboard'),
]
