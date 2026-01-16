"""
Step 1: Confirm project deletion.

Requires user to type the project name to confirm deletion.
This prevents accidental deletions by requiring explicit confirmation.

Validation is done in the wizard's on_complete method to access session data.
"""
from django import forms

from core.forms.wizard_forms import WizardStepForm


class ProjectDeleteConfirmForm(WizardStepForm):
    """
    Confirm project deletion by typing the project name.

    The confirm_name field collects user input. Actual validation that it
    matches the project name is done in ProjectDeleteWizard.on_complete()
    where we have access to the project from session context.

    Template: projects/wizard_steps/delete_project/delete_confirm.html
    """

    title = 'Confirm Deletion'

    confirm_name = forms.CharField(
        label='Type project name to confirm',
        help_text='This action cannot be undone.',
        widget=forms.TextInput(attrs={
            'placeholder': 'Enter exact project name',
            'autocomplete': 'off',
            'class': 'form-control',
        })
    )
