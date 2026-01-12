from django.shortcuts import get_object_or_404, render, redirect
from django.contrib import messages
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


def create_project(request):
    # Logic for creating a new project goes here
    return render(request, 'projects/create_project.html')


def delete_project(request, slug):
    """
    Delete project and provide user feedback via Django messages.
    Simple Django conventional approach - no AJAX needed.
    """
    if request.method != 'POST':
        messages.error(request, 'Invalid request method.')
        return redirect('projects:projects_list')

    project = get_object_or_404(Project, slug=slug)
    project_name = project.name

    try:
        project.delete()
        messages.success(request, f'Project "{project_name}" was deleted successfully.')
    except Exception as e:
        messages.error(request, f'Error deleting project: {str(e)}')

    return redirect('projects:projects_list')