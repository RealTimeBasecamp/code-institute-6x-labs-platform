from django.shortcuts import get_object_or_404, render, redirect
from django.contrib import messages
from .models import Project
from django.views.generic import ListView
from core.card_utils import render_card_groups


class ProjectListView(ListView):
    model = Project
    template_name = 'projects/projects_list.html'
    context_object_name = 'projects'


def project(request, slug):
    """
    Display project planner page with project details and sites.
    
    FLOW: View defines card_groups with data → renders generic field template 
          → wraps in mark_safe → passes to template → template uses {% card %} tag
    
    Card groups are defined as dicts with:
    - title: Card header title
    - icon: Bootstrap icon class
    - fields: List of (label, value) tuples displayed in 2-column layout
    
    For each group, the view:
    1. Renders generic_field_list.html with the fields
    2. Wraps HTML with mark_safe()
    3. Passes to template context
    
    This consolidates all card data into one data structure, avoiding template repetition.
    
    Args:
        request: HTTP request object
        slug (str): Project slug for lookup
    
    Context:
        project: The Project object (or None if slug not provided)
        projects: All Project objects for dropdown
        card_groups: List of dicts with title, icon, and body_html keys
    """
    if slug:
        project = get_object_or_404(Project, slug=slug)
    else:
        project = None
    projects = Project.objects.all()

    context = {
        'project': project,
        'projects': projects,
    }

    # Define card groups with data
    if project:
        card_groups = project.get_card_groups()
        card_groups = render_card_groups(card_groups)
        context['card_groups'] = card_groups

    return render(request, 'projects/project_planner.html', context)


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