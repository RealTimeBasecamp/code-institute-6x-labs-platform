"""
Step 1: Basic user information.

Field requirements inherited from User model (AbstractUser):
- first_name: optional (blank=True in AbstractUser)
- last_name: optional (blank=True in AbstractUser)
- display_name: optional (blank=True on model)
"""
from django import forms

from core.forms.wizard_forms import WizardModelForm
from users.models import User


class UserBasicInfoForm(WizardModelForm):
    """Basic user info - name and display name."""

    title = 'Basic Info'

    class Meta:
        model = User
        fields = ['first_name', 'last_name', 'display_name']
        widgets = {
            'first_name': forms.TextInput(attrs={
                'placeholder': 'Enter your first name',
                'autofocus': True,
            }),
            'last_name': forms.TextInput(attrs={
                'placeholder': 'Enter your last name',
            }),
            'display_name': forms.TextInput(attrs={
                'placeholder': 'e.g., John D. or JD',
            }),
        }
        labels = {
            'first_name': 'First Name',
            'last_name': 'Last Name',
            'display_name': 'Display Name',
        }
        help_texts = {
            'display_name': 'How you want others to see your name',
        }
