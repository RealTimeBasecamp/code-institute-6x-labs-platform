from django.urls import path
from . import views

app_name = 'projects'

urlpatterns = [
    path('', views.ProjectListView.as_view(), name='projects_list'),
    path('project-planner/', views.project_planner, name='project_planner'),
    path('project-planner/<slug:slug>/', views.project, name='project_planner_detail'),
    path('project-planner/delete-project/<slug:slug>/', views.delete_project, name='delete_project'),
]