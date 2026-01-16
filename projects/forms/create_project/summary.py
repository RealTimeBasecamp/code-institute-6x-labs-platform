"""
Project Creation Wizard - Final Step: Summary/Confirmation

This step displays a summary of the project being created and
shows who is creating it. No fields to fill in - just confirmation.
"""
from django import forms


class ProjectSummaryForm(forms.Form):
    """
    Summary confirmation step - displays project info before submission.

    This is a plain Form (not ModelForm) as it doesn't save any data.
    The created_by field is set via get_extra_create_data in the wizard.
    
    Template: projects/wizard_steps/create_project/summary.html (auto-generated)
    """

    # No fields - this is a display-only confirmation step
    title = 'Summary'