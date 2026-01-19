"""
Step 5: Contact information.

Field requirements inherited from Contact model:
- All fields are optional (blank=True on model)

Since all fields are optional, this step is skippable.

This form includes:
- Company details (name, email, phone, website)
- Primary contact (title, name, pronouns, email, phone)
- Land owner contact (title, name, pronouns, email, phone, organization, preferred method)
- Secondary contact (title, name, pronouns, email, phone)
- Notes

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
            'company_website',
            # Primary contact
            'primary_contact_title',
            'primary_contact_name',
            'primary_contact_pronouns',
            'primary_contact_email',
            'primary_contact_phone',
            # Land owner
            'land_owner_title',
            'land_owner_name',
            'land_owner_pronouns',
            'land_owner_email',
            'land_owner_phone',
            'land_owner_organization',
            'land_owner_preferred_contact_method',
            # Secondary contact
            'secondary_contact_title',
            'secondary_contact_name',
            'secondary_contact_pronouns',
            'secondary_contact_email',
            'secondary_contact_phone',
            # Notes
            'notes',
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
            'company_website': forms.URLInput(attrs={
                'placeholder': 'https://www.example.com',
            }),
            # Primary contact
            'primary_contact_title': forms.TextInput(attrs={
                'placeholder': 'e.g., Project Manager',
            }),
            'primary_contact_name': forms.TextInput(attrs={
                'placeholder': 'Full name',
            }),
            'primary_contact_pronouns': forms.TextInput(attrs={
                'placeholder': 'e.g., they/them',
            }),
            'primary_contact_email': forms.EmailInput(attrs={
                'placeholder': 'name@example.com',
            }),
            'primary_contact_phone': forms.TextInput(attrs={
                'placeholder': '+44 1234 567890',
                'type': 'tel',
            }),
            # Land owner
            'land_owner_title': forms.TextInput(attrs={
                'placeholder': 'e.g., Estate Owner',
            }),
            'land_owner_name': forms.TextInput(attrs={
                'placeholder': 'Full name',
            }),
            'land_owner_pronouns': forms.TextInput(attrs={
                'placeholder': 'e.g., she/her',
            }),
            'land_owner_email': forms.EmailInput(attrs={
                'placeholder': 'name@example.com',
            }),
            'land_owner_phone': forms.TextInput(attrs={
                'placeholder': '+44 1234 567890',
                'type': 'tel',
            }),
            'land_owner_organization': forms.TextInput(attrs={
                'placeholder': 'Organization or estate name',
            }),
            'land_owner_preferred_contact_method': forms.TextInput(attrs={
                'placeholder': 'e.g., Email, Phone, Post',
            }),
            # Secondary contact
            'secondary_contact_title': forms.TextInput(attrs={
                'placeholder': 'e.g., Site Manager',
            }),
            'secondary_contact_name': forms.TextInput(attrs={
                'placeholder': 'Full name',
            }),
            'secondary_contact_pronouns': forms.TextInput(attrs={
                'placeholder': 'e.g., he/him',
            }),
            'secondary_contact_email': forms.EmailInput(attrs={
                'placeholder': 'name@example.com',
            }),
            'secondary_contact_phone': forms.TextInput(attrs={
                'placeholder': '+44 1234 567890',
                'type': 'tel',
            }),
            # Notes
            'notes': forms.Textarea(attrs={
                'placeholder': 'Any additional contact notes...',
                'rows': 3,
            }),
        }
        labels = {
            # Company
            'company_name': 'Company Name',
            'company_email': 'Company Email',
            'company_phone': 'Company Phone',
            'company_website': 'Company Website',
            # Primary contact
            'primary_contact_title': 'Title/Role',
            'primary_contact_name': 'Name',
            'primary_contact_pronouns': 'Pronouns',
            'primary_contact_email': 'Email',
            'primary_contact_phone': 'Phone',
            # Land owner
            'land_owner_title': 'Title/Role',
            'land_owner_name': 'Name',
            'land_owner_pronouns': 'Pronouns',
            'land_owner_email': 'Email',
            'land_owner_phone': 'Phone',
            'land_owner_organization': 'Organization',
            'land_owner_preferred_contact_method': 'Preferred Contact Method',
            # Secondary contact
            'secondary_contact_title': 'Title/Role',
            'secondary_contact_name': 'Name',
            'secondary_contact_pronouns': 'Pronouns',
            'secondary_contact_email': 'Email',
            'secondary_contact_phone': 'Phone',
            # Notes
            'notes': 'Notes',
        }
