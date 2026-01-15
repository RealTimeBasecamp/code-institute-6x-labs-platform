"""
Step 3: Work information.

Field requirements inherited from User model:
- title: optional (blank=True on model)
- department: optional (blank=True on model)
"""
from django import forms

from core.forms.wizard_forms import WizardModelForm
from users.models import User


class UserWorkInfoForm(WizardModelForm):
    """Work info - job title and department."""

    title = 'Work'

    class Meta:
        model = User
        fields = ['title', 'department']
        widgets = {
            'title': forms.TextInput(attrs={
                'placeholder': 'e.g., Project Manager',
            }),
            'department': forms.TextInput(attrs={
                'placeholder': 'e.g., Operations',
            }),
        }
        labels = {
            'title': 'Job Title',
            'department': 'Department',
        }
