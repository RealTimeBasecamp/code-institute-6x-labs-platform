from django.shortcuts import render
from django.http import HttpResponse
from .models import Project
from django.views.generic import ListView


class ProjectListView(ListView):
    model = Project
    template_name = 'project_planner/project_list.html'
    context_object_name = 'projects'
