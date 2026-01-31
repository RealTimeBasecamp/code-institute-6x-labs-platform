from django.shortcuts import render
from django.contrib.auth.decorators import login_required

#from reports.models import Report
from django.views.generic import ListView
from django.contrib.auth.mixins import LoginRequiredMixin
from django.db.models.functions import Lower


# TODO
# Set up report model and get list of reports appearing in reports list view
# Should only show users reports they have created
# class ReportsListView(LoginRequiredMixin, ListView):
#     """
#     Display list of all projects with table and grid views.

#     Data comes from: Project model queryset ordered by name
#     Data returned to: projects_list.html template

#     Context:
#         projects: All Project objects ordered by name (lowercase)
#         user_has_own_projects: Boolean indicating if user created any projects
#     """

#     model = Report
#     template_name = 'reports/reports_list.html'
#     context_object_name = 'reports'
#     paginate_by = 20

#     def get_queryset(self):
#         return Report.objects.order_by(Lower('name'))

#     def get_context_data(self, **kwargs):
#         context = super().get_context_data(**kwargs)
#         # Check if the current user has any projects they created
#         # Used to conditionally show the Actions column in the table
#         if self.request.user.is_authenticated:
#             context['user_has_own_projects'] = Report.objects.filter(
#                 created_by=self.request.user
#             ).exists()
#         else:
#             context['user_has_own_projects'] = False
#         return context


@login_required
def report_generator(request):
    """
    Render the report generator page.
    """
    return render(request, 'reports/report_generator.html')