from django.shortcuts import get_object_or_404, render, redirect
from django.contrib import messages
from django.urls import reverse
from django.contrib.auth.decorators import login_required
from django.db.models.functions import Lower
from django.http import JsonResponse, HttpResponseBadRequest, HttpResponseForbidden
from django.views.decorators.http import require_POST
from django.utils import timezone
import datetime

from .models import Project, Site, MapComponent, ComponentFolder
import json
from django.views.generic import ListView
from django.contrib.auth.mixins import LoginRequiredMixin
from core.card_utils import render_card_groups
from .utils import build_site_bounds_and_list, build_project_center


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
def project_detail(request, slug):
    """
    Display project info page with project details, breakdown charts, and sites.

    This page shows a comprehensive view of project information including:
    - Project metadata and cards
    - Interactive map with site bounds
    - Breakdown charts (CO2, area, plants)

    Data comes from: Project model, Site model, card_utils
    Data returned to: projects/project.html template

    Args:
        request: HTTP request object
        slug (str): Project slug for lookup

    Context:
        project: The Project object
        projects: All Project objects for dropdown
        card_groups: List of dicts with title, icon, and body_html keys
        site_rows: Table rows for interactive map
        site_bounds_rows: Coordinate data for map bounds
    """
    project = get_object_or_404(Project, slug=slug)

    if not (request.user.is_staff or request.user.is_superuser or project.created_by == request.user):
        return HttpResponseForbidden('You do not have permission to view this project.')

    projects = Project.objects.all().order_by(Lower('name'))
    sites = project.sites.all()

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
    }

    # Build breadcrumbs for this page
    context['breadcrumbs'].append({
        'label': project.name,
        'url': None,
        'is_current': True,
        'is_ellipsis': False,
    })

    # Define card groups with data (edit_form passed directly to frontend)
    card_groups = project.get_card_groups()
    card_groups = render_card_groups(card_groups)
    context['card_groups'] = card_groups

    # Move the map/table building logic into a utility to keep view concise
    bounds_context = build_site_bounds_and_list(project)
    context.update(bounds_context)

    return render(request, 'projects/project.html', context)


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


@login_required
def projects_api(request):
    """
    API endpoint to list projects for the current user.
    GET: Returns JSON list of projects created by the logged-in user.
    """
    if request.method != 'GET':
        return JsonResponse({'error': 'Method not allowed'}, status=405)

    projects = Project.objects.filter(
        created_by=request.user
    ).order_by(Lower('name'))

    data = []
    for p in projects:
        data.append({
            'slug': p.slug,
            'name': p.name,
            'status': str(p.status) if p.status else None,
            'updated_at': p.updated_at.isoformat() if p.updated_at else None,
            'site_count': p.sites.count(),
        })

    return JsonResponse({'projects': data})


# =============================================================================
# MAP COMPONENT API
# =============================================================================

def _get_project_and_site(request, slug, site_id):
    """Helper: resolve project + site, check permissions."""
    project = get_object_or_404(Project, slug=slug)
    site = get_object_or_404(Site, id=site_id, project=project)
    has_perm = (
        request.user.is_staff
        or request.user.is_superuser
        or project.created_by == request.user
    )
    return project, site, has_perm


def _component_to_feature(comp):
    """Serialize a MapComponent to a GeoJSON Feature dict."""
    return comp.to_geojson_feature()


def _feature_to_component_data(feature):
    """Extract MapComponent field values from a GeoJSON Feature dict."""
    geometry = feature.get('geometry', {})
    props = feature.get('properties', {})
    return {
        'geometry_type': geometry.get('type', 'Polygon'),
        'geometry': geometry,
        'name': props.get('name', 'Untitled'),
        'data_type': props.get('data_type', 'annotation'),
        'stroke_color': props.get('stroke_color', '#3388ff'),
        'fill_color': props.get('fill_color', '#3388ff'),
        'fill_opacity': props.get('fill_opacity', 0.3),
        'stroke_width': props.get('stroke_width', 2.0),
        'fill_pattern': props.get('fill_pattern', 'solid'),
        'parametric': props.get('parametric', {}),
        'visible': props.get('visible', True),
        'locked': props.get('locked', False),
        'z_order': props.get('z_order', 0),
        'annotation_title': props.get('annotation_title', ''),
        'annotation_description': props.get('annotation_description', ''),
        'annotation_icon': props.get('annotation_icon', ''),
    }


