"""
Project creation wizard forms.

Each step is a separate file for clarity. This __init__.py ties them
together, defines the wizard order, and registers the wizard.

Template convention: projects/wizard_steps/create_project/{step_name}.html
"""
from core.wizard import BaseWizardView
from core.wizards import register_wizard
from projects.models import Project

from .basic_info import ProjectBasicInfoForm
from .environment import ProjectEnvironmentForm
from .address import ProjectAddressForm
from .coordinates import ProjectCoordinatesForm
from .contact import ProjectContactForm
from .summary import ProjectSummaryForm


class ProjectCreationWizard(BaseWizardView):
    """
    Project creation wizard.
    
    Creates Project with related Address, Contact, and optional
    Coordinate records through a multi-step wizard interface.
    """

    wizard_name = 'project_creation'
    success_url = '/projects/project-planner/{slug}/'
    success_message = 'Project created successfully!'

    forms = [
        ProjectBasicInfoForm,
        ProjectEnvironmentForm,
        ProjectAddressForm,
        ProjectCoordinatesForm,
        ProjectContactForm,
        ProjectSummaryForm,
    ]

    def get_extra_create_data(self, request):
        """Set created_by to the current user when creating a project."""
        return {'created_by': request.user}

    def get_step_context(self, request, step, form):
        """Add extra context for specific steps using model constants."""
        context = {}

        # Environment step - soil and climate descriptions from model
        if step == 1:
            context['soil_descriptions'] = Project.SOIL_TYPE_DESCRIPTIONS
            context['climate_descriptions'] = Project.CLIMATE_DESCRIPTIONS

        # Coordinates step - help text from model
        if step == 3:
            context['coordinate_help'] = Project.COORDINATE_HELP

        # Summary step - choice mappings for display labels
        if step == 5:
            context['project_type_choices'] = Project.PROJECT_TYPE_CHOICES
            context['soil_type_choices'] = Project.SOIL_TYPE_CHOICES
            context['climate_choices'] = Project.CLIMATE_CHOICES

        return context


# Register the wizard
register_wizard('project_creation', ProjectCreationWizard)


# Export for convenience
__all__ = [
    'ProjectCreationWizard',
    'ProjectBasicInfoForm',
    'ProjectEnvironmentForm',
    'ProjectAddressForm',
    'ProjectCoordinatesForm',
    'ProjectContactForm',
    'ProjectSummaryForm',
]
