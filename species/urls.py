from django.urls import path

from . import api_views, views

app_name = 'species'

urlpatterns = [
    # -- Page views
    path('', views.SpeciesListView.as_view(), name='species_list'),
    path('species/<str:name>/', views.species_detail, name='species_detail'),
    path('mixer/', views.species_mix_list, name='species_mixer'),

    # -- Species Mixer API (must come before mixer/<str:name>/ to avoid capture)

    # Generation (Dramatiq background tasks)
    path('mixer/api/generate/', api_views.api_generate_mix, name='api_generate_mix'),
    path('mixer/api/rescore/', api_views.api_rescore_mix, name='api_rescore_mix'),
    path('mixer/api/validate-species/', api_views.api_validate_species, name='api_validate_species'),
    path('mixer/api/task-status/<str:task_id>/', api_views.api_task_status, name='api_task_status'),

    # Location lookup + immediate env data (per-source for progressive loading)
    path('mixer/api/location/', api_views.api_location_data, name='api_location_data'),
    path('mixer/api/env-data/soil/', api_views.api_env_data_soil, name='api_env_data_soil'),
    path('mixer/api/env-data/climate/', api_views.api_env_data_climate, name='api_env_data_climate'),
    path('mixer/api/env-data/hydrology/', api_views.api_env_data_hydrology, name='api_env_data_hydrology'),
    path('mixer/api/env-data/', api_views.api_env_data, name='api_env_data'),

    # Mix CRUD
    path('mixer/api/save/', api_views.api_save_mix, name='api_save_mix'),
    path('mixer/api/mixes/create/', api_views.api_create_mix, name='api_create_mix'),
    path('mixer/api/mixes/', api_views.api_list_mixes, name='api_list_mixes'),
    path('mixer/api/mixes/<int:mix_id>/', api_views.api_get_mix, name='api_get_mix'),
    path('mixer/api/mixes/<int:mix_id>/delete/', api_views.api_delete_mix, name='api_delete_mix'),

    # Species search (for manual add)
    path('mixer/api/species-search/', api_views.api_species_search, name='api_species_search'),

    # Named mix page (after all api/ routes so it doesn't swallow them)
    path('mixer/<str:name>/', views.species_mix, name='species_mix'),
]
