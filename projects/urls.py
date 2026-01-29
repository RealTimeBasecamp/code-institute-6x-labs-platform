from django.urls import path
from . import views

app_name = 'projects'

urlpatterns = [
    path('', views.ProjectListView.as_view(), name='projects_list'),
    path('project-planner/', views.project_planner, name='project_planner'),
    path('project-planner/<slug:slug>/', views.project_planner_detail, name='project_planner_detail'),
    path('<slug:slug>/', views.project_detail, name='project_detail'),
    path('<slug:slug>/delete-project/', views.delete_project, name='delete_project'),
    path('<slug:slug>/api/publish-sites/', views.publish_sites, name='publish_sites_api'),
    path('<slug:slug>/api/delete-site/', views.delete_site, name='delete_site_api'),
]
