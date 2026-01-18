"""
Step 5: Contact information.

Field requirements inherited from Contact model:
- All fields are optional (blank=True on model)

Since all fields are optional, this step is skippable.

This form includes:
- Company details (name, email, phone)
- Primary contact (name, email, phone)
- Land owner contact (name, email, phone)
- Secondary contact (name, email, phone)

These match the Contact Information card displayed on the project planner.
"""
from django import forms

from core.forms.wizard_forms import WizardModelForm
from core.models import Contact


class ProjectContactForm(WizardModelForm):
    """Contact information - company, primary, land owner, secondary."""

    title = 'Contact'

    class Meta:
        model = Contact
        fields = [
            # Company
            'company_name',
            'company_email',
            'company_phone',
            # Primary contact
            'primary_contact_name',
            'primary_contact_email',
            'primary_contact_phone',
            # Land owner
            'land_owner_name',
            'land_owner_email',
            'land_owner_phone',
            # Secondary contact
            'secondary_contact_name',
            'secondary_contact_email',
            'secondary_contact_phone',
        ]
        widgets = {
            # Company
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
            # Primary contact
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
            # Land owner
            'land_owner_name': forms.TextInput(attrs={
                'placeholder': 'Full name',
            }),
            'land_owner_email': forms.EmailInput(attrs={
                'placeholder': 'name@example.com',
            }),
            'land_owner_phone': forms.TextInput(attrs={
                'placeholder': '+44 1234 567890',
                'type': 'tel',
            }),
            # Secondary contact
            'secondary_contact_name': forms.TextInput(attrs={
                'placeholder': 'Full name',
            }),
            'secondary_contact_email': forms.EmailInput(attrs={
                'placeholder': 'name@example.com',
            }),
            'secondary_contact_phone': forms.TextInput(attrs={
                'placeholder': '+44 1234 567890',
                'type': 'tel',
            }),
        }
        labels = {
            'company_name': 'Company Name',
            'company_email': 'Company Email',
            'company_phone': 'Company Phone',
            'primary_contact_name': 'Primary Contact Name',
            'primary_contact_email': 'Primary Contact Email',
            'primary_contact_phone': 'Primary Contact Phone',
            'land_owner_name': 'Land Owner Name',
            'land_owner_email': 'Land Owner Email',
            'land_owner_phone': 'Land Owner Phone',
            'secondary_contact_name': 'Secondary Contact Name',
            'secondary_contact_email': 'Secondary Contact Email',
            'secondary_contact_phone': 'Secondary Contact Phone',
        }
