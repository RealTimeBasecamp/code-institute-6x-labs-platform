from django.urls import path
from . import views


urlpatterns = [
    path('', views.ProjectListView.as_view(), name='projects_list'),
    path('project-planner/<slug:slug>/', views.project, name='project_planner'),
]