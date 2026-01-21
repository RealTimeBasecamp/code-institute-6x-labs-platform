"""
User profile edit wizard forms.

Each step is a separate file for clarity. This __init__.py ties them
together, defines the wizard order, and registers the wizard.

Template convention: users/wizard_steps/edit_profile/{step_name}.html
"""
from core.wizard import BaseWizardView
from core.wizards import register_wizard

from .basic_info import UserBasicInfoForm
from .preferences import UserPreferencesForm


class UserProfileWizard(BaseWizardView):
    """
    User profile setup/edit wizard.

    Updates the current user's profile through a multi-step
    wizard interface. Pre-populates with existing data.
    """

    wizard_name = 'user_profile'
    mode = 'update'  # Update existing user, not create new
    success_url = '/dashboard/'
    success_message = 'Profile updated successfully!'

    forms = [
        UserBasicInfoForm,
        UserPreferencesForm,
    ]

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
register_wizard('user_profile', UserProfileWizard)


__all__ = [
    'UserProfileWizard',
    'UserBasicInfoForm',
    'UserPreferencesForm',
]
