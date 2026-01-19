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
    
    title = 'Your Details'  # This overrides "Basic Info"

    class Meta:
        model = User
        fields = ['first_name', 'last_name', 'display_name', 'avatar', 'pronouns']
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
            'avatar': forms.TextInput(attrs={
                'placeholder': 'Avatar URL or path',
            }),
            'pronouns': forms.Select(choices=User.PRONOUNS_CHOICES, attrs={
                'class': 'form-select',
            }),
        }
        labels = {
            'first_name': 'First Name',
            'last_name': 'Last Name',
            'display_name': 'Display Name',
            'avatar': 'Avatar',
            'pronouns': 'Pronouns',
        }
        help_texts = {
            'display_name': 'How you want others to see your name',
            'avatar': 'Profile image or avatar (URL or path)',
            'pronouns': 'Select your pronouns',
        }
