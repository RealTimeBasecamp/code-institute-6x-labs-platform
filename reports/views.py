from django.shortcuts import render
from django.contrib.auth.decorators import login_required

from django.views.generic import ListView
from django.contrib.auth.mixins import LoginRequiredMixin
from django.db.models.functions import Lower

from reports.models import Report


class ReportsListView(LoginRequiredMixin, ListView):
    """
    Reports list view. Accessible at path '', named 'reports_list'.
    Only accessible to logged-in users.    
    """

    model = Report
    template_name = 'reports/reports_list.html'
    context_object_name = 'reports'
    paginate_by = 20

    def get_queryset(self):
        reports = Report.objects.all().order_by(Lower('title'))
        return reports


@login_required
def report_generator(request):
    """
    Render the report generator page.
    """
    return render(request, 'reports/report_generator.html')