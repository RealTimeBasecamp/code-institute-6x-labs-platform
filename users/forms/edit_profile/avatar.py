"""
Step 5: Avatar selection.

Field requirements inherited from User model:
- avatar: optional (blank=True on model)
"""
from django import forms

from core.forms.wizard_forms import WizardModelForm
from users.models import User


class UserAvatarForm(WizardModelForm):
    """Avatar selection - profile image URL."""

    title = 'Avatar'

    class Meta:
        model = User
        fields = ['avatar']
        widgets = {
            'avatar': forms.TextInput(attrs={
                'placeholder': 'https://example.com/avatar.jpg',
            }),
        }
        labels = {
            'avatar': 'Avatar',
        }
        help_texts = {
            'avatar': 'Enter an avatar URL or leave blank for default',
        }

    def clean_avatar(self):
        """
        Validate avatar URL format if provided.

        Returns:
            str: Cleaned avatar URL or empty string
        """
        avatar = self.cleaned_data.get('avatar', '')
        if avatar and not avatar.startswith(('http://', 'https://', '/')):
            raise forms.ValidationError(
                "Avatar must be a valid URL starting with http://, https://, or /"
            )
        return avatar
