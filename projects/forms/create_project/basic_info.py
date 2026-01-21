"""
Step 1: Basic project information.

Field requirements inherited from Project model:
- name: required (no blank=True on model)
- project_type: required (no blank=True on model)
- status: optional (null=True, blank=True on model) - ForeignKey to Status
- description: optional (blank=True on model)
"""
from django import forms

from core.forms.wizard_forms import WizardModelForm
from projects.models import Project


class ProjectBasicInfoForm(WizardModelForm):
    """Basic project info - name, type, status, description."""

    title = 'Basic Info'  # Optional: override auto-generated title

    class Meta:
        model = Project
        fields = ['name', 'project_type', 'status', 'description']
        widgets = {
            'name': forms.TextInput(attrs={
                'placeholder': 'Enter project name',
                'autofocus': True,
            }),
            'project_type': forms.Select(),
            'status': forms.Select(),
            'description': forms.Textarea(attrs={
                'placeholder': 'Describe the project goals and scope...',
                'rows': 4,
            }),
        }
        labels = {
            'name': 'Project Name',
            'project_type': 'Project Type',
            'status': 'Status',
            'description': 'Description',
        }
