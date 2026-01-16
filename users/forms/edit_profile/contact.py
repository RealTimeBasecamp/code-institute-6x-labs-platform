"""
Step 2: Contact information.

Field requirements inherited from User model:
- phone: optional (blank=True on model)
- pronouns: optional (blank=True on model)
"""
from django import forms

from core.forms.wizard_forms import WizardModelForm
from users.models import User


class UserContactForm(WizardModelForm):
    """Contact info - phone and pronouns."""

    title = 'Contact'

    class Meta:
        model = User
        fields = ['phone', 'pronouns']
        widgets = {
            'phone': forms.TextInput(attrs={
                'placeholder': '+44 1234 567890',
                'type': 'tel',
            }),
            'pronouns': forms.Select(),
        }
        labels = {
            'phone': 'Phone Number',
            'pronouns': 'Pronouns',
        }
        help_texts = {
            'pronouns': 'How would you like to be addressed?',
        }
