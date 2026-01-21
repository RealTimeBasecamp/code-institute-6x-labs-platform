from django.shortcuts import render, redirect
from django.contrib.auth.decorators import login_required
from django.utils.timezone import now

from projects.models import Project
from planting import models
from django.db.models import Sum
from reports.models import GlobalMetrics, update_global_metrics
from django.db.models.functions import ExtractYear

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
    # (Re)calculate global metrics using existing model aggregation helpers
    # Note: update_global_metrics() uses model-level aggregates defined in `reports.models`.
    update_global_metrics()
    metrics = GlobalMetrics.get_instance()

    num_projects = metrics.total_projects or Project.objects.count()
    # Global metrics store CO2 in kilograms; convert to tonnes for display
    total_co2 = int((metrics.total_co2_sequestered_kg or 0) / 1000)
    total_plants = metrics.total_plants or Project.objects.aggregate(total=Sum('total_plants'))['total'] or 0

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