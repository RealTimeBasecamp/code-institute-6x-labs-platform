from django.db import models
from django_countries.fields import CountryField
from django.core.exceptions import ValidationError


# =============================================================================
# NAVIGATION ITEM (Self-referential for nested menus)
# =============================================================================
class NavigationItem(models.Model):
    """Navigation menu item with tier-based access control."""

    TYPE_CHOICES = [
        ('profile', 'Profile'),
        ('modal', 'Modal Trigger'),
        ('link', 'Link'),
        ('parent', 'Parent (has children)'),
    ]

    # Core fields
    item_id = models.SlugField(unique=True, max_length=100)
    item_type = models.CharField(max_length=20, choices=TYPE_CHOICES, default='link')
    label = models.CharField(max_length=100)
    icon = models.CharField(max_length=100, help_text="Bootstrap icon class or image path")
    url_name = models.CharField(
        max_length=255,
        blank=True,
        help_text="Django URL name (e.g., 'projects:project_planner') or path"
    )
    is_active = models.BooleanField(default=True, help_text="False = 'Coming Soon'")
    is_footer = models.BooleanField(
        default=False,
        help_text="If True, render this nav item pinned to the bottom of the sidebar"
    )

    # Hierarchy
    parent = models.ForeignKey(
        'self',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='children'
    )
    display_order = models.PositiveIntegerField(default=0)

    # Access control
    allowed_tiers = models.ManyToManyField(
        'users.SubscriptionTier',
        related_name='accessible_nav_items',
        blank=True,
        help_text="Tiers that can access this item. Staff/superusers always have access."
    )
    staff_only = models.BooleanField(
        default=False,
        help_text="If True, only staff/superusers can see this item. Regular users won't see it at all."
    )

    class Meta:
        ordering = ['display_order', 'label']

    def __str__(self):
        return f"{self.label} ({self.item_id})"

    def is_allowed_for_user(self, user):
        """Check if this item is accessible for a given user."""
        if not user.is_authenticated:
            return False
        # Staff and superusers bypass tier checks
        if user.is_staff or user.is_superuser:
            return True
        # Check user's subscription tier
        if hasattr(user, 'subscription_tier') and user.subscription_tier:
            return self.allowed_tiers.filter(pk=user.subscription_tier.pk).exists()
        return False


# =============================================================================
# COORDINATE
# =============================================================================
class Coordinate(models.Model):
    latitude = models.DecimalField(
        max_digits=10, decimal_places=7, db_index=True, null=True, blank=True
    )
    longitude = models.DecimalField(
        max_digits=11, decimal_places=7, db_index=True, null=True, blank=True
    )
    altitude = models.DecimalField(max_digits=7, decimal_places=2, null=True, blank=True)
    elevation = models.DecimalField(max_digits=7, decimal_places=2, null=True, blank=True)
    coordinate_system = models.CharField(max_length=20, default="WGS84", blank=True)
    what3w = models.CharField(max_length=50, null=True, blank=True, db_index=True)

    def __str__(self):
        if self.latitude and self.longitude:
            return f"{self.latitude}, {self.longitude}"
        return "No coordinates"


# =============================================================================
# ADDRESS
# =============================================================================
class Address(models.Model):
    address_line_1 = models.CharField(max_length=255)
    address_line_2 = models.CharField(max_length=255, null=True, blank=True)
    city = models.CharField(max_length=100, db_index=True)
    region = models.CharField(max_length=100, null=True, blank=True)
    postcode = models.CharField(max_length=20, null=True, blank=True, db_index=True)
    country_code = CountryField(null=True, blank=True, db_index=True)

    class Meta:
        verbose_name_plural = "Addresses"

    def __str__(self):
        return f"{self.address_line_1}, {self.city}"


# =============================================================================
# CONTACT
# =============================================================================
class Contact(models.Model):
    # Company details
    company_name = models.CharField(max_length=255, null=True, blank=True)
    company_email = models.EmailField(max_length=255, null=True, blank=True)
    company_phone = models.CharField(max_length=30, null=True, blank=True)
    company_website = models.URLField(max_length=255, null=True, blank=True)

    # Primary contact
    primary_contact_title = models.CharField(max_length=100, null=True, blank=True)
    primary_contact_name = models.CharField(max_length=255, null=True, blank=True)
    primary_contact_pronouns = models.CharField(max_length=20, null=True, blank=True)
    primary_contact_email = models.EmailField(max_length=255, null=True, blank=True)
    primary_contact_phone = models.CharField(max_length=30, null=True, blank=True)

    # Secondary contact (optional)
    secondary_contact_title = models.CharField(max_length=100, null=True, blank=True)
    secondary_contact_name = models.CharField(max_length=255, null=True, blank=True)
    secondary_contact_pronouns = models.CharField(max_length=20, null=True, blank=True)
    secondary_contact_email = models.EmailField(max_length=255, null=True, blank=True)
    secondary_contact_phone = models.CharField(max_length=30, null=True, blank=True)

    # Land owner (may differ from primary contact)
    land_owner_title = models.CharField(max_length=100, null=True, blank=True)
    land_owner_name = models.CharField(max_length=255, null=True, blank=True)
    land_owner_pronouns = models.CharField(max_length=20, null=True, blank=True)
    land_owner_email = models.EmailField(max_length=255, null=True, blank=True)
    land_owner_phone = models.CharField(max_length=30, null=True, blank=True)
    land_owner_organization = models.CharField(max_length=255, null=True, blank=True)
    land_owner_preferred_contact_method = models.CharField(max_length=20, null=True, blank=True)

    # Notes
    notes = models.TextField(null=True, blank=True)

    def __str__(self):
        if self.company_name:
            return self.company_name
        if self.primary_contact_name:
            return f"Contact: {self.primary_contact_name}"
        if self.land_owner_name:
            return f"Landowner: {self.land_owner_name}"
        return f"Contact #{self.pk}"
