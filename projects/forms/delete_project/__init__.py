"""
Project deletion wizard forms.

Each step is a separate file for clarity, matching the create_project pattern.
Template paths: projects/wizard_steps/delete_project/{step_name}.html

Structure:
    delete_summary.py  -> delete_summary.html   (Step 1: Review)
    delete_confirm.py  -> delete_confirm.html   (Step 2: Confirm)
"""
from django.contrib import messages
from django.urls import reverse

from core.wizard import BaseWizardView
from core.wizards import register_wizard
from projects.models import Project

from .delete_summary import ProjectDeleteSummaryForm
from .delete_confirm import ProjectDeleteConfirmForm


class ProjectDeleteWizard(BaseWizardView):
    """
    Project deletion wizard.

    Safely guides users through project deletion with confirmations.
    Requires project_slug in wizard context (passed from frontend).
    """

    wizard_name = 'project_delete'
    mode = 'delete'  # Special mode for deletion wizards
    success_url = '/projects/'
    success_message = 'Project deleted successfully.'

    forms = [
        ProjectDeleteSummaryForm,
        ProjectDeleteConfirmForm,
    ]

    def _get_project(self, request):
        """
        Retrieve the project from context stored in session.

        Context is passed from frontend via data-wizard-context attribute
        and stored in wizard session by handle_start.
        """
        wizard_data = self.get_wizard_data(request)
        context = wizard_data.get('context', {})
        project_slug = context.get('project_slug')

        if project_slug:
            try:
                return Project.objects.select_related('status').get(slug=project_slug)
            except Project.DoesNotExist:
                return None
        return None

    def get_step_context(self, request, step, form):
        """Add project info to template context for display."""
        project = self._get_project(request)
        return {'project': project}

    def on_complete(self, request, all_data):
        """
        Delete the project after successful confirmation.

        Validates that:
        1. Project exists in session context
        2. User is the project creator
        3. Typed name matches exactly
        """
        project = self._get_project(request)

        if not project:
            return {
                'success': False,
                'error': 'Project not found.'
            }

        # Security check: only creator can delete
        if (project.created_by != request.user) and not (request.user.is_superuser or request.user.is_staff):
            return {
                'success': False,
                'error': 'You do not have permission to delete this project.'
            }

        # Validate typed name matches exactly
        confirm_name = all_data.get('confirm_name', '')
        if confirm_name != project.name:
            return {
                'success': False,
                'error': f'Project name does not match. Please type "{project.name}" exactly.'
            }

        project_name = project.name
        project.delete()

        # Add Django message - will be shown as toast on redirected page
        messages.success(
            request,
            f'Successfully deleted project: {project_name}'
        )

        return {
            'success': True,
            'redirect_url': reverse('projects:projects_list'),
        }


# Register the wizard
register_wizard('project_delete', ProjectDeleteWizard)


__all__ = [
    'ProjectDeleteWizard',
    'ProjectDeleteSummaryForm',
    'ProjectDeleteConfirmForm',
]
