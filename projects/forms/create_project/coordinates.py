"""
Step 4: GPS coordinates.

Field requirements inherited from Coordinate model:
- latitude: required (no blank=True on model)
- longitude: required (no blank=True on model)
- altitude: optional (blank=True on model)
- elevation: optional (blank=True on model)
- coordinate_system: optional with default "WGS84"
- what3w: optional (blank=True on model)

Note: Since the Coordinate FK on Project is nullable, this entire step
is skippable. However, if ANY coordinate field is filled in, both
latitude and longitude MUST be provided.

Custom validation allows:
1. All fields empty → skip coordinates (no Coordinate record created)
2. Both lat/long + optional others → create Coordinate
3. Partial fields (only one of lat/long) → validation error
"""
from django import forms

from core.forms.wizard_forms import WizardModelForm
from core.models import Coordinate


class ProjectCoordinatesForm(WizardModelForm):
    """GPS coordinates - all fields from Coordinate model."""

    title = 'Coordinates'

    # Override to make lat/long optional in form (validation handles it)
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
        fields = [
            'latitude',
            'longitude',
            'altitude',
            'elevation',
            'coordinate_system',
            'what3w',
        ]
        widgets = {
            'altitude': forms.NumberInput(attrs={
                'placeholder': 'e.g., 100.0',
                'step': '0.01',
            }),
            'elevation': forms.NumberInput(attrs={
                'placeholder': 'e.g., 150.0',
                'step': '0.01',
            }),
            'coordinate_system': forms.TextInput(attrs={
                'placeholder': 'e.g., WGS84',
            }),
            'what3w': forms.TextInput(attrs={
                'placeholder': 'e.g., ///filled.count.soap',
            }),
        }
        labels = {
            'latitude': 'Latitude',
            'longitude': 'Longitude',
            'altitude': 'Altitude (meters)',
            'elevation': 'Elevation (meters)',
            'coordinate_system': 'Coordinate System',
            'what3w': 'What3Words',
        }
        help_texts = {
            'altitude': 'Height above sea level at this point.',
            'elevation': 'Ground elevation at this point.',
            'coordinate_system': 'Default is WGS84 (standard GPS).',
            'what3w': 'Three-word address from what3words.com',
        }

    def clean(self):
        """Validate coordinate fields.

        Rules:
        - Both lat/long must be provided together (can't have just one)
        - If both are empty, that's valid (skip coordinates)
        - All other fields are always optional
        """
        cleaned_data = super().clean()
        latitude = cleaned_data.get('latitude')
        longitude = cleaned_data.get('longitude')

        # Both must be provided together, or both must be empty
        has_lat = latitude is not None
        has_long = longitude is not None
        if has_lat != has_long:
            raise forms.ValidationError(
                "Both latitude and longitude must be provided together, "
                "or both left empty to skip coordinates."
            )

        return cleaned_data
