"""
Step 2: Environmental conditions.

Field requirements inherited from Project model:
- soil_type: required (no blank=True on model)
- climate: required (no blank=True on model)
- area_hectares: optional (blank=True on model)
"""
from django import forms

from core.forms.wizard_forms import WizardModelForm
from projects.models import Project


class ProjectEnvironmentForm(WizardModelForm):
    """Environmental conditions - soil, climate, area."""

    title = 'Environment'

    class Meta:
        model = Project
        fields = ['soil_type', 'climate', 'area_hectares']
        widgets = {
            'soil_type': forms.Select(),
            'climate': forms.Select(),
            'area_hectares': forms.NumberInput(attrs={
                'placeholder': 'e.g., 50.5',
                'step': '0.01',
                'min': '0',
            }),
        }
        labels = {
            'soil_type': 'Soil Type',
            'climate': 'Climate',
            'area_hectares': 'Area (hectares)',
        }
