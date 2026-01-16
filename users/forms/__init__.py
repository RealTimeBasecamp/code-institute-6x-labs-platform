"""
User wizard forms.

Each wizard is organized in its own subfolder for clean separation:
    - edit_profile/  : User profile setup/edit wizard

Importing this module registers all wizards with the core wizard registry.
"""
# Import wizard packages to trigger registration
from .edit_profile import (
    UserProfileWizard,
    UserBasicInfoForm,
    UserContactForm,
    UserWorkInfoForm,
    UserPreferencesForm,
    UserAvatarForm,
)


__all__ = [
    # Edit profile wizard
    'UserProfileWizard',
    'UserBasicInfoForm',
    'UserContactForm',
    'UserWorkInfoForm',
    'UserPreferencesForm',
    'UserAvatarForm',
]
