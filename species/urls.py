from django.urls import path
from . import views

app_name = 'species'

urlpatterns = [
    path('', views.SpeciesListView.as_view(), name='species_list'),
    path('species/<str:name>/', views.species_detail, name='species_detail'),
    path('mixer/', views.species_mix_list, name='species_mixer'),
    path('mixer/<str:name>/', views.species_mix, name='species_mix'),
]
