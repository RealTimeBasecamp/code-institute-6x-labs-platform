from django.urls import path
from . import views

app_name = 'projects'

urlpatterns = [
    path('', views.ProjectListView.as_view(), name='projects_list'),
    path('project-planner/', views.project_planner, name='project_planner'),
    path('project-planner/<slug:slug>/', views.project_planner_detail, name='project_planner_detail'),
    path(
        'project-planner/api/editor-preferences/',
        views.editor_preferences_api,
        name='editor_preferences_api',
    ),
    path('<slug:slug>/', views.project_detail, name='project_detail'),
    path('<slug:slug>/delete-project/', views.delete_project, name='delete_project'),
    path('<slug:slug>/api/publish-sites/', views.publish_sites, name='publish_sites_api'),
    path('<slug:slug>/api/delete-site/', views.delete_site, name='delete_site_api'),

    # Map Component API
    path(
        '<slug:slug>/api/sites/<int:site_id>/components/',
        views.components_api,
        name='components_api',
    ),
    path(
        '<slug:slug>/api/sites/<int:site_id>/components/bulk/',
        views.components_bulk_api,
        name='components_bulk_api',
    ),
    path(
        '<slug:slug>/api/components/<int:component_id>/',
        views.component_detail_api,
        name='component_detail_api',
    ),

    # Component Folder API
    path(
        '<slug:slug>/api/sites/<int:site_id>/folders/',
        views.folders_api,
        name='folders_api',
    ),
    path(
        '<slug:slug>/api/folders/<int:folder_id>/',
        views.folder_detail_api,
        name='folder_detail_api',
    ),

    # GeoPackage Export / Import
    path(
        '<slug:slug>/api/sites/<int:site_id>/export/geopackage/',
        views.export_geopackage,
        name='export_geopackage',
    ),
    path(
        '<slug:slug>/api/sites/<int:site_id>/import/geopackage/',
        views.import_geopackage,
        name='import_geopackage',
    ),
]
