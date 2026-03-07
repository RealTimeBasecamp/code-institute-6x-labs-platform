from django.db import models
from django.contrib.auth.models import AbstractUser


# =============================================================================
# SUBSCRIPTION TIER (Controls feature access for paying customers)
# =============================================================================
class SubscriptionTier(models.Model):
    """
    Subscription tier that controls feature access.

    Data comes from: Admin panel or management commands (seed data).
    Related to User model through ForeignKey relationship.

    Staff/superusers bypass tier checks via Django's is_staff/is_superuser flags.
    """
    slug = models.SlugField(unique=True, max_length=50)
    name = models.CharField(max_length=100)
    level = models.PositiveIntegerField(default=0, help_text="Lower number = more access")
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ['level']

    def __str__(self):
        return self.name


# =============================================================================
# USER (Custom user model extending Django's AbstractUser)
# =============================================================================
class User(AbstractUser):
    """
    Custom user model that extends Django's AbstractUser.

    Inherited fields from AbstractUser:
    - username, email, password, first_name, last_name
    - is_staff, is_active, is_superuser, date_joined, last_login

    Staff/superusers bypass subscription tier checks automatically.
    """
    # Pronouns choices
    PRONOUNS_PREFER_NOT_TO_SAY = ''
    PRONOUNS_HE_HIM = 'he/him'
    PRONOUNS_SHE_HER = 'she/her'
    PRONOUNS_THEY_THEM = 'they/them'
    PRONOUNS_OTHER = 'other'

    PRONOUNS_CHOICES = [
        (PRONOUNS_PREFER_NOT_TO_SAY, 'Prefer not to say'),
        (PRONOUNS_HE_HIM, 'He/Him'),
        (PRONOUNS_SHE_HER, 'She/Her'),
        (PRONOUNS_THEY_THEM, 'They/Them'),
        (PRONOUNS_OTHER, 'Other'),
    ]

    # Profile fields
    phone = models.CharField(max_length=30, blank=True)
    pronouns = models.CharField(max_length=20, blank=True, choices=PRONOUNS_CHOICES)
    title = models.CharField(max_length=100, blank=True)
    department = models.CharField(max_length=100, blank=True)

    # Subscription & preferences
    subscription_tier = models.ForeignKey(
        SubscriptionTier,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='users',
        help_text="Subscription tier for feature access. Staff/superusers bypass this."
    )
    display_name = models.CharField(max_length=255, blank=True)
    avatar = models.CharField(max_length=255, blank=True)

    # UI preferences
    theme = models.CharField(
        max_length=20,
        default='default',
        choices=[
            ('default', 'Default'),
            ('moon', 'Moon'),
            ('gaia', 'Gaia'),
            ('sunset', 'Sunset'),
            ('honeycomb', 'Honeycomb'),
            ('ocean', 'Ocean'),
            ('6xlabs', '6xLabs'),
        ],
        help_text="Color theme selection"
    )
    theme_mode = models.CharField(
        max_length=10,
        default='system',
        choices=[
            ('light', 'Light'),
            ('dark', 'Dark'),
            ('system', 'System'),
        ],
        help_text="Light/Dark mode preference"
    )
    sidebar_width = models.CharField(max_length=20, default='280px')

    # Onboarding status
    profile_setup_complete = models.BooleanField(
        default=False,
        help_text="Whether user has completed the profile setup wizard"
    )

    def __str__(self):
        if self.display_name:
            return self.display_name
        if self.get_full_name():
            return self.get_full_name()
        return self.username

    def has_feature_access(self, nav_item_id):
        """Check if user has access to a specific feature/navigation item."""
        from core.models import NavigationItem

        # Staff and superusers always have access
        if self.is_staff or self.is_superuser:
            return True

        # Check subscription tier
        if not self.subscription_tier:
            return False

        try:
            nav_item = NavigationItem.objects.get(item_id=nav_item_id)
            return nav_item.allowed_tiers.filter(pk=self.subscription_tier.pk).exists()
        except NavigationItem.DoesNotExist:
            return True  # If nav item doesn't exist, allow access
