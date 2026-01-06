from django.urls import path
from . import views

app_name = 'projects'

urlpatterns = [
    path('', views.ProjectListView.as_view(), name='projects_list'),
    path('project-planner/', views.project, name='project_planner'),
    path('project-planner/<slug:slug>/', views.project, name='project_planner_detail'),
]