@login_required
def components_api(request, slug, site_id):
    """
    GET:  List all components for a site as GeoJSON FeatureCollection.
    POST: Create a new component from a GeoJSON Feature.
    """
    project, site, has_perm = _get_project_and_site(request, slug, site_id)

    if request.method == 'GET':
        components = site.map_components.select_related('folder').all()
        features = [_component_to_feature(c) for c in components]
        return JsonResponse({
            'type': 'FeatureCollection',
            'features': features,
        })

    if request.method == 'POST':
        if not has_perm:
            return HttpResponseForbidden('Permission denied')
        try:
            data = json.loads(request.body.decode('utf-8') or '{}')
        except (json.JSONDecodeError, UnicodeDecodeError):
            return HttpResponseBadRequest('Invalid JSON')

        fields = _feature_to_component_data(data)
        folder_id = data.get('properties', {}).get('folder_id')
        if folder_id:
            try:
                fields['folder'] = ComponentFolder.objects.get(id=folder_id, site=site)
            except ComponentFolder.DoesNotExist:
                pass

        comp = MapComponent(site=site, **fields)
        try:
            comp.full_clean()
        except Exception as e:
            return HttpResponseBadRequest(str(e))
        comp.save()
        return JsonResponse(_component_to_feature(comp), status=201)

    return JsonResponse({'error': 'Method not allowed'}, status=405)


@login_required
def component_detail_api(request, slug, component_id):
    """
    PATCH:  Update a component's properties or geometry.
    DELETE: Delete a component.
    """
    project = get_object_or_404(Project, slug=slug)
    comp = get_object_or_404(MapComponent, id=component_id, site__project=project)
    has_perm = (
        request.user.is_staff
        or request.user.is_superuser
        or project.created_by == request.user
    )
    if not has_perm:
        return HttpResponseForbidden('Permission denied')

    if request.method == 'PATCH':
        try:
            data = json.loads(request.body.decode('utf-8') or '{}')
        except (json.JSONDecodeError, UnicodeDecodeError):
            return HttpResponseBadRequest('Invalid JSON')

        updatable_fields = [
            'name', 'data_type', 'stroke_color', 'fill_color', 'fill_opacity',
            'stroke_width', 'fill_pattern', 'parametric', 'visible', 'locked',
            'z_order', 'annotation_title', 'annotation_description', 'annotation_icon',
        ]
        updated = []
        for field in updatable_fields:
            if field in data:
                setattr(comp, field, data[field])
                updated.append(field)

        # Handle geometry update
        if 'geometry' in data:
            geom = data['geometry']
            comp.geometry = geom
            comp.geometry_type = geom.get('type', comp.geometry_type)
            updated.extend(['geometry', 'geometry_type'])

        # Handle folder assignment
        if 'folder_id' in data:
            folder_id = data['folder_id']
            if folder_id is None:
                comp.folder = None
            else:
                try:
                    comp.folder = ComponentFolder.objects.get(id=folder_id, site=comp.site)
                except ComponentFolder.DoesNotExist:
                    return HttpResponseBadRequest('Folder not found')
            updated.append('folder')

        if updated:
            try:
                comp.full_clean()
            except Exception as e:
                return HttpResponseBadRequest(str(e))
            comp.save()

        return JsonResponse(_component_to_feature(comp))

    if request.method == 'DELETE':
        comp_id = comp.id
        comp.delete()
        return JsonResponse({'deleted': comp_id})

    return JsonResponse({'error': 'Method not allowed'}, status=405)


