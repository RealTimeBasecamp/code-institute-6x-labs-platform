from django.shortcuts import get_object_or_404, render
from .models import Project
from django.views.generic import ListView


class ProjectListView(ListView):
    model = Project
    template_name = 'projects/projects_list.html'
    context_object_name = 'projects'


def project(request, slug):
    # Do not filter by active status here
    # In the template use user authentication tier to show
    # Active projects to all users and inactive projects to admins only
    if slug:
        project = get_object_or_404(Project, slug=slug)
    else:
        project = None
    projects = Project.objects.values('name', 'slug')

    return render(request, 'projects/project_planner.html', {
        'project': project,
        'projects': projects,
    })