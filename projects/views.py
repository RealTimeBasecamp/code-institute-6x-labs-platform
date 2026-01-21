from django.shortcuts import get_object_or_404, render, redirect
from django.contrib import messages
from django.urls import reverse
from django.contrib.auth.decorators import login_required
from django.db.models.functions import Lower
from django.http import JsonResponse, HttpResponseBadRequest, HttpResponseForbidden
from django.views.decorators.http import require_POST
from django.utils import timezone
import datetime

from .models import Project
import json
from django.views.generic import ListView
from django.contrib.auth.mixins import LoginRequiredMixin
from core.card_utils import render_card_groups
from .utils import build_site_bounds_and_list


class ProjectListView(LoginRequiredMixin, ListView):
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
    # Provide default plotting algorithms list for templates
    context['plotting_algorithms'] = ['Poisson Disc sampling']
    return render(request, 'projects/project_planner.html', context)


@login_required
@require_POST
def publish_sites(request, slug):
    """
    API endpoint to create new Site records for the given project slug.
    Expects JSON payload: { sites: [{ name: "Site 1", bounds: [[lng,lat],...] }, ...] }
    Returns JSON list of created site ids.
    """
    project = get_object_or_404(Project, slug=slug)

    # Only allow publishing sites if user is project owner or staff/superuser
    if not (request.user.is_staff or request.user.is_superuser or project.created_by == request.user):
        return HttpResponseForbidden('Permission denied')

    try:
        payload = json.loads(request.body.decode('utf-8') or '{}')
    except Exception:
        return HttpResponseBadRequest('Invalid JSON')

    sites = payload.get('sites') or []
    created = []
    for s in sites:
        name = s.get('name') or 'Unnamed Site'
        bounds = s.get('bounds') or []
        if not bounds or not isinstance(bounds, list):
            continue

        # Save bounding box coordinates as GeoJSON Polygon
        geo = {
            'type': 'Polygon',
            'coordinates': [bounds]
        }

        # Required Site model fields are not nullable; provide sensible defaults
        est_completion_date = timezone.now()
        completion_percentage = 0
        maturity_years = 0
        current_year = datetime.date.today().year
        total_plants = 0

        site_obj = project.sites.create(
            name=name,
            description='Staged via interactive map',
            est_completion_date=est_completion_date,
            completion_percentage=completion_percentage,
            maturity_years=maturity_years,
            current_year=current_year,
            total_plants=total_plants,
            bounding_box_coordinates=geo
        )
        # Include stored geometry in response for verification/debugging
        created.append({
            'id': site_obj.id,
            'name': site_obj.name,
            'bounds': bounds,
            'stored_geometry': getattr(site_obj, 'bounding_box_coordinates', None)
        })

    return JsonResponse({'created': created})


@login_required
@require_POST
def delete_site(request, slug):
    """
    Delete a site immediately. Expects JSON payload: { site_id: <int> }
    """
    project = get_object_or_404(Project, slug=slug)
    try:
        payload = json.loads(request.body.decode('utf-8') or '{}')
    except Exception:
        return HttpResponseBadRequest('Invalid JSON')

    site_id = payload.get('site_id')
    if not site_id:
        return HttpResponseBadRequest('Missing site_id')

    try:
        site = project.sites.get(id=site_id)
    except Exception:
        return HttpResponseBadRequest('Site not found')

    # Only allow deletion if user has permission (project owner or staff/superuser)
    if not (request.user.is_staff or request.user.is_superuser or project.created_by == request.user):
        return HttpResponseForbidden('Permission denied')

    site.delete()
    return JsonResponse({'deleted': site_id})


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
    if project:
        sites = project.sites.all()
    else:
        sites = []  # or Site.objects.none() if you have imported Site

    site_rows = [
        [i+1, site.name, "None", site.total_co2_sequestered_kg] for i, site in enumerate(sites)]

    # New: site_bounds_rows with #, X, Y, Lock
    site_bounds_rows = []
    for i, site in enumerate(sites):
        # Default values
        x, y = None, None
        bounds = getattr(site, 'bounding_box_coordinates', {})

        # Extract first coordinate if available
        try:
            coords = bounds.get('coordinates', [])
            if coords and coords[0] and coords[0][0]:
                x, y = coords[0][0][0], coords[0][0][1]
        except Exception:
            pass
        site_bounds_rows.append([
            i + 1,  # #
            x,      # X (lng)
            y,      # Y (lat)
            False   # Lock (default to False, change as needed)
        ])

    context = {
        'project': project,
        'projects': projects,
        'breadcrumbs': [
            {
                'label': 'Projects',
                'url': reverse('projects:projects_list'),
                'is_current': False,
                'is_ellipsis': False,
            },
        ],
        'sites': sites,
        'site_rows': site_rows,
        'site_bounds_rows': site_bounds_rows,
        'plotting_algorithms': ['Poisson Disc sampling', 'Sample Elimination'],
    }

    # Build breadcrumbs for this page
    if project:
        context['breadcrumbs'].append({
            'label': project.name,
            'url': None,
            'is_current': True,
            'is_ellipsis': False,
        })

    # Define card groups with data (edit_form passed directly to frontend)
    if project:
        card_groups = project.get_card_groups()
        card_groups = render_card_groups(card_groups)
        context['card_groups'] = card_groups

        # Move the map/table building logic into a utility to keep view concise
        bounds_context = build_site_bounds_and_list(project)
        context.update(bounds_context)

    # Ensure plotting_algorithms is always a list so templates iterate items, not characters
    if 'plotting_algorithms' not in context:
        context['plotting_algorithms'] = ['Poisson Disc sampling', 'Sample Elimination']

    return render(request, 'projects/project_planner.html', context)


@require_POST
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

    # Check if current user is the creator or staff/superuser
    if not (request.user.is_staff or request.user.is_superuser or project.created_by == request.user):
        messages.error(request, 'You do not have permission to delete this project.')
        return redirect('projects:projects_list')

    try:
        project.delete()
        messages.success(request, f'Project "{project_name}" was deleted successfully.')
    except Exception as e:
        messages.error(request, f'Error deleting project: {str(e)}')

    return redirect('projects:projects_list')