@login_required
def components_bulk_api(request, slug, site_id):
    """
    PUT: Bulk save — replaces all components for a site with the provided set.
    Accepts a GeoJSON FeatureCollection.
    """
    if request.method != 'PUT':
        return JsonResponse({'error': 'Method not allowed'}, status=405)

    project, site, has_perm = _get_project_and_site(request, slug, site_id)
    if not has_perm:
        return HttpResponseForbidden('Permission denied')

    try:
        data = json.loads(request.body.decode('utf-8') or '{}')
    except (json.JSONDecodeError, UnicodeDecodeError):
        return HttpResponseBadRequest('Invalid JSON')

    features = data.get('features', [])

    # Build lookup of existing components by server ID for updates
    existing = {c.id: c for c in site.map_components.all()}
    seen_ids = set()
    created = []
    updated = []

    for feature in features:
        server_id = feature.get('id')
        fields = _feature_to_component_data(feature)

        # Resolve folder
        folder_id = feature.get('properties', {}).get('folder_id')
        folder = None
        if folder_id:
            try:
                folder = ComponentFolder.objects.get(id=folder_id, site=site)
            except ComponentFolder.DoesNotExist:
                pass

        if server_id and server_id in existing:
            # Update existing component
            comp = existing[server_id]
            for key, val in fields.items():
                setattr(comp, key, val)
            comp.folder = folder
            try:
                comp.full_clean()
            except Exception:
                continue
            comp.save()
            seen_ids.add(server_id)
            updated.append(comp.id)
        else:
            # Create new component
            comp = MapComponent(site=site, folder=folder, **fields)
            try:
                comp.full_clean()
            except Exception:
                continue
            comp.save()
            created.append(comp.id)

    # Delete components not in the incoming set
    to_delete = set(existing.keys()) - seen_ids
    if to_delete:
        MapComponent.objects.filter(id__in=to_delete).delete()

    # Return the full updated collection
    components = site.map_components.select_related('folder').all()
    result_features = [_component_to_feature(c) for c in components]
    return JsonResponse({
        'type': 'FeatureCollection',
        'features': result_features,
        'meta': {
            'created': len(created),
            'updated': len(updated),
            'deleted': len(to_delete),
        },
    })


# =============================================================================
# COMPONENT FOLDER API
# =============================================================================

@login_required
def folders_api(request, slug, site_id):
    """
    GET:  List all folders for a site.
    POST: Create a new folder.
    """
    project, site, has_perm = _get_project_and_site(request, slug, site_id)

    if request.method == 'GET':
        folders = site.component_folders.all()
        return JsonResponse({
            'folders': [
                {
                    'id': f.id,
                    'name': f.name,
                    'parent_id': f.parent_id,
                    'expanded': f.expanded,
                    'visible': f.visible,
                    'locked': f.locked,
                    'z_order': f.z_order,
                }
                for f in folders
            ]
        })

    if request.method == 'POST':
        if not has_perm:
            return HttpResponseForbidden('Permission denied')
        try:
            data = json.loads(request.body.decode('utf-8') or '{}')
        except (json.JSONDecodeError, UnicodeDecodeError):
            return HttpResponseBadRequest('Invalid JSON')

        parent = None
        parent_id = data.get('parent_id')
        if parent_id:
            try:
                parent = ComponentFolder.objects.get(id=parent_id, site=site)
            except ComponentFolder.DoesNotExist:
                return HttpResponseBadRequest('Parent folder not found')

        folder = ComponentFolder.objects.create(
            site=site,
            name=data.get('name', 'New Folder'),
            parent=parent,
            z_order=data.get('z_order', 0),
        )
        return JsonResponse({
            'id': folder.id,
            'name': folder.name,
            'parent_id': folder.parent_id,
            'expanded': folder.expanded,
            'visible': folder.visible,
            'locked': folder.locked,
            'z_order': folder.z_order,
        }, status=201)

    return JsonResponse({'error': 'Method not allowed'}, status=405)


