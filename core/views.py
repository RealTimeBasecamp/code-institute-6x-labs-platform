import json

from django.shortcuts import render, redirect
from django.contrib.auth.decorators import login_required
from django.http import JsonResponse, HttpResponseBadRequest
from django.utils.timezone import now

from django.db.models import Sum
from django.db.models.functions import ExtractYear

from projects.models import Project

app_name = 'core'


def login_view(request):
    """
    Redirect to allauth's login page.

    Data comes from: None (redirect only)
    Data returned to: Redirects to allauth's account_login URL
    """
    # If user is already authenticated, redirect to dashboard
    if request.user.is_authenticated:
        return redirect('core:dashboard')
    # Otherwise redirect to allauth's login which handles the form properly
    return redirect('account_login')


@login_required
def dashboard(request):
    num_projects = Project.objects.count()
    aggregates = Project.objects.aggregate(
        total_co2=Sum('total_co2_sequestered_kg'),
        total_plants=Sum('total_plants'),
    )
    # CO2 stored in kg; convert to tonnes for display
    total_co2 = int((aggregates['total_co2'] or 0) / 1000)
    total_plants = aggregates['total_plants'] or 0

    # Build a simple year-series for plants using stored per-project totals (uses existing project aggregates)
    plants_by_year_qs = Project.objects.exclude(created_at__isnull=True).annotate(year=ExtractYear('created_at')).values('year').annotate(total_plants=Sum('total_plants')).order_by('year')
    plants_years = [p['year'] for p in plants_by_year_qs]
    plants_values = [p['total_plants'] or 0 for p in plants_by_year_qs]
    # Use `created_at` (existing field) to determine earliest project year
    first_project = Project.objects.order_by('created_at').first()
    years_of_growth = (now().year - first_project.created_at.year) if first_project and first_project.created_at else 0

    context = {
        'num_projects': num_projects,
        'total_co2': total_co2,
        'total_plants': total_plants,
        'years_of_growth': years_of_growth,
        'plants_years': plants_years,
        'plants_values': plants_values,
    }
    return render(request, 'core/dashboard.html', context)


@login_required
def user_preferences_api(request):
    """
    API endpoint for reading and updating global user preferences.

    GET: Returns current user's theme preferences as JSON.
    PATCH: Updates specified fields and returns updated preferences.

    Expects JSON body for PATCH, e.g.: {"theme": "moon", "theme_mode": "dark"}
    """
    user = request.user

    if request.method == 'GET':
        return JsonResponse({
            'theme': user.theme,
            'theme_mode': user.theme_mode,
        })

    if request.method == 'PATCH':
        try:
            data = json.loads(request.body.decode('utf-8') or '{}')
        except (json.JSONDecodeError, UnicodeDecodeError):
            return HttpResponseBadRequest('Invalid JSON')

        # Whitelist of updatable fields with their allowed values
        allowed_fields = {
            'theme': [c[0] for c in user._meta.get_field('theme').choices],
            'theme_mode': [c[0] for c in user._meta.get_field('theme_mode').choices],
        }

        updated = []
        for field, valid_values in allowed_fields.items():
            if field in data:
                value = str(data[field])
                if value not in valid_values:
                    return HttpResponseBadRequest(
                        f'Invalid value for {field}'
                    )
                setattr(user, field, value)
                updated.append(field)

        if updated:
            user.save(update_fields=updated)

        return JsonResponse({
            'theme': user.theme,
            'theme_mode': user.theme_mode,
        })

    return JsonResponse({'error': 'Method not allowed'}, status=405)