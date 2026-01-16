"""
Project Deletion Wizard - Step 1: Summary/Warning

Displays project details and warns user about deletion consequences.
No fields to fill in - just review and confirmation to proceed.
"""
from django import forms


class ProjectDeleteSummaryForm(forms.Form):
    """
    Summary/warning step - displays project info before deletion confirmation.

    This is a plain Form (not ModelForm) as it doesn't save any data.
    The next step (delete_confirm) will require typing the project name.

    Template: projects/wizard_steps/delete_project/delete_summary.html
    """

    # No fields - this is a display-only warning step
    title = 'Review Project'