@login_required
def folder_detail_api(request, slug, folder_id):
    """
    PATCH:  Update a folder.
    DELETE: Delete a folder (components in it get folder=NULL).
    """
    project = get_object_or_404(Project, slug=slug)
    folder = get_object_or_404(ComponentFolder, id=folder_id, site__project=project)
    has_perm = (
        request.user.is_staff
        or request.user.is_superuser
        or project.created_by == request.user
    )
    if not has_perm:
        return HttpResponseForbidden('Permission denied')

    if request.method == 'PATCH':
        try:
            data = json.loads(request.body.decode('utf-8') or '{}')
        except (json.JSONDecodeError, UnicodeDecodeError):
            return HttpResponseBadRequest('Invalid JSON')

        updatable = ['name', 'expanded', 'visible', 'locked', 'z_order']
        for field in updatable:
            if field in data:
                setattr(folder, field, data[field])

        if 'parent_id' in data:
            pid = data['parent_id']
            if pid is None:
                folder.parent = None
            else:
                try:
                    folder.parent = ComponentFolder.objects.get(id=pid, site=folder.site)
                except ComponentFolder.DoesNotExist:
                    return HttpResponseBadRequest('Parent folder not found')

        folder.save()
        return JsonResponse({
            'id': folder.id,
            'name': folder.name,
            'parent_id': folder.parent_id,
            'expanded': folder.expanded,
            'visible': folder.visible,
            'locked': folder.locked,
            'z_order': folder.z_order,
        })

    if request.method == 'DELETE':
        folder_id = folder.id
        folder.delete()
        return JsonResponse({'deleted': folder_id})

    return JsonResponse({'error': 'Method not allowed'}, status=405)


# ---------------------------------------------------------------------------
# GeoPackage Export / Import
# ---------------------------------------------------------------------------

@login_required
def export_geopackage(request, slug, site_id):
    """GET — Download all components for a site as a GeoPackage file."""
    from django.http import HttpResponse as HR
    from .geopackage import export_components

    project, site, has_perm = _get_project_and_site(request, slug, site_id)
    if not has_perm:
        return HttpResponseForbidden('Permission denied')

    components = site.map_components.all()
    data = export_components(components)

    filename = f'{site.name or "site"}.gpkg'.replace(' ', '_')
    response = HR(data, content_type='application/geopackage+sqlite3')
    response['Content-Disposition'] = f'attachment; filename="{filename}"'
    return response


@login_required
def import_geopackage(request, slug, site_id):
    """POST — Import a GeoPackage file, creating MapComponents for the site."""
    from .geopackage import import_components

    if request.method != 'POST':
        return JsonResponse({'error': 'Method not allowed'}, status=405)

    project, site, has_perm = _get_project_and_site(request, slug, site_id)
    if not has_perm:
        return HttpResponseForbidden('Permission denied')

    uploaded = request.FILES.get('file')
    if not uploaded:
        return HttpResponseBadRequest('No file uploaded')

    if not uploaded.name.endswith('.gpkg'):
        return HttpResponseBadRequest('File must be a .gpkg GeoPackage')

    comp_dicts = import_components(uploaded)

    created = []
    for cd in comp_dicts:
        comp = MapComponent(
            site=site,
            geometry=cd['geometry'],
            geometry_type=cd['geometry_type'],
            name=cd.get('name', 'Imported'),
            data_type=cd.get('data_type', 'annotation'),
            stroke_color=cd.get('stroke_color', '#3388ff'),
            fill_color=cd.get('fill_color', '#3388ff'),
            fill_opacity=float(cd.get('fill_opacity', 0.3)),
            stroke_width=float(cd.get('stroke_width', 2.0)),
            fill_pattern=cd.get('fill_pattern', 'solid'),
            annotation_title=cd.get('annotation_title', ''),
            annotation_description=cd.get('annotation_description', ''),
            annotation_icon=cd.get('annotation_icon', ''),
        )
        comp.save()
        created.append(_component_to_feature(comp))

    return JsonResponse({
        'type': 'FeatureCollection',
        'features': created,
    })