"""
Step 4: GPS coordinates.

Field requirements inherited from Coordinate model:
- latitude: required (no blank=True on model)
- longitude: required (no blank=True on model)
- altitude: optional (blank=True on model)

Note: Since the Coordinate FK on Project is nullable, this entire step
is skippable. However, if ANY coordinate field is filled in, both
latitude and longitude MUST be provided.

Custom validation allows:
1. All fields empty → skip coordinates (no Coordinate record created)
2. Both lat/long + optional altitude → create Coordinate
3. Partial fields (only one of lat/long) → validation error
"""
from django import forms

from core.forms.wizard_forms import WizardModelForm
from core.models import Coordinate


class ProjectCoordinatesForm(WizardModelForm):
    """GPS coordinates - latitude, longitude, altitude."""

    title = 'Coordinates'

    # Override to make fields optional in form (validation handles it)
    latitude = forms.DecimalField(
        max_digits=10,
        decimal_places=7,
        required=False,
        widget=forms.NumberInput(attrs={
            'placeholder': 'e.g., 51.5074',
            'step': 'any',
            'min': '-90',
            'max': '90',
        })
    )
    longitude = forms.DecimalField(
        max_digits=11,
        decimal_places=7,
        required=False,
        widget=forms.NumberInput(attrs={
            'placeholder': 'e.g., -0.1278',
            'step': 'any',
            'min': '-180',
            'max': '180',
        })
    )

    class Meta:
        model = Coordinate
        fields = ['latitude', 'longitude', 'altitude']
        widgets = {
            'altitude': forms.NumberInput(attrs={
                'placeholder': 'e.g., 100.0',
                'step': '0.01',
            }),
        }
        labels = {
            'latitude': 'Latitude',
            'longitude': 'Longitude',
            'altitude': 'Altitude (meters)',
        }

    def clean(self):
        """Validate coordinate fields.
        
        Rules:
        - Both lat/long must be provided together (can't have just one)
        - If both are empty, that's valid (skip coordinates)
        - Altitude is always optional
        """
        cleaned_data = super().clean()
        latitude = cleaned_data.get('latitude')
        longitude = cleaned_data.get('longitude')

        # Both must be provided together, or both must be empty
        if (latitude is not None and longitude is None) or \
           (latitude is None and longitude is not None):
            raise forms.ValidationError(
                "Both latitude and longitude must be provided together, "
                "or both left empty to skip coordinates."
            )

        return cleaned_data
