"""
Step 3: Project location address.

Field requirements inherited from Address model:
- address_line_1: required (no blank=True on model)
- city: required (no blank=True on model)
- country_code: optional (blank=True on model)
- address_line_2: optional (blank=True on model)
- region: optional (blank=True on model)
- postcode: optional (blank=True on model)
"""
from django import forms

from core.forms.wizard_forms import WizardModelForm
from core.models import Address


class ProjectAddressForm(WizardModelForm):
    """Project location - full address details."""

    title = 'Address'

    class Meta:
        model = Address
        fields = [
            'address_line_1', 'city', 'country_code',
            'address_line_2', 'region', 'postcode'
        ]
        widgets = {
            'address_line_1': forms.TextInput(attrs={
                'placeholder': 'Street address',
            }),
            'address_line_2': forms.TextInput(attrs={
                'placeholder': 'Apartment, suite, unit, etc.',
            }),
            'city': forms.TextInput(attrs={
                'placeholder': 'City or town',
            }),
            'region': forms.TextInput(attrs={
                'placeholder': 'State, province, or region',
            }),
            'postcode': forms.TextInput(attrs={
                'placeholder': 'Postal/ZIP code',
            }),
        }
        labels = {
            'address_line_1': 'Address Line 1',
            'address_line_2': 'Address Line 2',
            'city': 'City',
            'region': 'Region/State',
            'postcode': 'Postcode',
            'country_code': 'Country',
        }
