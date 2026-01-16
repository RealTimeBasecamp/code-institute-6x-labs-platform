"""
Project creation wizard forms.

Each step is a separate file for clarity. This __init__.py ties them
together and defines the wizard order.

Usage:
    from projects.forms import ProjectWizard
    # Register with: register_wizard('project_creation', ProjectWizard)
"""
from core.wizard import BaseWizardView
from core.wizards import register_wizard

from .basic_info import ProjectBasicInfoForm
from .environment import ProjectEnvironmentForm
from .address import ProjectAddressForm
from .coordinates import ProjectCoordinatesForm
from .contact import ProjectContactForm
from .summary import ProjectSummaryForm


class ProjectWizard(BaseWizardView):
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
        """Add extra context for specific steps."""
        context = {}

        # Add soil type descriptions for environment step
        if step == 1:
            context['soil_descriptions'] = {
                'clay': 'Dense, water-retaining soil. Good for some trees.',
                'sandy': 'Light, fast-draining soil. Needs more watering.',
                'silty': 'Fertile, moisture-retaining soil.',
                'peaty': 'Acidic, high organic matter. Good for specific species.',
                'chalky': 'Alkaline, well-draining. Limited plant selection.',
                'loamy': 'Ideal balanced soil for most plants.',
                'mixed': 'Combination of soil types across the site.',
            }

        # Add coordinate help for coordinates step
        if step == 3:
            context['coordinate_help'] = (
                "GPS coordinates help us accurately map your project site. "
                "You can find coordinates using Google Maps or GPS devices. "
                "These are optional but recommended for larger projects."
            )

        return context


# Register the wizard
register_wizard('project_creation', ProjectWizard)


# Export individual forms for direct use if needed
__all__ = [
    'ProjectWizard',
    'ProjectBasicInfoForm',
    'ProjectEnvironmentForm',
    'ProjectAddressForm',
    'ProjectCoordinatesForm',
    'ProjectContactForm',
    'ProjectSummaryForm',
]
