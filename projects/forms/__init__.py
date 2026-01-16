"""
Project wizard forms.

Each wizard is organized in its own subfolder for clean separation:
    - create_project/  : Project creation wizard
    - delete_project/  : Project deletion wizard

Importing this module registers all wizards with the core wizard registry.
"""
# Import wizard packages to trigger registration
from .create_project import (
    ProjectCreationWizard,
    ProjectBasicInfoForm,
    ProjectEnvironmentForm,
    ProjectAddressForm,
    ProjectCoordinatesForm,
    ProjectContactForm,
    ProjectSummaryForm,
)

from .delete_project import (
    ProjectDeleteWizard,
    ProjectDeleteConfirmForm,
)


__all__ = [
    # Create project wizard
    'ProjectCreationWizard',
    'ProjectBasicInfoForm',
    'ProjectEnvironmentForm',
    'ProjectAddressForm',
    'ProjectCoordinatesForm',
    'ProjectContactForm',
    'ProjectSummaryForm',
    # Delete project wizard
    'ProjectDeleteWizard',
    'ProjectDeleteConfirmForm',
]
