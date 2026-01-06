from django.db import models
from django.contrib.auth.models import AbstractUser


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
    # Profile fields
    phone = models.CharField(max_length=30, blank=True)
    pronouns = models.CharField(max_length=20, blank=True)
    title = models.CharField(max_length=100, blank=True)
    department = models.CharField(max_length=100, blank=True)

    # Subscription & preferences
    subscription_tier = models.ForeignKey(
        'core.SubscriptionTier',
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
        default='dark',
        choices=[
            ('light', 'Light'),
            ('dark', 'Dark'),
            ('system', 'System'),
        ]
    )
    sidebar_width = models.CharField(max_length=20, default='280px')

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
