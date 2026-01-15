"""
Step 4: UI preferences.

Field requirements inherited from User model:
- theme: has default value, effectively optional
- theme_mode: has default value, effectively optional

Note: These fields have choices defined on the model, so no
additional choice definition is needed.
"""
from core.forms.wizard_forms import WizardModelForm
from users.models import User


class UserPreferencesForm(WizardModelForm):
    """UI preferences - theme and display mode."""

    title = 'Preferences'

    class Meta:
        model = User
        fields = ['theme', 'theme_mode']
        labels = {
            'theme': 'Color Theme',
            'theme_mode': 'Display Mode',
        }
        help_texts = {
            'theme': 'Choose your preferred color palette',
            'theme_mode': 'Light, dark, or follow system settings',
        }
