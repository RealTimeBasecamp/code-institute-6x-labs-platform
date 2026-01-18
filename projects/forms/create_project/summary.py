"""
Project Creation Wizard - Final Step: Summary/Confirmation

This step displays a summary of the project being created and
shows who is creating it. No fields to fill in - just confirmation.
"""
from core.forms.wizard_forms import WizardModelForm
from projects.models import Project


class ProjectSummaryForm(WizardModelForm):
    """
    Summary confirmation step - displays project info before submission.

    Uses WizardModelForm with no fields for consistency with other wizard forms.
    The created_by field is set via get_extra_create_data in the wizard.
    
    Template: projects/wizard_steps/create_project/summary.html (auto-generated)
    """

    title = 'Summary'

    class Meta:
        model = Project
        fields = []  # No editable fields - display only