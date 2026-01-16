"""
Step 5: Contact information.

Field requirements inherited from Contact model:
- All fields are optional (blank=True on model)

Since all fields are optional, this step is skippable.
"""
from django import forms

from core.forms.wizard_forms import WizardModelForm
from core.models import Contact


class ProjectContactForm(WizardModelForm):
    """Contact information - company and primary contact."""

    title = 'Contact'

    class Meta:
        model = Contact
        fields = [
            'company_name', 'company_email', 'company_phone',
            'primary_contact_name', 'primary_contact_email', 'primary_contact_phone',
        ]
        widgets = {
            'company_name': forms.TextInput(attrs={
                'placeholder': 'Organization name',
            }),
            'company_email': forms.EmailInput(attrs={
                'placeholder': 'contact@company.com',
            }),
            'company_phone': forms.TextInput(attrs={
                'placeholder': '+44 1234 567890',
                'type': 'tel',
            }),
            'primary_contact_name': forms.TextInput(attrs={
                'placeholder': 'Full name',
            }),
            'primary_contact_email': forms.EmailInput(attrs={
                'placeholder': 'name@example.com',
            }),
            'primary_contact_phone': forms.TextInput(attrs={
                'placeholder': '+44 1234 567890',
                'type': 'tel',
            }),
        }
        labels = {
            'company_name': 'Company/Organization Name',
            'company_email': 'Company Email',
            'company_phone': 'Company Phone',
            'primary_contact_name': 'Primary Contact Name',
            'primary_contact_email': 'Primary Contact Email',
            'primary_contact_phone': 'Primary Contact Phone',
        }
