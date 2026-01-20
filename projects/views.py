from django.shortcuts import get_object_or_404, render, redirect
from django.contrib import messages
from django.urls import reverse
from django.contrib.auth.decorators import login_required
from django.db.models.functions import Lower

from .models import Project
import json
from django.views.generic import ListView
from core.card_utils import render_card_groups
from .utils import build_site_bounds_and_list


class ProjectListView(ListView):
    """
    Display list of all projects with table and grid views.

    Data comes from: Project model queryset ordered by name
    Data returned to: projects_list.html template

    Context:
        projects: All Project objects ordered by name (lowercase)
        user_has_own_projects: Boolean indicating if user created any projects
    """

    model = Project
    template_name = 'projects/projects_list.html'
    context_object_name = 'projects'
    paginate_by = 20

    def get_queryset(self):
        return Project.objects.order_by(Lower('name'))

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        # Check if the current user has any projects they created
        # Used to conditionally show the Actions column in the table
        if self.request.user.is_authenticated:
            context['user_has_own_projects'] = Project.objects.filter(
                created_by=self.request.user
            ).exists()
        else:
            context['user_has_own_projects'] = False
        return context


@login_required
def project_planner(request):
    """
    Redirect to project planner page without a specific project selected.
    """
    projects = Project.objects.all().order_by(Lower('name'))
    context = {
        'project': None,
        'projects': projects,
        'breadcrumbs': [
            {
                'label': 'Projects',
                'url': reverse('projects:projects_list'),
                'is_current': False,
                'is_ellipsis': False,
            },
        ],
    }
    return render(request, 'projects/project_planner.html', context)


@login_required
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
    projects = Project.objects.all().order_by(Lower('name'))

    # Build breadcrumbs for this page
    breadcrumbs = [
        {
            'label': 'Projects',
            'url': reverse('projects:projects_list'),
            'is_current': False,
            'is_ellipsis': False,
        },
    ]
    if project:
        breadcrumbs.append({
            'label': project.name,
            'url': None,
            'is_current': True,
            'is_ellipsis': False,
        })

    context = {
        'project': project,
        'projects': projects,
        'breadcrumbs': breadcrumbs,
    }

    # Define card groups with data (edit_form passed directly to frontend)
    if project:
        card_groups = project.get_card_groups()
        card_groups = render_card_groups(card_groups)
        context['card_groups'] = card_groups

        # Move the map/table building logic into a utility to keep view concise
        bounds_context = build_site_bounds_and_list(project)
        context.update(bounds_context)

    return render(request, 'projects/project_planner.html', context)


@login_required
def delete_project(request, slug):
    """
    Delete project and provide user feedback via Django messages.
    Only the user who created the project can delete it.
    """
    if request.method != 'POST':
        messages.error(request, 'Invalid request method.')
        return redirect('projects:projects_list')

    project = get_object_or_404(Project, slug=slug)
    project_name = project.name

    # Check if current user is the creator
    if project.created_by != request.user:
        messages.error(request, 'You do not have permission to delete this project.')
        return redirect('projects:projects_list')

    try:
        project.delete()
        messages.success(request, f'Project "{project_name}" was deleted successfully.')
    except Exception as e:
        messages.error(request, f'Error deleting project: {str(e)}')

    return redirect('projects:projects_list')