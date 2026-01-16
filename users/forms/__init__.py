"""
User profile wizard forms.

Each step is a separate file for clarity. This __init__.py ties them
together and defines the wizard order.

Usage:
    from users.forms import UserWizard
    # Register with: register_wizard('user_profile', UserWizard)
"""
from core.wizard import BaseWizardView
from core.wizards import register_wizard

from .basic_info import UserBasicInfoForm
from .contact import UserContactForm
from .work_info import UserWorkInfoForm
from .preferences import UserPreferencesForm
from .avatar import UserAvatarForm


class UserWizard(BaseWizardView):
    """
    User profile setup wizard.
    
    Updates the current user's profile through a multi-step
    wizard interface. Pre-populates with existing data.
    """

    wizard_name = 'user_profile'
    mode = 'update'  # Update existing user, not create new
    success_url = '/dashboard/'
    success_message = 'Profile setup complete!'

    forms = [
        UserBasicInfoForm,
        UserContactForm,
        UserWorkInfoForm,
        UserPreferencesForm,
        UserAvatarForm,
    ]

    def get_initial_data(self, request):
        """Pre-populate forms with existing user data."""
        user = request.user

        return {
            '0': {
                'first_name': user.first_name or '',
                'last_name': user.last_name or '',
                'display_name': user.display_name or '',
            },
            '1': {
                'phone': user.phone or '',
                'pronouns': user.pronouns or '',
            },
            '2': {
                'title': user.title or '',
                'department': user.department or '',
            },
            '3': {
                'theme': user.theme or 'default',
                'theme_mode': user.theme_mode or 'system',
            },
            '4': {
                'avatar': user.avatar or '',
            },
        }

    def on_complete(self, request, all_data):
        """
        Complete the wizard and mark profile setup as done.

        Calls parent to update user fields, then sets profile_setup_complete=True
        so the wizard modal won't auto-trigger on subsequent dashboard visits.
        """
        result = super().on_complete(request, all_data)

        if result.get('success'):
            # Mark profile setup as complete
            user = request.user
            user.profile_setup_complete = True
            user.save(update_fields=['profile_setup_complete'])

        return result


# Register the wizard
register_wizard('user_profile', UserWizard)


# Export individual forms for direct use if needed
__all__ = [
    'UserWizard',
    'UserBasicInfoForm',
    'UserContactForm',
    'UserWorkInfoForm',
    'UserPreferencesForm',
    'UserAvatarForm',
]
